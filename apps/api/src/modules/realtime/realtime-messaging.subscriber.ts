import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { MessageCreatedEvent, MessageDeletedEvent } from '@app/contracts';
import {
  MESSAGING_EVENTS,
  REALTIME_EVENTS,
  messageCreatedEventSchema,
  messageDeletedEventSchema,
} from '@app/contracts';
// Value import: Nest reads the type at runtime via emitDecoratorMetadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { RealtimeService } from './realtime.service.js';

/**
 * Realtime messaging fan-out (B5.6). The messaging service emits
 * `messaging.message.created` / `messaging.message.deleted` AFTER the row
 * is committed; THIS subscriber is the only transport hop:
 *
 * - `conversation:message` (+ the deleted twin) goes to the
 *   `conversation:<id>` room — every socket that explicitly joined the
 *   thread (the open chat window);
 * - the SAME event also goes to each recipient's `user:<id>` room — the
 *   inbox badge/list updates without joining every conversation room.
 *   The sender is excluded (recipientIds already is; their own HTTP
 *   response is the ack).
 *
 * Best-effort, always: a malformed payload is logged and dropped, a
 * gateway-not-ready emit is skipped by RealtimeService itself — a push
 * failure must never break a send. Payloads are zod-guarded HERE so a
 * drift upstream surfaces as a skipped event + log, not garbage on the
 * wire.
 */
@Injectable()
export class RealtimeMessagingSubscriber {
  private readonly logger = new Logger(RealtimeMessagingSubscriber.name);

  constructor(private readonly realtime: RealtimeService) {}

  @OnEvent(MESSAGING_EVENTS.messageCreated)
  handleCreated(payload: unknown): void {
    const parsed = messageCreatedEventSchema.safeParse(payload);
    if (!parsed.success) {
      this.logger.warn(
        `messaging.message.created payload drift: ${parsed.error.message.slice(0, 200)}`,
      );
      return;
    }
    const event = parsed.data as MessageCreatedEvent;
    this.realtime.emitToConversation(
      event.conversationId,
      REALTIME_EVENTS.conversationMessage,
      event,
    );
    for (const recipientId of event.recipientIds) {
      this.realtime.emitToUser(recipientId, REALTIME_EVENTS.conversationMessage, event);
    }
  }

  @OnEvent(MESSAGING_EVENTS.messageDeleted)
  handleDeleted(payload: unknown): void {
    const parsed = messageDeletedEventSchema.safeParse(payload);
    if (!parsed.success) {
      this.logger.warn(
        `messaging.message.deleted payload drift: ${parsed.error.message.slice(0, 200)}`,
      );
      return;
    }
    const event = parsed.data as MessageDeletedEvent;
    this.realtime.emitToConversation(
      event.conversationId,
      REALTIME_EVENTS.conversationMessageDeleted,
      event,
    );
    for (const recipientId of event.recipientIds) {
      this.realtime.emitToUser(recipientId, REALTIME_EVENTS.conversationMessageDeleted, event);
    }
  }
}
