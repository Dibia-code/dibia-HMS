// Tiny classnames joiner. Accepts strings, and objects { className: boolean }.
// cx('btn', isActive && 'active', { disabled: !enabled })
export function cx(...args) {
  const out = []
  for (const arg of args) {
    if (!arg) continue
    if (typeof arg === 'string') out.push(arg)
    else if (typeof arg === 'object') {
      for (const key in arg) if (arg[key]) out.push(key)
    }
  }
  return out.join(' ')
}
