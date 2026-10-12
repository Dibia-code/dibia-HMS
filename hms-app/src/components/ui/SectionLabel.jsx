// Uppercase section label used above table groupings (.section-label).
export function SectionLabel({ children, style }) {
  return (
    <div className="section-label" style={style}>
      {children}
    </div>
  )
}
