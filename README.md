# Mingle — Chat App with AI Recaps

Mingle is a full-stack MERN chat application. People sign up with an email and password, start private one-to-one chats, share photos and PDFs, and get an AI-written recap of any conversation powered by Google Gemini.

**🔗 Live demo: https://mingle-let-s-chat.vercel.app/

> To try it: create an account, then open a second account in a private/incognito window and start a chat using the first account's email.

## Features

- Email and password accounts with hashed passwords (bcrypt) and signed JWT sessions
- Profile name and photo updates
- Private one-to-one conversations, started by entering another user's email
- Photo and PDF attachments (up to 12 MB locally, about 4.5 MB on Vercel)
- Edit your own sent messages
- **AI chat recap:** summarizes the last 150 messages into 3–5 bullets with Gemini
- Rate limiting on sign-in and recap requests, plus Helmet security headers
- Responsive layout for desktop and mobile

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite |
| Backend | Node.js, Express 5 |
| Database | MongoDB Atlas, Mongoose |
| AI | Google Gemini (`@google/genai`) |
| Hosting | Vercel (serverless functions) |

## Project structure

```
├── api/index.js        # Vercel entry point for the Express app
├── server/
│   ├── index.js        # Routes: auth, chats, messages, files, AI recap
│   ├── auth.js         # JWT authentication middleware
│   └── models.js       # User, Conversation, Message, StoredFile schemas
├── src/                # React client
├── vercel.json         # Vercel build and routing config
└── .env.example        # Template for environment variables
```

## Environment variables

Copy `.env.example` to `.env` for local development, or add these in your hosting dashboard.

| Name | Required | Description |
|---|---|---|
| `MONGODB_URI` | Yes | MongoDB Atlas connection string, ending in `/mingle?retryWrites=true&w=majority` |
| `JWT_SECRET` | Yes | Long random string (32+ characters) used to sign sessions |
| `GEMINI_API_KEY` | Yes | Key from [Google AI Studio](https://aistudio.google.com/app/apikey) |
| `GEMINI_MODEL` | No | Gemini model name. Defaults to `gemini-3.8-flash`. If it is busy or unavailable, try `gemini-3.1-flash-lite` |
| `CLIENT_ORIGIN` | Local only | Frontend origin for CORS. Defaults to `http://localhost:5173` |
| `PORT` | Local only | API port. Defaults to `4000` |
| `NODE_ENV` | Hosting | Set to `production` when deployed |

Never commit `.env` or put keys in frontend code.

## Run locally

1. Install Node.js 20 or newer.
2. Create a free [MongoDB Atlas](https://www.mongodb.com/cloud/atlas) cluster, add a database user, and allow your IP under Network Access.
3. Copy `.env.example` to `.env` and fill in the values above.
4. Install and start both servers:

   ```sh
   npm install
   npm run dev
   ```

5. Open `http://localhost:5173`. The API runs at `http://localhost:4000`.

## Deploy to Vercel

1. Push this repository to GitHub, with `package.json` at the repository root.
2. In [Vercel](https://vercel.com), choose **Add New → Project** and import the repository.
3. Vercel detects Vite. Build command: `npm run build`. Output directory: `dist`.
4. Add `MONGODB_URI`, `JWT_SECRET`, `GEMINI_API_KEY`, and `NODE_ENV=production` under **Environment Variables**.
5. In MongoDB Atlas, add `0.0.0.0/0` under **Network Access**, because Vercel's IP addresses change.
6. Deploy, then open `/api/health`. It should return `{"status":"ok","database":"connected"}`.
7. If the project is not publicly reachable, turn off **Vercel Authentication** under **Settings → Deployment Protection**.

After changing an environment variable, redeploy for it to take effect.

## API overview

- `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`, `PATCH /api/auth/me`
- `GET /api/conversations`, `POST /api/conversations`
- `GET /api/conversations/:id/messages`, `POST /api/conversations/:id/messages`
- `PATCH /api/conversations/:id/messages/:messageId` (sender only)
- `POST /api/conversations/:id/summarize`
- `GET /api/files/:filename` (signed in and a member of the conversation)
- `GET /api/health`

## Known limitations

- New messages appear after a short delay (up to 8 seconds), because the client polls instead of using WebSockets.
- Uploaded files are stored in MongoDB. On Vercel, requests above about 4.5 MB are rejected, and uploads count toward the Atlas free-tier storage (512 MB).
- Chat text is sent to Google Gemini to produce recaps. Do not use the recap feature for content you would not share with Google.
- Gemini can return temporary `503` or `429` errors at busy times or when free quota runs out. Retry, or switch `GEMINI_MODEL`.
- Not yet included: email verification, password reset, account deletion, and real-time presence.

## Security notes

- Passwords are hashed with bcrypt, and sessions use signed JWTs that expire after 7 days.
- Files are served only to signed-in members of the related conversation.
- Use a unique, long `JWT_SECRET` and an Atlas database user with only the access it needs.

## Ideas for next steps

- Real-time messaging with Socket.IO or a hosted realtime service
- Object storage (for example Cloudflare R2 or S3) for large files
- Automatic fallback to a second Gemini model when the first is busy
- Group chats, read receipts, and message search
