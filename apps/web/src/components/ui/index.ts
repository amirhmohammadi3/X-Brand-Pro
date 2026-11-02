/**
 * UI Kit barrel (F1.3). Re-export every base component so callers do
 * `import { Button, Card } from '@/components/ui'`. Icons come from
 * `./icons`; the `DirIcon` wrapper is also exported.
 */
export { Button, type ButtonProps, type ButtonVariant, type ButtonSize } from './button';
export { IconButton, type IconButtonProps } from './icon-button';
export { Spinner, type SpinnerProps } from './spinner';
export { Card, CardHeader, CardBody, CardFooter, type CardProps, type CardStyle } from './card';
export { Badge, type BadgeProps, type BadgeVariant } from './badge';
export { Avatar, type AvatarProps, type AvatarSize, initialsFromName } from './avatar';
export { AvatarGroup, type AvatarGroupProps } from './avatar-group';
export { Separator, type SeparatorProps } from './separator';
export { Skeleton, type SkeletonProps } from './skeleton';
export { EmptyState, type EmptyStateProps } from './empty-state';
export { ErrorState, type ErrorStateProps } from './error-state';
export { Rating, type RatingProps, type RatingSize } from './rating';
export { Tag, type TagProps } from './tag';
export { ProgressBar, type ProgressBarProps } from './progress-bar';
export { Kbd, type KbdProps } from './kbd';
export { Heading, type HeadingProps, type HeadingLevel } from './heading';
export { Text, type TextProps } from './text';
export { VisuallyHidden, type VisuallyHiddenProps } from './visually-hidden';
export { DirIcon, type DirIconProps } from './dir-icon';
export * as Icons from './icons';
