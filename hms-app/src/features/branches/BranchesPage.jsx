import { useMemo, useState } from 'react'
import { useRepo } from '@/data/RepositoryContext'
import { useLiveQuery } from '@/hooks/useLiveQuery'
import {
  useToast, usePageHeader, Card, CardHead, Button, Pill, Icon,
  FormPanel, FormGrid, Field, Input,
} from '@/components'
import { naira, formatDate } from '@/lib/format'

const DAY = 86_400_000
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime() }
const isToday = (iso) => iso && new Date(iso).getTime() >= startOfToday()

// Branches — one card per location with live figures, plus the queue of stock
// transfer requests between branches (§4). BRANCHES_MANAGE.
export default function BranchesPage() {
  const repo = useRepo()
  const toast = useToast()

  const [draft, setDraft] = useState(null)
  const [errors, setErrors] = useState({})

  const { data: branches } = useLiveQuery(() => repo.list('branches'), [repo])
  const { data: staff } = useLiveQuery(() => repo.list('staff'), [repo])
  const { data: products } = useLiveQuery(() => repo.list('products'), [repo])
  const { data: sales } = useLiveQuery(() => repo.list('sales'), [repo])
  const { data: transfers } = useLiveQuery(() => repo.list('transfers'), [repo])

  const branchName = (id) => branches?.find((b) => b.id === id)?.name || '—'

  const cards = useMemo(
    () =>
      (branches || []).map((b) => ({
        ...b,
        staffCount: (staff || []).filter((s) => s.branchId === b.id).length,
        productCount: (products || []).filter((p) => p.branchId === b.id).length,
        salesToday: (sales || []).filter((s) => s.branchId === b.id && isToday(s.createdAt)).reduce((sum, s) => sum + (s.total || 0), 0),
      })),
    [branches, staff, products, sales],
  )

  const pending = useMemo(
    () => [...(transfers || [])].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
    [transfers],
  )

  usePageHeader(
    {
      title: 'Branches',
      subtitle: 'Locations & stock transfers',
      actions: !draft && (
        <Button variant="primary" icon="plus" onClick={() => { setErrors({}); setDraft({ name: '', address: '' }) }}>
          Add branch
        </Button>
      ),
    },
    [!!draft],
  )

  async function save() {
    const e = {}
    if (!draft.name.trim()) e.name = 'Required'
    setErrors(e)
    if (Object.keys(e).length) return
    try {
      await repo.create('branches', { name: draft.name.trim(), address: draft.address.trim(), isMain: false })
      toast.success('Branch added')
      setDraft(null)
    } catch (err) {
      toast.error(err.message || 'Could not add branch')
    }
  }

  return (
    <>
      {draft && (
        <div className="mb-3">
          <FormPanel title="Add branch" submitLabel="Save branch" onClose={() => setDraft(null)} onSubmit={save}>
            <FormGrid>
              <Field label="Branch name" htmlFor="b-name" error={errors.name}>
                <Input id="b-name" value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="e.g. Surulere Branch" />
              </Field>
              <Field label="Address" htmlFor="b-addr">
                <Input id="b-addr" value={draft.address} onChange={(e) => setDraft((d) => ({ ...d, address: e.target.value }))} placeholder="e.g. 14 Adeniran Ave, Surulere" />
              </Field>
            </FormGrid>
          </FormPanel>
        </div>
      )}

      <Card className="mb-3">
        <CardHead title={`Branches (${cards.length})`} />
        {cards.map((b) => (
          <div key={b.id} className="branch-card">
            <div className="bl">
              <div className="bic"><Icon name="branches" size={20} /></div>
              <div>
                <div className="bname">{b.name}{b.isMain ? ' · Main' : ''}</div>
                <div className="bsub">{b.address || 'No address on file'}</div>
              </div>
            </div>
            <div className="branch-figs">
              <div className="bfig"><div className="n">{b.staffCount}</div><div className="l">Staff</div></div>
              <div className="bfig"><div className="n">{b.productCount}</div><div className="l">Products</div></div>
              <div className="bfig"><div className="n">{naira(b.salesToday)}</div><div className="l">Sales today</div></div>
            </div>
          </div>
        ))}
      </Card>

      <Card>
        <CardHead title="Stock transfer requests" />
        {pending.length === 0 ? (
          <div className="empty-row">No transfer requests. Raise one from the Warehouse screen.</div>
        ) : (
          pending.map((t) => (
            <div key={t.id} className="row-line">
              <div className="grow">
                <div className="r-title">{branchName(t.fromBranchId)} → {branchName(t.toBranchId)}</div>
                <div className="r-sub">{t.productName || 'Stock'} · {t.qty} units · {formatDate(t.createdAt)}</div>
              </div>
              <Pill tone={t.status === 'approved' ? 'confirmed' : t.status === 'rejected' ? 'critical' : 'pending'}>
                {t.status === 'approved' ? 'Approved' : t.status === 'rejected' ? 'Rejected' : 'Pending'}
              </Pill>
            </div>
          ))
        )}
      </Card>
    </>
  )
}
