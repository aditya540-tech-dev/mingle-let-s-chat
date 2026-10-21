# Mingle — MERN chat app

Mingle is a React + Vite client with an Express/Node API and MongoDB persistence. It includes email/password accounts, profile updates, private photo/PDF uploads, one-to-one chats, and a Gemini chat recap endpoint. The Gemini key stays on the server.

## Run locally

1. Install Node.js 20 or newer.
2. Create a MongoDB Atlas cluster, a database user, and allow your development IP in Atlas Network Access. Copy the cluster connection string.
3. Copy `.env.example` to `.env` in this folder. Set `MONGODB_URI`, a long random `JWT_SECRET`, and the Gemini key. Keep `.env` private and out of Git.
4. Install packages and start both servers:

   ```sh
   npm install
   npm run dev
   ```

5. Open `http://localhost:5173`. The API runs at `http://localhost:4000`.

To create a Gemini key, use [Google AI Studio API keys](https://aistudio.google.com/app/apikey), then place it in `.env` as `GEMINI_API_KEY`. The default model is `gemini-3.8-flash`; change `GEMINI_MODEL` if you want another model available to your account. The recap route returns a clear setup error until the key is configured.

## Production build

Run `npm run build`, then set `NODE_ENV=production` and start with `npm start`. Express serves the built client and API from the same service. Configure these server environment variables in your hosting provider: `MONGODB_URI`, `JWT_SECRET`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `CLIENT_ORIGIN`, `NODE_ENV`, and `PORT`.

For Render, create a Node web service rooted at this folder, use `npm install && npm run build` as the build command and `npm start` as the start command. Add environment variables through the Render dashboard; do not commit `.env` or put API keys in Vite variables.

## Data and security notes

- Passwords are hashed with bcrypt; API sessions use signed JWTs.
- Gemini summaries require a signed-in participant and are rate-limited. Chat transcripts are sent to Google Gemini to produce the recap.
- Uploaded files are limited to 12 MB and supported photo formats or PDF. File routes check the signed-in user's membership before serving an upload.
- This starter stores uploads on the server's local disk. For a multi-instance or ephemeral host such as Render, connect private object storage before relying on uploads in production; local uploads may not survive redeploys.
- Use HTTPS in production, a unique long JWT secret, an Atlas database user with least privilege, and a restricted Atlas IP allowlist. Add email verification, password reset, and account deletion before a public launch.

## API overview

- `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`, `PATCH /api/auth/me`
- `GET /api/conversations`, `POST /api/conversations`
- `GET /api/conversations/:id/messages`, `POST /api/conversations/:id/messages`
- `PATCH /api/conversations/:id/messages/:messageId` (sender only)
- `POST /api/conversations/:id/summarize`
- `GET /api/files/:filename` (authenticated, conversation-member only)

The frontend polls for new messages every eight seconds. Add Socket.IO if you want real-time delivery and presence.

Sent text messages can be edited by their sender; the API rejects edits to another participant's message. The Mingle app starts with an empty people list. Use the plus button to start a conversation with an existing Mingle user's email.

`render.yaml` defines the Render web service. Render will prompt for `MONGODB_URI` and `GEMINI_API_KEY` as private environment variables; add these in the Render dashboard. Create the GitHub repository first, push this folder as the repository root, and connect it to Render. The Render disk is ephemeral in the default configuration, so configure persistent/private storage for uploaded files before production use.
