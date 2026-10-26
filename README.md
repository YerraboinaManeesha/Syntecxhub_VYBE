# VYBE — Connect. Chat. Belong.

A real-time messaging app built with the MERN stack and Socket.io: accounts, private chats, group chats, live presence, typing indicators, unread counts and persistent history.

- **Frontend:** React 18, Vite, React Router, custom CSS design tokens, Lucide icons, Socket.io client
- **Backend:** Node 20+, Express, Socket.io, Mongoose, Zod, JWT in HttpOnly cookies, bcryptjs, Helmet, rate limiting
- **Database:** MongoDB (Atlas in production)

## What is built

| Area | Details |
|------|---------|
| Landing page | Your own `Landing.jsx` / `landing.css` layout and text, recoloured to the rose/plum palette |
| Auth | Register, login (email or username), logout, session restore on refresh, generic login errors, rate limiting |
| Discovery | Search users by name or username, paginated, caller excluded, public fields only |
| Private chat | One conversation per pair (enforced by a unique index, safe under concurrent requests) |
| Messaging | Socket.io send with acknowledgement, persisted before it is acknowledged or delivered, idempotent retries, cursor-paginated history |
| Groups | Create, add members, leave, per-member unread, membership checked on every operation |
| Presence | Derived from live authenticated connections; several tabs/devices count as one user; short grace period so a refresh does not flash "offline" |
| Typing | Throttled, relayed only inside authorised rooms, never stored, cleared on disconnect |
| Unread | One `ReadState` per member per conversation; the sender never gets unread for their own messages; synced across a user's sessions |
| Profile | Change display name and username (uniqueness enforced) |
| Profile photos | Upload, change and remove a JPG/PNG/WebP photo (max 5 MB). Shown in the sidebar, conversation list, chat header, messages, group members, contacts and settings. Without a photo a neutral default icon is shown (never a letter) |
| Attachments | A **+** button beside the composer: Photos, Videos, Documents. Preview before sending, upload progress, cancel/remove, send with or without text. Photos show inline (click for a larger view), videos play in the chat, documents are download cards. Delivered in real time and persisted |
| Timestamps | Shown just below each bubble, outside it, on the bubble's side. Hover or click for the full date and time. Date separators between days |
| Profile view | Click a person's photo or name (chat header, a message, group member list, contacts) to see their photo, name, username, online status and the **Media** and **Documents** shared in that conversation, with dates, open/download and a larger preview |
| Theme | "A softer, warmer VYBE": Rose Pink `#E75480`, Plum `#702963`, Blush Pink `#F9A8D4`, Peach Pink `#FFD1B8` on a deep plum-black. All colours are tokens in `client/src/styles/tokens.css` |
| Message status | Under your own messages: **Sending** (animated dot; failed shows Retry), **Sent** (one muted-plum ✓, stored in MongoDB), **Delivered** (two rose ✓✓, only after the recipient's connected, signed-in session acknowledged receiving it; being online is not enough; messages sent while they were offline become Delivered when they next connect), **Read** (two bright rose ✓✓ with a short glow, once the recipient opened the conversation). In groups, Delivered/Read means at least one other member |
| Edit | Own messages only, within 15 minutes, never after deletion. Shows an "Edited" label, updates live for everyone, and refreshes the conversation preview. Captions on photo/file messages can be edited too |
| Delete | **For me**: hides it only for you, at any time, permanently. **For everyone**: sender only, within 1 hour. The message becomes a "This message was deleted" tombstone for all members; its text, reactions, pin and the stored file are removed (not just hidden) and replies quoting it stop showing its text |
| Reply | Quoted preview above the reply (sender and text, or Photo/Video/Document). Click the quote to jump to the original, loading older history if needed. Only live messages of the same conversation can be replied to (checked on the server) |
| Reactions | ❤️ 😂 👍 😮 😢 🔥, one per person per message. Picking another emoji replaces yours; picking the same one removes it. Chips show counts and who reacted; live for everyone |
| Pins | Any member can pin up to 3 messages per conversation. A bar above the chat shows them (tap to jump and cycle, X to unpin), shared by everyone and live. Deleting a message for everyone unpins it |
| Responsive | Desktop three columns, tablet icon sidebar, mobile one view at a time with bottom navigation |

**Not built (on purpose):** email or password change flows, GIF/HEIC/audio uploads, group admin roles, push notifications. The README does not claim them.

## How it was verified

- **148 backend integration tests** (`cd server && npm test`) against a real MongoDB: auth, CSRF, authorization, duplicate prevention under concurrency, idempotent sends, unread, presence across tabs, typing, groups, delivery and read receipts, edit/delete/reply/reaction/pin rules (time windows, ownership, limits, concurrency, live events), plus profile photos, attachment validation and limits, byte-range video requests, per-conversation access to files, shared-media listing and cleanup of abandoned uploads.
- **60 + 75 + 18 + 35 browser checks** with Playwright and Chromium, using separate browser sessions for three users against the real server and database: registration and validation, live delivery, unread badges, typing, presence, persistence after refresh, non-member access blocked, groups, going offline and retrying with no duplicate, profile, logout, mobile layout.
- The second set of 75 covers photo upload/change/remove, previews, photo/video/document delivery and download between two accounts, timestamps, the profile view and shared files, groups, refresh and re-login persistence, and mobile layout. The 18 cover the status ticks end to end (sent, delivered only on a live session, read, offline-then-sync, layout). The 35 cover the message menu, edit, delete for me / for everyone, replies and jump-to-original, reactions, pins and mobile layout. Production build succeeds.

**Not verified:** the actual deployment to Atlas, Render and Vercel (it needs your accounts), and Safari/Firefox. See "Deploy" for the exact steps and the checks to run afterwards.

## Run locally

Requirements: Node.js 20+, and MongoDB (either a local install or a free Atlas cluster).

```bash
# 1. Backend
cd server
cp .env.example .env          # Windows PowerShell: copy .env.example .env
# edit .env: set JWT_SECRET and MONGODB_URI (see below)
npm install
npm run dev                   # http://localhost:5000/api/health

# 2. Frontend (new terminal)
cd client
cp .env.example .env          # leave the values empty for local development
npm install
npm run dev                   # http://localhost:5173
```

Generate a secret for `JWT_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

`MONGODB_URI` can be `mongodb://127.0.0.1:27017/vybe` for a local MongoDB, or your Atlas string.

Always open the app at **http://localhost:5173** (not 127.0.0.1): the server only accepts that exact origin.

In development the Vite server proxies `/api` and `/socket.io` to the backend, so cookies are first-party and nothing else needs configuring.

### Try it with two accounts

1. Open http://localhost:5173 in a normal window and register user one.
2. Open a **private/incognito window** (separate cookies) and register user two.
3. In window one: Contacts, search for user two, click to open the chat, send a message.
4. Window two shows the new conversation, an unread badge, and the message instantly. Reply, and watch the typing indicator and online status.
5. Refresh either window: history and session are restored.

### Run the tests

```bash
cd server
# needs a running MongoDB; uses the database "vybe_test" and drops it afterwards
npm test
# or point at another instance:
TEST_MONGODB_URI=mongodb://127.0.0.1:27017/vybe_test npm test
```

## Architecture

```
vybe/
  client/                      React + Vite
    src/
      components/{common,auth,layout,chat,contacts,landing}
      context/                 Auth, Socket, Chat, Toast providers
      pages/                   Landing, Login, Register, ChatPage, SectionPages
      services/                api.js (REST client), socket.js
      styles/                  tokens.css (design tokens), global.css, landing.css, app.css, auth.css
      utils/                   formatting, validation, conversation helpers
  server/
    src/
      config/                  env + database
      models/                  User, Conversation, Message, ReadState
      routes/                  auth, users, conversations, groups
      services/                conversationService (authorization + persistence), presence
      sockets/                 Socket.io server and emit helpers
      middleware/              auth, csrf, validate, rateLimit, errorHandler
      validators/              Zod schemas
    tests/                     integration tests
  render.yaml                  Render blueprint
```

**Data model.** `User`, `Conversation` (private or group; private ones carry a unique `participantKey`), `Message` (unique on `senderId + clientMsgId` for idempotency, indexed for history), `ReadState` (one per member per conversation; unread = other people's messages newer than `lastReadAt`).

**One message path.** Messages are created only through the `message:send` socket event. REST handles everything else (auth, users, conversations, history, read state).

**Socket events.** Client to server: `conversation:join`, `conversation:leave`, `message:send`, `message:read`, `typing:start`, `typing:stop`. Server to client: `message:new`, `conversation:update`, `message:read:update`, `presence:update`, `typing:update`, `error:notification`. Every payload is validated with Zod; every conversation event checks membership against the database; joining a room is only possible after that check.

## Security notes

- Passwords: bcrypt (12 rounds), hash never selected or returned.
- Sessions: JWT in an **HttpOnly** cookie (`Secure` in production). Nothing sensitive in localStorage; the browser never sees the session token.
- Sockets: authenticate with a separate **60-second** token fetched over the cookie-authenticated API, on every (re)connect. A session token is rejected as a socket token and vice versa.
- CSRF: every state-changing API call must carry `X-Requested-With: vybe` and, if the browser sends an `Origin`, it must equal `CLIENT_ORIGIN`. Cross-origin requests are blocked by CORS.
- Authorization: every conversation, message, group and socket operation checks membership server-side; non-members get 404 so ids cannot be probed.
- Validation: Zod on every REST body/query and every socket payload; search text is regex-escaped.
- Messages are stored and rendered as plain text; the UI never injects HTML.
- Rate limits: login (failed attempts), registration, general API, and per-socket message sending.
- Helmet headers, request size limits, controlled error responses with no stack traces.
- Uploads: the file type is decided from the file's **bytes** (never the name or the browser's claim); only JPG/PNG/WebP, MP4/WebM/MOV and PDF/Word/Excel/PowerPoint/TXT/CSV are accepted. Photos are re-encoded, which proves they decode and strips location/camera metadata. Limits: photos 5 MB, videos 25 MB, documents 10 MB. SVG, HTML, scripts and executables are rejected.
- Serving files: only members of the conversation can fetch an attachment (others get 404), documents are always sent as downloads, and every file is served with `nosniff` and a sandboxing CSP. An upload that is not yet sent is visible only to the person who uploaded it and is deleted after an hour if never sent.

## Deploy (Atlas + Render + Vercel)

Do these in order. Nothing here has been run against your accounts yet, so use the checks at the end.

### 1. MongoDB Atlas (database)

1. Create a free cluster at cloud.mongodb.com.
2. **Database Access:** add a database user with a strong password (read/write on any database).
3. **Network Access:** Render's free tier has no fixed outbound IP, so Atlas needs to allow `0.0.0.0/0`. That is acceptable only because access is protected by the user and password; keep that password strong and never commit it.
4. **Connect, Drivers:** copy the connection string and put your database name before the `?`:
   `mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/vybe?retryWrites=true&w=majority`
   If the password contains special characters, URL-encode them.

### 2. Backend on Render

1. Push this project to GitHub (the `.gitignore` already excludes `.env` files).
2. Render: **New, Blueprint**, select the repository (it reads `render.yaml`). Or create a Web Service manually: root directory `server`, build `npm ci`, start `npm start`, health check `/api/health`.
3. Set the environment variables:
   - `MONGODB_URI`: the Atlas string from step 1
   - `CLIENT_ORIGIN`: your Vercel URL, e.g. `https://vybe-chat.vercel.app` (no trailing slash; you can set a placeholder now and fix it after step 3)
   - `JWT_SECRET`: generated automatically by the blueprint (or set 48+ random bytes yourself)
   - `NODE_ENV=production`, `COOKIE_SAMESITE=lax`
4. Deploy, then open `https://YOUR-SERVICE.onrender.com/api/health`. Expect `{"success":true,...}`.

Render supports WebSockets, so Socket.io works on the same service. Notes: the free tier sleeps after inactivity (the first request after a sleep is slow, and people appear offline while it is asleep). Presence is kept in memory, so run **one** instance; scaling out needs the Socket.io Redis adapter and shared presence.

### 3. Frontend on Vercel

1. Edit `client/vercel.json` and replace `YOUR-RENDER-SERVICE.onrender.com` with your real Render host. This rewrite makes `/api` calls same-site, so the session cookie stays first-party (more reliable than cross-site cookies, which many browsers block).
2. Vercel: **Add New Project**, import the repository, set **Root Directory** to `client`. Framework preset: Vite.
3. Environment variables:
   - `VITE_API_URL`: leave **empty**
   - `VITE_SOCKET_URL`: `https://YOUR-SERVICE.onrender.com` (WebSockets cannot pass through Vercel rewrites, so the socket connects to Render directly using its short-lived token)
4. Deploy. Copy the final Vercel URL, set it as `CLIENT_ORIGIN` on Render, and redeploy the backend.

### 4. Check the live app

Open the Vercel URL in two different browsers (or one normal and one private window) and run through "Try it with two accounts". Also confirm:
- DevTools, Application, Cookies: `vybe_token` is `HttpOnly` and `Secure`.
- Network: WebSocket connects to your Render host (status 101).
- Refresh keeps you signed in; Sign out then visiting `/app` sends you to login.

If sign-in appears to work but you are bounced back to login, the cookie is not being stored: re-check that `vercel.json` points at the right Render URL and that `VITE_API_URL` is empty. If the socket never connects, check `VITE_SOCKET_URL` and that `CLIENT_ORIGIN` exactly matches the Vercel URL.

## Environment variables

`server/.env`

| Variable | Purpose |
|----------|---------|
| `NODE_ENV` | `development` or `production` |
| `PORT` | Port (Render sets it) |
| `CLIENT_ORIGIN` | Exact frontend origin for CORS, sockets and CSRF; `https://` in production |
| `MONGODB_URI` | MongoDB connection string |
| `JWT_SECRET` | 32+ random characters; the server refuses to start without it |
| `COOKIE_SAMESITE` | `lax` (default), `strict` or `none` (`none` forces `Secure`; avoid, see above) |

`client/.env` (only `VITE_` values reach the browser, never put secrets here)

| Variable | Purpose |
|----------|---------|
| `VITE_API_URL` | Empty locally and on Vercel (same-origin `/api`) |
| `VITE_SOCKET_URL` | Empty locally; the Render URL in production |
| `VITE_DEV_BACKEND` | Optional: backend URL for the dev proxy (default `http://localhost:5000`) |

## File storage

Photos, videos and documents are stored in **MongoDB GridFS** (bucket `uploads`), so they survive Render redeploys and need no extra service or environment variables. Metadata (uploader, conversation, message, type, size, dimensions) lives in the `attachments` collection. Profile photos are stored as 256x256 WebP.

Consequences to plan for: a free Atlas cluster has 512 MB, so heavy video use will fill it; videos are streamed with HTTP range requests so seeking works. If you outgrow this, replace `server/src/services/storage.js` (four functions) with S3/Cloudinary.

## Known limitations

- Uploads through the **Vercel `/api` rewrite are not verified.** Vercel may limit request body size on rewrites. Test one large video (about 20 MB) right after deploying. If it fails there but works locally, the fix is to serve the app and the API from the same site (for example `app.example.com` and `api.example.com` on a custom domain) rather than using `SameSite=None`, which browsers increasingly block for the photo and video requests.

- Group receipts show the best status across other members, not per-member detail.
- `client/src/components/landing/ChatPreview.jsx` is no longer used by your landing page and can be deleted.
- Single backend instance (in-memory presence).
- "Online" ignores users who left a tab open but idle.
- Messages hidden with "delete for me" still count in the shared media/documents list of the profile view.
- The 15-minute edit and 1-hour delete windows are enforced on the server but only covered by backend tests (the browser suite cannot wait that long).
- No email/password change or group roles yet. One attachment per message.
- Typing and presence rely on a live connection; after a reconnect the list and open threads are refetched and merged.
