import clsx from 'clsx';
import type { ReactNode } from 'react';

const tones = {
  neutral: 'bg-ink-100 text-ink-700',
  brand: 'bg-brand-50 text-brand-700',
  success: 'bg-success-50 text-success-700',
  warning: 'bg-warning-50 text-warning-700',
  danger: 'bg-danger-50 text-danger-700',
};

export function Badge({ tone = 'neutral', children }: { tone?: keyof typeof tones; children: ReactNode }) {
  return <span className={clsx('inline-flex rounded-full px-2 py-0.5 text-xs font-semibold', tones[tone])}>{children}</span>;
}
