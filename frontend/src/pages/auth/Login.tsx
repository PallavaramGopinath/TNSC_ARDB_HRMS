import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { useAuth } from '@/hooks/useAuth';
import { errorMessage } from '@/services/api';
import { authApi } from '@/services/auth';

const schema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
  captchaAnswer: z.string().optional(),
});
type Form = z.infer<typeof schema>;

export function LoginPage() {
  const { user, signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [serverError, setServerError] = useState<string | null>(null);
  const captcha = useQuery({ queryKey: ['captcha'], queryFn: authApi.captcha, staleTime: 0, gcTime: 0 });
  const { register, handleSubmit, formState, resetField } = useForm<Form>({ resolver: zodResolver(schema) });

  if (user) return <Navigate to={user.mustChangePassword ? '/change-password' : '/'} replace />;

  const onSubmit = handleSubmit(async (v) => {
    setServerError(null);
    try {
      const pair = await authApi.login({ ...v, captchaId: captcha.data?.captchaId });
      signIn(pair);
      const from = (location.state as { from?: string } | null)?.from ?? '/';
      navigate(pair.user.mustChangePassword ? '/change-password' : from, { replace: true });
    } catch (e) {
      setServerError(errorMessage(e));
      resetField('captchaAnswer');
      void captcha.refetch();
    }
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-25 via-white to-ink-50 p-4">
      <div className="card w-full max-w-sm p-7">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600 text-lg font-bold text-white">A</div>
          <h1 className="text-lg font-bold">TNSC ARDB</h1>
          <p className="text-sm text-ink-500">HR &amp; Payroll</p>
          <p className="font-tamil text-xs text-ink-400">தமிழ்நாடு கூட்டுறவு மாநில வேளாண்மை மற்றும் ஊரக வளர்ச்சி வங்கி</p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <Field label="Username" autoComplete="username" autoFocus {...register('username')} error={formState.errors.username?.message} />
          <Field label="Password" type="password" autoComplete="current-password" {...register('password')} error={formState.errors.password?.message} />
          {captcha.data?.enabled && (
            <div>
              <span className="field-label">Captcha</span>
              <div className="mb-2 flex items-center gap-2">
                <div className="h-[50px] flex-1 overflow-hidden rounded-lg border border-ink-200 bg-brand-25 [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: captcha.data.svg ?? '' }} />
                <Button variant="ghost" aria-label="New captcha" onClick={() => void captcha.refetch()}><RefreshCw size={16} /></Button>
              </div>
              <input className="field-input" placeholder="Type the characters above" autoComplete="off" {...register('captchaAnswer')} />
            </div>
          )}
          {serverError && <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">{serverError}</p>}
          <Button type="submit" className="w-full" disabled={formState.isSubmitting}>{formState.isSubmitting ? 'Signing in…' : 'Sign in'}</Button>
        </form>
      </div>
    </div>
  );
}
