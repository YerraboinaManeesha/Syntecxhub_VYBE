// Presence is derived from live, authenticated socket connections.
// userId -> Set of socket ids. A user is online while the set is non-empty, so several tabs
// or devices count as one user and closing one tab never marks them offline.
const connections = new Map();

export function addConnection(userId, socketId) {
  const key = String(userId);
  let set = connections.get(key);
  const wasOffline = !set || set.size === 0;
  if (!set) {
    set = new Set();
    connections.set(key, set);
  }
  set.add(socketId);
  return wasOffline;
}

export function removeConnection(userId, socketId) {
  const key = String(userId);
  const set = connections.get(key);
  if (!set) return false;
  set.delete(socketId);
  if (set.size === 0) {
    connections.delete(key);
    return true; // became offline
  }
  return false;
}

export function isOnline(userId) {
  const set = connections.get(String(userId));
  return Boolean(set && set.size > 0);
}

export function resetPresence() {
  connections.clear();
}
