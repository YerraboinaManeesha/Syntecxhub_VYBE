import mongoose from 'mongoose';

const { Schema } = mongoose;

const messageSchema = new Schema(
  {
    conversationId: { type: Schema.Types.ObjectId, ref: 'Conversation', required: true },
    senderId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    // May be empty only when the message carries an attachment.
    content: { type: String, default: '', maxlength: 4000 },
    attachment: { type: Schema.Types.ObjectId, ref: 'Attachment' },
    // Client-generated id used for idempotency: a retry with the same id returns the stored message.
    clientMsgId: { type: String, required: true, minlength: 8, maxlength: 64 },
    // Reply: the quoted message (same conversation, checked on send).
    replyTo: { type: Schema.Types.ObjectId, ref: 'Message' },
    // Set when the text was edited by its sender.
    editedAt: { type: Date },
    // "Delete for everyone": the row stays as a tombstone, text and files are removed.
    deletedAt: { type: Date },
    // "Delete for me": hidden from these users only.
    deletedFor: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    // A call record shown in the chat ("Missed voice call", "Video call 12:03"). Frozen when the call ends.
    call: {
      callId: { type: Schema.Types.ObjectId, ref: 'Call' },
      type: { type: String, enum: ['voice', 'video'] },
      status: { type: String },
      endedBy: { type: String },
      durationSec: { type: Number, default: 0 },
      callerId: { type: Schema.Types.ObjectId, ref: 'User' },
    },
    // One reaction per person per message.
    reactions: [
      new Schema({ userId: { type: Schema.Types.ObjectId, ref: 'User', required: true }, emoji: { type: String, required: true } }, { _id: false }),
    ],
  },
  { timestamps: true }
);

messageSchema.pre('validate', function requireContentOrAttachment(next) {
  if (!this.content && !this.attachment && !this.deletedAt && !this.call?.callId) this.invalidate('content', 'Message cannot be empty');
  next();
});

// History pagination: newest first within a conversation.
messageSchema.index({ conversationId: 1, _id: -1 });
// Idempotent sends: one message per (sender, clientMsgId).
messageSchema.index({ senderId: 1, clientMsgId: 1 }, { unique: true });
// One chat record per call, however many times the end of the call is reported.
messageSchema.index({ 'call.callId': 1 }, { unique: true, sparse: true });

export const Message = mongoose.model('Message', messageSchema);