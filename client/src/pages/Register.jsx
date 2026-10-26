import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Check, Loader2 } from 'lucide-react';
import { AuthLayout, Field, PasswordInput } from '../components/auth/AuthParts.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import {
  passwordChecks,
  validateConfirm,
  validateEmail,
  validateName,
  validatePassword,
  validateUsername,
} from '../utils/validators.js';
import '../styles/auth.css';

const RULES = {
  name: (f) => validateName(f.name),
  username: (f) => validateUsername(f.username),
  email: (f) => validateEmail(f.email),
  password: (f) => validatePassword(f.password),
  confirmPassword: (f) => validateConfirm(f.password, f.confirmPassword),
};

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', username: '', email: '', password: '', confirmPassword: '' });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [loading, setLoading] = useState(false);

  const set = (key) => (event) => {
    const value = event.target.value;
    setForm((f) => ({ ...f, [key]: value }));
    // Clear a field error as soon as the user edits that field.
    if (errors[key]) setErrors((e) => ({ ...e, [key]: '' }));
  };
  const blur = (key) => () => setErrors((e) => ({ ...e, [key]: RULES[key](form) }));

  async function onSubmit(event) {
    event.preventDefault();
    const next = {};
    for (const key of Object.keys(RULES)) {
      const message = RULES[key](form);
      if (message) next[key] = message;
    }
    setErrors(next);
    setFormError('');
    if (Object.keys(next).length) return;

    setLoading(true);
    try {
      await register({ ...form, name: form.name.trim(), username: form.username.trim(), email: form.email.trim() });
      navigate('/app', { replace: true });
    } catch (error) {
      if (error.fields) setErrors((e) => ({ ...e, ...error.fields }));
      else if (error.field) setErrors((e) => ({ ...e, [error.field]: error.message }));
      else setFormError(error.message);
      setLoading(false);
    }
  }

  const checks = passwordChecks(form.password);

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Join VYBE and start your first conversation."
      footer={
        <>
          Already have an account? <Link to="/login">Sign in</Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="auth-form">
        {formError && (
          <div className="form-alert" role="alert">
            {formError}
          </div>
        )}
        <Field label="Full name" id="name" error={errors.name}>
          <input id="name" className="input" value={form.name} onChange={set('name')} onBlur={blur('name')} autoComplete="name" autoFocus aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? 'name-error' : undefined} />
        </Field>
        <Field label="Username" id="username" error={errors.username} hint="3-20 letters, numbers or underscores">
          <input id="username" className="input" value={form.username} onChange={set('username')} onBlur={blur('username')} autoComplete="username" autoCapitalize="none" aria-invalid={Boolean(errors.username)} aria-describedby={errors.username ? 'username-error' : undefined} />
        </Field>
        <Field label="Email address" id="email" error={errors.email}>
          <input id="email" type="email" className="input" value={form.email} onChange={set('email')} onBlur={blur('email')} autoComplete="email" aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? 'email-error' : undefined} />
        </Field>
        <Field label="Password" id="password" error={errors.password}>
          <PasswordInput id="password" value={form.password} onChange={set('password')} onBlur={blur('password')} error={errors.password} autoComplete="new-password" />
          <ul className="pw-checks" aria-label="Password requirements">
            {checks.map((check) => (
              <li key={check.label} className={check.ok ? 'ok' : ''}>
                <Check size={13} aria-hidden="true" /> {check.label}
              </li>
            ))}
          </ul>
        </Field>
        <Field label="Confirm password" id="confirmPassword" error={errors.confirmPassword}>
          <PasswordInput id="confirmPassword" value={form.confirmPassword} onChange={set('confirmPassword')} onBlur={blur('confirmPassword')} error={errors.confirmPassword} autoComplete="new-password" />
        </Field>
        <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
          {loading && <Loader2 className="spin" size={18} aria-hidden="true" />}
          {loading ? 'Creating account…' : 'Create account'}
        </button>
      </form>
    </AuthLayout>
  );
}
