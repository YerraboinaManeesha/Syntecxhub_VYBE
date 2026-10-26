import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Ban, Loader2, RotateCw, Trash2 } from 'lucide-react';
import { Avatar, LoadingState, ErrorState } from '../common/Common.jsx';
import AttachmentView from '../media/AttachmentView.jsx';
import MessageTicks from './MessageTicks.jsx';
import { messageStatus, STATUS_LABEL } from '../../utils/status.js';
import Lightbox from '../media/Lightbox.jsx';
import { formatDayLabel, formatFull, formatTime, isSameDay } from '../../utils/format.js';
import { useChat } from '../../context/ChatContext.jsx';
import { DeleteDialog, MessageMenu, ReactionBar, ReplyQuote } from './MessageActions.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import CallRecordCard from '../calls/CallRecord.jsx';

export function TypingIndicator({ names }) {
  if (!names.length) return null;
  const label =
    names.length === 1 ? `${names[0]} is typing` : names.length === 2 ? `${names[0]} and ${names[1]} are typing` : 'Several people are typing';
  return (
    <div className="typing" role="status" aria-live="polite">
      <span className="typing-dots" aria-hidden="true"><i /><i /><i /></span>
      <span>{label}</span>
    </div>
  );
}

// The time sits just below the bubble, outside it, on the same side as the bubble.
// It shows the clock time; hover (title) or tap/click reveals the full date and time.
function MessageTime({ message, mine, status }) {
  const [full, setFull] = useState(false);
  const sending = message.status === 'sending';
  if (message.status === 'failed') return null;
  if (sending) {
    return (
      <span className="msg-time" role="status">
        <Loader2 size={11} className="spin" aria-hidden="true" /> Sending…
      </span>
    );
  }
  return (
    <button type="button" className="msg-time" onClick={() => setFull((v) => !v)} title={`${formatFull(message.createdAt)}${mine && STATUS_LABEL[status] ? ` · ${STATUS_LABEL[status]}` : ''}`} aria-label={`Sent ${formatFull(message.createdAt)}`}>
      {message.editedAt && <span className="edited-label" title={`Edited ${formatFull(message.editedAt)}`}>Edited</span>}
      <time dateTime={message.createdAt}>{full ? formatFull(message.createdAt) : formatTime(message.createdAt)}</time>
      {mine && !message.deleted && <MessageTicks status={status} />}
    </button>
  );
}

// Message text is rendered as a plain text node (never as HTML); CSS preserves line breaks.
export function MessageBubble({ message, mine, meId, status, showSender, sender, showAvatar, names, pinned, actions, onRetry, onDiscard, onOpenMedia, onOpenProfile }) {
  if (message.call) return <CallRecordCard message={message} mine={mine} meId={meId} />;
  const failed = message.status === 'failed';
  const sending = message.status === 'sending';
  const attachment = message.attachment;
  const deleted = message.deleted;
  const confirmed = !message.status; // only stored messages can be edited, reacted to, pinned or deleted
  const mediaOnly = !deleted && attachment && attachment.kind !== 'document' && !message.content && !message.replyTo;
  const name = sender?.name || message.sender?.name || 'Unknown';
  return (
    <div className={`msg-row ${mine ? 'mine' : 'theirs'}`}>
      <div className="msg-line">
        {!mine && (
          <span className="msg-avatar">
            {showAvatar && (
              <button type="button" className="avatar-btn" onClick={() => sender && onOpenProfile?.(sender)} disabled={!sender} aria-label={`View ${name}'s profile`}>
                <Avatar id={sender?.id || message.senderId} name={name} src={sender?.avatarUrl} size={28} />
              </button>
            )}
          </span>
        )}
        <div className="msg-stack">
          <div className={`bubble ${mine ? 'sent' : 'received'} ${failed ? 'failed' : ''} ${sending ? 'sending' : ''} ${mediaOnly ? 'media-only' : ''} ${attachment ? 'has-attachment' : ''} ${deleted ? 'deleted' : ''}`}>
            {showSender && (
              <button type="button" className="bubble-sender" onClick={() => sender && onOpenProfile?.(sender)} disabled={!sender}>
                {name}
              </button>
            )}
            {deleted ? (
              <p className="bubble-text tombstone"><Ban size={14} aria-hidden="true" /> {mine ? 'You deleted this message' : 'This message was deleted'}</p>
            ) : (
              <>
                {message.replyTo && <ReplyQuote preview={message.replyTo} mine={mine} meId={meId} onJump={actions?.onJump} />}
                {attachment && <AttachmentView attachment={attachment} onOpen={onOpenMedia} />}
                {message.content && <p className="bubble-text">{message.content}</p>}
              </>
            )}
          </div>
          {!deleted && confirmed && <ReactionBar reactions={message.reactions} meId={meId} names={names} onReact={(emoji) => actions.onReact(message, emoji)} />}
          <MessageTime message={message} mine={mine} status={status} />
        </div>
        {confirmed && actions && (
          <MessageMenu
            message={message}
            mine={mine}
            pinned={pinned}
            myReaction={message.reactions?.find((r) => r.userIds.includes(meId))?.emoji}
            onReact={(emoji) => actions.onReact(message, emoji)}
            onReply={() => actions.onReply(message)}
            onEdit={() => actions.onEdit(message)}
            onPin={() => actions.onPin(message)}
            onUnpin={() => actions.onUnpin(message)}
            onDelete={actions.onDelete}
          />
        )}
      </div>
      {failed && (
        <div className="msg-failed" role="alert">
          <AlertCircle size={14} aria-hidden="true" />
          <span>Not sent{message.error ? `: ${message.error}` : ''}</span>
          <button type="button" onClick={onRetry}><RotateCw size={13} aria-hidden="true" /> Retry</button>
          <button type="button" onClick={onDiscard}><Trash2 size={13} aria-hidden="true" /> Discard</button>
        </div>
      )}
    </div>
  );
}

