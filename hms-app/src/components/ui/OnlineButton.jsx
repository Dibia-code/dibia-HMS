import { useEffect, useState } from 'react'
import { useSync } from '@/data/RepositoryContext'
import { Button } from './Button'
import { Icon } from '../Icon'

// A button for actions that need the server. Offline it stays visible but greyed
// out, with a small offline icon, and tapping it says why (Design System 4.3).
export function OnlineButton({ children, onClick, ...props }) {
  const { online } = useSync()
  const [tip, setTip] = useState(false)

  useEffect(() => {
    if (!tip) return undefined
    const t = setTimeout(() => setTip(false), 2500)
    return () => clearTimeout(t)
  }, [tip])

  if (online) return <Button {...props} onClick={onClick}>{children}</Button>

  return (
    <span className="online-only">
      <Button {...props} variant="ghost" className="offline-disabled" aria-disabled="true" onClick={() => setTip(true)}>
        <Icon name="wifiOff" size={16} />
        {children}
      </Button>
      {tip && <span className="online-tip" role="status">Available when online</span>}
    </span>
  )
}
