import mongoose from 'mongoose';

const { Schema } = mongoose;

// One document per (conversation, member). Everything the member has not read is
// "messages from other people created after lastReadAt". This works the same for
// private chats and groups and never assumes the whole group has read anything.
const readStateSchema = new Schema(
  {
    conversationId: { type: Schema.Types.ObjectId, ref: 'Conversation', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    lastReadAt: { type: Date, required: true, default: Date.now },
    // Watermark: this member's signed-in app has confirmed receiving every message created up to this time.
    deliveredAt: { type: Date },
    // "Clear chat": everything up to this time is hidden for this member only (their own messages are hidden via deletedFor).
    clearedAt: { type: Date },
  },
  { timestamps: true }
);

readStateSchema.index({ conversationId: 1, userId: 1 }, { unique: true });
readStateSchema.index({ userId: 1 });

export const ReadState = mongoose.model('ReadState', readStateSchema);
