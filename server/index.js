import 'dotenv/config';
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI } from '@google/genai';
import { Conversation, Message, User, StoredFile } from './models.js';
import { requireAuth } from './auth.js';

const app = express();
const port = Number(process.env.PORT || 4000);
const here = path.dirname(fileURLToPath(import.meta.url));
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' }));
app.use(express.json({ limit: '1mb' }));

// Cache the MongoDB connection so serverless invocations reuse it.
let dbPromise;
function connectDb() {
  if (!process.env.MONGODB_URI || !process.env.JWT_SECRET) throw new Error('Set MONGODB_URI and JWT_SECRET in your environment variables.');
  dbPromise ??= mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 }).catch(error => { dbPromise = undefined; throw error; });
  return dbPromise;
}
app.use('/api', async (_req, res, next) => {
  try { await connectDb(); next(); } catch (error) { console.error('Database connection failed:', error.message); res.status(503).json({ error: 'Database is not available. Check MONGODB_URI and Atlas network access.' }); }
});

const safeExtensions = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/avif': '.avif', 'application/pdf': '.pdf' };
// Vercel's filesystem is read-only/ephemeral, so uploads are kept in MongoDB instead of on disk.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 }, fileFilter: (_req, file, cb) => safeExtensions[file.mimetype] ? cb(null, true) : cb(Object.assign(new Error('Only photos and PDF files are supported.'), { status: 400 })) });
async function saveUpload(file) {
  const filename = `${randomUUID()}${safeExtensions[file.mimetype] || ''}`;
  await StoredFile.create({ filename, mimeType: file.mimetype, size: file.size, data: file.buffer });
  return filename;
}
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false });
const summaryLimiter = rateLimit({ windowMs: 60 * 1000, limit: 8, standardHeaders: 'draft-8', legacyHeaders: false });
const publicUser = user => ({ id: user._id, name: user.name, email: user.email, photo: user.photo || '' });
const signToken = user => jwt.sign({ sub: user._id.toString() }, process.env.JWT_SECRET, { expiresIn: '7d' });
const isMember = (conversation, userId) => conversation.participants.some(person => (person._id ?? person).toString() === userId.toString());

app.get('/api/health', (_req, res) => res.json({ status: 'ok', database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' }));
app.post('/api/auth/register', authLimiter, async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    if (name.length < 1 || name.length > 50) return res.status(400).json({ error: 'Enter a name up to 50 characters.' });
    if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (password.length < 8) return res.status(400).json({ error: 'Use a password with at least 8 characters.' });
    if (await User.exists({ email })) return res.status(409).json({ error: 'That email already has an account.' });
    const user = await User.create({ name, email, passwordHash: await bcrypt.hash(password, 12) });
    res.status(201).json({ token: signToken(user), user: publicUser(user) });
  } catch (error) { res.status(500).json({ error: 'Could not create the account.' }); }
});
app.post('/api/auth/login', authLimiter, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const user = await User.findOne({ email });
  if (!user || !(await bcrypt.compare(String(req.body.password || ''), user.passwordHash))) return res.status(401).json({ error: 'Email or password does not match.' });
  res.json({ token: signToken(user), user: publicUser(user) });
});
app.get('/api/auth/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));
app.patch('/api/auth/me', requireAuth, upload.single('photo'), async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name || name.length > 50) return res.status(400).json({ error: 'Enter a name up to 50 characters.' });
  req.user.name = name;
  if (req.file) req.user.photo = `/uploads/${await saveUpload(req.file)}`;
  await req.user.save();
  res.json({ user: publicUser(req.user) });
});
app.get('/api/files/:filename', requireAuth, async (req, res) => {
  const filename = req.params.filename;
  if (!/^[\w-]+\.(?:jpg|png|webp|gif|avif|pdf)$/.test(filename)) return res.sendStatus(404);
  const storedPath = `/uploads/${filename}`;
  let allowed = req.user.photo === storedPath;
  if (!allowed) {
    const conversations = await Conversation.find({ participants: req.user._id }).select('_id').lean();
    allowed = Boolean(await Message.exists({ conversation: { $in: conversations.map(item => item._id) }, 'attachment.url': storedPath }));
  }
  if (!allowed) return res.sendStatus(404);
  const file = await StoredFile.findOne({ filename }).lean();
  if (!file) return res.sendStatus(404);
  res.set({ 'Cache-Control': 'private, no-store', 'Content-Type': file.mimeType });
  res.send(Buffer.from(file.data.buffer));
});

