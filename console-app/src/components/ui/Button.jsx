import { cx } from '@/lib/cx'
import { Icon } from '../Icon'

// Button. `variant` → .btn class (primary / secondary / danger); `icon` takes an
// icon name; `block` makes it full-width.
export function Button({
  variant = 'secondary',
  icon,
  iconRight,
  block,
  className,
  children,
  type = 'button',
  ...rest
}) {
  return (
    <button
      type={type}
      className={cx('btn', `btn-${variant}`, block && 'btn-block', className)}
      {...rest}
    >
      {icon && <Icon name={icon} />}
      {children}
      {iconRight && <Icon name={iconRight} />}
    </button>
  )
}
