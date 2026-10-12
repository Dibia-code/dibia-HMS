// Login-style field: label above an input. `Input` is a thin pass-through so its
// styling comes from the `.field input` rule.
export function Field({ label, htmlFor, children }) {
  return (
    <div className="field">
      {label && <label htmlFor={htmlFor}>{label}</label>}
      {children}
    </div>
  )
}

export function Input(props) {
  return <input {...props} />
}
