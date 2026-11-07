import type { SelectHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

/** Select gốc của trình duyệt: đủ dùng, truy cập bằng bàn phím sẵn, ít code hơn Radix Select */
export function NativeSelect({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'border-input bg-background focus-visible:ring-ring/50 h-9 w-full rounded-md border px-3 text-sm outline-none focus-visible:ring-[3px] disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}
