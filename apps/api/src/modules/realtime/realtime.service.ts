import { Injectable, Logger } from '@nestjs/common';
import type { Server } from 'socket.io';
import { realtimeBusinessRoom, realtimeUserRoom } from '@app/contracts';

/**
 * Server-side realtime emit surface (B5.5). The gateway hands the Socket.IO
 * server over here once initialized; every OTHER module that needs to push
 * an event injects THIS service — never the gateway — so the transport
 * stays swappable and tests can substitute a spy.
 *
 * Delivery semantics: `io.to(room).emit` is fire-and-forget. With the Redis
 * adapter attached the emit is fanned out to every gateway instance (the
 * pub/sub hop), so an event emitted in process A reaches a socket connected
 * to process B. Without Redis the emit stays local to this instance — the
 * documented fail-soft behavior (see DECISIONS.md, B5.5).
 *
 * Room names come from contracts helpers (single spelling, server-enforced
 * grammar) — callers never construct room strings by hand.
 */
@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);
  private server: Server | null = null;

  /** Called once by RealtimeGateway.afterInit. Safe to call again (idempotent). */
  registerServer(server: Server): void {
    this.server = server;
  }

  /** True once the gateway has handed over a live server instance. */
  isReady(): boolean {
    return this.server !== null;
  }

  /** Push `event` to every socket joined into `user:<userId>` (all instances). */
  emitToUser(userId: string, event: string, payload: unknown): void {
    if (!this.server) {
      this.logger.debug(`emitToUser(${userId}) skipped — gateway not initialized yet`);
      return;
    }
    this.server.to(realtimeUserRoom(userId)).emit(event, payload);
  }

  /** Push `event` to every socket joined into `business:<businessId>` (all instances). */
  emitToBusiness(businessId: string, event: string, payload: unknown): void {
    if (!this.server) {
      this.logger.debug(`emitToBusiness(${businessId}) skipped — gateway not initialized yet`);
      return;
    }
    this.server.to(realtimeBusinessRoom(businessId)).emit(event, payload);
  }
}
