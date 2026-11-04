/**
 * Auth feature components (F1.8): shared building blocks for the `(auth)`
 * pages, the account verification nudge and the login-required modal.
 */
export { AuthCard, type AuthCardProps } from './auth-card';
export { IdentifierField, type IdentifierFieldProps } from './identifier-field';
export {
  SegmentedControl,
  type SegmentedControlProps,
  type SegmentedOption,
} from './segmented-control';
export { OtpFlow, type OtpFlowProps } from './otp-flow';
export { GoogleButton, type GoogleButtonProps } from './google-button';
export { VerificationBanner } from './verification-banner';
export { LoginRequiredPrompt, type LoginRequiredPromptProps } from './login-required-prompt';
export { VerifyClient, type VerifyClientProps } from './verify-client';
export { LoginForm, seedAuthCache, type LoginFormProps } from './login-form';
export { RegisterForm, isUsernameFormatValid } from './register-form';
export { ForgotForm, RESET_IDENTIFIER_KEY } from './forgot-form';
export { ResetForm, type ResetFormProps } from './reset-form';
export { apiErrorText, retryAfterSec, useApiErrorText } from './api-error';
