export function otherParticipant(conversation, meId) {
  return conversation.participants.find((p) => p.id !== meId) || null;
}

export function conversationTitle(conversation, meId) {
  if (conversation.type === 'group') return conversation.groupName || 'Group';
  return otherParticipant(conversation, meId)?.name || 'Unknown user';
}

export function previewText(conversation, meId) {
  const last = conversation.lastMessage;
  if (!last) return null;
  const text = last.content.replace(/\s+/g, ' ');
  if (last.isCall) return text;
  if (last.senderId === meId) return `You: ${text}`;
  if (conversation.type === 'group') {
    const sender = conversation.participants.find((p) => p.id === last.senderId);
    return `${sender ? sender.name.split(' ')[0] : 'Someone'}: ${text}`;
  }
  return text;
}