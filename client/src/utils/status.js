/**
 * Status of a message I sent, from the receipts the server shares with conversation members.
 *   sending   – on its way to the server (local only)
 *   failed    – the server did not accept it
 *   sent      – stored on the server
 *   delivered – at least one other member's signed-in app has received it
 *   read      – at least one other member has opened the conversation since it was sent
 * In a group, "delivered/read" means at least one other member so far.
 */
export function messageStatus(message, conversation, meId) {
  if (message.status === 'sending') return 'sending';
  if (message.status === 'failed') return 'failed';
  const created = Date.parse(message.createdAt);
  let delivered = false;
  let read = false;
  for (const person of conversation.participants) {
    if (person.id === meId) continue;
    const receipt = conversation.receipts?.[person.id];
    if (!receipt) continue;
    if (receipt.readAt && Date.parse(receipt.readAt) >= created) read = true;
    if (receipt.deliveredAt && Date.parse(receipt.deliveredAt) >= created) delivered = true;
  }
  return read ? 'read' : delivered ? 'delivered' : 'sent';
}

export const STATUS_LABEL = { sent: 'Sent', delivered: 'Delivered', read: 'Read' };
