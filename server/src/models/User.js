import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 50 },
    // Stored lowercase, so uniqueness is case-insensitive.
    username: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      minlength: 3,
      maxlength: 20,
      match: /^[a-z0-9_]+$/,
    },
    // Stored normalized (lowercase, trimmed).
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
    // Never returned by default queries; select it explicitly when verifying a login.
    passwordHash: { type: String, required: true, select: false },
    // Profile photo bytes live in GridFS. avatarVersion changes with every upload, so the URL changes
    // and browsers never show a stale photo.
    avatarFileId: { type: mongoose.Schema.Types.ObjectId, select: false },
    avatarVersion: { type: Date },
  },
  { timestamps: true }
);

export const User = mongoose.model('User', userSchema);
