// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { Rating } from '../../src/components/ui/rating';

const fa = {
  ui: {
    rating: { label: 'امتیاز {value} از {max}', inputLabel: 'امتیاز شما', star: '{value} ستاره' },
  },
};

function renderWithIntl(node: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="fa" messages={fa}>
      {node}
    </NextIntlClientProvider>,
  );
}

describe('Rating display (F1.3)', () => {
  it('renders an accessible label with the value and max', () => {
    renderWithIntl(<Rating value={4.5} />);
    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('aria-label', 'امتیاز ۴٫۵ از ۵');
  });

  it('shows zero stars for value 0 without error', () => {
    renderWithIntl(<Rating value={0} />);
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', 'امتیاز ۰ از ۵');
  });
});

describe('Rating input keyboard (F1.3, RTL-aware)', () => {
  afterEach(() => {
    document.documentElement.dir = '';
  });

  it('ArrowRight increases the value in LTR', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    document.documentElement.dir = 'ltr';
    renderWithIntl(<Rating value={3} readOnly={false} onValueChange={onChange} />);
    const group = screen.getByRole('radiogroup');
    group.focus();
    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenCalledWith(3.5);
  });

  it('ArrowLeft decreases the value in LTR', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    document.documentElement.dir = 'ltr';
    renderWithIntl(<Rating value={3} readOnly={false} onValueChange={onChange} />);
    const group = screen.getByRole('radiogroup');
    group.focus();
    await user.keyboard('{ArrowLeft}');
    expect(onChange).toHaveBeenCalledWith(2.5);
  });

  it('ArrowLeft INCREASES the value in RTL (visual direction)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    document.documentElement.dir = 'rtl';
    renderWithIntl(<Rating value={3} readOnly={false} onValueChange={onChange} />);
    const group = screen.getByRole('radiogroup');
    group.focus();
    await user.keyboard('{ArrowLeft}');
    expect(onChange).toHaveBeenCalledWith(3.5);
  });

  it('ArrowRight DECREASES the value in RTL', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    document.documentElement.dir = 'rtl';
    renderWithIntl(<Rating value={3} readOnly={false} onValueChange={onChange} />);
    const group = screen.getByRole('radiogroup');
    group.focus();
    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenCalledWith(2.5);
  });

  it('Home sets the value to 0 and End to 5', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    document.documentElement.dir = 'ltr';
    renderWithIntl(<Rating value={3} readOnly={false} onValueChange={onChange} />);
    const group = screen.getByRole('radiogroup');
    group.focus();
    await user.keyboard('{Home}');
    expect(onChange).toHaveBeenLastCalledWith(0.5);
    await user.keyboard('{End}');
    expect(onChange).toHaveBeenLastCalledWith(5);
  });
});
