import { cx } from '@/lib/cx'

// Status pill. `tone` → colour: active → green, pending → amber, failed → red.
export function Pill({ tone = 'active', className, children }) {
  return <span className={cx('pill', `pill-${tone}`, className)}>{children}</span>
}
