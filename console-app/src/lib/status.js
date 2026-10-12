// Status → pill mappings, shared across the console pages so a hospital's
// status (or a ticket's) always reads the same colour and label.

export function hospitalStatusPill(status) {
  switch (status) {
    case 'active': return { tone: 'active', label: 'Active' }
    case 'pending': return { tone: 'pending', label: 'Pending approval' }
    case 'failed': return { tone: 'failed', label: 'Payment failed' }
    case 'suspended': return { tone: 'failed', label: 'Suspended' }
    case 'rejected': return { tone: 'failed', label: 'Rejected' }
    default: return { tone: 'pending', label: status || 'Unknown' }
  }
}

export function txnStatusPill(status) {
  return status === 'paid'
    ? { tone: 'active', label: 'Paid' }
    : { tone: 'failed', label: 'Failed' }
}

export function priorityPill(priority) {
  switch (priority) {
    case 'high': return { tone: 'failed', label: 'High' }
    case 'medium': return { tone: 'pending', label: 'Medium' }
    case 'low': return { tone: 'active', label: 'Low' }
    default: return { tone: 'pending', label: priority || '—' }
  }
}

export function ticketStatusPill(status) {
  return status === 'resolved'
    ? { tone: 'active', label: 'Resolved' }
    : { tone: 'pending', label: 'Open' }
}

// Whether an ISO date falls in the current calendar month (local time).
export function isThisMonth(value, now = new Date()) {
  if (!value) return false
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return false
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
}
