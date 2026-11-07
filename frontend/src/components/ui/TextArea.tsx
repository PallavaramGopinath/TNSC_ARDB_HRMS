import { forwardRef, type TextareaHTMLAttributes } from 'react';

interface Props extends TextareaHTMLAttributes<HTMLTextAreaElement> { label: string; error?: string }

export const TextArea = forwardRef<HTMLTextAreaElement, Props>(function TextArea({ label, error, id, rows = 2, ...rest }, ref) {
  const fid = id ?? rest.name;
  return (
    <div>
      <label htmlFor={fid} className="field-label">{label}</label>
      <textarea id={fid} ref={ref} rows={rows} className="field-input" aria-invalid={!!error} {...rest} />
      {error && <p className="field-error">{error}</p>}
    </div>
  );
});
