import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, PhoneCall, Phone, Plus, Search, Trash2, Video } from 'lucide-react';
import { Avatar, EmptyState, ErrorState, LoadingState, Modal } from '../components/common/Common.jsx';
import { CallKindIcon, DirectionIcon } from '../components/calls/CallRecord.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useCall } from '../context/CallContext.jsx';
import { useChat } from '../context/ChatContext.jsx';
import { useSocket } from '../context/SocketContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { callsApi } from '../services/api.js';
import { callTypeLabel, describeCall, formatCallTime, formatDuration } from '../utils/callLabels.js';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'missed', label: 'Missed' },
  { id: 'incoming', label: 'Incoming' },
  { id: 'outgoing', label: 'Outgoing' },
];
const PAGE = 30;
const EMPTY_TEXT = {
  all: 'Calls you make and receive will show up here.',
  missed: 'You have no missed calls.',
  incoming: 'No incoming calls yet.',
  outgoing: 'No outgoing calls yet.',
};

const matches = (filter, c) =>
  filter === 'all' || (filter === 'missed' && c.missed) || (filter === 'incoming' && c.direction === 'incoming') || (filter === 'outgoing' && c.direction === 'outgoing');

function CallRow({ call, privateConv, onOpen, onCallBack, onRemove, disabled }) {
  const outgoing = call.direction === 'outgoing';
  const info = describeCall({ status: call.status, outgoing, cancelledByCaller: call.endedBy === 'caller' });
  const label = callTypeLabel(call.type);
  const name = call.peer.name || 'Unknown user';
  return (
    <li className={`call-item ${info.missed ? 'missed' : ''}`} data-testid="call-item" data-call-id={call.id}>
      <button type="button" className="call-item-who" onClick={() => onOpen(call)} aria-label={`Open conversation with ${name}`}>
        <Avatar id={call.peer.id} name={name} src={call.peer.avatarUrl} size={44} />
      </button>
      <div className="call-item-main">
        <button type="button" className="call-item-name" onClick={() => onOpen(call)}>{name}</button>
        <span className="call-item-meta">
          <DirectionIcon outgoing={outgoing} missed={info.missed} />
          <span className="call-item-status">{info.label}</span>
          <span aria-hidden="true">·</span>
          <span>{label}</span>
          {info.answered && <><span aria-hidden="true">·</span><span>{formatDuration(call.durationSec)}</span></>}
        </span>
        <time className="call-item-time" dateTime={call.createdAt}>{formatCallTime(call.createdAt)}</time>
      </div>
      <button
        type="button"
        className="call-item-back"
        onClick={() => onCallBack(call)}
        disabled={disabled || !privateConv}
        aria-label={`Call ${name} back (${label.toLowerCase()})`}
        title={`Call back (${label.toLowerCase()})`}
      >
        <CallKindIcon type={call.type} size={20} />
      </button>
      <button type="button" className="icon-btn call-item-remove" onClick={() => onRemove(call)} aria-label={`Remove this call with ${name} from history`} title="Remove from history">
        <Trash2 size={16} aria-hidden="true" />
      </button>
    </li>
  );
}

