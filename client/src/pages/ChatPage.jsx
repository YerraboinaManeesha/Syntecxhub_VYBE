import { useEffect, useRef, useState } from 'react';
import { Link, useMatch, useNavigate } from 'react-router-dom';
import { ArrowLeft, Info, MessageCircle, Ban, MoreVertical, Phone, Search, Trash2, Video } from 'lucide-react';
import ConversationList from '../components/chat/ConversationList.jsx';
import MessageList, { TypingIndicator } from '../components/chat/MessageParts.jsx';
import { PinBar, toPreview } from '../components/chat/MessageActions.jsx';
import { useToast } from '../context/ToastContext.jsx';
import MessageComposer from '../components/chat/MessageComposer.jsx';
import { GroupDetails } from '../components/chat/GroupParts.jsx';
import ProfileView from '../components/media/ProfileView.jsx';
import { Avatar, EmptyState, LoadingState, Modal } from '../components/common/Common.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useChat } from '../context/ChatContext.jsx';
import { usersApi } from '../services/api.js';
import { useCall } from '../context/CallContext.jsx';
import { conversationTitle, otherParticipant } from '../utils/conversation.js';

const HEADER_MENU_CSS = `
.header-more { position: relative; }
.header-menu { position: absolute; right: 0; top: calc(100% + 6px); z-index: 40; min-width: 190px; padding: var(--space-1); background: var(--color-elevated); border: 1px solid var(--color-border); border-radius: var(--radius-md); box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45); }
.header-menu button { display: flex; align-items: center; gap: var(--space-3); width: 100%; min-height: 40px; padding: 0 var(--space-3); background: transparent; border: 0; border-radius: var(--radius-sm); color: var(--color-text); font: inherit; font-size: var(--text-sm); text-align: left; cursor: pointer; }
.header-menu button:hover, .header-menu button:focus-visible { background: var(--color-accent-tint); }
.header-menu button.danger { color: var(--color-error); }
.header-menu button:disabled { opacity: 0.5; cursor: default; }
.blocked-bar { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-3); padding: var(--space-3) var(--space-4); background: var(--color-sidebar); border-top: 1px solid var(--color-border); color: var(--color-text-muted); font-size: var(--text-sm); }
.blocked-bar span { flex: 1; min-width: 160px; }
.clear-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--space-3); margin-top: var(--space-4); }
@media (max-width: 480px) { .clear-actions .btn { flex: 1 1 100%; } .header-menu { min-width: 170px; } }
`;

