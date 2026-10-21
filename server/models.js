import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 50 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  photo: { type: String, default: '' }
}, { timestamps: true });

const conversationSchema = new mongoose.Schema({
  participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }],
  updatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

const messageSchema = new mongoose.Schema({
  conversation: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true, index: true },
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  text: { type: String, default: '', maxlength: 5000 },
  editedAt: { type: Date, default: null },
  attachment: { name: String, url: String, mimeType: String, size: Number }
}, { timestamps: true });

const storedFileSchema = new mongoose.Schema({
  filename: { type: String, required: true, unique: true },
  mimeType: String,
  size: Number,
  data: { type: Buffer, required: true }
}, { timestamps: true });

export const User = mongoose.model('User', userSchema);
export const Conversation = mongoose.model('Conversation', conversationSchema);
export const Message = mongoose.model('Message', messageSchema);
export const StoredFile = mongoose.model('StoredFile', storedFileSchema);
