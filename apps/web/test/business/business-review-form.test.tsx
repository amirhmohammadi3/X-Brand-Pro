// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';

/**
 * F4.5 BusinessReviewForm — auth gate + rating + body + photo upload +
 * check-in + submit. useAuth, useUploadMedia, apiFetch and the i18n Link are
 * mocked; the Rating radiogroup is driven by clicking its last radio (value 5).
 */
import type { BusinessReviewFormProps } from '../../src/components/business/business-review-form';

const useAuthMock = vi.fn();
const useUploadMediaMock = vi.fn();
const apiFetchMock = vi.fn();

vi.mock('../../src/lib/auth/auth-context', () => ({ useAuth: useAuthMock }));
vi.mock('../../src/lib/api/account', () => ({ useUploadMedia: useUploadMediaMock }));
vi.mock('../../src/lib/api/client', () => ({ apiFetch: apiFetchMock }));
vi.mock('../../src/i18n/navigation', () => ({
  Link: (props: { href: string; children?: React.ReactNode }) => (
    <a href={props.href}>{props.children}</a>
  ),
}));

const { BusinessReviewForm } = await import('../../src/components/business/business-review-form');

const messages = {
  ui: {
    rating: { label: 'امتیاز {value} از {max}', star: '{value} ستاره', inputLabel: 'امتیاز' },
  },
  businessPage: {
    reviews: {
      form: {
        title: 'ثبت نظر',
        ratingLabel: 'امتیاز',
        bodyLabel: 'نظر',
        bodyPlaceholder: 'بنویسید…',
        photoLabel: 'عکس',
        photoRemove: 'حذف',
        photoUploading: 'بارگذاری…',
        checkinLabel: 'اینجام',
        checkinLocating: 'موقعیت…',
        checkinDenied: 'رد شد',
        checkinUnavailable: 'نیست',
        submit: 'ثبت',
        submitting: 'در حال ثبت…',
        success: 'ثبت شد.',
        loginRequired: 'وارد شوید.',
        login: 'ورود',
        error: 'خطا.',
      },
    },
  },
};

function mutateMock() {
  return vi.fn().mockResolvedValue({ id: 'm1' });
}

function setupAuth(status: 'authenticated' | 'anonymous' = 'authenticated') {
  useAuthMock.mockReturnValue({ status });
}

function setupUpload() {
  const m = mutateMock();
  useUploadMediaMock.mockReturnValue({
    mutate: m,
    progress: null,
    isPending: false,
    cancel: vi.fn(),
  });
  return m;
}

function renderForm(over: Partial<BusinessReviewFormProps> = {}) {
  return render(
    <NextIntlClientProvider locale="fa" messages={messages}>
      <BusinessReviewForm businessId="b1" {...over} />
    </NextIntlClientProvider>,
  );
}

function setRating5() {
  const group = screen.getByRole('radiogroup');
  const radios = within(group).getAllByRole('radio');
  fireEvent.click(radios[radios.length - 1]!); // value 5
}

describe('BusinessReviewForm', () => {
  beforeEach(() => {
    useAuthMock.mockReset();
    useUploadMediaMock.mockReset();
    apiFetchMock.mockReset();
  });

  it('renders the login gate for anonymous visitors', () => {
    setupAuth('anonymous');
    renderForm();
    const gate = screen.getByTestId('business-review-form-gate');
    expect(gate).toHaveTextContent('وارد شوید.');
    expect(gate.querySelector('a')).toHaveAttribute('href', '/login');
    expect(screen.queryByTestId('business-review-form')).toBeNull();
  });

  it('renders the form with the submit disabled until rating + body are valid', () => {
    setupAuth('authenticated');
    setupUpload();
    renderForm();
    const submit = screen.getByTestId('business-review-form-submit') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    setRating5();
    fireEvent.change(screen.getByTestId('business-review-form-body'), {
      target: { value: 'یک نظر آزمایشی کافی' },
    });
    expect(submit.disabled).toBe(false);
  });

  it('submits the review with rating, body and the uploaded photo mediaId', async () => {
    setupAuth('authenticated');
    const uploadMutate = setupUpload();
    apiFetchMock.mockResolvedValue({ data: {} });
    renderForm();

    // attach a photo first
    const file = new File(['x'], 'p.jpg', { type: 'image/jpeg' });
    fireEvent.change(screen.getByTestId('business-review-form-photo'), {
      target: { files: [file] },
    });
    await waitFor(() => expect(uploadMutate).toHaveBeenCalledWith(file, 'review_photo'));

    setRating5();
    fireEvent.change(screen.getByTestId('business-review-form-body'), {
      target: { value: 'یک نظر آزمایشی کافی' },
    });
    fireEvent.click(screen.getByTestId('business-review-form-submit'));

    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledTimes(1));
    const [path, , opts] = apiFetchMock.mock.calls[0]! as [
      string,
      unknown,
      { method: string; body: unknown },
    ];
    expect(path).toContain('/businesses/b1/reviews');
    expect(opts.method).toBe('POST');
    expect(opts.body).toMatchObject({ rating: 5, body: 'یک نظر آزمایشی کافی', photoMediaId: 'm1' });
    expect(await screen.findByTestId('business-review-form-success')).toBeInTheDocument();
  });

  it('shows the error copy when the submit fails', async () => {
    setupAuth('authenticated');
    setupUpload();
    apiFetchMock.mockRejectedValue(new Error('boom'));
    renderForm();
    setRating5();
    fireEvent.change(screen.getByTestId('business-review-form-body'), {
      target: { value: 'یک نظر آزمایشی کافی' },
    });
    fireEvent.click(screen.getByTestId('business-review-form-submit'));
    await waitFor(() =>
      expect(screen.getByTestId('business-review-form-error')).toBeInTheDocument(),
    );
  });
});
