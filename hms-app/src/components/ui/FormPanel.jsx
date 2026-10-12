import { Button } from './Button'

// Inline add/edit panel that opens above a table (the pattern used across
// Inventory, Staff, Customers, etc.). Matches .form-panel.
export function FormPanel({ title, onClose, onSubmit, submitLabel = 'Save', submitDisabled, children }) {
  return (
    <form
      className="form-panel"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit?.(e)
      }}
    >
      <div className="fp-head">
        <div className="title">{title}</div>
        <div className="spacer" />
        {onClose && <Button variant="quiet" icon="x" onClick={onClose} aria-label="Close" />}
      </div>
      {children}
      <div className="fp-actions">
        {onClose && (
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        )}
        <Button variant="primary" type="submit" disabled={submitDisabled}>
          {submitLabel}
        </Button>
      </div>
    </form>
  )
}
