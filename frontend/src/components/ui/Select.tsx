import { forwardRef, type SelectHTMLAttributes } from 'react';

export interface Option { value: string | number; label: string }

interface Props extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  options: Option[];
  placeholder?: string;
  error?: string;
  hint?: string;
}

export const Select = forwardRef<HTMLSelectElement, Props>(function Select({ label, options, placeholder = 'Select…', error, hint, id, ...rest }, ref) {
  const fid = id ?? rest.name;
  return (
    <div>
      <label htmlFor={fid} className="field-label">{label}</label>
      <select id={fid} ref={ref} className="field-input" aria-invalid={!!error} {...rest}>
        <option value="">{placeholder}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {error ? <p className="field-error">{error}</p> : hint && <p className="mt-1 text-xs text-ink-500">{hint}</p>}
    </div>
  );
});

/** Build options from enum values: ['DIRECT', …] → [{ value: 'DIRECT', label: 'Direct' }]. */
export const enumOptions = (values: readonly string[]): Option[] =>
  values.map((v) => ({ value: v, label: v.charAt(0) + v.slice(1).toLowerCase().replace(/_/g, ' ') }));