export default function MessageList({ conversation, meId, onOpenProfile, onReply, onEdit, onJump, jumpTarget, onJumpEnd }) {
  const { threads, loadThread, loadOlder, retryMessage, discardMessage, deleteMessage, reactToMessage, pinMessage, unpinMessage } = useChat();
  const toast = useToast();
  const thread = threads[conversation.id];
  const scroller = useRef(null);
  const stickToBottom = useRef(true);
  const lastCount = useRef(0);
  const lastId = useRef(null);
  const prevHeight = useRef(0);
  const prepending = useRef(false);

  const items = thread?.items || [];
  const [viewer, setViewer] = useState(null); // attachment id shown in the lightbox
  const mediaItems = useMemo(
    () => items.filter((m) => m.attachment && (m.attachment.kind === 'image' || m.attachment.kind === 'video')).map((m) => ({ ...m.attachment, sentAt: m.createdAt })),
    [items]
  );
  const viewerIndex = viewer ? mediaItems.findIndex((a) => a.id === viewer) : -1;
  const isGroup = conversation.type === 'group';
  const [deleting, setDeleting] = useState(null); // message being deleted
  const names = useMemo(() => Object.fromEntries(conversation.participants.map((p) => [p.id, p.name])), [conversation.participants]);
  const pinnedIds = useMemo(() => new Set((conversation.pins || []).map((p) => p.messageId)), [conversation.pins]);
  const attempts = useRef(0);

  // Jump to a message (from a reply quote or the pin bar). If it is not loaded yet, load older pages until it is.
  useEffect(() => {
    if (!jumpTarget) { attempts.current = 0; return; }
    const el = scroller.current?.querySelector(`[data-mid="${jumpTarget.id}"]`);
    if (el) {
      stickToBottom.current = false;
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.classList.add('flash');
      setTimeout(() => el.classList.remove('flash'), 1800);
      attempts.current = 0;
      onJumpEnd?.();
    } else if (thread?.hasMore && !thread.loadingOlder && attempts.current < 10) {
      attempts.current += 1;
      loadOlder(conversation.id);
    } else if (thread && !thread.loadingOlder) {
      toast.error('That message is no longer available');
      onJumpEnd?.();
    }
  }, [jumpTarget, items, thread?.hasMore, thread?.loadingOlder]); // eslint-disable-line react-hooks/exhaustive-deps

  const fail = (error) => toast.error(error?.message || 'Something went wrong');
  const actions = {
    onReply,
    onEdit,
    onJump,
    onReact: (message, emoji) => reactToMessage(conversation.id, message.id, emoji).catch(fail),
    onPin: (message) => pinMessage(conversation.id, message.id).catch(fail),
    onUnpin: (message) => unpinMessage(conversation.id, message.id).catch(fail),
    onDelete: (message) => setDeleting(message),
  };

  // Keep the view pinned to the newest message when the user is at the bottom or sends one.
  // When older history is prepended, keep the reading position instead of jumping.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (prepending.current) {
      el.scrollTop = el.scrollHeight - prevHeight.current;
      prepending.current = false;
    } else {
      const newest = items[items.length - 1];
      const grew = items.length > lastCount.current;
      const mine = newest && newest.senderId === meId && newest.id !== lastId.current;
      if (stickToBottom.current || (grew && mine)) el.scrollTop = el.scrollHeight;
    }
    lastCount.current = items.length;
    lastId.current = items[items.length - 1]?.id ?? null;
  }, [items, meId]);

  // Reset when switching conversations.
  useEffect(() => {
    stickToBottom.current = true;
    lastCount.current = 0;
    lastId.current = null;
  }, [conversation.id]);

  function onScroll() {
    const el = scroller.current;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (el.scrollTop < 60 && thread?.hasMore && !thread.loadingOlder) {
      prevHeight.current = el.scrollHeight;
      prepending.current = true;
      loadOlder(conversation.id);
    }
  }

  if (!thread || (thread.status === 'loading' && items.length === 0)) return <LoadingState label="Loading messages…" fill />;
  if (thread.status === 'error' && items.length === 0) {
    return <ErrorState message={thread.error} onRetry={() => loadThread(conversation.id)} fill />;
  }
  if (items.length === 0) {
    return (
      <div className="state state-fill">
        <h3>No messages yet</h3>
        <p>Send the first message to start the conversation.</p>
      </div>
    );
  }

  return (
    <div className="messages" ref={scroller} onScroll={onScroll} role="log" aria-label="Messages" aria-live="polite">
      {thread.loadingOlder && <div className="older-loading"><Loader2 size={16} className="spin" aria-hidden="true" /> Loading earlier messages…</div>}
      {thread.hasMore && !thread.loadingOlder && (
        <button type="button" className="older-btn" onClick={() => { prevHeight.current = scroller.current.scrollHeight; prepending.current = true; loadOlder(conversation.id); }}>
          Load earlier messages
        </button>
      )}
      {items.map((message, index) => {
        const previous = items[index - 1];
        const newDay = !previous || !isSameDay(previous.createdAt, message.createdAt);
        const mine = message.senderId === meId;
        const startOfRun = newDay || previous.senderId !== message.senderId;
        const showSender = isGroup && !mine && startOfRun;
        const sender = conversation.participants.find((p) => p.id === message.senderId);
        return (
          <div key={message.id} className="msg-group" data-mid={message.id}>
            {newDay && <div className="day-sep"><span>{formatDayLabel(message.createdAt)}</span></div>}
            <MessageBubble
              message={message}
              mine={mine}
              meId={meId}
              names={names}
              pinned={pinnedIds.has(message.id)}
              actions={actions}
              status={mine ? messageStatus(message, conversation, meId) : undefined}
              showSender={showSender}
              sender={sender}
              showAvatar={!mine && startOfRun}
              onOpenMedia={(a) => setViewer(a.id)}
              onOpenProfile={onOpenProfile}
              onRetry={() => retryMessage(conversation.id, message.clientMsgId)}
              onDiscard={() => discardMessage(conversation.id, message.clientMsgId)}
            />
          </div>
        );
      })}
      {deleting && (
        <DeleteDialog
          message={deleting}
          mine={deleting.senderId === meId}
          onClose={() => setDeleting(null)}
          onDelete={(message, scope) => deleteMessage(conversation.id, message.id, scope).catch((error) => { fail(error); throw error; })}
        />
      )}
      {viewerIndex >= 0 && (
        <Lightbox items={mediaItems} index={viewerIndex} onIndex={(i) => setViewer(mediaItems[i].id)} onClose={() => setViewer(null)} />
      )}
    </div>
  );
}