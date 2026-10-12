import { cx } from '@/lib/cx'

// Reusable table. Each column declares a `header` and either a `key` (reads
// row[key]) or a `render(row)`. Scrolls on narrow screens via .table-wrap.
export function DataTable({ columns, rows, getRowKey, onRowClick, empty = 'Nothing to show', className }) {
  const list = Array.isArray(rows) ? rows : []
  const columnList = Array.isArray(columns) ? columns : []
  return (
    <div className="table-wrap">
      <table className={cx('t', className)}>
        <thead>
          <tr>
            {columnList.map((col, i) => (
              <th key={col.key || i} className={col.thClassName}>{col.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {list.length === 0 ? (
            <tr>
              <td className="empty" colSpan={columnList.length || 1}>{empty}</td>
            </tr>
          ) : (
            list.map((row, ri) => (
              <tr
                key={getRowKey ? getRowKey(row) : ri}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                style={onRowClick ? { cursor: 'pointer' } : undefined}
              >
                {columnList.map((col, ci) => (
                  <td key={col.key || ci} className={col.className}>
                    {col.render ? col.render(row) : row[col.key]}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
