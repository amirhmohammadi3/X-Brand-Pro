/**
 * Icon barrel (F1.3) — re-export ONLY the lucide icons the UI kit uses, so the
 * bundle stays small and the `check:no-external` guard sees a single import
 * surface. Add icons here as components adopt them.
 */
export {
  Star,
  X,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Check,
  AlertTriangle,
  Info,
  Loader2,
  Plus,
  Search,
  User,
  Inbox,
  RefreshCw,
} from 'lucide-react';

export type { LucideIcon } from 'lucide-react';
