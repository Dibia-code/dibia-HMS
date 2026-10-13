import { useEffect } from 'react'
import { Icon } from '../Icon'

// Search box with an optional "Scan" button. Used by POS (sale scan) and
// Inventory (scan-to-check-stock). onScan is wired to the same handler a real
// barcode wedge/USB scanner would trigger.
export function SearchScanBar({
  value,
  onChange,
  onScan,
  placeholder = 'Search products…',
  scanLabel = 'Scan',
  autoFocus,
}) {
  useEffect(() => {
    if (!onScan) return undefined
    const handleBarcode = (event) => {
      onChange?.(event.detail?.value || '')
      onScan(event.detail?.value || '')
    }
    window.addEventListener('dibia:barcode', handleBarcode)
    return () => window.removeEventListener('dibia:barcode', handleBarcode)
  }, [onChange, onScan])
  return (
    <div className="search-bar">
      <div className="search-box">
        <Icon name="search" />
        <input
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          onKeyDown={(e) => {
            // USB barcode scanners in keyboard-wedge mode type the barcode
            // into the focused field and finish with Enter.
            if (e.key === 'Enter') {
              e.preventDefault()
              onScan?.(e.currentTarget.value)
            }
          }}
        />
      </div>
      {onScan && (
        <button type="button" className="scan-btn" onClick={() => onScan(value)}>
          <Icon name="scan" />
          {scanLabel}
        </button>
      )}
    </div>
  )
}
