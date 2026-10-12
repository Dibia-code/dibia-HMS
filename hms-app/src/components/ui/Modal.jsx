import { useEffect, useRef } from 'react'
import { cx } from '@/lib/cx'
import { Button } from './Button'

export function Modal({ title, onClose, wide, xl, children, actions, labelledBy = 'modal-title' }) {
  const ref = useRef(null)

  useEffect(() => {
    const previous = document.activeElement
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.()
    }
    document.addEventListener('keydown', onKey)
    ref.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      previous?.focus?.()
    }
  }, [onClose])

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className={cx('modal', wide && 'wide', xl && 'xl')}
      >
        <h2 id={labelledBy}>{title}</h2>
        <div className="modal-body">{children}</div>
        {actions && <div className="modal-actions">{actions}</div>}
      </div>
    </div>
  )
}

export function ConfirmDialog({ title, message, confirmLabel = 'Confirm', destructive, busy, onConfirm, onCancel }) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      actions={
        <>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button
            variant={destructive ? 'danger-solid' : 'primary'}
            className={busy ? 'loading' : undefined}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? '' : confirmLabel}
          </Button>
        </>
      }
    >
      {message}
    </Modal>
  )
}