app.get('/api/conversations', requireAuth, async (req, res) => {
  const conversations = await Conversation.find({ participants: req.user._id }).populate('participants', 'name email photo').sort({ updatedAt: -1 });
  const result = await Promise.all(conversations.map(async conversation => {
    const other = conversation.participants.find(person => person._id.toString() !== req.user._id.toString());
    const last = await Message.findOne({ conversation: conversation._id }).sort({ createdAt: -1 }).lean();
    return { id: conversation._id, person: other ? publicUser(other) : null, lastMessage: last ? (last.text || last.attachment?.name || 'Attachment') : '', updatedAt: conversation.updatedAt };
  }));
  res.json({ conversations: result });
});
app.post('/api/conversations', requireAuth, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const person = await User.findOne({ email }).select('_id name email photo');
  if (!person) return res.status(404).json({ error: 'No Mingle account exists for that email yet.' });
  if (person._id.equals(req.user._id)) return res.status(400).json({ error: 'You cannot start a chat with yourself.' });
  const ids = [req.user._id, person._id].sort((a, b) => a.toString().localeCompare(b.toString()));
  let conversation = await Conversation.findOne({ participants: { $all: ids, $size: 2 } });
  if (!conversation) conversation = await Conversation.create({ participants: ids });
  res.status(201).json({ conversation: { id: conversation._id, person: publicUser(person), lastMessage: '' } });
});
app.get('/api/conversations/:id/messages', requireAuth, async (req, res) => {
  const conversation = await Conversation.findById(req.params.id);
  if (!conversation || !isMember(conversation, req.user._id)) return res.status(404).json({ error: 'Conversation not found.' });
  const messages = await Message.find({ conversation: conversation._id }).populate('sender', 'name photo').sort({ createdAt: 1 }).limit(500);
  res.json({ messages });
});
app.post('/api/conversations/:id/messages', requireAuth, upload.single('attachment'), async (req, res) => {
  const conversation = await Conversation.findById(req.params.id);
  if (!conversation || !isMember(conversation, req.user._id)) return res.status(404).json({ error: 'Conversation not found.' });
  const text = String(req.body.text || '').trim();
  if (!text && !req.file) return res.status(400).json({ error: 'Write a message or attach a file.' });
  const attachment = req.file ? { name: req.file.originalname, url: `/uploads/${await saveUpload(req.file)}`, mimeType: req.file.mimetype, size: req.file.size } : undefined;
  const message = await Message.create({ conversation: conversation._id, sender: req.user._id, text, attachment });
  conversation.updatedAt = new Date();
  await conversation.save();
  await message.populate('sender', 'name photo');
  res.status(201).json({ message });
});
app.patch('/api/conversations/:id/messages/:messageId', requireAuth, async (req, res) => {
  const conversation = await Conversation.findById(req.params.id);
  if (!conversation || !isMember(conversation, req.user._id)) return res.status(404).json({ error: 'Conversation not found.' });
  const message = await Message.findOne({ _id: req.params.messageId, conversation: conversation._id });
  if (!message || !message.sender.equals(req.user._id)) return res.status(404).json({ error: 'Message not found or you cannot edit it.' });
  const text = String(req.body.text || '').trim();
  if (!text || text.length > 5000) return res.status(400).json({ error: 'Edited messages must contain 1–5000 characters.' });
  message.text = text;
  message.editedAt = new Date();
  await message.save();
  conversation.updatedAt = new Date();
  await conversation.save();
  await message.populate('sender', 'name photo');
  res.json({ message });
});
app.post('/api/conversations/:id/summarize', requireAuth, summaryLimiter, async (req, res) => {
  if (!process.env.GEMINI_API_KEY) return res.status(503).json({ error: 'Gemini is not configured yet. Add GEMINI_API_KEY to the server environment.' });
  const conversation = await Conversation.findById(req.params.id).populate('participants', 'name');
  if (!conversation || !isMember(conversation, req.user._id)) return res.status(404).json({ error: 'Conversation not found.' });
  const messages = await Message.find({ conversation: conversation._id }).populate('sender', 'name').sort({ createdAt: -1 }).limit(150);
  if (!messages.length) return res.status(400).json({ error: 'There are no messages to summarize.' });
  const transcript = messages.reverse().map(message => `${message.sender.name}: ${message.text || `[shared ${message.attachment?.mimeType === 'application/pdf' ? 'PDF' : 'image'}: ${message.attachment?.name || 'file'}]`}`).join('\n').slice(-50000);
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const result = await ai.interactions.create({
      model: process.env.GEMINI_MODEL || 'gemini-3.8-flash',
      input: `Summarize this private chat in 3-5 concise bullets. Include decisions, plans, open questions, and useful dates if present. Do not invent details.\n\n${transcript}`
    });
    res.json({ summary: result.output_text || 'Gemini did not return a summary.' });
  } catch (error) {
    console.error('Gemini summary failed:', error.message);
    res.status(502).json({ error: 'Gemini could not summarize this chat right now.' });
  }
});

// On Vercel the built client is served by Vercel itself; only self-host with Express elsewhere.
if (process.env.NODE_ENV === 'production' && !process.env.VERCEL) {
  const clientDist = path.resolve(here, '../dist');
  app.use(express.static(clientDist));
  app.get('/{*path}', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

app.use((err, _req, res, _next) => {
  console.error(err.message);
  const status = err instanceof multer.MulterError ? 400 : (err.status || 500);
  res.status(status).json({ error: err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE' ? 'Files must be 12 MB or smaller.' : 'The request could not be completed.' });
});

export default app;

if (!process.env.VERCEL) {
  connectDb()
    .then(() => app.listen(port, () => console.log(`Mingle API listening at http://localhost:${port}`)))
    .catch(error => { console.error(error.message); process.exit(1); });
}
