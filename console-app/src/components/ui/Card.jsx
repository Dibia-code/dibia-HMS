import { cx } from '@/lib/cx'

// Plain surface card (.card).
export function Card({ className, children, ...rest }) {
  return (
    <div className={cx('card', className)} {...rest}>
      {children}
    </div>
  )
}
