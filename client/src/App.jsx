import { Navigate, Route, Routes } from 'react-router-dom';
import Landing from './pages/Landing.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import ChatPage from './pages/ChatPage.jsx';
import CallsPage from './pages/CallsPage.jsx';
import { ContactsPage, GroupsPage, ProfilePage } from './pages/SectionPages.jsx';
import AppShell from './components/layout/AppShell.jsx';
import { ProtectedRoute, PublicOnlyRoute } from './components/auth/AuthParts.jsx';
import { SocketProvider } from './context/SocketContext.jsx';
import { ChatProvider } from './context/ChatContext.jsx';
import { CallProvider } from './context/CallContext.jsx';

// Socket and chat state exist only while signed in, so logging out tears everything down.
function Authenticated() {
  return (
    <ProtectedRoute>
      <SocketProvider>
        <ChatProvider>
          <CallProvider>
            <AppShell />
          </CallProvider>
        </ChatProvider>
      </SocketProvider>
    </ProtectedRoute>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<PublicOnlyRoute><Login /></PublicOnlyRoute>} />
      <Route path="/register" element={<PublicOnlyRoute><Register /></PublicOnlyRoute>} />
      <Route path="/app" element={<Authenticated />}>
        <Route index element={<ChatPage />} />
        <Route path="c/:id" element={<ChatPage />} />
        <Route path="calls" element={<CallsPage />} />
        <Route path="contacts" element={<ContactsPage />} />
        <Route path="groups" element={<GroupsPage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="*" element={<Navigate to="/app" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}