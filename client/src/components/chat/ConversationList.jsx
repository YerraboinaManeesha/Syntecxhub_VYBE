import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MessageSquarePlus, Search, Users } from 'lucide-react';
import { Avatar, EmptyState, ErrorState, LoadingState } from '../common/Common.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useChat } from '../../context/ChatContext.jsx';
import { formatListTime } from '../../utils/format.js';
import { conversationTitle, otherParticipant, previewText } from '../../utils/conversation.js';

export function ConversationItem({ conversation, active }) {
  const { user } = useAuth();
  const { isOnline } = useChat();
  const title = conversationTitle(conversation, user.id);
  const other = otherParticipant(conversation, user.id);
  const isGroup = conversation.type === 'group';
  const online = !isGroup && other ? isOnline(other.id, other.online) : false;
  const preview = previewText(conversation, user.id);
  const unread = conversation.unreadCount;

  return (
    <li>
      <Link
        to={`/app/c/${conversation.id}`}
        className={`conv-item ${active ? 'active' : ''}`}
        aria-current={active ? 'page' : undefined}
      >
        <Avatar name={title} id={isGroup ? conversation.id : other?.id} src={isGroup ? null : other?.avatarUrl} online={online} group={isGroup} />
        <span className="conv-body">
          <span className="conv-top">
            <strong className="conv-title">{title}</strong>
            {conversation.lastMessage && <time className="conv-time">{formatListTime(conversation.lastMessage.createdAt)}</time>}
          </span>
          <span className="conv-bottom">
            <span className={`conv-preview ${unread ? 'unread' : ''}`}>{preview || 'No messages yet'}</span>
            {unread > 0 && (
              <span className="badge" aria-label={`${unread} unread messages`}>
                {unread > 99 ? '99+' : unread}
              </span>
            )}
          </span>
        </span>
      </Link>
    </li>
  );
}

export default function ConversationList({ activeId }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { conversations, convStatus, convError, loadConversations } = useChat();
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) => {
      const names = c.participants.map((p) => `${p.name} ${p.username}`).join(' ');
      return `${conversationTitle(c, user.id)} ${names}`.toLowerCase().includes(q);
    });
  }, [conversations, query, user.id]);

  return (
    <section className="conv-panel" aria-label="Conversations">
      <header className="panel-header">
        <h2>Conversations</h2>
        <button type="button" className="icon-btn icon-btn-accent" onClick={() => navigate('/app/contacts')} aria-label="New conversation" title="New conversation">
          <MessageSquarePlus size={18} aria-hidden="true" />
        </button>
      </header>
      <div className="search-box">
        <Search size={16} aria-hidden="true" />
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search conversations" aria-label="Search conversations" />
      </div>

      <div className="conv-scroll">
        {convStatus === 'loading' && <LoadingState label="Loading conversations…" />}
        {convStatus === 'error' && <ErrorState message={convError} onRetry={loadConversations} />}
        {convStatus === 'ready' && conversations.length === 0 && (
          <EmptyState
            icon={Users}
            title="No conversations yet"
            text="Find someone to talk to and say hello."
            action={<button type="button" className="btn btn-primary btn-sm" onClick={() => navigate('/app/contacts')}>Find people</button>}
          />
        )}
        {convStatus === 'ready' && conversations.length > 0 && filtered.length === 0 && (
          <EmptyState icon={Search} title="No matches" text="No conversations match your search." />
        )}
        {filtered.length > 0 && (
          <ul className="conv-list">
            {filtered.map((c) => (
              <ConversationItem key={c.id} conversation={c} active={c.id === activeId} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
