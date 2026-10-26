import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, MessageSquare, Search, X } from 'lucide-react';
import { Avatar, EmptyState, ErrorState } from '../common/Common.jsx';
import { useChat } from '../../context/ChatContext.jsx';
import { usersApi } from '../../services/api.js';
import useDebounce from '../../hooks/useDebounce.js';

export function ContactItem({ person, online, onOpen, onProfile, busy, selectable, selected, onToggle }) {
  const identity = (
    <>
      <Avatar name={person.name} id={person.id} src={person.avatarUrl} size={40} online={online} />
      <span className="contact-text">
        <strong>{person.name}</strong>
      </span>
    </>
  );
  if (selectable) {
    return (
      <li>
        <button type="button" className={`contact-item ${selected ? 'selected' : ''}`} onClick={onToggle} aria-pressed={selected}>
          {identity}
          <span className={`check ${selected ? 'on' : ''}`} aria-hidden="true">{selected && <Check size={14} />}</span>
        </button>
      </li>
    );
  }
  return (
    <li className="contact-row">
      <button type="button" className="contact-item contact-main" onClick={() => onProfile?.(person)} aria-label={`View ${person.name}'s profile`}>
        {identity}
      </button>
      <button type="button" className="contact-item contact-msg" onClick={onOpen} disabled={busy} aria-label={`Message ${person.name}`}>
        <span className="contact-action">
          {busy ? <Loader2 size={16} className="spin" aria-hidden="true" /> : <MessageSquare size={16} aria-hidden="true" />}
          <span>Message</span>
        </span>
      </button>
    </li>
  );
}

/**
 * Searches registered users from the server (name or username, caller excluded, paginated).
 * Single mode: clicking a person calls onOpen(person). Multiple mode: toggles selection.
 */
export default function UserSearch({ onOpen, onProfile, busyId, multiple = false, selected = [], onSelectedChange, excludeIds }) {
  const { isOnline } = useChat();
  const [query, setQuery] = useState('');
  const debounced = useDebounce(query, 300);
  const [state, setState] = useState({ users: [], page: 1, hasMore: false, status: 'loading', error: '', loadingMore: false });
  const requestId = useRef(0);

  async function fetchPage(page, append) {
    const id = ++requestId.current;
    setState((s) => ({ ...s, status: append ? s.status : 'loading', loadingMore: append, error: '' }));
    try {
      const data = await usersApi.search({ q: debounced, page, limit: 20 });
      if (id !== requestId.current) return; // a newer search superseded this one
      setState((s) => ({
        users: append ? [...s.users, ...data.users] : data.users,
        page,
        hasMore: data.hasMore,
        status: 'ready',
        error: '',
        loadingMore: false,
      }));
    } catch (error) {
      if (id !== requestId.current) return;
      setState((s) => ({ ...s, status: 'error', error: error.message, loadingMore: false }));
    }
  }

  useEffect(() => {
    fetchPage(1, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const users = excludeIds ? state.users.filter((u) => !excludeIds.has(u.id)) : state.users;
  const selectedIds = new Set(selected.map((p) => p.id));

  function toggle(person) {
    onSelectedChange(selectedIds.has(person.id) ? selected.filter((p) => p.id !== person.id) : [...selected, person]);
  }

  return (
    <div className="user-search">
      {multiple && selected.length > 0 && (
        <ul className="chips" aria-label="Selected people">
          {selected.map((p) => (
            <li key={p.id} className="chip">
              {p.name}
              <button type="button" onClick={() => toggle(p)} aria-label={`Remove ${p.name}`}><X size={13} aria-hidden="true" /></button>
            </li>
          ))}
        </ul>
      )}
      <div className="search-box">
        <Search size={16} aria-hidden="true" />
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name" aria-label="Search people" />
      </div>

      <div className="user-results" aria-busy={state.status === 'loading'}>
        {state.status === 'loading' && (
          <div className="state"><Loader2 className="spin" size={20} aria-hidden="true" /><p>Searching…</p></div>
        )}
        {state.status === 'error' && <ErrorState message={state.error} onRetry={() => fetchPage(1, false)} />}
        {state.status === 'ready' && users.length === 0 && (
          <EmptyState
            icon={Search}
            title="No users found"
            text={debounced ? `Nobody matches “${debounced}”.` : 'No other people have joined VYBE yet. Invite a friend to sign up.'}
          />
        )}
        {users.length > 0 && (
          <ul className="contact-list">
            {users.map((person) => (
              <ContactItem
                key={person.id}
                person={person}
                online={isOnline(person.id, person.online)}
                busy={busyId === person.id}
                selectable={multiple}
                selected={selectedIds.has(person.id)}
                onToggle={() => toggle(person)}
                onOpen={() => onOpen(person)}
                onProfile={onProfile}
              />
            ))}
          </ul>
        )}
        {state.hasMore && (
          <button type="button" className="btn btn-ghost btn-sm btn-block" disabled={state.loadingMore} onClick={() => fetchPage(state.page + 1, true)}>
            {state.loadingMore ? 'Loading…' : 'Show more'}
          </button>
        )}
      </div>
    </div>
  );
}