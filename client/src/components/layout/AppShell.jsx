import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useMatch, useNavigate } from 'react-router-dom';
import { LogOut, MessageSquare, Phone, UserCircle, Users, UsersRound, WifiOff } from 'lucide-react';
import VYBELogo from './VYBELogo.jsx';
import { Avatar } from '../common/Common.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useChat } from '../../context/ChatContext.jsx';
import { useCall } from '../../context/CallContext.jsx';
import { useSocket } from '../../context/SocketContext.jsx';

const NAV = [
  { to: '/app', label: 'Conversations', icon: MessageSquare, end: true, badge: true },
  { to: '/app/calls', label: 'Calls', icon: Phone, calls: true },
  { to: '/app/contacts', label: 'Contacts', icon: Users },
  { to: '/app/groups', label: 'Groups', icon: UsersRound },
  { to: '/app/profile', label: 'Profile', icon: UserCircle },
];

function NavItems({ unread }) {
  const { missed } = useCall();
  return NAV.map(({ to, label, icon: Icon, end, badge, calls }) => (
    <NavLink key={to} to={to} end={end} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
      <span className="nav-icon">
        <Icon size={20} aria-hidden="true" />
        {badge && unread > 0 && <span className="nav-dot" aria-hidden="true" />}
        {calls && missed > 0 && <span className="nav-dot nav-dot-missed" aria-hidden="true" />}
      </span>
      <span className="nav-label">{label}</span>
      {badge && unread > 0 && <span className="sr-only"> ({unread} unread)</span>}
      {calls && missed > 0 && <span className="sr-only"> ({missed} missed)</span>}
    </NavLink>
  ));
}

/** Current user card with a small menu holding Profile and Sign out. */
export function ProfileMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (event.type === 'keydown' ? event.key === 'Escape' : !ref.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  return (
    <div className="profile-menu" ref={ref}>
      {open && (
        <div className="menu" role="menu">
          <button type="button" role="menuitem" onClick={() => { setOpen(false); navigate('/app/profile'); }}>
            <UserCircle size={16} aria-hidden="true" /> Profile and settings
          </button>
          <button type="button" role="menuitem" onClick={logout}>
            <LogOut size={16} aria-hidden="true" /> Sign out
          </button>
        </div>
      )}
      <button type="button" className="profile-card" onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open} aria-label={`Account menu for ${user.name}`} title={user.name}>
        <Avatar name={user.name} id={user.id} src={user.avatarUrl} size={36} />
      </button>
    </div>
  );
}

export function AppSidebar() {
  const { totalUnread } = useChat();
  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <span className="logo-full"><VYBELogo size={30} /></span>
        <span className="logo-icon"><VYBELogo size={30} showWordmark={false} /></span>
      </div>
      <nav className="sidebar-nav" aria-label="Main">
        <NavItems unread={totalUnread} />
      </nav>
      <ProfileMenu />
    </aside>
  );
}

function MobileNav() {
  const { totalUnread } = useChat();
  return (
    <nav className="mobile-nav" aria-label="Main">
      <NavItems unread={totalUnread} />
    </nav>
  );
}

export function ConnectionBanner() {
  const { status } = useSocket();
  const [show, setShow] = useState(false);

  // Don't flash the banner for the brief moment while connecting or on a fast refresh.
  useEffect(() => {
    if (status === 'connected') {
      setShow(false);
      return undefined;
    }
    const timer = setTimeout(() => setShow(true), 1500);
    return () => clearTimeout(timer);
  }, [status]);

  if (!show) return null;
  return (
    <div className="conn-banner" role="status">
      <WifiOff size={15} aria-hidden="true" /> Connection lost. Reconnecting… messages will be held for retry.
    </div>
  );
}

export default function AppShell() {
  const inChat = Boolean(useMatch('/app/c/:id'));
  return (
    <div className={`app-shell ${inChat ? 'in-chat' : ''}`}>
      <AppSidebar />
      <div className="app-main">
        <ConnectionBanner />
        <div className="app-content">
          <Outlet />
        </div>
      </div>
      <MobileNav />
    </div>
  );
}