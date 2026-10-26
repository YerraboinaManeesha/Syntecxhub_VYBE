import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Loader2, User, Users, X } from 'lucide-react';
import { avatarHue } from '../../utils/format.js';
import { assetUrl } from '../../services/api.js';

export function OnlineIndicator({ online, className = '' }) {
  if (!online) return null;
  return <span className={`online-dot ${className}`} role="img" aria-label="Online" />;
}

/**
 * Shows the person's photo when they have one; otherwise a neutral default (a silhouette for people,
 * a group icon for groups). Never the first letter of a name.
 */
export function Avatar({ name, id, src, size = 40, online = false, group = false }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  const showPhoto = Boolean(src) && !failed;
  const Icon = group ? Users : User;
  return (
    <span
      className={`avatar ${showPhoto ? 'has-photo' : `hue-${avatarHue(id || name)}`} ${group ? 'avatar-group' : ''}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {showPhoto ? (
        <img src={assetUrl(src)} alt="" loading="lazy" draggable="false" onError={() => setFailed(true)} />
      ) : (
        <Icon size={Math.round(size * 0.52)} strokeWidth={1.8} aria-hidden="true" />
      )}
      <OnlineIndicator online={online} />
    </span>
  );
}

export function LoadingState({ label = 'Loading…', fill = false }) {
  return (
    <div className={`state ${fill ? 'state-fill' : ''}`} role="status">
      <Loader2 className="spin" size={22} aria-hidden="true" />
      <p>{label}</p>
    </div>
  );
}

export function ErrorState({ message, onRetry, fill = false }) {
  return (
    <div className={`state ${fill ? 'state-fill' : ''}`} role="alert">
      <AlertCircle size={24} className="state-icon-error" aria-hidden="true" />
      <p>{message || 'Something went wrong.'}</p>
      {onRetry && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, text, action, fill = false }) {
  return (
    <div className={`state ${fill ? 'state-fill' : ''}`}>
      {Icon && (
        <span className="state-icon">
          <Icon size={22} aria-hidden="true" />
        </span>
      )}
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {action}
    </div>
  );
}

export function Modal({ title, onClose, children, footer }) {
  const ref = useRef(null);

  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.focus();
    const onKey = (event) => event.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <header className="modal-header">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-footer">{footer}</footer>}
      </div>
    </div>
  );
}
