import { Button, Modal, useToast } from '@/components'
import { METHOD_LABEL } from '@/lib/billing'
import { naira, formatDateTime } from '@/lib/format'
import { hospitalConfig } from '@/lib/hospital'
import { getHardwareConfig, printReceiptToUsb } from '@/lib/hardware'

export function ReceiptView({ payment, hospital, onClose, onDone, doneLabel }) {
  const cfg = hospitalConfig(hospital).receipt
  const toast = useToast()
  const isRefund = payment.type === 'refund'
  const totals = payment.totals
  const outstanding = payment.balanceAfter || 0

  function asText() {
    const money = (n) => naira(n)
    const rows = [
      hospital?.name || 'Receipt',
      `${isRefund ? 'Refund' : 'Receipt'} ${payment.receiptNo}`,
      formatDateTime(payment.createdAt),
      `Patient: ${payment.patientName} (${payment.dibiaId})`,
      `Visit: ${payment.visitNo}`,
      `Cashier: ${payment.cashierName}`,
      '',
      ...(payment.lines || []).map((l) => `${l.label} x${l.qty}  ${money(l.amount)}`),
      ...(Array.isArray(payment.methods) ? payment.methods : []).map((m) => `${isRefund ? 'Refunded via' : 'Paid by'} ${METHOD_LABEL[m.method] || m.method}: ${money(m.amount)}`),
      `${isRefund ? 'Total refunded' : 'Amount received'}: ${money(payment.amount)}`,
      ...(!isRefund && outstanding > 0.005 ? [`Balance outstanding: ${money(outstanding)}`] : []),
      '',
      cfg.footer,
    ]
    return rows.join('\n')
  }

  async function share() {
    const text = asText()
    try {
      if (navigator.share) await navigator.share({ title: `Receipt ${payment.receiptNo}`, text })
      else {
        await navigator.clipboard.writeText(text)
        toast.success('Receipt copied')
      }
    } catch {
      return
    }
  }

  async function print() {
    if (!getHardwareConfig().printer) {
      window.print()
      return
    }
    try {
      await printReceiptToUsb(asText())
      toast.success('Receipt sent to the connected printer')
    } catch (error) {
      toast.error(error?.message || 'Could not print to the connected printer')
    }
  }

  return (
    <Modal
      wide
      title={isRefund ? 'Refund receipt' : 'Payment receipt'}
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" icon="printer" onClick={print}>Print</Button>
          <Button variant="ghost" onClick={share}>Share or copy</Button>
          {onDone ? (
            <Button variant="primary" onClick={onDone}>{doneLabel || 'Done'}</Button>
          ) : (
            <Button variant="primary" onClick={onClose}>Close</Button>
          )}
        </>
      }
    >
      <div className="receipt-sheet" id="receipt-print">
        <div className="rc-head">
          <div className="rc-fac">{hospital?.name || 'Hospital'}</div>
          {cfg.showAddress && hospital?.address && <div>{hospital.address}</div>}
          {cfg.showPhone && hospital?.phone && <div>{hospital.phone}</div>}
        </div>
        <div className="rc-meta">
          <div><span>Receipt</span><b>{payment.receiptNo}</b></div>
          <div><span>Date</span><b>{formatDateTime(payment.createdAt)}</b></div>
          <div><span>Patient</span><b>{payment.patientName}</b></div>
          <div><span>Patient ID</span><b>{payment.dibiaId}</b></div>
          <div><span>Visit</span><b>{payment.visitNo}</b></div>
          <div><span>Cashier</span><b>{payment.cashierName}</b></div>
          {isRefund && <div><span>Refund of</span><b>{payment.refundOfNo}</b></div>}
        </div>

        {!isRefund && payment.lines?.length > 0 && (
          <table className="rc-lines">
            <thead>
              <tr><th>Item</th><th className="num">Qty</th><th className="num">Amount</th></tr>
            </thead>
            <tbody>
              {(Array.isArray(payment.lines) ? payment.lines : []).map((l) => (
                <tr key={l.id}>
                  <td>{l.label}</td>
                  <td className="num">{l.qty}</td>
                  <td className="num">{naira(l.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {!isRefund && totals && (
          <div className="rc-totals">
            <div><span>Subtotal</span><span>{naira(totals.subtotal)}</span></div>
            {totals.vat > 0 && <div><span>{totals.vatMode === 'inclusive' ? `Includes VAT (${totals.vatRate}%)` : `VAT (${totals.vatRate}%)`}</span><span>{naira(totals.vat)}</span></div>}
            <div className="b"><span>Bill total</span><span>{naira(totals.total)}</span></div>
          </div>
        )}

        <div className="rc-totals">
          {(Array.isArray(payment.methods) ? payment.methods : []).map((m, i) => (
            <div key={i}>
              <span>{isRefund ? 'Refunded via' : 'Paid by'} {METHOD_LABEL[m.method] || m.method}</span>
              <span>{naira(m.amount)}</span>
            </div>
          ))}
          <div className="b"><span>{isRefund ? 'Total refunded' : 'Amount received'}</span><span>{naira(payment.amount)}</span></div>
          {!isRefund && outstanding > 0.005 && (
            <div className="owed"><span>Balance outstanding</span><span>{naira(outstanding)}</span></div>
          )}
        </div>

        {isRefund && payment.reason && <div className="rc-reason">Reason: {payment.reason}</div>}
        <div className="rc-foot">{cfg.footer}</div>
      </div>
    </Modal>
  )
}
