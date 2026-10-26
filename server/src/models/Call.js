import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * One call between two people of a private conversation.
 *   ringing   -> callee's devices are ringing
 *   ongoing   -> answered, media is flowing
 * Final states:
 *   completed -> answered and then ended (durationSec is set)
 *   missed    -> nobody answered: ring timeout, caller hung up first, or callee was offline
 *   declined  -> callee pressed decline
 *   busy      -> callee (or caller) was already in another call
 *   failed    -> connection never came up / the server restarted mid-call
 */
export const CALL_TYPES = ['voice', 'video'];
export const OPEN_STATUSES = ['ringing', 'ongoing'];

const callSchema = new Schema(
  {
    conversationId: { type: Schema.Types.ObjectId, ref: 'Conversation', required: true },
    callerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    calleeId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: CALL_TYPES, required: true },
    status: { type: String, enum: [...OPEN_STATUSES, 'completed', 'missed', 'declined', 'busy', 'failed'], default: 'ringing' },
    answeredAt: { type: Date },
    endedAt: { type: Date },
    durationSec: { type: Number, default: 0 },
    // Who ended it: 'caller' | 'callee' | 'timeout' | 'server' (for history details only).
    endedBy: { type: String },
    // Missed calls the callee has not looked at yet (drives the badge).
    calleeSeen: { type: Boolean, default: true },
    // "Delete from history" hides a call for that person only.
    hiddenFor: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  },
  { timestamps: true }
);

callSchema.index({ callerId: 1, _id: -1 });
callSchema.index({ calleeId: 1, _id: -1 });
callSchema.index({ calleeId: 1, status: 1, calleeSeen: 1 });
callSchema.index({ status: 1 });

export const Call = mongoose.model('Call', callSchema);
