// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { BusinessPhoto } from '@app/contracts';

/**
 * F4.2 BusinessGallery — the thumbnail grid + lightbox. Covers: empty gallery
 * renders nothing; N photos render N thumbs with localized `{i} of {n}` aria
 * labels; clicking a thumb opens the lightbox with the right image; the
 * next button cycles to the following photo and wraps around. The Modal
 * (Radix Dialog) renders its content into a portal — `screen` queries search
 * document.body, so the lightbox image is findable once open.
 */
import { BusinessGallery } from '../../src/components/business/business-gallery';

const messages = {
  form: { overlay: { close: 'بستن' } },
  businessPage: {
    gallery: { title: 'گالری', prev: 'قبلی', next: 'بعدی', count: '{i} از {n}' },
  },
};

function makePhoto(
  id: string,
  url: string,
  sortOrder: number,
  thumbUrl: string | null,
): BusinessPhoto {
  return {
    id,
    businessId: 'b1',
    mediaId: `m-${id}`,
    url,
    thumbUrl,
    width: null,
    height: null,
    sortOrder,
    createdAt: '2026-01-01T00:00:00Z',
  };
}

const photos: BusinessPhoto[] = [
  makePhoto('p1', '/media/p1.jpg', 0, '/media/p1t.jpg'),
  makePhoto('p2', '/media/p2.jpg', 1, null),
];

function renderGallery(photos: BusinessPhoto[]) {
  return render(
    <NextIntlClientProvider locale="fa" messages={messages}>
      <BusinessGallery photos={photos} />
    </NextIntlClientProvider>,
  );
}

function thumbAt(i: number): HTMLElement {
  const thumbs = screen.getAllByTestId('business-gallery-thumb');
  return thumbs[i]!;
}

describe('BusinessGallery', () => {
  it('renders nothing when there are no photos', () => {
    renderGallery([]);
    expect(screen.queryByTestId('business-gallery-grid')).toBeNull();
  });

  it('renders one thumbnail per photo, sorted by sortOrder, with localized aria labels', () => {
    renderGallery(photos);
    const thumbs = screen.getAllByTestId('business-gallery-thumb');
    expect(thumbs).toHaveLength(2);
    // p1 (sortOrder 0) first, p2 (sortOrder 1) second — count is 1-based.
    expect(thumbs[0]!).toHaveAttribute('aria-label', '1 از 2');
    expect(thumbs[1]!).toHaveAttribute('aria-label', '2 از 2');
    // thumb falls back to the full url when thumbUrl is null (p2).
    const img0 = thumbs[0]!.querySelector('img');
    const img1 = thumbs[1]!.querySelector('img');
    expect(img0).toHaveAttribute('src', '/media/p1t.jpg');
    expect(img1).toHaveAttribute('src', '/media/p2.jpg');
  });

  it('opens the lightbox at the clicked photo', async () => {
    renderGallery(photos);
    fireEvent.click(thumbAt(0));
    const img = await screen.findByTestId('business-gallery-lightbox-img');
    expect(img).toHaveAttribute('src', '/media/p1.jpg');
    expect(screen.getByTestId('business-gallery-count')).toHaveTextContent('1 از 2');
  });

  it('cycles to the next photo via the next button', async () => {
    renderGallery(photos);
    fireEvent.click(thumbAt(0));
    await screen.findByTestId('business-gallery-lightbox-img');
    fireEvent.click(screen.getByTestId('business-gallery-next'));
    expect(screen.getByTestId('business-gallery-lightbox-img')).toHaveAttribute(
      'src',
      '/media/p2.jpg',
    );
    expect(screen.getByTestId('business-gallery-count')).toHaveTextContent('2 از 2');
  });

  it('wraps around from the last photo back to the first', async () => {
    renderGallery(photos);
    // open the second photo directly
    fireEvent.click(thumbAt(1));
    await screen.findByTestId('business-gallery-lightbox-img');
    fireEvent.click(screen.getByTestId('business-gallery-next')); // wraps to p1
    expect(screen.getByTestId('business-gallery-lightbox-img')).toHaveAttribute(
      'src',
      '/media/p1.jpg',
    );
  });
});
