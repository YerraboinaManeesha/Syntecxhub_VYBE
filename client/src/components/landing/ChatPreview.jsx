import { Search, Send } from 'lucide-react';

// Illustrative sample content for the landing page only.
// It is not real data and the authenticated app never uses it.
const SAMPLE_CHATS = [
  { name: 'Design Crew', preview: 'Final mockups are up', time: '10:42', unread: 2, online: false, group: true },
  { name: 'Aarav Sharma', preview: 'See you at 6?', time: '10:15', unread: 0, online: true },
  { name: 'Meera Rao', preview: 'Sent the notes over', time: 'Yesterday', unread: 0, online: true },
  { name: 'Study Group', preview: 'Who has the slides?', time: 'Mon', unread: 0, online: false, group: true },
];

const SAMPLE_MESSAGES = [
  { from: 'them', text: 'Are we still on for the demo today?', time: '10:12' },
  { from: 'me', text: 'Yes. Pushing the last fixes now.', time: '10:13' },
  { from: 'them', text: 'Perfect, ping me when it is live.', time: '10:14' },
];

function Avatar({ name, online }) {
  const initials = name
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('');
  return (
    <span className="pv-avatar" aria-hidden="true">
      {initials}
      {online && <span className="pv-online" />}
    </span>
  );
}

export default function ChatPreview() {
  return (
    <div className="chat-preview" role="img" aria-label="Illustrative preview of the VYBE chat interface">
      <aside className="pv-list">
        <div className="pv-search">
          <Search size={14} aria-hidden="true" />
          <span>Search conversations</span>
        </div>
        <ul>
          {SAMPLE_CHATS.map((chat, index) => (
            <li key={chat.name} className={`pv-item ${index === 1 ? 'is-active' : ''}`}>
              <Avatar name={chat.name} online={chat.online} />
              <div className="pv-item-body">
                <div className="pv-item-top">
                  <strong>{chat.name}</strong>
                  <time>{chat.time}</time>
                </div>
                <div className="pv-item-bottom">
                  <span>{chat.preview}</span>
                  {chat.unread > 0 && <span className="pv-badge">{chat.unread}</span>}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </aside>

      <section className="pv-chat">
        <header className="pv-chat-header">
          <Avatar name="Aarav Sharma" online />
          <div>
            <strong>Aarav Sharma</strong>
            <span>Online</span>
          </div>
        </header>
        <div className="pv-messages">
          {SAMPLE_MESSAGES.map((message) => (
            <div key={message.text} className={`pv-bubble ${message.from === 'me' ? 'is-sent' : 'is-received'}`}>
              <p>{message.text}</p>
              <time>{message.time}</time>
            </div>
          ))}
        </div>
        <div className="pv-composer">
          <span>Write a message</span>
          <span className="pv-send">
            <Send size={14} aria-hidden="true" />
          </span>
        </div>
      </section>
    </div>
  );
}
