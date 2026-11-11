// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';

/**
 * F4.10 BusinessClaimButton — anonymous gate + authenticated modal → POST
 * /businesses/:id/claims. useAuth/useUploadMedia/apiFetch/Link mocked.
 */
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

const { BusinessClaimButton } = await import('../../src/components/business/business-claim-button');

const messages = {
  form: { overlay: { close: 'بستن' } },
  claim: {
    button: 'ادعا',
    title: 'ادعای مالکیت',
    evidenceLabel: 'مدارک',
    evidencePlaceholder: 'بنویسید…',
    receiptLabel: 'مدرک',
    submit: 'ثبت',
    submitting: '…',
    success: 'ثبت شد.',
    loginRequired: 'وارد شوید.',
    error: 'خطا.',
  },
};

function setupUpload() {
  const mutate = vi.fn().mockResolvedValue({ id: 'doc1' });
  useUploadMediaMock.mockReturnValue({ mutate, progress: null, isPending: false, cancel: vi.fn() });
  return mutate;
}

function renderClaim() {
  return render(
    <NextIntlClientProvider locale="fa" messages={messages}>
      <BusinessClaimButton businessId="b1" />
    </NextIntlClientProvider>,
  );
}

describe('BusinessClaimButton', () => {
  beforeEach(() => {
    useAuthMock.mockReset();
    useUploadMediaMock.mockReset();
    apiFetchMock.mockReset();
  });

  it('renders the login gate for anonymous visitors', () => {
    useAuthMock.mockReturnValue({ status: 'anonymous' });
    renderClaim();
    expect(screen.getByTestId('claim-gate')).toBeInTheDocument();
    expect(screen.queryByTestId('claim-button')).toBeNull();
  });

  it('submits the claim with evidence and the uploaded document mediaId', async () => {
    useAuthMock.mockReturnValue({ status: 'authenticated', user: { id: 'u1' } });
    const uploadMutate = setupUpload();
    apiFetchMock.mockResolvedValue({ data: { id: 'cl1' } });
    renderClaim();

    fireEvent.click(screen.getByTestId('claim-button'));
    const form = await screen.findByTestId('claim-form');

    // attach a document first
    const file = new File(['x'], 'license.pdf', { type: 'application/pdf' });
    fireEvent.change(form.querySelector('[data-testid="claim-document"]')!, {
      target: { files: [file] },
    });
    await waitFor(() => expect(uploadMutate).toHaveBeenCalledWith(file, 'claim_document'));

    // evidence (min 20 chars) + submit
    fireEvent.change(screen.getByTestId('claim-evidence'), {
      target: { value: 'این کسب‌وکار از سال ۱۳۹۰ متعلق به من است.' },
    });
    fireEvent.click(screen.getByTestId('claim-submit'));

    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledTimes(1));
    const [path, , opts] = apiFetchMock.mock.calls[0]! as [
      string,
      unknown,
      { method: string; body: unknown },
    ];
    expect(path).toBe('/businesses/b1/claims');
    expect(opts.method).toBe('POST');
    expect(opts.body).toMatchObject({
      evidence: 'این کسب‌وکار از سال ۱۳۹۰ متعلق به من است.',
      documentMediaId: 'doc1',
    });
    await waitFor(() => expect(screen.getByTestId('claim-success')).toBeInTheDocument());
  });
});
