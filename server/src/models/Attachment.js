import mongoose from 'mongoose';

const { Schema } = mongoose;

// Metadata for a file shared in a conversation. The bytes live in GridFS (`fileId`).
// An attachment starts "pending" (messageId null) when uploaded and becomes part of the
// conversation only when a message that references it is stored. Pending ones expire.
const attachmentSchema = new Schema(
  {
    uploaderId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    conversationId: { type: Schema.Types.ObjectId, ref: 'Conversation', required: true },
    messageId: { type: Schema.Types.ObjectId, ref: 'Message', default: null },
    kind: { type: String, enum: ['image', 'video', 'document'], required: true },
    filename: { type: String, required: true, maxlength: 120 },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    width: { type: Number },
    height: { type: Number },
    fileId: { type: Schema.Types.ObjectId, required: true },
    sentAt: { type: Date },
  },
  { timestamps: true }
);

// Shared media / documents listing for a conversation.
attachmentSchema.index({ conversationId: 1, messageId: 1, kind: 1, _id: -1 });
// Expiring unsent uploads.
attachmentSchema.index({ messageId: 1, createdAt: 1 });

export const Attachment = mongoose.model('Attachment', attachmentSchema);
