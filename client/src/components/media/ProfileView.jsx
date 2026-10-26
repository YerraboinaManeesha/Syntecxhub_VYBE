import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Loader2, MessageSquare } from 'lucide-react';
import { Avatar } from '../common/Common.jsx';
import SharedFiles from './SharedFiles.jsx';
import Lightbox from './Lightbox.jsx';
import { useChat } from '../../context/ChatContext.jsx';

/**
 * Another person's profile, shown as a side panel (full screen on phones).
 * It only shows what the server already shares with conversation members: photo, name, username,
 * online status, and the files shared in this conversation.
 *   person: { id, name, username, avatarUrl, online }
 *   conversationId: where "shared" files come from (omit if there is no conversation yet)
 */
export default function ProfileView({ person, conversationId, backLabel = 'Back to conversation', onClose, onMessage, messaging = false }) {
  const { isOnline, threads } = useChat();
  const [photo, setPhoto] = useState(false);
  const ref = useRef(null);
  const online = isOnline(person.id, person.online);

  // Re-fetch shared files when a new attachment lands in this conversation while the panel is open.
  const attachmentCount = (threads[conversationId]?.items || []).filter((m) => m.attachment && !m.status).length;

  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.focus();
    const onKey = (event) => event.key === 'Escape' && !photo && onClose();
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [onClose, photo]);

  const photoItem = person.avatarUrl ? [{ id: `avatar-${person.id}`, kind: 'image', filename: person.name, url: person.avatarUrl }] : [];

  return (
    <div className="drawer-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={`${person.name} profile`} tabIndex={-1} ref={ref}>
        <header className="drawer-header">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            <ArrowLeft size={16} aria-hidden="true" /> {backLabel}
          </button>
        </header>

        <div className="drawer-body">
          <div className="profile-top">
            {person.avatarUrl ? (
              <button type="button" className="profile-photo-btn" onClick={() => setPhoto(true)} aria-label={`View ${person.name}'s photo`}>
                <Avatar id={person.id} name={person.name} src={person.avatarUrl} size={112} />
              </button>
            ) : (
              <Avatar id={person.id} name={person.name} size={112} />
            )}
            <h2>{person.name}</h2>
            <p className={`profile-status ${online ? 'status-online' : ''}`}>
              <span className={`status-dot ${online ? 'on' : ''}`} aria-hidden="true" /> {online ? 'Online' : 'Offline'}
            </p>
            {onMessage && (
              <button type="button" className="btn btn-primary btn-sm" onClick={onMessage} disabled={messaging}>
                {messaging ? <Loader2 size={16} className="spin" aria-hidden="true" /> : <MessageSquare size={16} aria-hidden="true" />} Message
              </button>
            )}
          </div>

          {conversationId ? (
            <SharedFiles conversationId={conversationId} refreshKey={attachmentCount} />
          ) : (
            <p className="shared-empty">Photos, videos and documents you share in a conversation will appear here.</p>
          )}
        </div>
      </aside>
      {photo && <Lightbox items={photoItem} index={0} onIndex={() => {}} onClose={() => setPhoto(false)} />}
    </div>
  );
}