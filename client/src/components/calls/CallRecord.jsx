import { ArrowDownLeft, ArrowUpRight, Phone, PhoneMissed, Video, VideoOff } from 'lucide-react';
import { useCall } from '../../context/CallContext.jsx';
import { useChat } from '../../context/ChatContext.jsx';
import { callTypeLabel, describeCall, formatCallTime, formatDuration } from '../../utils/callLabels.js';
import { formatFull } from '../../utils/format.js';

/** Icon for a call: red phone/camera for missed, plain phone/camera otherwise. */
export function CallKindIcon({ type, missed, size = 18 }) {
  const Icon = missed ? (type === 'video' ? VideoOff : PhoneMissed) : type === 'video' ? Video : Phone;
  return <Icon size={size} aria-hidden="true" />;
}

/** Direction arrow (in/out) used on the Calls page. */
export function DirectionIcon({ outgoing, missed, size = 14 }) {
  const Icon = outgoing ? ArrowUpRight : ArrowDownLeft;
  return <Icon size={size} className={missed ? 'call-dir missed' : 'call-dir'} aria-hidden="true" />;
}

/** The WhatsApp-style call card shown inside a conversation. */
export default function CallRecordCard({ message, mine, meId }) {
  const { startCall, busy } = useCall();
  const { conversations } = useChat();
  const call = message.call;
  const outgoing = String(call.callerId) === String(meId);
  const info = describeCall({ status: call.status, outgoing, cancelledByCaller: call.endedBy === 'caller' });
  const conversation = conversations.find((c) => c.id === message.conversationId);
  const peer = conversation?.participants.find((p) => p.id !== meId);
  const label = callTypeLabel(call.type);
  const when = formatCallTime(message.createdAt);
  const summary = `${label}, ${info.label}${info.answered ? `, ${formatDuration(call.durationSec)}` : ''}, ${formatFull(message.createdAt)}`;

  return (
    <div className={`msg-row call-row ${mine ? 'mine' : 'theirs'}`}>
      <div className="msg-line">
        {!mine && <span className="msg-avatar" />}
        <div className="msg-stack">
          <div className={`call-card ${info.missed ? 'missed' : ''}`} role="group" aria-label={summary} data-testid="call-card" data-call-id={call.id} data-status={call.status}>
            <span className="call-card-icon"><CallKindIcon type={call.type} missed={info.missed} /></span>
            <span className="call-card-body">
              <strong className="call-card-title">{label}</strong>
              <span className="call-card-sub">
                <DirectionIcon outgoing={outgoing} missed={info.missed} />
                <span className="call-card-status">{info.label}</span>
                {info.answered && <span>· {formatDuration(call.durationSec)}</span>}
              </span>
              <time className="call-card-time" dateTime={message.createdAt} title={formatFull(message.createdAt)}>{when}</time>
            </span>
            {peer && (
              <button
                type="button"
                className="call-card-back"
                onClick={() => startCall(message.conversationId, call.type, peer)}
                disabled={busy || conversation?.blockedByMe}
                aria-label={`Call back with ${label.toLowerCase()}`}
                title={`Call back (${label.toLowerCase()})`}
              >
                <CallKindIcon type={call.type} size={18} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}