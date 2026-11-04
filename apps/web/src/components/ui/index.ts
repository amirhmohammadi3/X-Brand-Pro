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

// Form UI Kit (F1.4) — form components + the Zod form hook.
export * from './form';

// Overlay + data UI Kit (F1.5).
export { Modal, useModalState, type ModalProps, type ModalSize } from './modal';
export { Drawer, type DrawerProps, type DrawerSide } from './drawer';
export { BottomSheet, type BottomSheetProps, type BottomSheetSnap } from './bottom-sheet';
export {
  ConfirmDialog,
  useConfirm,
  type ConfirmDialogProps,
  type ConfirmOptions,
} from './confirm-dialog';
export { Popover, type PopoverProps } from './popover';
export {
  DropdownMenu,
  DropdownItem,
  DropdownSeparator,
  DropdownCheckboxItem,
  DropdownSub,
  DropdownLabel,
} from './dropdown-menu';
export { Tooltip, type TooltipProps } from './tooltip';
export { Tabs, type TabsProps } from './tabs';
export { Accordion, type AccordionProps, type AccordionItem } from './accordion';
export { ToastProvider, useToast, type ToastVariant, type ToastOptions } from './toast';
export { DataTable, type DataTableColumn, type DataTableProps, type SortDir } from './data-table';
export { Pagination, type PaginationProps } from './pagination';
export { Breadcrumbs, type BreadcrumbsProps, type BreadcrumbItem } from './breadcrumbs';
export { Stat, type StatProps } from './stat';
export { Timeline, type TimelineProps, type TimelineItem } from './timeline';
export { CopyButton, type CopyButtonProps } from './copy-button';
