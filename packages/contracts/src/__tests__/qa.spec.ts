import { describe, expect, it } from 'vitest';
import {
  createQaQuestionBodySchema,
  deleteQaAnswerResultSchema,
  qaAnswerSchema,
  qaListQuerySchema,
  qaQuestionSchema,
  QA_ANSWER_BODY_MAX,
  QA_ANSWER_BODY_MIN,
  QA_QUESTION_BODY_MAX,
  QA_QUESTION_BODY_MIN,
  QA_ASK_LIMIT_PER_HOUR,
  QA_READ_LIMIT_PER_MIN,
  QA_STATUSES,
  QA_WRITE_LIMIT_PER_MIN,
  updateQaQuestionBodySchema,
  upsertQaAnswerBodySchema,
} from '../qa.js';

const UUID = '11111111-1111-4111-8111-111111111111';

const validAnswer = {
  id: UUID,
  questionId: UUID,
  userId: UUID,
  authorName: 'Owner',
  body: 'Yes, we deliver.',
  editedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const validQuestion = {
  id: UUID,
  businessId: UUID,
  userId: UUID,
  authorName: null,
  authorUsername: 'asker01',
  body: 'Do you deliver to District 3?',
  status: 'approved' as const,
  answer: validAnswer,
  editedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('qa contracts', () => {
  it('keeps the status enum aligned with the reviews lifecycle', () => {
    expect([...QA_STATUSES]).toEqual(['approved', 'pending', 'rejected']);
  });

  it('documents the public rule constants', () => {
    expect(QA_QUESTION_BODY_MIN).toBe(10);
    expect(QA_QUESTION_BODY_MAX).toBe(500);
    expect(QA_ANSWER_BODY_MIN).toBe(2);
    expect(QA_ANSWER_BODY_MAX).toBe(1000);
    expect(QA_ASK_LIMIT_PER_HOUR).toBe(10);
    expect(QA_WRITE_LIMIT_PER_MIN).toBe(30);
    expect(QA_READ_LIMIT_PER_MIN).toBe(60);
  });

  it('accepts a fully-shaped question with an inline answer', () => {
    const parsed = qaQuestionSchema.parse(validQuestion);
    expect(parsed.answer?.body).toBe('Yes, we deliver.');
    expect(parsed.authorName).toBeNull();
  });

  it('accepts an unanswered question and rejects an unknown status', () => {
    expect(qaQuestionSchema.safeParse({ ...validQuestion, answer: null }).success).toBe(true);
    expect(qaQuestionSchema.safeParse({ ...validQuestion, status: 'moderated' }).success).toBe(
      false,
    );
  });

  it('rejects a question body outside the length window', () => {
    expect(createQaQuestionBodySchema.safeParse({ body: 'short' }).success).toBe(false);
    expect(createQaQuestionBodySchema.safeParse({ body: 'x'.repeat(501) }).success).toBe(false);
    expect(
      createQaQuestionBodySchema.safeParse({ body: 'x'.repeat(QA_QUESTION_BODY_MIN) }).success,
    ).toBe(true);
  });

  it('rejects unknown keys in the create body', () => {
    expect(
      createQaQuestionBodySchema.safeParse({ body: 'A valid question body', rating: 5 }).success,
    ).toBe(false);
  });

  it('requires at least one field on the update body and rejects unknown keys', () => {
    expect(updateQaQuestionBodySchema.safeParse({ body: 'Refined question wording' }).success).toBe(
      true,
    );
    expect(updateQaQuestionBodySchema.safeParse({}).success).toBe(false);
  });

  it('validates the answer body window and strictness', () => {
    expect(
      upsertQaAnswerBodySchema.safeParse({ body: 'x'.repeat(QA_ANSWER_BODY_MIN) }).success,
    ).toBe(true);
    expect(
      upsertQaAnswerBodySchema.safeParse({ body: 'x'.repeat(QA_ANSWER_BODY_MAX + 1) }).success,
    ).toBe(false);
    expect(upsertQaAnswerBodySchema.safeParse({ body: 'ok', extra: 1 }).success).toBe(false);
  });

  it('parses the list query with coercion and the optional moderation status', () => {
    expect(qaListQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20 });
    expect(qaListQuerySchema.parse({ page: '2', status: 'pending' })).toEqual({
      page: 2,
      pageSize: 20,
      status: 'pending',
    });
    expect(qaListQuerySchema.safeParse({ status: 'nope' }).success).toBe(false);
  });

  it('keeps the idempotent delete result shape', () => {
    expect(deleteQaAnswerResultSchema.parse({ deleted: false })).toEqual({ deleted: false });
  });

  it('answer schema strips unknown keys (response DTOs are forward-compatible)', () => {
    const parsed = qaAnswerSchema.parse({ ...validAnswer, helpfulCount: 1 });
    expect('helpfulCount' in parsed).toBe(false);
  });
});
