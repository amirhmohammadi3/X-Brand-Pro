// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';

/**
 * F4.9 BusinessShare — the disclosure toggle + WhatsApp/Telegram/Instagram/
 * copy-link buttons. The shared URL is window.location.href; clipboard is
 * stubbed; navigator.share is absent in jsdom so the native button is hidden.
 */
import { BusinessShare } from '../../src/components/business/business-share';

const messages = {
  share: {
    button: 'اشتراک‌گذاری',
    whatsapp: 'واتس‌اپ',
    telegram: 'تلگرام',
    instagram: 'اینستاگرام',
    copy: 'کپی لینک',
    copied: 'کپی شد',
    native: 'اشتراک…',
    title: 'اشتراک',
  },
};

const writeText = vi.fn().mockResolvedValue(undefined);

function renderShare(title = 'کافه نمونه') {
  return render(
    <NextIntlClientProvider locale="fa" messages={messages}>
      <BusinessShare title={title} />
    </NextIntlClientProvider>,
  );
}

describe('BusinessShare', () => {
  beforeEach(() => {
    writeText.mockClear();
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    // navigator.share is NOT defined in jsdom → native button hidden
  });

  it('hides the options until the toggle is clicked', () => {
    renderShare();
    expect(screen.queryByTestId('business-share-options')).toBeNull();
    fireEvent.click(screen.getByTestId('business-share-toggle'));
    expect(screen.getByTestId('business-share-options')).toBeInTheDocument();
  });

  it('builds the WhatsApp share link from the current url + title', () => {
    renderShare('کافه نمونه');
    fireEvent.click(screen.getByTestId('business-share-toggle'));
    const wa = screen.getByTestId('business-share-whatsapp');
    const expected =
      'https://wa.me/?text=' + encodeURIComponent(`کافه نمونه — ${window.location.href}`);
    expect(wa).toHaveAttribute('href', expected);
  });

  it('builds the Telegram share link from the current url', () => {
    renderShare();
    fireEvent.click(screen.getByTestId('business-share-toggle'));
    expect(screen.getByTestId('business-share-telegram')).toHaveAttribute(
      'href',
      'https://t.me/share/url?url=' + encodeURIComponent(window.location.href),
    );
  });

  it('copies the link and flips the button label to «copied»', async () => {
    renderShare();
    fireEvent.click(screen.getByTestId('business-share-toggle'));
    fireEvent.click(screen.getByTestId('business-share-copy'));
    await waitFor(() =>
      expect(screen.getByTestId('business-share-copy')).toHaveTextContent('کپی شد'),
    );
    expect(writeText).toHaveBeenCalledWith(window.location.href);
  });

  it('does not render the native-share button when navigator.share is absent', () => {
    renderShare();
    fireEvent.click(screen.getByTestId('business-share-toggle'));
    expect(screen.queryByTestId('business-share-native')).toBeNull();
  });
});
