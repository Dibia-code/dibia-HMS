import { cx } from '@/lib/cx'
import { Icon } from '../Icon'

// Button. `variant` → .btn CSS class (primary/ghost/amber/danger/quiet);
// `icon` / `iconRight` take icon names.
export function Button({
  variant = 'ghost',
  size,
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
      className={cx('btn', `btn-${variant}`, size && `btn-${size}`, block && 'btn-block', className)}
      {...rest}
    >
      {icon && <Icon name={icon} />}
      {children}
      {iconRight && <Icon name={iconRight} />}
    </button>
  )
}