/** Three-dots menu in the chat header. Add more entries to `items`. */
function HeaderMenu({ items }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="header-more" ref={ref}>
      <style>{HEADER_MENU_CSS}</style>
      <button type="button" className="icon-btn" onClick={() => setOpen((v) => !v)} aria-label="More options" title="More options" aria-haspopup="menu" aria-expanded={open}>
        <MoreVertical size={20} aria-hidden="true" />
      </button>
      {open && (
        <div className="header-menu" role="menu">
          {items.map((item) => (
            <button key={item.label} type="button" role="menuitem" className={item.danger ? 'danger' : undefined} disabled={item.disabled} onClick={() => { setOpen(false); item.onClick(); }}>
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Confirms "Clear Chat". Only this person's view is cleared; the other people keep their messages. */
function ClearChatDialog({ onClose, onConfirm }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function go() {
    setBusy(true);
    setError('');
    try {
      await onConfirm();
      onClose();
    } catch (e) {
      setError(e.message || 'Could not clear this chat. Please try again.');
      setBusy(false);
    }
  }

  return (
    <Modal title="Clear Chat?" onClose={busy ? () => {} : onClose}>
      <p className="delete-text">Are you sure you want to clear all messages and media from this chat? This action cannot be undone.</p>
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="clear-actions">
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-danger" disabled={busy} onClick={go}>{busy ? 'Clearing…' : 'Clear Chat'}</button>
      </div>
    </Modal>
  );
}

/** Confirms blocking. The other person is never told. */
function BlockDialog({ name, onClose, onConfirm }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function go() {
    setBusy(true);
    setError('');
    try {
      await onConfirm();
      onClose();
    } catch (e) {
      setError(e.message || 'Could not block this contact. Please try again.');
      setBusy(false);
    }
  }

  return (
    <Modal title={`Block ${name}?`} onClose={busy ? () => {} : onClose}>
      <p className="delete-text">
        They won&apos;t be able to message you and they won&apos;t be told. You won&apos;t receive their messages, and you won&apos;t see each other&apos;s online status. You can unblock at any time.
      </p>
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="clear-actions">
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-danger" disabled={busy} onClick={go}>{busy ? 'Blocking…' : 'Block'}</button>
      </div>
    </Modal>
  );
}

/** Replaces the message box while a contact is blocked. */
function BlockedBar({ name, onUnblock }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="blocked-bar" role="status">
      <Ban size={16} aria-hidden="true" />
      <span>You blocked {name}. Unblock to send a message.</span>
      <button type="button" className="btn btn-ghost" disabled={busy} onClick={async () => { setBusy(true); try { await onUnblock(); } finally { setBusy(false); } }}>Unblock</button>
    </div>
  );
}

function ChatHeader({ conversation, onBack, onInfo, onProfile, onClear, onBlock, onUnblock }) {
  const { user } = useAuth();
  const { isOnline } = useChat();
  const title = conversationTitle(conversation, user.id);
  const isGroup = conversation.type === 'group';
  const other = otherParticipant(conversation, user.id);
  const { startCall, busy: inCall } = useCall();
  const callBlockedReason = conversation.blockedByMe ? 'Unblock to call' : inCall ? 'You are already in a call' : '';

  let subtitle;
  if (isGroup) {
    const online = conversation.participants.filter((p) => p.id !== user.id && isOnline(p.id, p.online)).length;
    subtitle = `${conversation.participants.length} members${online ? ` · ${online} online` : ''}`;
  } else {
    const online = other ? isOnline(other.id, other.online) : false;
    subtitle = <span className={online ? 'status-online' : ''}>{online ? 'Online' : 'Offline'}</span>;
  }

  return (
    <header className="chat-header">
      <Link to="/app" className="icon-btn back-btn" onClick={onBack} aria-label="Back to conversations">
        <ArrowLeft size={20} aria-hidden="true" />
      </Link>
      <button type="button" className="header-hit" onClick={isGroup ? onInfo : onProfile} disabled={!isGroup && !other} aria-label={isGroup ? `${title} group details` : `View ${title}'s profile`}>
        <Avatar name={title} id={isGroup ? conversation.id : other?.id} src={isGroup ? null : other?.avatarUrl} online={!isGroup && other ? isOnline(other.id, other.online) : false} group={isGroup} />
        <span className="chat-header-text">
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </span>
      </button>
      {!isGroup && other && (
        <>
          <button type="button" className="icon-btn" onClick={() => startCall(conversation.id, 'voice', other)} disabled={Boolean(callBlockedReason)} aria-label="Voice call" title={callBlockedReason || 'Voice call'} data-testid="call-voice">
            <Phone size={20} aria-hidden="true" />
          </button>
          <button type="button" className="icon-btn" onClick={() => startCall(conversation.id, 'video', other)} disabled={Boolean(callBlockedReason)} aria-label="Video call" title={callBlockedReason || 'Video call'} data-testid="call-video">
            <Video size={20} aria-hidden="true" />
          </button>
        </>
      )}
      <HeaderMenu
        items={[
          {
            label: isGroup ? 'Group details' : 'Contact info',
            icon: <Info size={16} aria-hidden="true" />,
            onClick: isGroup ? onInfo : onProfile,
            disabled: !isGroup && !other,
          },
          ...(isGroup
            ? []
            : [conversation.blockedByMe
                ? { label: 'Unblock', icon: <Ban size={16} aria-hidden="true" />, onClick: onUnblock }
                : { label: 'Block', icon: <Ban size={16} aria-hidden="true" />, onClick: onBlock, danger: true }]),
          { label: 'Clear chat', icon: <Trash2 size={16} aria-hidden="true" />, onClick: onClear, danger: true },
        ]}
      />
    </header>
  );
}

function ChatWindow({ id }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { conversations, convStatus, typing, threads, unpinMessage, clearChat } = useChat();
  const toast = useToast();
  const [details, setDetails] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [profile, setProfile] = useState(null); // person whose profile is open
  const [replyTo, setReplyTo] = useState(null); // preview of the message being replied to
  const [editing, setEditing] = useState(null); // message being edited
  const [jumpTarget, setJumpTarget] = useState(null);
  const conversation = conversations.find((c) => c.id === id);
  const otherPerson = conversation ? otherParticipant(conversation, user.id) : null;
  // The server pushes the new state (conversation:update); these only send the request.
  const unblockOther = () => usersApi.unblock(otherPerson.id).then(() => toast.success('Contact unblocked')).catch((e) => toast.error(e.message));

  useEffect(() => {
    setDetails(false);
    setConfirmClear(false);
    setConfirmBlock(false);
    setProfile(null);
    setReplyTo(null);
    setEditing(null);
    setJumpTarget(null);
  }, [id]);

  // If the message being replied to / edited disappears (deleted for everyone or for me), drop the draft state.
  const items = threads[id]?.items;
  useEffect(() => {
    if (!items) return;
    const gone = (mid) => { const m = items.find((x) => x.id === mid); return !m || m.deleted; };
    if (replyTo && gone(replyTo.id)) setReplyTo(null);
    if (editing && gone(editing.id)) setEditing(null);
  }, [items, replyTo, editing]);

  if (!conversation) {
    if (convStatus === 'loading') return <LoadingState label="Loading…" fill />;
    return (
      <EmptyState
        fill
        icon={Search}
        title="Conversation not found"
        text="It may have been removed, or you no longer have access to it."
        action={<Link to="/app" className="btn btn-ghost btn-sm">Back to conversations</Link>}
      />
    );
  }

  const typingNames = Object.entries(typing[id] || {})
    .filter(([userId]) => userId !== user.id)
    .map(([, name]) => name.split(' ')[0]);

  return (
    <section className="chat-window" aria-label="Chat">
      <ChatHeader
        conversation={conversation}
        onInfo={() => setDetails(true)}
        onProfile={() => setProfile(otherParticipant(conversation, user.id))}
        onClear={() => setConfirmClear(true)}
        onBlock={() => setConfirmBlock(true)}
        onUnblock={unblockOther}
      />
      <PinBar
        pins={conversation.pins || []}
        meId={user.id}
        onJump={(mid) => setJumpTarget({ id: mid, n: Date.now() })}
        onUnpin={(mid) => unpinMessage(id, mid).catch((e) => toast.error(e.message))}
      />
      <MessageList
        conversation={conversation}
        meId={user.id}
        onOpenProfile={(p) => (p.id === user.id ? null : setProfile(p))}
        onReply={(message) => {
          const sender = conversation.participants.find((p) => p.id === message.senderId);
          setEditing(null);
          setReplyTo(toPreview(message, sender?.name || message.sender?.name));
        }}
        onEdit={(message) => { setReplyTo(null); setEditing(message); }}
        onJump={(mid) => setJumpTarget({ id: mid, n: Date.now() })}
        jumpTarget={jumpTarget}
        onJumpEnd={() => setJumpTarget(null)}
      />
      <TypingIndicator names={typingNames} />
      {conversation.blockedByMe && otherPerson ? (
        <BlockedBar name={otherPerson.name} onUnblock={unblockOther} />
      ) : (
        <MessageComposer
          conversationId={id}
          replyTo={replyTo}
          onClearReply={() => setReplyTo(null)}
          editing={editing}
          onClearEdit={() => setEditing(null)}
        />
      )}
      {details && (
        <GroupDetails
          conversation={conversation}
          onClose={() => setDetails(false)}
          onLeft={() => navigate('/app', { replace: true })}
          onOpenProfile={(p) => { setDetails(false); setProfile(p); }}
        />
      )}
      {confirmClear && (
        <ClearChatDialog
          onClose={() => setConfirmClear(false)}
          onConfirm={async () => {
            await clearChat(id);
            toast.success('Chat cleared');
          }}
        />
      )}
      {confirmBlock && otherPerson && (
        <BlockDialog
          name={otherPerson.name}
          onClose={() => setConfirmBlock(false)}
          onConfirm={async () => {
            await usersApi.block(otherPerson.id);
            toast.success(`${otherPerson.name} blocked`);
          }}
        />
      )}
      {profile && <ProfileView person={profile} conversationId={conversation.id} onClose={() => setProfile(null)} />}
    </section>
  );
}

export default function ChatPage() {
  const match = useMatch('/app/c/:id');
  const navigate = useNavigate();
  const id = match?.params.id || null;
  const { setActiveId } = useChat();

  useEffect(() => {
    setActiveId(id);
    return () => setActiveId(null);
  }, [id, setActiveId]);

  return (
    <div className={`chat-layout ${id ? 'has-chat' : ''}`}>
      <ConversationList activeId={id} />
      <div className="chat-pane">
        {id ? (
          <ChatWindow id={id} />
        ) : (
          <EmptyState
            fill
            icon={MessageCircle}
            title="Good conversations start with a hello."
            text="Choose a conversation or find someone new to connect with."
            action={<button type="button" className="btn btn-primary" onClick={() => navigate('/app/contacts')}>Find people</button>}
          />
        )}
      </div>
    </div>
  );
}