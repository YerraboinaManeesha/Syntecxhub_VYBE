import { useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import VYBELogo from '../layout/VYBELogo.jsx';
import { ErrorState, LoadingState } from '../common/Common.jsx';
import { useAuth } from '../../context/AuthContext.jsx';

export function ProtectedRoute({ children }) {
  const { user, status, error, restore } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <LoadingState label="Restoring your session…" fill />;
  if (status === 'error') return <ErrorState message={error} onRetry={restore} fill />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
}

export function PublicOnlyRoute({ children }) {
  const { user, status } = useAuth();
  if (status === 'loading') return <LoadingState fill />;
  if (user) return <Navigate to="/app" replace />;
  return children;
}

export function AuthLayout({ title, subtitle, children, footer }) {
  return (
    <main className="auth-page">
      <div className="auth-card">
        <Link to="/" aria-label="VYBE home" className="auth-logo">
          <VYBELogo size={34} />
        </Link>
        <h1>{title}</h1>
        <p className="auth-sub">{subtitle}</p>
        {children}
        <p className="auth-footer">{footer}</p>
      </div>
    </main>
  );
}

export function Field({ label, id, error, hint, children }) {
  return (
    <div className={`field ${error ? 'has-error' : ''}`}>
      <label htmlFor={id}>{label}</label>
      {children}
      {error ? (
        <p className="field-error" id={`${id}-error`} role="alert">
          {error}
        </p>
      ) : (
        hint && <p className="field-hint">{hint}</p>
      )}
    </div>
  );
}

export function PasswordInput({ id, value, onChange, error, autoComplete, onBlur }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="password-wrap">
      <input
        id={id}
        type={shown ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        onBlur={onBlur}
        autoComplete={autoComplete}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        className="input"
      />
      <button
        type="button"
        className="icon-btn password-toggle"
        onClick={() => setShown((v) => !v)}
        aria-label={shown ? 'Hide password' : 'Show password'}
        aria-pressed={shown}
      >
        {shown ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
      </button>
    </div>
  );
}
