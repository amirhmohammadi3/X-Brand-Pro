// @vitest-environment jsdom
import { useState } from 'react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { OtpChannel, OtpRequestResult } from '@app/contracts';
import { ApiRequestError } from '../../src/lib/api/errors';
import { OtpFlow } from '../../src/components/auth/otp-flow';
import { en } from './helpers';

const SEND_RESULT: OtpRequestResult = {
  resendAfterSec: 60,
  expiresInSec: 300,
  channel: 'sms',
  targetMasked: '+989***789',
};

/** Stateful harness mirroring how the pages own channel/target state. */
function Harness(props: {
  onSend: () => Promise<OtpRequestResult>;
  onVerify: (code: string) => Promise<void>;
}) {
  const [channel, setChannel] = useState<OtpChannel>('sms');
  const [target, setTarget] = useState('');
  return (
    <NextIntlClientProvider locale="en" messages={en}>
      <OtpFlow
        channel={channel}
        onChannelChange={setChannel}
        channelLabel="Delivery method"
        target={target}
        onTargetChange={setTarget}
        onSend={props.onSend}
        onVerify={props.onVerify}
      />
    </NextIntlClientProvider>
  );
}

function setPhone(value: string) {
  fireEvent.change(screen.getByLabelText(/Mobile number/), { target: { value } });
}

function fillCode(code: string) {
  const cells = screen.getAllByRole('textbox');
  for (let i = 0; i < code.length; i += 1) {
    const cell = cells[i];
    if (cell === undefined) break;
    fireEvent.change(cell, { target: { value: code[i] } });
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe('OtpFlow (F1.8) — send step', () => {
  it('blocks the send until the phone target is valid', async () => {
    const onSend = vi.fn(() => Promise.resolve(SEND_RESULT));
    const onVerify = vi.fn(() => Promise.resolve());
    render(<Harness onSend={onSend} onVerify={onVerify} />);

    fireEvent.click(screen.getByRole('button', { name: 'Send code' }));
    await act(async () => {});
    expect(screen.getByText('Enter a valid Iranian mobile number.')).toBeInTheDocument();
    expect(onSend).not.toHaveBeenCalled();

    setPhone('09123456789');
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }));
    await act(async () => {});
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/We sent a one-time code to:/)).toBeInTheDocument();
    expect(screen.getByText('+989***789')).toBeInTheDocument();
  });

  it('rejects a non-email target on the email channel', async () => {
    const onSend = vi.fn(() => Promise.resolve(SEND_RESULT));
    const onVerify = vi.fn(() => Promise.resolve());
    render(<Harness onSend={onSend} onVerify={onVerify} />);

    fireEvent.click(screen.getByRole('radio', { name: 'Email' }));
    fireEvent.change(screen.getByLabelText(/Email address/), { target: { value: 'not-an-email' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }));
    await act(async () => {});
    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument();
    expect(onSend).not.toHaveBeenCalled();
  });

  it('maps OTP_RESEND_TOO_SOON (with retryAfterSec) to the countdown', async () => {
    vi.useFakeTimers();
    const onSend = vi.fn(() => {
      throw new ApiRequestError({
        status: 429,
        code: 'OTP_RESEND_TOO_SOON',
        message: 'soon',
        details: { retryAfterSec: 30 },
      });
    });
    const onVerify = vi.fn(() => Promise.resolve());
    render(<Harness onSend={onSend} onVerify={onVerify} />);

    setPhone('09123456789');
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }));
    await act(async () => {});
    expect(
      screen.getByText('Please wait a moment before requesting a new code.'),
    ).toBeInTheDocument();

    setPhone('09123456789');
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }));
    await act(async () => {
      vi.advanceTimersByTime(31_000);
    });
    expect(onSend).toHaveBeenCalledTimes(2);
  });
});

describe('OtpFlow (F1.8) — code step', () => {
  it('arms the resend countdown from resendAfterSec and re-enables afterwards', async () => {
    vi.useFakeTimers();
    const onSend = vi.fn(() => Promise.resolve(SEND_RESULT));
    const onVerify = vi.fn(() => Promise.resolve());
    render(<Harness onSend={onSend} onVerify={onVerify} />);

    setPhone('09123456789');
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }));
    await act(async () => {});
    expect(screen.getByText('You can resend in 60 seconds')).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(61_000);
    });
    expect(screen.getByRole('button', { name: 'Resend the code' })).toBeEnabled();
  });

  it('auto-submits on the last cell and shows a translated wrong-code error', async () => {
    vi.useFakeTimers();
    const onSend = vi.fn(() => Promise.resolve(SEND_RESULT));
    const onVerify = vi.fn(() =>
      Promise.reject(new ApiRequestError({ status: 422, code: 'OTP_INVALID', message: 'wrong' })),
    );
    render(<Harness onSend={onSend} onVerify={onVerify} />);

    setPhone('09123456789');
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }));
    await act(async () => {});
    fillCode('123456');
    await act(async () => {});
    expect(onVerify).toHaveBeenCalledWith('123456');
    expect(screen.getByText('The code you entered is not correct.')).toBeInTheDocument();
    // Cells are cleared for a clean retry.
    const firstCell = screen.getAllByRole('textbox')[0];
    expect(firstCell).toHaveValue('');
  });

  it('maps OTP_EXPIRED to its message after auto-submit', async () => {
    vi.useFakeTimers();
    const onSend = vi.fn(() => Promise.resolve(SEND_RESULT));
    const onVerify = vi.fn(() =>
      Promise.reject(new ApiRequestError({ status: 422, code: 'OTP_EXPIRED', message: 'expired' })),
    );
    render(<Harness onSend={onSend} onVerify={onVerify} />);

    setPhone('09123456789');
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }));
    await act(async () => {});
    fillCode('654321');
    await act(async () => {});
    expect(screen.getByText('This code has expired — request a new one.')).toBeInTheDocument();
  });
});
