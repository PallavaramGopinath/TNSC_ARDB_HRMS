import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="card mx-auto max-w-md p-10 text-center">
      <p className="text-4xl font-bold text-brand-600">404</p>
      <p className="mt-2 text-ink-600">This page does not exist or you do not have access.</p>
      <Link to="/" className="mt-4 inline-block text-sm font-semibold text-brand-700 hover:underline">Back to dashboard</Link>
    </div>
  );
}
