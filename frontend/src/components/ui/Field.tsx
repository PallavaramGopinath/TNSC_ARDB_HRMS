import { forwardRef, type InputHTMLAttributes } from 'react';

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
}

export const Field = forwardRef<HTMLInputElement, Props>(function Field({ label, error, id, ...rest }, ref) {
  const fid = id ?? rest.name;
  return (
    <div>
      <label htmlFor={fid} className="field-label">{label}</label>
      <input id={fid} ref={ref} className="field-input" aria-invalid={!!error} {...rest} />
      {error && <p className="field-error">{error}</p>}
    </div>
  );
});
