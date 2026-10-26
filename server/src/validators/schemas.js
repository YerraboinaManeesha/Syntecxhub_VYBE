import { z } from 'zod';
import mongoose from 'mongoose';

export const objectId = z
  .string()
  .refine((value) => mongoose.isValidObjectId(value) && String(new mongoose.Types.ObjectId(value)) === value, {
    message: 'Invalid id',
  });

const name = z.string().trim().min(2, 'Name must be at least 2 characters').max(50, 'Name must be at most 50 characters');

const username = z
  .string()
  .trim()
  .regex(/^[a-zA-Z0-9_]{3,20}$/, 'Username must be 3-20 characters: letters, numbers and underscores only')
  .transform((value) => value.toLowerCase());

const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .email('Enter a valid email address');

const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password must be at most 72 characters')
  .regex(/[A-Za-z]/, 'Password must include a letter')
  .regex(/[0-9]/, 'Password must include a number');

export const registerSchema = z
  .object({ name, username, email, password, confirmPassword: z.string() })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export const loginSchema = z.object({
  identifier: z.string().trim().min(1, 'Enter your email or username').max(254),
  password: z.string().min(1, 'Enter your password').max(200),
});

export const updateProfileSchema = z
  .object({ name: name.optional(), username: username.optional() })
  .refine((data) => data.name !== undefined || data.username !== undefined, {
    message: 'Provide a name or username to update',
  });

export const listUsersQuery = z.object({
  q: z.string().trim().max(50).optional().default(''),
  page: z.coerce.number().int().min(1).max(1000).optional().default(1),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
});

export const createConversationSchema = z.object({
  type: z.literal('private').optional().default('private'),
  userId: objectId,
});

export const messagesQuery = z.object({
  before: objectId.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(30),
});

export const createGroupSchema = z.object({
  name: z.string().trim().min(1, 'Group name is required').max(60, 'Group name must be at most 60 characters'),
  memberIds: z.array(objectId).min(1, 'Select at least one member').max(49),
});

export const addMembersSchema = z.object({
  userIds: z.array(objectId).min(1).max(49),
});

// Socket payloads
export const messageSendPayload = z
  .object({
    conversationId: objectId,
    // Content is plain text. Control characters other than newline/tab are stripped.
    // It may be empty only when an attachment is sent with the message.
    content: z
      .string()
      .optional()
      .default('')
      .transform((value) => value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim())
      .refine((value) => value.length <= 4000, 'Message is too long (max 4000 characters)'),
    clientMsgId: z.string().min(8).max(64),
    attachmentId: objectId.optional(),
    replyTo: objectId.optional(),
  })
  .refine((data) => data.content.length > 0 || data.attachmentId, {
    message: 'Message cannot be empty',
    path: ['content'],
  });

export const sharedQuery = z.object({
  group: z.enum(['media', 'documents']).optional().default('media'),
  before: objectId.optional(),
  limit: z.coerce.number().int().min(1).max(60).optional().default(30),
});

export const conversationPayload = z.object({ conversationId: objectId });

export const REACTION_EMOJIS = ['❤️', '😂', '👍', '😮', '😢', '🔥'];

export const editMessageSchema = z.object({
  content: z
    .string()
    .transform((value) => value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim())
    .refine((value) => value.length <= 4000, 'Message is too long (max 4000 characters)'),
});

export const deleteMessageQuery = z.object({ scope: z.enum(['me', 'everyone']) });
export const reactionSchema = z.object({ emoji: z.enum(REACTION_EMOJIS) });

export const callsQuery = z.object({
  before: objectId.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(30),
  filter: z.enum(['all', 'missed', 'incoming', 'outgoing']).optional().default('all'),
  conversationId: objectId.optional(),
});