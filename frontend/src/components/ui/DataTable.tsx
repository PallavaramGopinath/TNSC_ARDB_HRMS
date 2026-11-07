import { flexRender, getCoreRowModel, getSortedRowModel, useReactTable, type ColumnDef, type SortingState } from '@tanstack/react-table';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { useState } from 'react';

interface Props<T> {
  data: T[];
  columns: ColumnDef<T, any>[];
  loading?: boolean;
  empty?: string;
}

/** Sortable grid — stands in for TNCU's Syncfusion SfGrid. */
export function DataTable<T>({ data, columns, loading, empty = 'No records' }: Props<T>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="card overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="border-b border-ink-200 bg-ink-50 text-left text-xs font-semibold uppercase tracking-wide text-ink-500">
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => (
                <th key={h.id} className="whitespace-nowrap px-4 py-2.5">
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
              <tr key={row.id} className="hover:bg-brand-25">
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="whitespace-nowrap px-4 py-2.5 text-ink-800">
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
