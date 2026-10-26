import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Ban, CornerUpLeft, FileText, Image as ImageIcon, MoreHorizontal, Pencil, Pin, PinOff, Trash2, Video, X } from 'lucide-react';
import { Modal } from '../common/Common.jsx';

export const REACTIONS = ['❤️', '😂', '👍', '😮', '😢', '🔥'];
export const EDIT_WINDOW_MS = 15 * 60 * 1000;
export const DELETE_EVERYONE_WINDOW_MS = 60 * 60 * 1000;

const KIND_LABEL = { image: 'Photo', video: 'Video', document: 'Document' };
const KIND_ICON = { image: ImageIcon, video: Video, document: FileText };

/** What to show for a quoted or pinned message: its text, or what kind of file it is. */
export function PreviewText({ preview }) {
  if (preview.deleted) {
    return <span className="preview-deleted"><Ban size={12} aria-hidden="true" /> Message deleted</span>;
  }
  const Icon = KIND_ICON[preview.attachmentKind];
  return (
    <>
      {Icon && <Icon size={12} aria-hidden="true" />}
      {preview.content || KIND_LABEL[preview.attachmentKind] || ''}
    </>
  );
}

export function toPreview(message, senderName) {
  return {
    id: message.id,
    senderId: message.senderId,
    senderName,
    content: message.content.length > 140 ? `${message.content.slice(0, 140)}…` : message.content,
    attachmentKind: message.attachment?.kind || null,
    deleted: false,
  };
}

/** The quote shown at the top of a reply bubble. Click to jump to the original. */
export function ReplyQuote({ preview, mine, meId, onJump }) {
  const who = preview.senderId === meId ? 'You' : preview.senderName || 'Unknown';
  return (
    <button type="button" className={`reply-quote ${mine ? 'on-sent' : ''}`} onClick={() => onJump?.(preview.id)} aria-label={`Reply to ${who}. Jump to original message`}>
      <strong>{who}</strong>
      <span className="reply-quote-text"><PreviewText preview={preview} /></span>
    </button>
  );
}

