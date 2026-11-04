'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Button,
  IconButton,
  Spinner,
  Card,
  CardHeader,
  CardBody,
  CardFooter,
  Badge,
  Avatar,
  AvatarGroup,
  Separator,
  Skeleton,
  EmptyState,
  ErrorState,
  Rating,
  Tag,
  ProgressBar,
  Kbd,
  Heading,
  Text,
  Icons,
} from '../../../../components/ui';
import { Inbox, RefreshCw, Plus, Star, AlertTriangle } from '../../../../components/ui/icons';
import { ToastProvider } from '../../../../components/ui';
import { FormPlayground } from './form-playground';
import { OverlayPlayground } from './overlay-playground';

/**
 * The component gallery rendered inside /dev/ui (F1.3). Every base UI Kit
 * component in every relevant variant/state, so a human can verify each pack
 * × mode × locale visually. The toolbar (pack/mode) lives in the parent
 * DevUiClient; this is the body.
 */
export function DevUiShowcase() {
  const t = useTranslations('ui');
  const [rating, setRating] = useState(4);
  const [tagSelected, setTagSelected] = useState(false);
  const [progress] = useState(62);
  const [loading, setLoading] = useState(false);

  return (
    <ToastProvider>
      <div className="space-y-10">
        {/* Buttons */}
        <section>
          <Heading level="h2" className="mb-3">
            Button
          </Heading>
          <Card className="p-4">
            <div className="flex flex-wrap gap-3">
              <Button variant="primary">Primary</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="danger">Danger</Button>
              <Button variant="link">Link</Button>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button size="sm">Small</Button>
              <Button size="md">Medium</Button>
              <Button size="lg">Large</Button>
              <Button
                loading={loading}
                onClick={() => {
                  setLoading(true);
                  setTimeout(() => setLoading(false), 1500);
                }}
              >
                {loading ? t('loading') : 'Click to load'}
              </Button>
              <IconButton icon={Plus} aria-label="افزودن" />
              <IconButton icon={RefreshCw} aria-label="بازخوانی" loading />
            </div>
          </Card>
        </section>

        {/* Spinner */}
        <section>
          <Heading level="h2" className="mb-3">
            Spinner
          </Heading>
          <Card className="flex items-center gap-4 p-4">
            <Spinner size="sm" />
            <Spinner size="md" />
            <Spinner size="lg" />
            <Spinner label={t('loading')} />
          </Card>
        </section>

        {/* Cards */}
        <section>
          <Heading level="h2" className="mb-3">
            Card
          </Heading>
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader>
                <Text className="font-semibold">Outlined (پک فعال)</Text>
              </CardHeader>
              <CardBody>
                <Text muted>بدنه کارت با padding از توکن.</Text>
              </CardBody>
              <CardFooter>
                <Button size="sm" variant="ghost">
                  بستن
                </Button>
              </CardFooter>
            </Card>
            <Card cardStyle="elevated">
              <CardHeader>
                <Text className="font-semibold">Elevated</Text>
              </CardHeader>
              <CardBody>
                <Text muted>سایه نرم.</Text>
              </CardBody>
            </Card>
            <Card cardStyle="bordered">
              <CardHeader>
                <Text className="font-semibold">Bordered</Text>
              </CardHeader>
              <CardBody>
                <Text muted>حاشیه طلایی.</Text>
              </CardBody>
            </Card>
          </div>
        </section>

        {/* Badges */}
        <section>
          <Heading level="h2" className="mb-3">
            Badge
          </Heading>
          <Card className="flex flex-wrap items-center gap-3 p-4">
            <Badge variant="neutral" leadingIcon={Icons.Info}>
              نکته
            </Badge>
            <Badge variant="primary" leadingIcon={Star}>
              برتر
            </Badge>
            <Badge variant="success" leadingIcon={Icons.Check}>
              تأیید شد
            </Badge>
            <Badge variant="warning" leadingIcon={AlertTriangle}>
              هشدار
            </Badge>
            <Badge variant="danger" leadingIcon={AlertTriangle}>
              خطا
            </Badge>
          </Card>
        </section>

        {/* Avatars */}
        <section>
          <Heading level="h2" className="mb-3">
            Avatar
          </Heading>
          <Card className="flex flex-wrap items-center gap-4 p-4">
            <Avatar name="علی رضایی" size="sm" />
            <Avatar name="علی‌رضا احمدی" size="md" />
            <Avatar name="Jane Doe" size="lg" />
            <AvatarGroup
              size="sm"
              avatars={[
                { name: 'ممد رستگار' },
                { name: 'سارا کیانی' },
                { name: 'Bob Lee' },
                { name: 'Cara Ng' },
                { name: 'Dan Park' },
                { name: 'Eve Wu' },
              ]}
            />
          </Card>
        </section>

        {/* Skeleton */}
        <section>
          <Heading level="h2" className="mb-3">
            Skeleton
          </Heading>
          <Card className="flex flex-wrap items-start gap-6 p-4">
            <Skeleton shape="circle" />
            <div className="flex-1">
              <Skeleton shape="text" lines={3} />
            </div>
            <Skeleton shape="rect" className="h-16 w-32" />
          </Card>
        </section>

        {/* Empty / Error states */}
        <section>
          <Heading level="h2" className="mb-3">
            EmptyState / ErrorState
          </Heading>
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <EmptyState
                icon={Inbox}
                title="هنوز نظری ثبت نشده"
                description="اولین نفری باشید که نظر می‌دهد."
                action={{ label: 'افزودن نظر', onClick: () => {} }}
              />
            </Card>
            <Card>
              <ErrorState
                error={{ message: 'دریافت اطلاعات ناموفق بود', requestId: 'req_abc123' } as never}
                onRetry={() => {}}
              />
            </Card>
          </div>
        </section>

        {/* Rating */}
        <section>
          <Heading level="h2" className="mb-3">
            Rating
          </Heading>
          <Card className="space-y-3 p-4">
            <div className="flex items-center gap-4">
              <Rating value={4.5} size="md" />
              <Rating value={3} size="sm" />
              <Rating value={5} size="lg" />
            </div>
            <div className="flex items-center gap-4">
              <Rating value={rating} readOnly={false} onValueChange={setRating} />
              <Text muted>انتخاب: {rating}</Text>
            </div>
          </Card>
        </section>

        {/* Tag / Chip */}
        <section>
          <Heading level="h2" className="mb-3">
            Tag / Chip
          </Heading>
          <Card className="flex flex-wrap items-center gap-3 p-4">
            <Tag>ساده</Tag>
            <Tag selectable selected={tagSelected} onClick={() => setTagSelected((v) => !v)}>
              قابل انتخاب
            </Tag>
            <Tag removable removeLabel="حذف" onRemove={() => {}}>
              قابل حذف
            </Tag>
            <Tag selected>انتخاب‌شده</Tag>
          </Card>
        </section>

        {/* Progress + Kbd + Separator */}
        <section>
          <Heading level="h2" className="mb-3">
            ProgressBar / Kbd / Separator
          </Heading>
          <Card className="space-y-4 p-4">
            <ProgressBar value={progress} aria-label="پیشرفت بارگذاری" />
            <div className="flex items-center gap-2">
              <Text size="sm" muted>
                میانبر:
              </Text>
              <Kbd>Ctrl</Kbd>
              <Kbd>K</Kbd>
            </div>
            <Separator />
            <Text size="sm" muted>
              بعد از جداکننده
            </Text>
          </Card>
        </section>

        {/* Typography */}
        <section>
          <Heading level="h2" className="mb-3">
            Heading / Text
          </Heading>
          <Card className="space-y-2 p-4">
            <Heading level="h1">H1 عنوان اصلی</Heading>
            <Heading level="h2">H2 عنوان صفحه</Heading>
            <Heading level="h3">H3 عنوان بخش</Heading>
            <Text>Text پایه (md).</Text>
            <Text size="sm" muted>
              Text کمکی (sm, muted).
            </Text>
            <Text size="xs">Text ریز (xs).</Text>
          </Card>
        </section>

        {/* Forms (F1.4) */}
        <section>
          <FormPlayground />
        </section>

        {/* Overlays + data (F1.5) */}
        <section>
          <OverlayPlayground />
        </section>
      </div>
    </ToastProvider>
  );
}
