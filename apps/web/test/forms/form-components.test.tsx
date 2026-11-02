// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { NextIntlClientProvider } from 'next-intl';
import {
  Input,
  PasswordInput,
  Textarea,
  Select,
  Checkbox,
  RadioGroup,
  Switch,
  FileDropzone,
  CopyField,
  FormError,
} from '../../src/components/ui/form';
import { en } from './messages';

function withIntl(node: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      {node}
    </NextIntlClientProvider>,
  );
}

describe('form components — axe + behavior (F1.4)', () => {
  it('Input password: toggle button has an accessible name and switches type', async () => {
    const user = userEvent.setup();
    const { container } = withIntl(<Input type="password" aria-label="pw" />);
    const input = container.querySelector('input')!;
    expect(input).toHaveAttribute('type', 'password');
    const toggle = screen.getByRole('button', { name: 'Show password' });
    await user.click(toggle);
    expect(input).toHaveAttribute('type', 'text');
    expect(toggle).toHaveAttribute('aria-label', 'Hide password');
  });

  it('PasswordInput: shows a visible text strength label, not color alone', () => {
    withIntl(<PasswordInput value="Abcd1234!@#$efgh" aria-label="pw" />);
    // The strongest label text should be present.
    expect(screen.getByText('Strong')).toBeTruthy();
  });

  it('Textarea: shows a localized character counter', () => {
    const { container } = withIntl(<Textarea value="abc" maxLength={10} />);
    expect(container.textContent).toContain('3 of 10 characters');
  });

  it('Select: renders options and a placeholder', () => {
    withIntl(
      <Select
        placeholder="pick"
        options={[
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B' },
        ]}
        aria-label="role"
      />,
    );
    expect(screen.getByRole('combobox', { name: 'role' })).toBeTruthy();
    expect(screen.getByText('A')).toBeTruthy();
  });

  it('Checkbox: clicking the label toggles the box', async () => {
    const user = userEvent.setup();
    withIntl(<Checkbox label="Agree" />);
    const box = screen.getByRole('checkbox', { name: /Agree/ });
    expect(box).not.toBeChecked();
    await user.click(screen.getByText('Agree'));
    expect(box).toBeChecked();
  });

  it('RadioGroup: groups radios under a legend', () => {
    withIntl(
      <RadioGroup
        name="pref"
        label="Contact"
        value="sms"
        options={[
          { value: 'sms', label: 'SMS' },
          { value: 'email', label: 'Email' },
        ]}
      />,
    );
    expect(screen.getByText('Contact')).toBeTruthy();
    expect(screen.getByRole('radiogroup')).toBeTruthy();
  });

  it('Switch: exposes role=switch and toggles aria-checked', async () => {
    const user = userEvent.setup();
    let checked = false;
    const { rerender } = withIntl(
      <Switch checked={checked} onChange={(v) => (checked = v)} label="On" />,
    );
    const sw = screen.getByRole('switch', { name: 'On' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    await user.click(sw);
    rerender(
      <NextIntlClientProvider locale="en" messages={en}>
        <Switch checked={checked} onChange={() => {}} label="On" />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  });

  it('FileDropzone: hands File[] to the caller and is keyboard accessible', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container } = withIntl(<FileDropzone multiple onChange={onChange} aria-label="drop" />);
    const dropzone = screen.getByRole('button', { name: /Drag files here/ });
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    await user.upload(input, file);
    expect(onChange).toHaveBeenCalled();
    const passed = onChange.mock.calls.at(-1)?.[0] as File[];
    expect(passed[0]!.name).toBe('a.png');
    expect(dropzone).toBeTruthy();
  });

  it('CopyField: copy button has an accessible name', () => {
    withIntl(<CopyField value="ABC123" aria-label="code" />);
    expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy();
  });

  it('FormError: renders nothing when there are no errors', () => {
    const { container } = withIntl(<FormError errors={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('FormError: lists each error as a link', () => {
    withIntl(
      <FormError
        errors={[
          { name: 'email', label: 'Email', message: 'bad' },
          { name: 'phone', label: 'Phone', message: 'missing' },
        ]}
      />,
    );
    // Link text is "Go to {label}" from form.errorSummary.link.
    expect(screen.getByRole('link', { name: 'Go to Email' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Go to Phone' })).toBeTruthy();
  });

  it('each component passes axe', async () => {
    const { container } = withIntl(
      <>
        <Input aria-label="a" />
        <PasswordInput value="x" aria-label="p" />
        <Textarea value="x" maxLength={10} aria-label="t" />
        <Select options={[{ value: 'a', label: 'A' }]} aria-label="s" />
        <Checkbox label="c" />
        <RadioGroup name="r" label="L" value="a" options={[{ value: 'a', label: 'A' }]} />
        <Switch checked onChange={() => {}} label="sw" />
        <FileDropzone onChange={() => {}} aria-label="files" />
        <CopyField value="x" label="code" />
        <FormError errors={[{ name: 'email', label: 'Email', message: 'bad' }]} />
      </>,
    );
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });
});
