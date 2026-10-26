import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, CornerUpLeft, FileText, Image as ImageIcon, Loader2, Pencil, Plus, RotateCw, Send, Video, X } from 'lucide-react';
import { useChat } from '../../context/ChatContext.jsx';
import { useSocket } from '../../context/SocketContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { attachmentsApi, conversationsApi } from '../../services/api.js';
import { ACCEPT, checkFile } from '../../utils/files.js';
import { formatBytes } from '../../utils/format.js';
import { DocIcon } from '../media/AttachmentView.jsx';
import { PreviewText } from './MessageActions.jsx';

const MAX = 4000;

const MENU = [
  { kind: 'image', label: 'Photos', icon: ImageIcon },
  { kind: 'video', label: 'Videos', icon: Video },
  { kind: 'document', label: 'Documents', icon: FileText },
];

/** The file the person picked, shown before sending. It uploads as soon as it is picked, so sending is instant. */
function PendingPreview({ pending, onRemove, onRetry }) {
  const { file, kind, previewUrl, status, progress, error } = pending;
  return (
    <div className={`pending ${status === 'error' ? 'is-error' : ''}`} role="group" aria-label="Attachment to send">
      <div className="pending-thumb">
        {kind === 'image' && <img src={previewUrl} alt="" />}
        {kind === 'video' && <video src={previewUrl} muted preload="metadata" />}
        {kind === 'document' && <DocIcon filename={file.name} size={26} />}
      </div>
      <div className="pending-text">
        <strong title={file.name}>{file.name}</strong>
        {status === 'uploading' && (
          <>
            <span>Uploading… {progress}%</span>
            <span className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-label="Upload progress">
              <i style={{ width: `${progress}%` }} />
            </span>
          </>
        )}
        {status === 'ready' && <span>{formatBytes(file.size)} · ready to send</span>}
        {status === 'error' && <span className="pending-error" role="alert">{error}</span>}
      </div>
      {status === 'error' && onRetry && (
        <button type="button" className="icon-btn" onClick={onRetry} aria-label="Try upload again" title="Try again">
          <RotateCw size={17} aria-hidden="true" />
        </button>
      )}
      <button type="button" className="icon-btn" onClick={onRemove} aria-label={status === 'uploading' ? 'Cancel upload' : 'Remove attachment'} title={status === 'uploading' ? 'Cancel upload' : 'Remove'}>
        <X size={18} aria-hidden="true" />
      </button>
    </div>
  );
}

