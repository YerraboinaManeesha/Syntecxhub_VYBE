import { useEffect, useState } from 'react';
import { Loader2, LogOut, UserPlus } from 'lucide-react';
import { Avatar, Modal } from '../common/Common.jsx';
import UserSearch from '../contacts/UserSearch.jsx';
import SharedFiles from '../media/SharedFiles.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useChat } from '../../context/ChatContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';

/** Member list, add members, leave. Opened from the chat header of a group. */
export function GroupDetails({ conversation, onClose, onLeft, onOpenProfile }) {
  const { user } = useAuth();
  const { isOnline, addMembers, leaveGroup } = useChat();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState([]);
  const [busy, setBusy] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);

  const memberIds = new Set(conversation.participants.map((p) => p.id));

  async function add() {
    setBusy(true);
    try {
      await addMembers(conversation.id, picked.map((p) => p.id));
      toast.success(`Added ${picked.length} ${picked.length === 1 ? 'member' : 'members'}`);
      setPicked([]);
      setAdding(false);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function leave() {
    setBusy(true);
    try {
      await leaveGroup(conversation.id);
      toast.info(`You left ${conversation.groupName}`);
      onLeft();
    } catch (error) {
      toast.error(error.message);
      setBusy(false);
    }
  }

  return (
    <Modal title={conversation.groupName} onClose={onClose}>
      <h3 className="modal-section">{conversation.participants.length} members</h3>
      <ul className="member-list">
        {conversation.participants.map((p) => (
          <li key={p.id}>
            {p.id === user.id ? (
              <span className="member-row">
                <Avatar name={p.name} id={p.id} src={p.avatarUrl} size={34} online={isOnline(p.id, p.online)} />
                <span className="member-text">
                  <strong>{p.name} (you)</strong>
                </span>
              </span>
            ) : (
              <button type="button" className="member-row member-btn" onClick={() => onOpenProfile?.(p)} aria-label={`View ${p.name}'s profile`}>
                <Avatar name={p.name} id={p.id} src={p.avatarUrl} size={34} online={isOnline(p.id, p.online)} />
                <span className="member-text">
                  <strong>{p.name}</strong>
                </span>
              </button>
            )}
          </li>
        ))}
      </ul>

      <h3 className="modal-section">Shared in this group</h3>
      <SharedFiles conversationId={conversation.id} />

      {adding ? (
        <div className="modal-block">
          <h3 className="modal-section">Add people</h3>
          <UserSearch multiple selected={picked} onSelectedChange={setPicked} excludeIds={memberIds} />
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setAdding(false); setPicked([]); }}>Cancel</button>
            <button type="button" className="btn btn-primary btn-sm" disabled={busy || picked.length === 0} onClick={add}>
              {busy && <Loader2 size={16} className="spin" aria-hidden="true" />} Add {picked.length || ''}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn btn-ghost btn-block" onClick={() => setAdding(true)}>
          <UserPlus size={16} aria-hidden="true" /> Add members
        </button>
      )}

      <div className="modal-block danger-zone">
        {confirmLeave ? (
          <>
            <p>Leave this group? You will stop receiving its messages and lose access to its history.</p>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmLeave(false)}>Stay</button>
              <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={leave}>
                {busy && <Loader2 size={16} className="spin" aria-hidden="true" />} Leave group
              </button>
            </div>
          </>
        ) : (
          <button type="button" className="btn btn-danger-ghost btn-block" onClick={() => setConfirmLeave(true)}>
            <LogOut size={16} aria-hidden="true" /> Leave group
          </button>
        )}
      </div>
    </Modal>
  );
}

export function NewGroupModal({ onClose, onCreated }) {
  const { createGroup } = useChat();
  const toast = useToast();
  const [name, setName] = useState('');
  const [picked, setPicked] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => setError(''), [name, picked]);

  async function submit(event) {
    event.preventDefault();
    if (!name.trim()) return setError('Give your group a name');
    if (picked.length === 0) return setError('Select at least one person');
    setBusy(true);
    try {
      const conversation = await createGroup(name.trim(), picked.map((p) => p.id));
      onCreated(conversation);
    } catch (err) {
      setError(err.message);
      toast.error(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal title="New group" onClose={onClose}>
      <form onSubmit={submit} className="auth-form" noValidate>
        <div className="field">
          <label htmlFor="group-name">Group name</label>
          <input id="group-name" className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <div className="field">
          <span className="label">Members</span>
          <UserSearch multiple selected={picked} onSelectedChange={setPicked} />
        </div>
        {error && <div className="form-alert" role="alert">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy && <Loader2 size={16} className="spin" aria-hidden="true" />} Create group
          </button>
        </div>
      </form>
    </Modal>
  );
}