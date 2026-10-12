import { cx } from '@/lib/cx'

// Card and its optional header row. Matches .card / .card-head in components.css.
export function Card({ padLg, className, children, ...rest }) {
  return (
    <div className={cx('card', padLg && 'card-pad-lg', className)} {...rest}>
      {children}
    </div>
  )
}

export function CardHead({ title, children }) {
  return (
    <div className="card-head">
      {title && <div className="title">{title}</div>}
      {children}
    </div>
  )
}
