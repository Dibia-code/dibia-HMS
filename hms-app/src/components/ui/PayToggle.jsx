import { cx } from '@/lib/cx'

// Segmented payment-method toggle. Management POS uses cash/transfer/split;
// staff POS uses cash/transfer/credit (credit gated by customer selection).
// Pass options as [{ value, label, disabled }].
export function PayToggle({ options, value, onChange }) {
  return (
    <div className="pay-toggle" role="tablist" aria-label="Payment method">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="tab"
          aria-selected={value === opt.value}
          disabled={opt.disabled}
          className={cx(value === opt.value && 'active')}
          onClick={() => !opt.disabled && onChange?.(opt.value)}
          title={opt.disabled && opt.disabledHint ? opt.disabledHint : undefined}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
