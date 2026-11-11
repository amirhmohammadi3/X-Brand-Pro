import { describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { NotificationsEventsSubscriber } from '../src/modules/notifications/notifications-events.subscriber.js';
import type { UserRow } from '../src/db/schema/users.js';

/**
 * B5.7 NotificationsEventsSubscriber — the event→notification wiring, pure:
 * the 1:1 catalog mapping (review.replied→author, review.voted→author via
 * the payload's authorId, question.answered→asker, follow.created→followed
 * USER only, favorite.added→business OWNER), the self-notification
 * suppressions, the active-recipient gate, the {actor}/{business} template
 * vars and the BEST-EFFORT posture (a dead lookup never throws). The
 * @OnEvent registration itself is framework wiring; the handlers are called
 * directly here, exactly as EventEmitter2 would.
 */

const AUTHOR = '11111111-1111-4111-8111-111111111111';
const ASKER = '12121212-1212-4212-8212-121212121212';
const OWNER = '13131313-1313-4313-8313-131313131313';
const ACTOR = '14141414-1414-4414-8414-141414141414';
const FOLLOWER = '15151515-1515-4515-8515-151515151515';
const GHOST = '99999999-9999-4999-8999-999999999999';
const REVIEW = '21212121-2121-4212-8212-212121212121';
const QUESTION = '22222222-2222-4222-8222-222222222222';
const BIZ = '23232323-2323-4232-8232-232323232323';

function userRow(id: string, overrides: Partial<UserRow> = {}): UserRow {
  return {
    id,
    username: `user-${id.slice(0, 4)}`,
    displayName: null,
    status: 'active',
    role: 'user',
    ...overrides,
  } as UserRow;
}

interface NotifyCall {
  userId: string;
  eventKey: string;
  vars: Record<string, string | number>;
}

function makeDeps() {
  const users = new Map<string, UserRow>([
    [AUTHOR, userRow(AUTHOR, { displayName: 'نویسنده' })],
    [ASKER, userRow(ASKER)],
    [OWNER, userRow(OWNER)],
    [ACTOR, userRow(ACTOR, { displayName: 'علی رضایی' })],
    [FOLLOWER, userRow(FOLLOWER)],
  ]);
  const reviewsRows = new Map<string, { userId: string }>([[REVIEW, { userId: AUTHOR }]]);
  const questions = new Map<string, { userId: string }>([[QUESTION, { userId: ASKER }]]);
  const businessesRows = new Map<string, { name: string; ownerId: string | null }>([
    [BIZ, { name: 'کافه نمونه', ownerId: OWNER }],
  ]);
  const notifyCalls: NotifyCall[] = [];

  const subscriber = new NotificationsEventsSubscriber(
    {
      async notify(input: NotifyCall) {
        notifyCalls.push(input);
        return {
          eventKey: input.eventKey,
          channels: { inApp: true, email: false, sms: false, push: false },
          delivered: { inApp: true, email: false, sms: false, push: false },
        };
      },
    } as never,
    {
      async findById(id: string) {
        return users.get(id) ?? null;
      },
    } as never,
    {
      async findById(id: string) {
        const row = businessesRows.get(id);
        return row ? { id, ...row } : null;
      },
    } as never,
    {
      async findById(id: string) {
        const row = reviewsRows.get(id);
        return row ? { id, ...row } : null;
      },
    } as never,
    {
      async findQuestionById(id: string) {
        const row = questions.get(id);
        return row ? { id, ...row } : null;
      },
    } as never,
  );
  // silence the best-effort warn logs in this spec
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

  return { subscriber, notifyCalls, users, reviewsRows, questions, businessesRows };
}

describe('NotificationsEventsSubscriber — B5.7', () => {
  it('review.replied notifies the review AUTHOR with {actor, business} vars', async () => {
    const { subscriber, notifyCalls } = makeDeps();
    await subscriber.handleReviewReplied({
      reviewId: REVIEW,
      businessId: BIZ,
      replyId: 'r1',
      userId: ACTOR,
    });
    expect(notifyCalls).toEqual([
      {
        userId: AUTHOR,
        eventKey: 'review.replied',
        vars: { actor: 'علی رضایی', business: 'کافه نمونه' },
      },
    ]);
  });

  it('review.replied suppresses the self-reply and unknown reviews', async () => {
    const { subscriber, notifyCalls } = makeDeps();
    // the review author replies to their own review — silent
    await subscriber.handleReviewReplied({
      reviewId: REVIEW,
      businessId: BIZ,
      replyId: 'r1',
      userId: AUTHOR,
    });
    // unknown review id — silent (no author to resolve)
    await subscriber.handleReviewReplied({
      reviewId: GHOST,
      businessId: BIZ,
      replyId: 'r1',
      userId: ACTOR,
    });
    // garbage payload — silent
    await subscriber.handleReviewReplied(null);
    await subscriber.handleReviewReplied({});
    expect(notifyCalls).toEqual([]);
  });

  it('review.voted uses the payload authorId and suppresses the self-vote', async () => {
    const { subscriber, notifyCalls } = makeDeps();
    await subscriber.handleReviewVoted({
      reviewId: REVIEW,
      businessId: BIZ,
      userId: ACTOR,
      authorId: AUTHOR,
      value: 1,
    });
    expect(notifyCalls).toEqual([
      { userId: AUTHOR, eventKey: 'review.voted', vars: { business: 'کافه نمونه' } },
    ]);
    await subscriber.handleReviewVoted({
      reviewId: REVIEW,
      businessId: BIZ,
      userId: AUTHOR,
      authorId: AUTHOR,
      value: 1,
    });
    expect(notifyCalls).toHaveLength(1); // the self-vote added nothing
  });

  it('question.answered notifies the asker; the owner answering their own question is silent', async () => {
    const { subscriber, notifyCalls } = makeDeps();
    await subscriber.handleQuestionAnswered({
      questionId: QUESTION,
      businessId: BIZ,
      answerId: 'a1',
      userId: OWNER,
    });
    expect(notifyCalls).toEqual([
      { userId: ASKER, eventKey: 'question.answered', vars: { business: 'کافه نمونه' } },
    ]);
    // the ASKER answering their own question (edge: asker owns the business)
    await subscriber.handleQuestionAnswered({
      questionId: QUESTION,
      businessId: BIZ,
      answerId: 'a2',
      userId: ASKER,
    });
    expect(notifyCalls).toHaveLength(1);
  });

  it('follow.created notifies the followed USER with {actor}; business follows stay silent in v1', async () => {
    const { subscriber, notifyCalls } = makeDeps();
    await subscriber.handleFollowCreated({ followerId: FOLLOWER, kind: 'user', targetId: ACTOR });
    expect(notifyCalls).toEqual([
      {
        userId: ACTOR,
        eventKey: 'follow.created',
        vars: { actor: 'user-' + FOLLOWER.slice(0, 4) },
      },
    ]);
    await subscriber.handleFollowCreated({ followerId: FOLLOWER, kind: 'business', targetId: BIZ });
    expect(notifyCalls).toHaveLength(1);
    // displayName wins over username when present
    await subscriber.handleFollowCreated({ followerId: ACTOR, kind: 'user', targetId: ASKER });
    expect(notifyCalls[1]).toEqual({
      userId: ASKER,
      eventKey: 'follow.created',
      vars: { actor: 'علی رضایی' },
    });
  });

  it('favorite.added notifies the business OWNER; ownerless/self saves are silent', async () => {
    const { subscriber, notifyCalls, businessesRows } = makeDeps();
    await subscriber.handleFavoriteAdded({
      userId: ACTOR,
      businessId: BIZ,
      listId: 'l1',
      itemId: 'i1',
    });
    expect(notifyCalls).toEqual([
      {
        userId: OWNER,
        eventKey: 'business.favorited',
        vars: { actor: 'علی رضایی', business: 'کافه نمونه' },
      },
    ]);
    // the OWNER saving their own business — silent
    await subscriber.handleFavoriteAdded({
      userId: OWNER,
      businessId: BIZ,
      listId: 'l1',
      itemId: 'i2',
    });
    expect(notifyCalls).toHaveLength(1);
    // an UNCLAIMED business has no owner — silent
    businessesRows.set(BIZ, { name: 'کافه بی‌صاحب', ownerId: null });
    await subscriber.handleFavoriteAdded({
      userId: ACTOR,
      businessId: BIZ,
      listId: 'l1',
      itemId: 'i3',
    });
    expect(notifyCalls).toHaveLength(1);
  });

  it('a banned/deleted recipient or actor delivers nothing', async () => {
    const { subscriber, notifyCalls, users } = makeDeps();
    users.set(AUTHOR, userRow(AUTHOR, { status: 'deleted' }));
    await subscriber.handleReviewReplied({
      reviewId: REVIEW,
      businessId: BIZ,
      replyId: 'r1',
      userId: ACTOR,
    });
    await subscriber.handleReviewVoted({
      reviewId: REVIEW,
      businessId: BIZ,
      userId: ACTOR,
      authorId: AUTHOR,
      value: 1,
    });
    expect(notifyCalls).toEqual([]);
    // a deleted ACTOR is not an actor either
    users.set(AUTHOR, userRow(AUTHOR));
    users.set(ACTOR, userRow(ACTOR, { status: 'blocked' }));
    await subscriber.handleReviewReplied({
      reviewId: REVIEW,
      businessId: BIZ,
      replyId: 'r1',
      userId: ACTOR,
    });
    expect(notifyCalls).toEqual([]);
  });

  it('best-effort: a dead lookup never throws out of a handler', async () => {
    makeDeps(); // keep the Logger spy pair consistent with the other cases
    vi.spyOn(Logger.prototype, 'warn').mockRestore();
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const exploding = {
      async notify() {
        throw new Error('notify down');
      },
    } as never;
    const broken = new NotificationsEventsSubscriber(
      exploding,
      {
        async findById() {
          return null;
        },
      } as never,
      {
        async findById() {
          throw new Error('db down');
        },
      } as never,
      {
        async findById() {
          throw new Error('db down');
        },
      } as never,
      {
        async findQuestionById() {
          throw new Error('db down');
        },
      } as never,
    );
    // none of these throw — the source write must never break
    await expect(
      broken.handleReviewReplied({
        reviewId: REVIEW,
        businessId: BIZ,
        replyId: 'r1',
        userId: ACTOR,
      }),
    ).resolves.toBeUndefined();
    await expect(
      broken.handleReviewVoted({
        reviewId: REVIEW,
        businessId: BIZ,
        userId: ACTOR,
        authorId: AUTHOR,
        value: 1,
      }),
    ).resolves.toBeUndefined();
    await expect(
      broken.handleQuestionAnswered({
        questionId: QUESTION,
        businessId: BIZ,
        answerId: 'a1',
        userId: OWNER,
      }),
    ).resolves.toBeUndefined();
    await expect(
      broken.handleFollowCreated({ followerId: FOLLOWER, kind: 'user', targetId: ACTOR }),
    ).resolves.toBeUndefined();
    await expect(
      broken.handleFavoriteAdded({ userId: ACTOR, businessId: BIZ, listId: 'l1', itemId: 'i1' }),
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
  });
});
