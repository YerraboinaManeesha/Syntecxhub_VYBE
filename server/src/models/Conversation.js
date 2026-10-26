import mongoose from 'mongoose';

const { Schema } = mongoose;

const conversationSchema = new Schema(
  {
    type: { type: String, enum: ['private', 'group'], required: true },
    participants: [{ type: Schema.Types.ObjectId, ref: 'User', required: true }],
    // Private conversations only: the two participant ids sorted and joined.
    // The unique sparse index below makes a second conversation between the same two users impossible,
    // even under concurrent requests. Groups leave this field unset.
    participantKey: { type: String },
    groupName: { type: String, trim: true, maxlength: 60 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    lastMessageAt: { type: Date, default: Date.now },
    // Denormalized preview so the conversation list needs no per-conversation message query.
    lastMessage: {
      content: { type: String },
      senderId: { type: Schema.Types.ObjectId, ref: 'User' },
      createdAt: { type: Date },
      // A call record: shown without a "You:" prefix.
      isCall: { type: Boolean },
    },
    // Pinned messages (max 3), shared by all members.
    pins: [
      new Schema(
        {
          messageId: { type: Schema.Types.ObjectId, ref: 'Message', required: true },
          pinnedBy: { type: Schema.Types.ObjectId, ref: 'User' },
          pinnedAt: { type: Date, default: Date.now },
        },
        { _id: false }
      ),
    ],
  },
  { timestamps: true }
);

conversationSchema.index({ participantKey: 1 }, { unique: true, sparse: true });
conversationSchema.index({ participants: 1, lastMessageAt: -1 });

export function makeParticipantKey(idA, idB) {
  return [String(idA), String(idB)].sort().join(':');
}

export const Conversation = mongoose.model('Conversation', conversationSchema);