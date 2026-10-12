import { cx } from '@/lib/cx'

// Toggle switch (settings, active flags). Controlled: checked + onChange(bool).
export function Switch({ checked, onChange, label, disabled }) {
  return (
    <label className={cx('switch', disabled && 'disabled')} style={disabled ? { opacity: 0.5 } : undefined}>
      <input
        type="checkbox"
        checked={!!checked}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.checked)}
      />
      <span className="track" />
      <span className="thumb" />
      {label && <span style={{ marginLeft: 50, fontSize: 14 }}>{label}</span>}
    </label>
  )
}
