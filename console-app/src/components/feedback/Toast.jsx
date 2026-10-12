import { createContext, useCallback, useContext, useRef, useState } from 'react'
import { Icon } from '../Icon'

// Toast notifications. useToast() returns { toast, success, error, info };
// auto-dismiss after 2.4s, click to dismiss early.

const ToastCtx = createContext(null)
const ICON_BY_TYPE = { success: 'check', error: 'alert', info: 'bell' }

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const idRef = useRef(0)

  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id))
  }, [])

  const toast = useCallback(
    (message, { type = 'info', duration = 2400 } = {}) => {
      const id = ++idRef.current
      setToasts((list) => [...list, { id, message, type }])
      if (duration) setTimeout(() => dismiss(id), duration)
      return id
    },
    [dismiss],
  )

  const api = useRef({})
  api.current.toast = toast
  api.current.success = (m, o) => toast(m, { ...o, type: 'success' })
  api.current.error = (m, o) => toast(m, { ...o, type: 'error' })
  api.current.info = (m, o) => toast(m, { ...o, type: 'info' })

  return (
    <ToastCtx.Provider value={api.current}>
      {children}
      <div className="toast-region" aria-live="polite" aria-atomic="false">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.type}`} onClick={() => dismiss(t.id)} role="status">
            <Icon name={ICON_BY_TYPE[t.type] || 'bell'} />
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastCtx)
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>')
  return ctx
}
