import { flexRender, getCoreRowModel, getSortedRowModel, useReactTable, type ColumnDef, type SortingState } from '@tanstack/react-table';
import clsx from 'clsx';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { useState } from 'react';

interface Props<T> {
  data: T[];
  columns: ColumnDef<T, any>[];
  loading?: boolean;
  empty?: string;
  /** Keep the column with id 'actions' in view at the right edge while a wide grid scrolls sideways. */
  pinActions?: boolean;
}

/** Sortable grid — stands in for TNCU's Syncfusion SfGrid. */
export function DataTable<T>({ data, columns, loading, empty = 'No records', pinActions }: Props<T>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const pinned = (columnId: string, bg: string) => pinActions && columnId === 'actions' && `sticky right-0 border-l border-ink-100 ${bg}`;

  return (
    <div className="card overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="border-b border-ink-200 bg-ink-50 text-left text-xs font-semibold uppercase tracking-wide text-ink-500">
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => (
                <th key={h.id} className={clsx('whitespace-nowrap px-4 py-2.5', pinned(h.column.id, 'bg-ink-50'))}>
                  {h.isPlaceholder ? null : (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 disabled:cursor-default"
                      onClick={h.column.getToggleSortingHandler()}
                      disabled={!h.column.getCanSort()}
                    >
                      {flexRender(h.column.columnDef.header, h.getContext())}
                      {h.column.getIsSorted() === 'asc' && <ArrowUp size={12} />}
                      {h.column.getIsSorted() === 'desc' && <ArrowDown size={12} />}
                    </button>
                  )}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody className="divide-y divide-ink-100">
          {loading ? (
            <tr><td colSpan={columns.length} className="px-4 py-8 text-center text-ink-400">Loading…</td></tr>
          ) : table.getRowModel().rows.length === 0 ? (
            <tr><td colSpan={columns.length} className="px-4 py-8 text-center text-ink-400">{empty}</td></tr>
          ) : (
            table.getRowModel().rows.map((row) => (
              <tr key={row.id} className="group hover:bg-brand-25">
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className={clsx('whitespace-nowrap px-4 py-2.5 text-ink-800', pinned(cell.column.id, 'bg-white group-hover:bg-brand-25'))}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
