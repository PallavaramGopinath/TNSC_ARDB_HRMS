import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { TextArea } from '@/components/ui/TextArea';
import { apiError, errorMessage } from '@/services/api';

const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
/** 15542.00 → 15,542 (no ₹ or empty paise: the grids are wide). */
export const amount = (v: string | number) => inr.format(Number(v));

export const ErrorText = ({ children }: { children: ReactNode }) => (
  <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">{children}</p>
);

/** The message of a 409 that asks the user before overwriting, or null for any other error. */
export const overwriteQuestion = (e: unknown): string | null => {
  const err = apiError(e);
  return err?.code === 'CONFIRM_OVERWRITE' ? err.message : null;
};

/** Question inside a dialog, so that no second dialog opens over the first. */
export function ConfirmBar({ message, action, busy, onYes, onNo }: { message: string; action: string; busy: boolean; onYes: () => void; onNo: () => void }) {
  return (
    <div role="alertdialog" aria-label={message} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-warning-50 px-3 py-2 text-sm text-warning-700">
      <span>{message}</span>
      <span className="flex gap-2">
        <Button variant="secondary" disabled={busy} onClick={onNo}>No</Button>
        <Button disabled={busy} onClick={onYes}>{action}</Button>
      </span>
    </div>
  );
}

interface AskProps {
  title: string;
  message: ReactNode;
  action: string;
  /** Ask for a reason: required, or optional. */
  reason?: 'required' | 'optional';
  maxLength?: number;
  busy: boolean;
  error: unknown;
  onYes: (reason: string) => void;
  onClose: () => void;
}

export function AskDialog({ title, message, action, reason, maxLength = 500, busy, error, onYes, onClose }: AskProps) {
  const [text, setText] = useState('');
  return (
    <Modal open title={title} onClose={onClose}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); onYes(text.trim()); }}>
        <div className="text-sm text-ink-700">{message}</div>
        {reason && <TextArea label={reason === 'required' ? 'Reason' : 'Reason (optional)'} name="reason" rows={3} maxLength={maxLength} autoFocus value={text} onChange={(e) => setText(e.target.value)} />}
        {!!error && <ErrorText>{errorMessage(error)}</ErrorText>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy || (reason === 'required' && !text.trim())}>{busy ? 'Please wait…' : action}</Button>
        </div>
      </form>
    </Modal>
  );
}

/** Closing a dialog with unsaved typing asks first. */
export const mayClose = (dirty: boolean) => !dirty || window.confirm('Close without saving the changes?');
