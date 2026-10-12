import { useMemo, useState } from 'react'
import { useRepo } from '@/data/RepositoryContext'
import { useLiveQuery } from '@/hooks/useLiveQuery'
import {
  useToast, usePageHeader, Card, CardHead, Button, DataTable,
  StatRow, StatCard, FormPanel, FormGrid, Field, Input, Select, Textarea,
} from '@/components'
import { naira, formatDate } from '@/lib/format'

const CATEGORIES = ['Rent & utilities', 'Salaries', 'Fuel', 'Supplies', 'Maintenance', 'Other']

function isThisMonth(iso) {
  if (!iso) return false
  const d = new Date(iso)
  const now = new Date()
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
}

const emptyDraft = (branchId) => ({ category: CATEGORIES[0], amount: '', branchId: branchId || '', note: '', payee: '', payeePhone: '', payeeEmail: '', paymentStatus: 'unpaid' })

// Expenses — running cost log with category + branch (§4). EXPENSES_MANAGE only.
export default function ExpensesPage() {
  const repo = useRepo()
  const toast = useToast()

  const [draft, setDraft] = useState(null)
  const [errors, setErrors] = useState({})

  const { data: expenses } = useLiveQuery(() => repo.list('expenses'), [repo])
  const { data: branches } = useLiveQuery(() => repo.list('branches'), [repo])

  const branchName = (id) => branches?.find((b) => b.id === id)?.name || '—'

  const stats = useMemo(() => {
    const month = (expenses || []).filter((x) => isThisMonth(x.createdAt))
    const sum = (pred) => month.filter(pred).reduce((s, x) => s + (x.amount || 0), 0)
    return {
      month: sum(() => true),
      rent: sum((x) => x.category === 'Rent & utilities'),
      salaries: sum((x) => x.category === 'Salaries'),
    }
  }, [expenses])

  const rows = useMemo(
    () => [...(expenses || [])].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
    [expenses],
  )

  usePageHeader(
    {
      title: 'Expenses',
      subtitle: 'Operating costs',
      actions: !draft && (
        <Button variant="primary" icon="plus" onClick={() => { setErrors({}); setDraft(emptyDraft(branches?.[0]?.id)) }}>
          Record expense
        </Button>
      ),
    },
    [!!draft, branches?.length],
  )

  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }))

  async function save() {
    const e = {}
    if (draft.amount === '' || Number.isNaN(Number(draft.amount)) || Number(draft.amount) <= 0) e.amount = 'Enter an amount'
    setErrors(e)
    if (Object.keys(e).length) return
    try {
      await repo.create('expenses', {
        category: draft.category,
        amount: Number(draft.amount),
        branchId: draft.branchId || null,
        note: draft.note.trim(),
        payee: draft.payee.trim(), payeePhone: draft.payeePhone.trim(), payeeEmail: draft.payeeEmail.trim(),
        paymentStatus: draft.paymentStatus,
      })
      toast.success('Expense recorded')
      setDraft(null)
    } catch (err) {
      toast.error(err.message || 'Could not record expense')
    }
  }

  const columns = [
    { key: 'createdAt', header: 'Date', render: (r) => formatDate(r.createdAt) },
    { key: 'category', header: 'Category', render: (r) => <span className="cat-badge">{r.category}</span> },
    { key: 'note', header: 'Note', render: (r) => r.note || '—' },
    { key: 'payee', header: 'Pay to', render: (r) => r.payee || '—' },
    { key: 'paymentStatus', header: 'Payment', render: (r) => r.paymentStatus === 'paid' ? 'Paid' : 'Awaiting payment' },
    { key: 'branchId', header: 'Branch', render: (r) => branchName(r.branchId) },
    { key: 'amount', header: 'Amount', align: 'num', render: (r) => naira(r.amount || 0) },
  ]

  return (
    <>
      <StatRow>
        <StatCard label="This month" value={naira(stats.month)} />
        <StatCard label="Rent & utilities" value={naira(stats.rent)} />
        <StatCard label="Salaries" value={naira(stats.salaries)} />
      </StatRow>

      {draft && (
        <div className="mt-3 mb-3">
          <FormPanel title="Record expense" submitLabel="Save expense" onClose={() => setDraft(null)} onSubmit={save}>
            <FormGrid>
              <Field label="Category" htmlFor="e-cat">
                <Select id="e-cat" value={draft.category} onChange={(e) => set('category', e.target.value)}>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </Select>
              </Field>
              <Field label="Amount (₦)" htmlFor="e-amt" error={errors.amount}>
                <Input id="e-amt" type="number" min="0" value={draft.amount} onChange={(e) => set('amount', e.target.value)} placeholder="0" />
              </Field>
              <Field label="Branch" htmlFor="e-branch">
                <Select id="e-branch" value={draft.branchId} onChange={(e) => set('branchId', e.target.value)}>
                  <option value="">All / head office</option>
                  {(branches || []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </Select>
              </Field>
              <Field label="Pay to (person or company)" htmlFor="e-payee"><Input id="e-payee" value={draft.payee} onChange={(e) => set('payee', e.target.value)} placeholder="e.g. NEPA / electricity provider" /></Field>
              <Field label="Payee phone" htmlFor="e-phone"><Input id="e-phone" type="tel" value={draft.payeePhone} onChange={(e) => set('payeePhone', e.target.value)} /></Field>
              <Field label="Payee email" htmlFor="e-email"><Input id="e-email" type="email" value={draft.payeeEmail} onChange={(e) => set('payeeEmail', e.target.value)} /></Field>
              <Field label="Payment status" htmlFor="e-status"><Select id="e-status" value={draft.paymentStatus} onChange={(e) => set('paymentStatus', e.target.value)}><option value="unpaid">Needs payment</option><option value="paid">Paid</option></Select></Field>
              <Field label="Note" htmlFor="e-note" span2>
                <Textarea id="e-note" value={draft.note} onChange={(e) => set('note', e.target.value)} placeholder="e.g. NEPA bill for June" />
              </Field>
            </FormGrid>
          </FormPanel>
        </div>
      )}

      <Card className="mt-3">
        <CardHead title={`Expenses (${rows.length})`} />
        <DataTable columns={columns} rows={rows} empty={<div className="empty-row">No expenses recorded yet.</div>} />
      </Card>
    </>
  )
}