/** Reaction chips under a bubble. Tapping a chip toggles your own reaction with that emoji. */
export function ReactionBar({ reactions, meId, names, onReact }) {
  if (!reactions?.length) return null;
  return (
    <div className="reactions" role="group" aria-label="Reactions">
      {reactions.map(({ emoji, userIds }) => {
        const mine = userIds.includes(meId);
        const who = userIds.map((id) => (id === meId ? 'You' : names[id] || 'Someone')).join(', ');
        return (
          <button key={emoji} type="button" className={`reaction-chip ${mine ? 'mine' : ''}`} aria-pressed={mine} onClick={() => onReact(emoji)} title={who} aria-label={`${emoji} ${userIds.length}. ${who}`}>
            <span aria-hidden="true">{emoji}</span>
            <span className="reaction-count">{userIds.length}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * The "..." button beside a bubble and its menu: react, reply, edit, pin, delete.
 * The menu is positioned against the viewport so the scrolling message list never clips it.
 */
export function MessageMenu({ message, mine, pinned, onReact, onReply, onEdit, onPin, onUnpin, onDelete, myReaction }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const button = useRef(null);
  const menu = useRef(null);

  const deleted = message.deleted;
  const age = Date.now() - new Date(message.createdAt).getTime();
  const canEdit = mine && !deleted && age <= EDIT_WINDOW_MS;

  useLayoutEffect(() => {
    if (!open || !button.current || !menu.current) return;
    const b = button.current.getBoundingClientRect();
    const m = menu.current.getBoundingClientRect();
    const above = b.top - m.height - 8 > 8;
    const top = above ? b.top - m.height - 6 : Math.min(b.bottom + 6, window.innerHeight - m.height - 8);
    const left = Math.max(8, Math.min(mine ? b.right - m.width : b.left, window.innerWidth - m.width - 8));
    setPos({ top, left });
  }, [open, mine]);

  useEffect(() => {
    if (!open) return undefined;
    const close = () => setOpen(false);
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
        button.current?.focus();
      }
    };
    const onDown = (event) => {
      if (!menu.current?.contains(event.target) && !button.current?.contains(event.target)) close();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [open]);

  const run = (fn) => () => {
    setOpen(false);
    fn();
  };

  return (
    <span className={`msg-tools ${open ? 'open' : ''}`}>
      <button type="button" ref={button} className="icon-btn msg-tools-btn" onClick={() => { setPos(null); setOpen((v) => !v); }} aria-haspopup="menu" aria-expanded={open} aria-label="Message actions" title="Message actions">
        <MoreHorizontal size={17} aria-hidden="true" />
      </button>
      {open && (
        <div ref={menu} className="msg-menu" role="menu" aria-label="Message actions" style={pos ? { top: pos.top, left: pos.left } : { visibility: 'hidden', top: 0, left: 0 }}>
          {!deleted && (
            <div className="react-row" role="group" aria-label="React">
              {REACTIONS.map((emoji) => (
                <button key={emoji} type="button" className={`react-btn ${myReaction === emoji ? 'mine' : ''}`} onClick={run(() => onReact(emoji))} aria-label={`React ${emoji}`} aria-pressed={myReaction === emoji}>
                  {emoji}
                </button>
              ))}
            </div>
          )}
          {!deleted && <button type="button" role="menuitem" onClick={run(onReply)}><CornerUpLeft size={16} aria-hidden="true" /> Reply</button>}
          {canEdit && <button type="button" role="menuitem" onClick={run(onEdit)}><Pencil size={16} aria-hidden="true" /> Edit</button>}
          {!deleted && (pinned
            ? <button type="button" role="menuitem" onClick={run(onUnpin)}><PinOff size={16} aria-hidden="true" /> Unpin</button>
            : <button type="button" role="menuitem" onClick={run(onPin)}><Pin size={16} aria-hidden="true" /> Pin</button>)}
          <button type="button" role="menuitem" className="danger" onClick={run(() => onDelete(message))}><Trash2 size={16} aria-hidden="true" /> Delete</button>
        </div>
      )}
    </span>
  );
}

/** Asks how to delete. "For everyone" only appears when the rules allow it. */
export function DeleteDialog({ message, mine, onClose, onDelete }) {
  const [busy, setBusy] = useState(false);
  const age = Date.now() - new Date(message.createdAt).getTime();
  const everyone = mine && !message.deleted && age <= DELETE_EVERYONE_WINDOW_MS;

  async function go(scope) {
    setBusy(true);
    try {
      await onDelete(message, scope);
      onClose();
    } catch {
      setBusy(false);
    }
  }

  return (
    <Modal title="Delete message?" onClose={onClose}>
      <p className="delete-text">
        {everyone
          ? 'Delete for everyone removes it for all members. They will see that a message was deleted. Delete for me only hides it on your side.'
          : mine && !message.deleted
            ? 'It was sent more than an hour ago, so it can only be deleted for you. The other people will still see it.'
            : 'This only removes it for you. The other people will still see it.'}
      </p>
      <div className="delete-actions">
        {everyone && <button type="button" className="btn btn-danger" disabled={busy} onClick={() => go('everyone')}>Delete for everyone</button>}
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => go('me')}>Delete for me</button>
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  );
}

/** Bar above the messages. Shows one pinned message at a time; tap to jump to it and see the next. */
export function PinBar({ pins, meId, onJump, onUnpin }) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (index >= pins.length) setIndex(0);
  }, [pins.length, index]);
  if (!pins.length) return null;
  const pin = pins[index % pins.length];
  const who = pin.senderId === meId ? 'You' : pin.senderName || 'Unknown';
  return (
    <div className="pin-bar" role="region" aria-label="Pinned messages">
      <Pin size={15} aria-hidden="true" className="pin-icon" />
      <button type="button" className="pin-main" onClick={() => { onJump(pin.messageId); setIndex((index + 1) % pins.length); }} aria-label={`Pinned message ${(index % pins.length) + 1} of ${pins.length}. Jump to it`}>
        <span className="pin-count">{pins.length > 1 ? `Pinned ${(index % pins.length) + 1} of ${pins.length}` : 'Pinned'}</span>
        <span className="pin-text"><strong>{who}:</strong> <PreviewText preview={pin} /></span>
      </button>
      <button type="button" className="icon-btn" onClick={() => onUnpin(pin.messageId)} aria-label="Unpin this message" title="Unpin">
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
