import { useEffect } from 'react'
import { useHeaderState } from './pageHeaderContext'

// Page convenience hook: set the topbar title/subtitle/actions from a page.
// `actions` should be a stable node to avoid needless updates.
export function usePageHeader({ title, subtitle = '', actions = null }, deps = []) {
  const { setHeader } = useHeaderState()
  useEffect(() => {
    setHeader({ title, subtitle, actions })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
