import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { AuthLayout, Field, PasswordInput } from '../components/auth/AuthParts.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import '../styles/auth.css';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ identifier: '', password: '' });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [loading, setLoading] = useState(false);

  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));

  async function onSubmit(event) {
    event.preventDefault();
    const next = {};
    if (!form.identifier.trim()) next.identifier = 'Enter your email or username';
    if (!form.password) next.password = 'Enter your password';
    setErrors(next);
    setFormError('');
    if (Object.keys(next).length) return;

    setLoading(true);
    try {
      await login({ identifier: form.identifier, password: form.password });
      const from = location.state?.from;
      navigate(from && from.startsWith('/app') ? from : '/app', { replace: true });
    } catch (error) {
      setFormError(error.message);
      setLoading(false);
    }
  }

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to pick up your conversations."
      footer={
        <>
          New to VYBE? <Link to="/register">Create an account</Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="auth-form">
        {formError && (
          <div className="form-alert" role="alert">
            {formError}
          </div>
        )}
        <Field label="Email or username" id="identifier" error={errors.identifier}>
          <input
            id="identifier"
            className="input"
            value={form.identifier}
            onChange={set('identifier')}
            autoComplete="username"
            autoFocus
            aria-invalid={Boolean(errors.identifier)}
            aria-describedby={errors.identifier ? 'identifier-error' : undefined}
          />
        </Field>
        <Field label="Password" id="password" error={errors.password}>
          <PasswordInput id="password" value={form.password} onChange={set('password')} error={errors.password} autoComplete="current-password" />
        </Field>
        <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
          {loading && <Loader2 className="spin" size={18} aria-hidden="true" />}
          {loading ? 'Signing in…' : 'Sign In'}
        </button>
      </form>
    </AuthLayout>
  );
}
