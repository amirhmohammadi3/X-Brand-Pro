import { useCallback, useId, useRef, useState, type DragEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Upload, X } from 'lucide-react';
import { cn } from '../../../lib/cn';
import { IconButton } from '../icon-button';

export interface FileDropzoneProps {
  /** Allow more than one file. */
  multiple?: boolean;
  /** Accepted file types, e.g. `['image/png', 'image/jpeg']`. */
  accept?: string[];
  /** Max bytes per file; larger files are rejected with a message. */
  maxSize?: number;
  /** Current files (controlled). */
  value?: File[];
  /** Called with the new full file list whenever it changes. */
  onChange: (files: File[]) => void;
  /** Field name for `data-field-name` (focus targeting). */
  name?: string;
  disabled?: boolean;
  id?: string;
}

/**
 * `FileDropzone` (F1.4). Lets the user pick files by drag-and-drop or by
 * clicking the dropzone (which opens the file dialog). It does NOT upload:
 * it hands the chosen `File[]` to the caller via `onChange`.
 *
 * Behavior:
 *  - drag-and-drop highlights the zone;
 *  - clicking the zone or pressing Enter/Space opens the native dialog;
 *  - when `multiple` is false, only the latest file is kept;
 *  - files larger than `maxSize` are rejected with a localized message and
 *    not added;
 *  - thumbnails (for image files) are shown with a remove button; non-images
 *    show a filename chip with a remove button.
 */
export function FileDropzone({
  multiple = false,
  accept,
  maxSize,
  value,
  onChange,
  name,
  disabled = false,
  id,
}: FileDropzoneProps) {
  const t = useTranslations('form.fileDropzone');
  const fallbackId = useId();
  const inputId = id ?? fallbackId;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [tooLarge, setTooLarge] = useState<string | null>(null);

  const files = value ?? [];

  const acceptAttr = accept?.join(',') || undefined;

  const mergeFiles = useCallback(
    (incoming: File[]) => {
      let next = incoming;
      if (maxSize !== undefined) {
        const oversized = incoming.find((f) => f.size > maxSize);
        if (oversized) {
          setTooLarge(oversized.name);
          next = incoming.filter((f) => f.size <= maxSize);
        } else {
          setTooLarge(null);
        }
      }
      if (next.length === 0) return;
      const last = next[next.length - 1];
      onChange(multiple ? [...files, ...next] : last ? [last] : []);
    },
    [files, maxSize, multiple, onChange],
  );

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    if (disabled) return;
    mergeFiles(Array.from(e.dataTransfer.files));
  };

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) mergeFiles(Array.from(e.target.files));
    // Reset so picking the same file again still fires onChange.
    e.target.value = '';
  };

  const removeAt = (idx: number) => {
    onChange(files.filter((_, i) => i !== idx));
  };

  return (
    <div className="flex flex-col gap-2" data-field-name={name}>
      {/* Visually-hidden file input is a SIBLING of the dropzone (not nested
          inside the role=button div) so axe's nested-interactive rule is
          satisfied. The dropzone opens the dialog on click/Enter/Space. */}
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        multiple={multiple}
        accept={acceptAttr}
        disabled={disabled}
        onChange={handleInput}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        role="presentation"
      />
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled || undefined}
        aria-labelledby={`${inputId}-label`}
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(e) => {
          if (disabled) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={cn(
          'flex flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed p-6 text-center cursor-pointer',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
          dragging ? 'border-primary bg-primary/5' : 'border-border',
          disabled && 'opacity-50 cursor-not-allowed',
        )}
      >
        <Upload size={20} className="text-text-subtle" aria-hidden="true" />
        <span id={`${inputId}-label`} className="text-sm text-text">
          {multiple ? t('drop') : t('dropSingle')}
        </span>
        {accept && accept.length > 0 ? (
          <span className="text-xs text-text-subtle">
            {t('accepted', { types: accept.join(', ') })}
          </span>
        ) : null}
      </div>

      {tooLarge ? (
        <p role="alert" aria-live="polite" className="text-xs text-danger">
          {t('tooLarge', { name: tooLarge, max: maxSize ? String(maxSize) : '' })}
        </p>
      ) : null}

      {files.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {files.map((file, idx) => (
            <li
              key={`${file.name}-${idx}`}
              className="flex items-center gap-2 rounded-md border border-border bg-surface p-2"
            >
              {file.type.startsWith('image/') ? (
                <img
                  src={URL.createObjectURL(file)}
                  alt={t('preview', { name: file.name })}
                  className="h-10 w-10 rounded object-cover"
                />
              ) : (
                <span className="flex h-10 w-10 items-center justify-center rounded bg-surface-alt text-xs text-text-subtle">
                  {file.name.split('.').pop()?.slice(0, 3) ?? '?'}
                </span>
              )}
              <span className="flex-1 truncate text-sm text-text">{file.name}</span>
              <IconButton
                type="button"
                icon={X}
                aria-label={t('remove', { name: file.name })}
                onClick={() => removeAt(idx)}
                disabled={disabled}
                className="text-text-subtle hover:text-danger"
              />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
