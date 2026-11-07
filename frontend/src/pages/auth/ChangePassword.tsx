import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { useAuth } from '@/hooks/useAuth';
import { errorMessage } from '@/services/api';
import { authApi } from '@/services/auth';

const schema = z
  .object({
    currentPassword: z.string().min(1, 'Required'),
    newPassword: z.string().regex(/^(?=.*\d)(?=.*[A-Z]).{8,}$/, 'At least 8 characters, one digit and one uppercase letter'),
    confirm: z.string(),
  })
  .refine((v) => v.newPassword === v.confirm, { path: ['confirm'], message: 'Passwords do not match' });

export function ChangePasswordPage() {
  const { user, signIn, signOut } = useAuth();
  const navigate = useNavigate();
  const [err, setErr] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });

  const onSubmit = handleSubmit(async (v) => {
    setErr(null);
    try {
      signIn(await authApi.changePassword({ currentPassword: v.currentPassword, newPassword: v.newPassword }));
      navigate('/', { replace: true });
    } catch (e) {
      setErr(errorMessage(e));
    }
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-25 p-4">
      <div className="card w-full max-w-sm p-7">
        <h1 className="text-lg font-bold">Change password</h1>
        <p className="mb-5 text-sm text-ink-500">{user?.mustChangePassword ? 'You must set a new password before continuing.' : `Signed in as ${user?.username}`}</p>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <Field label="Current password" type="password" autoComplete="current-password" {...register('currentPassword')} error={formState.errors.currentPassword?.message} />
          <Field label="New password" type="password" autoComplete="new-password" {...register('newPassword')} error={formState.errors.newPassword?.message} />
          <Field label="Confirm new password" type="password" autoComplete="new-password" {...register('confirm')} error={formState.errors.confirm?.message} />
          {err && <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">{err}</p>}
          <div className="flex gap-2">
            <Button type="submit" className="flex-1" disabled={formState.isSubmitting}>Update password</Button>
            <Button variant="secondary" onClick={() => void signOut()}>Sign out</Button>
          </div>
        </form>
      </div>
    </div>
  );
}
