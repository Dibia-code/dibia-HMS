import { cx } from '@/lib/cx'
import { EmptyState } from './EmptyState'

// Data table. Columns: [{ key, header, render?(row), align?: 'num', className?,
// th?: className for header }]. `render` gets the row; without it the raw
// row[key] is shown. Wrapped in an overflow container so it scrolls on mobile.
export function DataTable({ columns, rows, getRowKey, onRowClick, empty, rowStatus }) {
  const list = Array.isArray(rows) ? rows : []
  const columnList = Array.isArray(columns) ? columns : []
  if (!list.length) {
    return empty ?? <EmptyState title="No records yet" />
  }
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            {columnList.map((col) => (
              <th key={col.key} className={cx(col.align === 'num' && 'num', col.th)}>
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {list.map((row, i) => (
            <tr
              key={getRowKey ? getRowKey(row) : (row.id ?? i)}
              className={cx(onRowClick && 'clickable', rowStatus && rowStatus(row) && `row-${rowStatus(row)}`)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {columnList.map((col) => (
                <td key={col.key} className={cx(col.align === 'num' && 'num', col.className)}>
                  {col.render ? col.render(row) : row[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