function NewCallModal({ onClose, onPick }) {
  const { conversations } = useChat();
  const { user } = useAuth();
  const [q, setQ] = useState('');
  const people = useMemo(() => {
    const list = conversations
      .filter((c) => c.type === 'private' && !c.blockedByMe)
      .map((c) => ({ conversation: c, person: c.participants.find((p) => p.id !== user.id) }))
      .filter((x) => x.person);
    const term = q.trim().toLowerCase();
    return term ? list.filter((x) => `${x.person.name} ${x.person.username || ''}`.toLowerCase().includes(term)) : list;
  }, [conversations, q, user.id]);
  return (
    <Modal title="New call" onClose={onClose}>
      <label className="search-box">
        <Search size={16} aria-hidden="true" />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your contacts" aria-label="Search your contacts" autoFocus />
      </label>
      {people.length === 0 ? (
        <p className="call-new-empty">{q ? 'Nobody matches that search.' : 'Start a conversation from Contacts first, then you can call that person here.'}</p>
      ) : (
        <ul className="call-new-list">
          {people.map(({ conversation, person }) => (
            <li key={conversation.id} className="call-new-row">
              <Avatar id={person.id} name={person.name} src={person.avatarUrl} size={40} />
              <span className="call-new-name">{person.name}</span>
              <button type="button" className="call-item-back" onClick={() => onPick(conversation, person, 'voice')} aria-label={`Voice call ${person.name}`} title="Voice call"><Phone size={18} aria-hidden="true" /></button>
              <button type="button" className="call-item-back" onClick={() => onPick(conversation, person, 'video')} aria-label={`Video call ${person.name}`} title="Video call"><Video size={18} aria-hidden="true" /></button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

export default function CallsPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const { socket } = useSocket();
  const { conversations } = useChat();
  const { startCall, busy, setMissed } = useCall();
  const [filter, setFilter] = useState('all');
  const [calls, setCalls] = useState([]);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [more, setMore] = useState(false);
  const [creating, setCreating] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const filterRef = useRef(filter);
  filterRef.current = filter;
  const seq = useRef(0);

  const markSeen = useCallback(() => {
    callsApi.markSeen().then((d) => setMissed(d.missed)).catch(() => {});
  }, [setMissed]);

  const load = useCallback(async (which) => {
    const mine = ++seq.current;
    setStatus('loading');
    try {
      const data = await callsApi.history({ limit: PAGE, filter: which });
      if (mine !== seq.current) return;
      setCalls(data.calls);
      setHasMore(data.hasMore);
      setStatus('ready');
      markSeen();
    } catch (e) {
      if (mine !== seq.current) return;
      setError(e.message || 'Could not load your calls.');
      setStatus('error');
    }
  }, [markSeen]);

  useEffect(() => { load(filter); }, [filter, load]);

  async function loadMore() {
    if (more || !calls.length) return;
    setMore(true);
    try {
      const data = await callsApi.history({ limit: PAGE, filter, before: calls[calls.length - 1].id });
      setCalls((list) => {
        const seen = new Set(list.map((c) => c.id));
        return [...list, ...data.calls.filter((c) => !seen.has(c.id))];
      });
      setHasMore(data.hasMore);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setMore(false);
    }
  }

  // Live: a call that just finished appears at the top; the same call never appears twice.
  useEffect(() => {
    if (!socket) return undefined;
    const onFinished = ({ call, reason }) => {
      if (!call || reason === 'answered_elsewhere' || call.status === 'ringing' || call.status === 'ongoing') return;
      if (!matches(filterRef.current, call)) return;
      setCalls((list) => {
        const rest = list.filter((c) => c.id !== call.id);
        return [call, ...rest].sort((a, b) => (a.id < b.id ? 1 : -1));
      });
      setStatus((s) => (s === 'error' ? s : 'ready'));
      if (call.missed) markSeen();
    };
    socket.on('call:ended', onFinished);
    socket.on('call:missed', onFinished);
    return () => {
      socket.off('call:ended', onFinished);
      socket.off('call:missed', onFinished);
    };
  }, [socket, markSeen]);

  const privateConv = useCallback(
    (call) => conversations.find((c) => c.id === call.conversationId && c.type === 'private' && !c.blockedByMe),
    [conversations]
  );

  const openChat = (call) => navigate(`/app/c/${call.conversationId}`);
  const callBack = (call) => startCall(call.conversationId, call.type, call.peer);

  async function remove(call) {
    const before = calls;
    setCalls((list) => list.filter((c) => c.id !== call.id));
    try {
      await callsApi.remove(call.id);
    } catch (e) {
      setCalls(before);
      toast.error(e.message || 'Could not remove that call.');
    }
  }

  async function clearAll() {
    setConfirmClear(false);
    try {
      await callsApi.clearAll();
      setCalls([]);
      setHasMore(false);
      setMissed(0);
    } catch (e) {
      toast.error(e.message || 'Could not clear your call history.');
    }
  }

  return (
    <div className="page calls-page">
      <header className="page-header page-header-row">
        <div>
          <h1>Calls</h1>
          <p>Your voice and video calls.</p>
        </div>
        <div className="calls-actions">
          {calls.length > 0 && (
            <button type="button" className="btn btn-ghost" onClick={() => setConfirmClear(true)}>Clear all</button>
          )}
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
            <Plus size={18} aria-hidden="true" /> New call
          </button>
        </div>
      </header>

      <div className="tabs calls-filters" role="tablist" aria-label="Filter calls">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" role="tab" aria-selected={filter === f.id} className={`tab ${filter === f.id ? 'active' : ''}`} onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
      </div>

      {status === 'loading' && <LoadingState label="Loading calls…" />}
      {status === 'error' && <ErrorState message={error} onRetry={() => load(filter)} />}
      {status === 'ready' && calls.length === 0 && (
        <EmptyState icon={PhoneCall} title={filter === 'all' ? 'No calls yet' : `No ${filter} calls`} text={EMPTY_TEXT[filter]} />
      )}
      {status === 'ready' && calls.length > 0 && (
        <>
          <ul className="call-list page-list" aria-label="Recent calls">
            {calls.map((c) => (
              <CallRow key={c.id} call={c} privateConv={privateConv(c)} onOpen={openChat} onCallBack={callBack} onRemove={remove} disabled={busy} />
            ))}
          </ul>
          {hasMore && (
            <button type="button" className="btn btn-ghost calls-more" onClick={loadMore} disabled={more}>
              {more ? <Loader2 size={16} className="spin" aria-hidden="true" /> : null} Load older calls
            </button>
          )}
        </>
      )}

      {creating && (
        <NewCallModal
          onClose={() => setCreating(false)}
          onPick={(conversation, person, type) => { setCreating(false); startCall(conversation.id, type, person); }}
        />
      )}
      {confirmClear && (
        <Modal
          title="Clear call history?"
          onClose={() => setConfirmClear(false)}
          footer={(
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setConfirmClear(false)}>Cancel</button>
              <button type="button" className="btn btn-danger" onClick={clearAll}>Clear all</button>
            </>
          )}
        >
          <p>This removes every call from your Calls list. The other person's list and the call cards in your chats are not affected.</p>
        </Modal>
      )}
    </div>
  );
}