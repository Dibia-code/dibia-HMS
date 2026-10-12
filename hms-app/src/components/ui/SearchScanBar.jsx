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
  return (
    <div className="search-bar">
      <div className="search-box">
        <Icon name="search" />
        <input
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          placeholder={placeholder}
          autoFocus={autoFocus}
        />
      </div>
      {onScan && (
        <button type="button" className="scan-btn" onClick={onScan}>
          <Icon name="scan" />
          {scanLabel}
        </button>
      )}
    </div>
  )
}
