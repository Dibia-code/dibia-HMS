import { useMemo, useState } from 'react'
import { PERM } from '@/auth/permissions'
import { useAuth } from '@/auth/AuthContext'
import { useRepo } from '@/data/RepositoryContext'
import { useLiveQuery } from '@/hooks/useLiveQuery'
import {
  useToast, usePageHeader, Card, CardHead, Button, DataTable,
  StatRow, StatCard, Pill, FormPanel, FormGrid, Field, Input,
} from '@/components'
import { naira, formatDate } from '@/lib/format'

// Credit standing → pill tone + label.
function standingPill(s) {
  if (s === 'overdue') return { tone: 'overdue', label: 'Overdue' }
  if (s === 'watch') return { tone: 'pending', label: 'Watch' }
  return { tone: 'confirmed', label: 'Good standing' }
}

const emptyDraft = () => ({ firstName: '', surname: '', otherNames: '', phone: '', email: '', creditLimit: '' })

// Customers — credit customers with limits and balances owed (§4). Anyone with
// CUSTOMERS_VIEW sees the ledger; CUSTOMERS_MANAGE adds new accounts.
export default function CustomersPage() {
  const { can } = useAuth()
  const canManage = can(PERM.CUSTOMERS_MANAGE)
  const repo = useRepo()
  const toast = useToast()

  const [draft, setDraft] = useState(null)
  const [errors, setErrors] = useState({})

  const { data: customers } = useLiveQuery(() => repo.list('customers'), [repo])

  const stats = useMemo(() => {
    const list = customers || []
    return {
      count: list.length,
      outstanding: list.reduce((sum, c) => sum + (c.balance || 0), 0),
      overdue: list.filter((c) => c.standing === 'overdue').length,
    }
  }, [customers])

  const rows = useMemo(
    () => [...(customers || [])].sort((a, b) => (b.balance || 0) - (a.balance || 0)),
    [customers],
  )

  usePageHeader(
    {
      title: 'Customers',
      subtitle: 'Credit accounts & balances',
      actions: canManage && !draft && (
        <Button variant="primary" icon="plus" onClick={() => { setErrors({}); setDraft(emptyDraft()) }}>
          Add customer
        </Button>
      ),
    },
    [canManage, !!draft],
  )

  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }))

  async function save() {
    const e = {}
    if (!draft.firstName.trim() || !draft.surname.trim()) e.name = 'First name and surname are required'
    if (!draft.phone.trim()) e.phone = 'Required'
    setErrors(e)
    if (Object.keys(e).length) return
    try {
      await repo.create('customers', {
        name: [draft.firstName, draft.surname, draft.otherNames].filter(Boolean).join(' ').trim(),
        firstName: draft.firstName.trim(), surname: draft.surname.trim(), otherNames: draft.otherNames.trim(),
        phone: draft.phone.trim(),
        email: draft.email.trim(),
        creditLimit: Number(draft.creditLimit || 0),
        balance: 0,
        standing: 'good',
        dueDate: null,
      })
      toast.success('Customer added')
      setDraft(null)
    } catch (err) {
      toast.error(err.message || 'Could not add customer')
    }
  }

  const columns = [
    {
      key: 'name',
      header: 'Customer',
      render: (r) => (
        <span className="stack-tight">
          <span className="cell-strong">{r.name}</span>
          <span className="r-sub">{r.phone || '—'}</span>
          <span className="r-sub">{r.email || ''}</span>
        </span>
      ),
    },
    { key: 'creditLimit', header: 'Credit limit', align: 'num', render: (r) => naira(r.creditLimit || 0) },
    {
      key: 'balance',
      header: 'Balance owed',
      align: 'num',
      render: (r) => (
        <span className={(r.balance || 0) > 0 ? 'bal-owed' : 'bal-clear'}>
          {(r.balance || 0) > 0 ? naira(r.balance) : 'Clear'}
        </span>
      ),
    },
    { key: 'dueDate', header: 'Due date', render: (r) => (r.dueDate ? formatDate(r.dueDate) : '—') },
    {
      key: 'standing',
      header: 'Status',
      render: (r) => {
        const p = standingPill(r.standing)
        return <Pill tone={p.tone}>{p.label}</Pill>
      },
    },
  ]

  return (
    <>
      <StatRow>
        <StatCard label="Total customers" value={stats.count} />
        <StatCard label="Outstanding credit" value={naira(stats.outstanding)} />
        <StatCard label="Overdue accounts" value={stats.overdue} deltaDir={stats.overdue ? 'down' : 'flat'} delta={stats.overdue ? 'Needs follow-up' : 'All current'} />
      </StatRow>

      {draft && canManage && (
        <div className="mt-3 mb-3">
          <FormPanel title="New customer" submitLabel="Save customer" onClose={() => setDraft(null)} onSubmit={save}>
            <FormGrid>
              <Field label="First name" htmlFor="c-first" error={errors.name}><Input id="c-first" value={draft.firstName} onChange={(e) => set('firstName', e.target.value)} /></Field>
              <Field label="Surname" htmlFor="c-surname"><Input id="c-surname" value={draft.surname} onChange={(e) => set('surname', e.target.value)} /></Field>
              <Field label="Other names" htmlFor="c-other"><Input id="c-other" value={draft.otherNames} onChange={(e) => set('otherNames', e.target.value)} /></Field>
              <Field label="Phone number" htmlFor="c-phone" error={errors.phone}>
                <Input id="c-phone" value={draft.phone} onChange={(e) => set('phone', e.target.value)} placeholder="e.g. 0803 123 4567" />
              </Field>
              <Field label="Email address" htmlFor="c-email"><Input id="c-email" type="email" value={draft.email} onChange={(e) => set('email', e.target.value)} placeholder="name@example.com" /></Field>
              <Field label="Credit limit (₦)" htmlFor="c-limit" hint="Maximum they can owe on credit." span2>
                <Input id="c-limit" type="number" min="0" value={draft.creditLimit} onChange={(e) => set('creditLimit', e.target.value)} placeholder="0" />
              </Field>
            </FormGrid>
          </FormPanel>
        </div>
      )}

      <Card className="mt-3">
        <CardHead title={`Customers (${rows.length})`} />
        <DataTable columns={columns} rows={rows} empty={<div className="empty-row">No customers yet.</div>} />
      </Card>
    </>
  )
}