export default function MessageComposer({ conversationId, replyTo, onClearReply, editing, onClearEdit }) {
  const { sendMessage, editMessage, notifyTyping, stopTyping } = useChat();
  const { status } = useSocket();
  const toast = useToast();
  const [text, setText] = useState('');
  const [pending, setPending] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const ref = useRef(null);
  const menuRef = useRef(null);
  const inputs = useRef({});
  const pendingRef = useRef(null);
  const uploadRef = useRef(null); // { abort }
  pendingRef.current = pending;

  // Throw away an unsent attachment (cancel an in-flight upload, or delete the stored draft).
  const discard = useCallback((item) => {
    if (!item) return;
    uploadRef.current?.abort();
    uploadRef.current = null;
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    if (item.attachment) attachmentsApi.discard(item.attachment.id).catch(() => {});
  }, []);

  // Drafts are per conversation view; start clean when switching.
  useEffect(() => {
    setText('');
    setPending(null);
    setMenuOpen(false);
    ref.current?.focus();
    return () => {
      discard(pendingRef.current);
    };
  }, [conversationId, discard]);

  // Grow with content up to a cap.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [text]);

  // Close the + menu on outside click or Escape.
  useEffect(() => {
    if (!menuOpen) return undefined;
    const close = (event) => {
      if (event.type === 'keydown' ? event.key === 'Escape' : !menuRef.current?.contains(event.target)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [menuOpen]);

  const startUpload = useCallback(
    (item) => {
      const upload = conversationsApi.upload(conversationId, item.file, (progress) =>
        setPending((p) => (p && p.id === item.id ? { ...p, progress } : p))
      );
      uploadRef.current = upload;
      upload.promise
        .then((data) => setPending((p) => (p && p.id === item.id ? { ...p, status: 'ready', progress: 100, attachment: data.attachment } : p)))
        .catch((error) => {
          if (error.code === 'aborted') return;
          setPending((p) => (p && p.id === item.id ? { ...p, status: 'error', error: error.message } : p));
        });
    },
    [conversationId]
  );

  function choose(kind, event) {
    const file = event.target.files?.[0];
    event.target.value = ''; // allow picking the same file again
    setMenuOpen(false);
    if (!file) return;
    const problem = checkFile(file, kind);
    if (problem) {
      toast.error(problem);
      return;
    }
    discard(pendingRef.current); // one attachment per message; a new pick replaces the old one
    const item = {
      id: `${Date.now()}-${Math.random()}`,
      file,
      kind,
      previewUrl: kind === 'document' ? '' : URL.createObjectURL(file),
      status: 'uploading',
      progress: 0,
      attachment: null,
      error: '',
    };
    setPending(item);
    startUpload(item);
  }

  function retryUpload() {
    const item = { ...pending, status: 'uploading', progress: 0, error: '' };
    setPending(item);
    startUpload(item);
  }

  function removePending() {
    discard(pending);
    setPending(null);
    ref.current?.focus();
  }

  const uploading = pending?.status === 'uploading';
  const attachmentReady = pending?.status === 'ready';
  const canSend = editing
    ? text.trim().length > 0 || Boolean(editing.attachment)
    : !uploading && pending?.status !== 'error' && (text.trim().length > 0 || attachmentReady);

  // Entering edit mode loads the message text into the box; leaving it restores an empty draft.
  const editingId = editing?.id;
  useEffect(() => {
    if (editing) {
      setText(editing.content);
      discard(pendingRef.current);
      setPending(null);
      setTimeout(() => ref.current?.focus(), 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId]);
  useEffect(() => {
    if (replyTo) ref.current?.focus();
  }, [replyTo]);

  async function saveEdit() {
    const next = text.trim();
    if (next === editing.content) {
      onClearEdit();
      setText('');
      return;
    }
    try {
      await editMessage(conversationId, editing.id, next);
      onClearEdit();
      setText('');
    } catch (error) {
      toast.error(error.message || 'Could not edit the message');
    }
  }

  function cancelEdit() {
    onClearEdit();
    setText('');
  }

  function submit() {
    if (!canSend) return;
    if (editing) {
      saveEdit();
      return;
    }
    sendMessage(conversationId, text, { attachment: attachmentReady ? pending.attachment : null, replyTo });
    onClearReply?.();
    if (pending?.previewUrl) URL.revokeObjectURL(pending.previewUrl);
    uploadRef.current = null;
    setPending(null); // ownership moved to the message; do not discard it on switch
    pendingRef.current = null;
    stopTyping();
    setText('');
    ref.current?.focus();
  }

  function onKeyDown(event) {
    if (event.key === 'Escape' && (editing || replyTo)) {
      event.preventDefault();
      if (editing) cancelEdit();
      else onClearReply();
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  }

  function onChange(event) {
    setText(event.target.value);
    if (event.target.value.trim()) notifyTyping(conversationId);
  }

  return (
    <div className="composer-wrap">
      {replyTo && !editing && (
        <div className="compose-bar" role="group" aria-label="Replying to">
          <CornerUpLeft size={16} aria-hidden="true" />
          <div className="compose-bar-text">
            <strong>Replying to {replyTo.senderName || 'message'}</strong>
            <span><PreviewText preview={replyTo} /></span>
          </div>
          <button type="button" className="icon-btn" onClick={onClearReply} aria-label="Cancel reply" title="Cancel reply"><X size={18} aria-hidden="true" /></button>
        </div>
      )}
      {editing && (
        <div className="compose-bar editing" role="group" aria-label="Editing message">
          <Pencil size={16} aria-hidden="true" />
          <div className="compose-bar-text">
            <strong>Editing message</strong>
            <span>Press Enter to save, Esc to cancel</span>
          </div>
          <button type="button" className="icon-btn" onClick={cancelEdit} aria-label="Cancel edit" title="Cancel edit"><X size={18} aria-hidden="true" /></button>
        </div>
      )}
      {pending && <PendingPreview pending={pending} onRemove={removePending} onRetry={retryUpload} />}
      <form className="composer" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <div className="attach" ref={menuRef}>
          {menuOpen && (
            <div className="menu attach-menu" role="menu" aria-label="Attach">
              {MENU.map(({ kind, label, icon: Icon }) => (
                <button key={kind} type="button" role="menuitem" onClick={() => inputs.current[kind]?.click()}>
                  <Icon size={17} aria-hidden="true" /> {label}
                </button>
              ))}
            </div>
          )}
          <button type="button" disabled={Boolean(editing)} className={`icon-btn attach-btn ${menuOpen ? 'open' : ''}`} onClick={() => setMenuOpen((v) => !v)} aria-haspopup="menu" aria-expanded={menuOpen} aria-label="Attach a file" title="Attach">
            <Plus size={22} aria-hidden="true" />
          </button>
          {MENU.map(({ kind }) => (
            <input key={kind} ref={(el) => { inputs.current[kind] = el; }} type="file" hidden accept={ACCEPT[kind]} onChange={(e) => choose(kind, e)} data-testid={`file-${kind}`} />
          ))}
        </div>
        <textarea
          ref={ref}
          value={text}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onBlur={stopTyping}
          rows={1}
          maxLength={MAX}
          placeholder={editing ? 'Edit your message' : replyTo ? 'Write your reply' : pending ? 'Add a caption (optional)' : status === 'connected' ? 'Write a message' : 'Reconnecting… you can still write'}
          aria-label="Message"
        />
        <button type="submit" className="send-btn" disabled={!canSend} aria-label={editing ? 'Save edit' : 'Send message'} title={editing ? 'Save (Enter)' : uploading ? 'Wait for the upload to finish' : 'Send (Enter)'}>
          {uploading && !editing ? <Loader2 size={18} className="spin" aria-hidden="true" /> : editing ? <Check size={18} aria-hidden="true" /> : <Send size={18} aria-hidden="true" />}
        </button>
      </form>
    </div>
  );
}
