import { cx } from '@/lib/cx'
import { initials } from '@/lib/format'

// Circular avatar with initials fallback. `size` = sm|lg.
export function Avatar({ name, size, className }) {
  return (
    <span className={cx('avatar', size && `avatar--${size}`, className)} title={name}>
      {initials(name)}
    </span>
  )
}
