import { cx } from '@/lib/cx'

// Uppercase group label used above tables and card sections.
export function SectionLabel({ className, children }) {
  return <div className={cx('section-label', className)}>{children}</div>
}
