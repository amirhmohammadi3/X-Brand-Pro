'use client';

/**
 * QaEditor (F7.4) — the `/dashboard/:businessId/qa` body.
 *
 * The owner's Q&A console: a paginated list of the business's APPROVED
 * questions (newest first) with the per-question owner answer (create /
 * edit / delete). The list is the public read `GET /businesses/:id/questions`
 * — the owner sees exactly what customers see, plus answer controls. Pending
 * and rejected questions are a moderation view (`reviews.manage`) and live
 * in the admin panel, not here.
 *
 * Answer lifecycle (B4.8): one answer per question, upserted by `PUT
 * /questions/:id/answer` (`created` distinguishes the first write from an
 * edit) and removed by `DELETE /questions/:id/answer` (idempotent). The API
 * enforces business ownership; a 403 here means the caller no longer owns
 * the business. The answer body is validated client-side against the
 * contract bounds (2..1000 chars).
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Trash2 } from 'lucide-react';
import { HelpCircle } from 'lucide-react';
import { QA_ANSWER_BODY_MAX, QA_ANSWER_BODY_MIN, type QaQuestion } from '@app/contracts';
import { useLocale } from 'next-intl';
import {
  useBusinessQuestions,
  useRemoveQaAnswer,
  useUpsertQaAnswer,
} from '../../lib/api/dashboard-qa';
import { isApiRequestError } from '../../lib/api/errors';
import { createFormatters } from '../../lib/format';
import { useToast } from '../ui/toast';
import {
  Badge,
  Card,
  CardBody,
  EmptyState,
  ErrorState,
  Heading,
  IconButton,
  Pagination,
  Spinner,
} from '../ui';
import { SubmitButton } from '../ui/form';

const PAGE_SIZE = 10;

export function QaEditor({ businessId }: { businessId: string }) {
  const t = useTranslations('dashboard');
  const locale = useLocale();
  const fmt = createFormatters(locale);
  const toast = useToast();
  const [page, setPage] = useState(1);

  const { result, isPending, error } = useBusinessQuestions(businessId, page, PAGE_SIZE);
  const upsertMutation = useUpsertQaAnswer(businessId);
  const removeMutation = useRemoveQaAnswer(businessId);

  if (isPending) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner aria-label={t('qa.loading')} />
      </div>
    );
  }
  if (error) {
    return <ErrorState error={error} onRetry={() => setPage((p) => p)} />;
  }

  const items = result?.items ?? [];
  const meta = result?.meta;

  return (
    <div className="flex flex-col gap-4" data-testid="dashboard-qa">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Heading level="h2" className="text-lg">
          {t('qa.title')}
        </Heading>
        {meta ? (
          <span className="text-sm text-text-subtle">{t('qa.count', { total: meta.total })}</span>
        ) : null}
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={HelpCircle}
          title={t('qa.emptyTitle')}
          description={t('qa.emptyMessage')}
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((question) => (
            <QuestionRow
              key={question.id}
              question={question}
              fmt={fmt}
              onUpsert={async (body) => {
                try {
                  const res = await upsertMutation.mutateAsync({ questionId: question.id, body });
                  toast.success(res.created ? t('qa.answerCreated') : t('qa.answerUpdated'));
                } catch (e) {
                  toast.error(
                    isApiRequestError(e) && e.isClientError ? e.message : t('qa.answerError'),
                  );
                }
              }}
              onRemove={async () => {
                try {
                  await removeMutation.mutateAsync(question.id);
                  toast.success(t('qa.answerRemoved'));
                } catch (e) {
                  toast.error(
                    isApiRequestError(e) && e.isClientError ? e.message : t('qa.answerError'),
                  );
                }
              }}
              upserting={upsertMutation.isPending}
              removing={removeMutation.isPending}
            />
          ))}
        </ul>
      )}

      {meta && meta.totalPages > 1 ? (
        <Pagination page={meta.page} totalPages={meta.totalPages} onPageChange={setPage} />
      ) : null}
    </div>
  );
}

interface QuestionRowProps {
  question: QaQuestion;
  fmt: ReturnType<typeof createFormatters>;
  onUpsert: (body: { body: string }) => Promise<void>;
  onRemove: () => Promise<void>;
  upserting: boolean;
  removing: boolean;
}

function QuestionRow({ question, fmt, onUpsert, onRemove, upserting, removing }: QuestionRowProps) {
  const t = useTranslations('dashboard');
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState(question.answer?.body ?? '');

  function startEdit() {
    setBody(question.answer?.body ?? '');
    setOpen(true);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = body.trim();
    if (trimmed.length < QA_ANSWER_BODY_MIN || upserting) return;
    await onUpsert({ body: trimmed });
    setOpen(false);
  }

  const authorLabel = question.authorName ?? question.authorUsername;
  const answer = question.answer;

  return (
    <li>
      <Card>
        <CardBody className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-text">{authorLabel}</span>
              {answer ? (
                <Badge variant="success">{t('qa.answered')}</Badge>
              ) : (
                <Badge variant="warning">{t('qa.pending')}</Badge>
              )}
            </div>
            <time className="text-xs text-muted" dateTime={question.createdAt}>
              {fmt.formatDateTime(new Date(question.createdAt), 'medium')}
            </time>
          </div>

          <p className="whitespace-pre-wrap text-sm text-text">{question.body}</p>

          {answer ? (
            <div
              className="rounded-lg border-s-2 border-primary bg-surface-alt p-3 text-sm"
              data-testid="dashboard-qa-answer"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-primary">{t('qa.answerLabel')}</span>
                <time className="text-xs text-muted" dateTime={answer.createdAt}>
                  {fmt.formatDateTime(new Date(answer.createdAt), 'medium')}
                </time>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-text">{answer.body}</p>
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={startEdit}
                  className="text-xs text-primary underline underline-offset-4"
                  data-testid="dashboard-qa-answer-edit"
                >
                  {t('qa.answerEdit')}
                </button>
                <IconButton
                  icon={Trash2}
                  aria-label={t('qa.answerDelete')}
                  onClick={() => void onRemove()}
                  disabled={removing}
                />
              </div>
            </div>
          ) : null}

          {!answer && !open ? (
            <button
              type="button"
              onClick={startEdit}
              className="self-start text-sm text-primary underline underline-offset-4"
              data-testid="dashboard-qa-answer-add"
            >
              {t('qa.answerAdd')}
            </button>
          ) : null}

          {open ? (
            <form
              onSubmit={submit}
              className="flex flex-col gap-2"
              data-testid="dashboard-qa-answer-form"
            >
              <label className="flex flex-col gap-1 text-sm text-text">
                <span>{t('qa.answerLabel')}</span>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder={t('qa.answerPlaceholder')}
                  rows={3}
                  minLength={QA_ANSWER_BODY_MIN}
                  maxLength={QA_ANSWER_BODY_MAX}
                  className="rounded border border-border-subtle bg-surface px-2 py-1"
                  data-testid="dashboard-qa-answer-input"
                />
              </label>
              <span className="text-xs text-muted">
                {t('qa.answerCharCount', {
                  count: body.length,
                  min: QA_ANSWER_BODY_MIN,
                  max: QA_ANSWER_BODY_MAX,
                })}
              </span>
              <div className="flex items-center gap-2">
                <SubmitButton
                  loading={upserting}
                  disabled={body.trim().length < QA_ANSWER_BODY_MIN}
                >
                  {answer ? t('qa.answerSave') : t('qa.answerSubmit')}
                </SubmitButton>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="text-sm text-text-subtle underline underline-offset-4"
                >
                  {t('qa.answerCancel')}
                </button>
              </div>
            </form>
          ) : null}
        </CardBody>
      </Card>
    </li>
  );
}
