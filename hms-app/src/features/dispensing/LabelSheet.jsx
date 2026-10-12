import { Modal, Button } from '@/components'
import { formatDate } from '@/lib/format'

export function LabelSheet({ records, hospital, onClose }) {
  return (
    <Modal
      wide
      title="Dispensing labels"
      onClose={onClose}
      labelledBy="labels-title"
      actions={
        <>
          <Button variant="ghost" icon="printer" onClick={() => window.print()}>Print labels</Button>
          <Button variant="primary" onClick={onClose}>Done</Button>
        </>
      }
    >
      <div id="receipt-print" className="labels">
        {records.map((r) => (
          <div key={r.id} className="drug-label">
            <div className="dl-fac">{hospital?.name}</div>
            <div className="dl-drug">{r.drugName}</div>
            <div className="dl-row"><span>Dose</span><b>{r.dose || 'As directed'}</b></div>
            <div className="dl-row"><span>How often</span><b>{r.frequency || 'As directed'}</b></div>
            <div className="dl-row"><span>For</span><b>{r.duration || 'As directed'}</b></div>
            <div className="dl-row"><span>Quantity</span><b>{r.qty}</b></div>
            <div className="dl-row"><span>Patient</span><b>{r.patientName}</b></div>
            <div className="dl-row"><span>Date</span><b>{formatDate(r.at)}</b></div>
          </div>
        ))}
      </div>
    </Modal>
  )
}
