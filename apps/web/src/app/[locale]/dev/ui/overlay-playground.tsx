'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Modal,
  Drawer,
  BottomSheet,
  ConfirmDialog,
  useConfirm,
  Popover,
  DropdownMenu,
  DropdownItem,
  DropdownSeparator,
  DropdownCheckboxItem,
  DropdownLabel,
  Tooltip,
  Tabs,
  Accordion,
  useToast,
  DataTable,
  Pagination,
  Breadcrumbs,
  Stat,
  Timeline,
  CopyButton,
  Button,
  Card,
  CardBody,
  CardHeader,
  Heading,
  type DataTableColumn,
} from '../../../../components/ui';

interface Row {
  id: string;
  name: string;
  city: string;
  rating: number;
}

/**
 * Overlay + data UI playground (F1.5), rendered inside /dev/ui. Every overlay
 * has a trigger; opening a Modal inside a Drawer verifies nested focus
 * handling. The data components sit in cards below.
 */
export function OverlayPlayground() {
  const t = useTranslations('form');
  const toast = useToast();
  const confirm = useConfirm();
  const { dialog: confirmDialog } = confirm;

  const [modalOpen, setModalOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [nestedModalOpen, setNestedModalOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [checked, setChecked] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);

  const rows: Row[] = [
    { id: '1', name: 'کافه آرمان', city: 'تهران', rating: 4.5 },
    { id: '2', name: 'رستوران دریا', city: 'شیراز', rating: 4.2 },
    { id: '3', name: 'فست‌فود پلاس', city: 'اصفهان', rating: 3.8 },
    { id: '4', name: 'بزمک کافی', city: 'تبریز', rating: 4.7 },
    { id: '5', name: 'کافه باران', city: 'مشهد', rating: 4.0 },
  ];

  const columns: DataTableColumn<Row>[] = [
    { id: 'name', header: 'نام', cell: (r) => r.name, sortable: true },
    { id: 'city', header: 'شهر', cell: (r) => r.city, sortable: true },
    { id: 'rating', header: 'امتیاز', cell: (r) => r.rating, sortable: true },
  ];

  return (
    <>
      {confirmDialog}
      <Card>
        <CardHeader>
          <Heading level="h2">{t('playground.overlayTitle')}</Heading>
        </CardHeader>
        <CardBody className="space-y-6">
          {/* Overlays */}
          <div className="flex flex-wrap gap-3">
            <Button onClick={() => setModalOpen(true)}>{t('playground.openModal')}</Button>
            <Button onClick={() => setDrawerOpen(true)}>{t('playground.openDrawer')}</Button>
            <Button onClick={() => setSheetOpen(true)}>{t('playground.openSheet')}</Button>
            <Button variant="danger" onClick={() => setConfirmOpen(true)}>
              {t('playground.openConfirm')}
            </Button>
            <Button
              variant="ghost"
              onClick={() =>
                confirm.confirm({
                  destructive: true,
                  title: t('confirm.title'),
                  description: t('confirm.description'),
                })
              }
            >
              {t('playground.useConfirmHook')}
            </Button>
          </div>

          <Modal
            open={modalOpen}
            onOpenChange={setModalOpen}
            title={t('playground.modalTitle')}
            description={t('playground.modalDesc')}
            footer={
              <>
                <Button variant="ghost" onClick={() => setModalOpen(false)}>
                  {t('overlay.cancel')}
                </Button>
                <Button onClick={() => setModalOpen(false)}>{t('overlay.confirm')}</Button>
              </>
            }
          >
            <p className="text-sm text-text-subtle">{t('playground.modalBody')}</p>
          </Modal>

          <Drawer
            open={drawerOpen}
            onOpenChange={setDrawerOpen}
            title={t('playground.drawerTitle')}
            description={t('playground.drawerDesc')}
          >
            <div className="space-y-3">
              <p className="text-sm text-text-subtle">{t('playground.drawerBody')}</p>
              <Button onClick={() => setNestedModalOpen(true)}>
                {t('playground.openModalInDrawer')}
              </Button>
            </div>
            {/* Modal inside Drawer — verifies nested focus management. */}
            <Modal
              open={nestedModalOpen}
              onOpenChange={setNestedModalOpen}
              title={t('playground.nestedModalTitle')}
              size="sm"
            >
              <p className="text-sm text-text-subtle">{t('playground.nestedModalBody')}</p>
            </Modal>
          </Drawer>

          <BottomSheet
            open={sheetOpen}
            onOpenChange={setSheetOpen}
            title={t('playground.sheetTitle')}
          >
            <p className="text-sm text-text-subtle">{t('playground.sheetBody')}</p>
          </BottomSheet>

          <ConfirmDialog
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            destructive
            title={t('playground.confirmTitle')}
            description={t('confirm.description')}
            onConfirm={async () => {
              await new Promise((r) => setTimeout(r, 500));
            }}
          />

          {/* Popovers + Dropdown + Tooltip */}
          <div className="flex flex-wrap items-center gap-3">
            <Popover trigger={<Button variant="secondary">{t('playground.popover')}</Button>}>
              <p className="text-sm">{t('playground.popoverBody')}</p>
            </Popover>

            <DropdownMenu trigger={<Button variant="secondary">{t('playground.menu')}</Button>}>
              <DropdownLabel>{t('playground.menuLabel')}</DropdownLabel>
              <DropdownItem>{t('playground.edit')}</DropdownItem>
              <DropdownItem>{t('playground.duplicate')}</DropdownItem>
              <DropdownSeparator />
              <DropdownCheckboxItem checked={checked} onCheckedChange={setChecked}>
                {t('playground.pin')}
              </DropdownCheckboxItem>
              <DropdownSeparator />
              <DropdownItem destructive>{t('playground.delete')}</DropdownItem>
            </DropdownMenu>

            <Tooltip content={t('playground.tooltipContent')}>
              <Button variant="link">{t('playground.tooltipTrigger')}</Button>
            </Tooltip>
          </div>

          {/* Toasts */}
          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" onClick={() => toast.success(t('playground.toastSuccess'))}>
              {t('playground.toastSuccessBtn')}
            </Button>
            <Button variant="secondary" onClick={() => toast.error(t('playground.toastError'))}>
              {t('playground.toastErrorBtn')}
            </Button>
            <Button
              variant="secondary"
              onClick={() =>
                toast.promise(
                  new Promise<string>((resolve) => setTimeout(() => resolve('ok'), 1000)),
                  {
                    loading: t('playground.toastLoading'),
                    success: t('playground.toastSuccess'),
                    error: t('playground.toastError'),
                  },
                )
              }
            >
              {t('playground.toastPromiseBtn')}
            </Button>
          </div>

          {/* Tabs + Accordion */}
          <Tabs
            tabs={[
              {
                value: 'tab1',
                label: t('playground.tab1'),
                content: <p className="text-sm">{t('playground.tab1Body')}</p>,
              },
              {
                value: 'tab2',
                label: t('playground.tab2'),
                content: <p className="text-sm">{t('playground.tab2Body')}</p>,
              },
            ]}
          />

          <Accordion
            items={[
              { value: 'a1', header: t('playground.acc1'), content: t('playground.acc1Body') },
              { value: 'a2', header: t('playground.acc2'), content: t('playground.acc2Body') },
            ]}
          />
        </CardBody>
      </Card>

      {/* Data components */}
      <Card className="mt-6">
        <CardHeader>
          <Heading level="h2">{t('playground.dataTitle')}</Heading>
        </CardHeader>
        <CardBody className="space-y-6">
          <Breadcrumbs
            items={[
              { label: t('playground.crumbHome'), href: '/' },
              { label: t('playground.crumbList'), href: '/list' },
              { label: t('playground.crumbCurrent') },
            ]}
            jsonLd
          />

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Stat label={t('playground.statVisits')} value="۱٬۲۴۰" delta={12} deltaUnit="percent" />
            <Stat
              label={t('playground.statRevenue')}
              value="۳٬۵۰۰٬۰۰۰"
              delta={-3}
              deltaUnit="percent"
            />
            <Stat label={t('playground.statOrders')} value="۸۹" />
          </div>

          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            selectable
            selectedKeys={selected}
            onSelectionChange={setSelected}
            renderMobileCard={(r) => (
              <div className="flex flex-col gap-1">
                <span className="font-medium">{r.name}</span>
                <span className="text-xs text-text-subtle">{r.city}</span>
                <span className="text-xs text-text-subtle">
                  {t('playground.rating')}: {r.rating}
                </span>
              </div>
            )}
          />

          <Pagination page={page} totalPages={8} onPageChange={setPage} />

          <Timeline
            items={[
              { time: t('playground.tl1Time'), children: t('playground.tl1Body'), tone: 'success' },
              { time: t('playground.tl2Time'), children: t('playground.tl2Body'), tone: 'primary' },
              { time: t('playground.tl3Time'), children: t('playground.tl3Body') },
            ]}
          />

          <div className="flex items-center gap-2">
            <span className="text-sm text-text-subtle">{t('playground.copyDemo')}</span>
            <CopyButton value="XBRAND-2026-CODE" />
            <CopyButton value="ABC123" iconOnly aria-label={t('copy.copy')} />
          </div>
        </CardBody>
      </Card>
    </>
  );
}
