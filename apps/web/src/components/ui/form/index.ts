/**
 * Form UI Kit barrel (F1.4). Re-exports the form components and the Zod form
 * hook so callers do `import { Field, Input, useZodForm } from '@/components/ui'`.
 */
export { Label, type LabelProps, Field, type FieldProps } from './field';
export { Input, type InputProps, type InputType } from './input';
export { PhoneInput, type PhoneInputProps } from './phone-input';
export { OtpInput, type OtpInputProps } from './otp-input';
export { PasswordInput, type PasswordInputProps, scorePassword } from './password-input';
export { Textarea, type TextareaProps } from './textarea';
export { Select, type SelectProps, type SelectOption } from './select';
export { Checkbox, type CheckboxProps } from './checkbox';
export { RadioGroup, type RadioGroupProps, type RadioOption } from './radio-group';
export { Switch, type SwitchProps } from './switch';
export { FormError, type FormErrorProps, type FormErrorEntry } from './form-error';
export { SubmitButton, type SubmitButtonProps } from './submit-button';
export { FileDropzone, type FileDropzoneProps } from './file-dropzone';
export { CopyField, type CopyFieldProps } from './copy-field';
export { useZodForm, type UseZodFormReturn, type UseZodFormOptions } from './use-zod-form';
