import { FlaskConical } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/** Logo: ô vuông xanh "đạt" + tên sản phẩm. Ẩn chữ khi sidebar thu gọn thành icon */
export function BrandMark({ subtitle }: { subtitle?: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2">
      <span className="bg-brand text-brand-foreground flex size-8 shrink-0 items-center justify-center rounded-md">
        <FlaskConical className="size-4" aria-hidden />
      </span>
      <span className="grid min-w-0 leading-tight group-data-[collapsible=icon]:hidden">
        <span className="truncate font-semibold">{t('app.name')}</span>
        {subtitle && <span className="text-muted-foreground truncate text-xs">{subtitle}</span>}
      </span>
    </div>
  );
}
