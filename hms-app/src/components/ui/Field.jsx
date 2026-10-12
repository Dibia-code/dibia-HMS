import { cx } from '@/lib/cx'

// Form field wrapper + inputs (.field / .input / .select / .textarea, .form-grid).

export function FormGrid({ children, className }) {
  return <div className={cx('form-grid', className)}>{children}</div>
}

export function Field({ label, hint, error, htmlFor, className, children, span2, required, incomplete }) {
  return (
    <div className={cx('field', error && 'invalid', incomplete && 'incomplete', span2 && 'col-span-2', className)}>
      {label && (
        <label htmlFor={htmlFor}>
          {label}
          {required && <span className="req" aria-hidden="true">*</span>}
        </label>
      )}
      {children}
      {error ? <span className="error">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  )
}

export function Input({ className, ...rest }) {
  return <input className={cx('input', className)} {...rest} />
}

export function Textarea({ className, ...rest }) {
  return <textarea className={cx('textarea', className)} {...rest} />
}

export function Select({ className, children, ...rest }) {
  return (
    <select className={cx('select', className)} {...rest}>
      {children}
    </select>
  )
}
