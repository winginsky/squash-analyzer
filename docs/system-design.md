# Squash Analyzer — System Design Document

**Version:** 1.0  
**Date:** March 2026  
**Author:** Manus AI

---

## 1. Overview

Squash Analyzer is a cross-platform mobile and web application that allows players and coaches to upload squash game footage and receive AI-generated coaching feedback. The system extracts evenly-spaced video frames, sends them to a multimodal large language model, and returns a structured analysis covering game statistics, strategic observations, ranked improvement suggestions with drill recommendations, and an overall performance score. Coaches can augment AI output with their own structured notes, which are then incorporated into subsequent re-analyses. Completed analyses can be shared publicly via tokenised links without requiring the recipient to log in.

The application is built on **Expo SDK 54** (React Native + React 19) with an **Express + tRPC** backend, a **MySQL** database via **Drizzle ORM**, and **S3-compatible object storage** for video files and extracted frames.

---

## 2. High-Level Architecture

The system is composed of four logical layers that communicate through well-defined interfaces.

```
┌─────────────────────────────────────────────────────────────┐
│                     Client (Expo / Web)                      │
│  React Native + NativeWind · Expo Router · tRPC React Query │
└────────────────────────┬────────────────────────────────────┘
                         │ HTTPS (tRPC + REST)
┌────────────────────────▼────────────────────────────────────┐
│                  Backend (Express / Node.js)                  │
│  REST: /api/upload-video, /api/auth/*, /api/health           │
│  tRPC: /api/trpc — videos, admin, feedback routers           │
└──────────┬────────────────────────────┬─────────────────────┘
           │ Drizzle ORM (MySQL)        │ S3 Storage Proxy
┌──────────▼──────────┐      ┌──────────▼──────────────────┐
│  MySQL Database      │      │  S3-Compatible Object Store  │
│  users               │      │  videos/{key}.mp4            │
│  video_analyses      │      │  frames/{key}.jpg            │
│  suggestion_feedback │      └─────────────────────────────┘
└─────────────────────┘
           │
┌──────────▼──────────────────────────────────────────────────┐
│              Manus Forge LLM API (Gemini 2.5 Flash)          │
│  POST /v1/chat/completions — multimodal, JSON schema output  │
└─────────────────────────────────────────────────────────────┘
```

The client and server run as a single combined process in development (`pnpm dev` via `concurrently`), with the Metro bundler on port **8081** and the Express API server on port **3000**. In the web browser, `getApiBaseUrl()` derives the API origin by replacing the `8081-` prefix in the hostname with `3000-`, so no environment variable is required for local development.

---

## 3. Technology Stack

| Layer | Technology | Notes |
|---|---|---|
| Mobile / Web UI | Expo SDK 54, React Native 0.81, React 19 | Cross-platform (iOS, Android, Web) |
| Routing | Expo Router 6 (file-based) | Stack + Tab navigation |
| Styling | NativeWind 4 (Tailwind CSS) | Single token system shared with runtime |
| State / Data fetching | TanStack Query + tRPC React Query | Type-safe end-to-end |
| Backend framework | Express 4 + tRPC 11 | REST for upload; tRPC for all other API |
| ORM | Drizzle ORM | MySQL dialect; `drizzle-kit` for migrations |
| Database | MySQL (managed, Manus-hosted) | Three tables: users, video_analyses, suggestion_feedback |
| Object storage | S3-compatible proxy (Manus Forge) | Videos up to 2 GB; JPEG frames |
| AI model | Gemini 2.5 Flash via Manus Forge `/v1/chat/completions` | Multimodal; JSON schema output; 32 768 token limit |
| Video processing | ffmpeg + ffprobe (server-side) | Frame extraction; duration detection |
| Authentication | Manus OAuth 2.0 + session cookie / Bearer token | Cookie for web; Bearer token for native |
| Language | TypeScript 5.9 (strict) | Shared types between client and server |

---

## 4. Data Model

### 4.1 `users`

| Column | Type | Notes |
|---|---|---|
| `id` | `INT AUTO_INCREMENT PK` | Surrogate key used in all relations |
| `openId` | `VARCHAR(64) UNIQUE NOT NULL` | Manus OAuth identifier |
| `name` | `TEXT` | Display name from OAuth provider |
| `email` | `VARCHAR(320)` | Optional; from OAuth profile |
| `loginMethod` | `VARCHAR(64)` | OAuth provider name (e.g. `google`) |
| `role` | `ENUM('user','coach','admin')` | Default `user`; controls feature access |
| `createdAt` | `TIMESTAMP` | Row creation time |
| `updatedAt` | `TIMESTAMP ON UPDATE` | Last modification time |
| `lastSignedIn` | `TIMESTAMP` | Updated on every OAuth callback |

### 4.2 `video_analyses`

| Column | Type | Notes |
|---|---|---|
| `id` | `INT AUTO_INCREMENT PK` | |
| `userId` | `INT` (nullable FK → `users.id`) | `NULL` for anonymous uploads |
| `title` | `VARCHAR(255) NOT NULL` | User-provided label |
| `playerName` | `VARCHAR(255)` | Optional; used in AI prompt |
| `playerDescription` | `TEXT` | Optional; helps AI identify the correct player |
| `videoUrl` | `VARCHAR(1024) NOT NULL` | Public S3 URL of the uploaded video |
| `thumbnailUrl` | `VARCHAR(1024)` | S3 URL of first extracted frame |
| `status` | `ENUM('pending','analyzing','complete','failed')` | Lifecycle state |
| `analysisResults` | `JSON` | Full AI output (see §6.3) |
| `errorMessage` | `TEXT` | Set when `status = 'failed'` |
| `coachNotes` | `JSON` | Coach-entered structured notes (same schema as `analysisResults`) |
| `shareToken` | `VARCHAR(64)` | Random token; `NULL` until share link is generated |
| `createdAt` | `TIMESTAMP` | |
| `updatedAt` | `TIMESTAMP ON UPDATE` | |

### 4.3 `suggestion_feedback`

| Column | Type | Notes |
|---|---|---|
| `id` | `INT AUTO_INCREMENT PK` | |
| `videoId` | `INT NOT NULL` | FK → `video_analyses.id` |
| `suggestionIdx` | `INT NOT NULL` | 0-based index into `analysisResults.suggestions` |
| `vote` | `ENUM('up','down') NOT NULL` | Thumbs up = accurate; thumbs down = inaccurate |
| `sessionKey` | `VARCHAR(128)` | Device-level deduplication key |
| `createdAt` | `TIMESTAMP` | |

---

## 5. Authentication & Authorisation

### 5.1 Authentication Flow

The system uses **Manus OAuth 2.0** with two variants: a browser redirect flow for web and a deep-link flow for native apps.

**Web flow:**
1. User taps "Sign In" → client redirects to `{OAUTH_PORTAL_URL}/app-auth?appId=…&redirectUri=…`.
2. After consent, the portal redirects to `GET /api/oauth/callback?code=…&state=…`.
3. The server exchanges the code for an access token, fetches user info, upserts the `users` row, and issues a **session cookie** (`HttpOnly`, `SameSite=None`, `Secure`, 1-year TTL).
4. The browser is redirected back to the app.

**Native flow:**
1. The app opens the system browser to the same OAuth URL.
2. After consent, the portal redirects to `{deepLinkScheme}://oauth/callback?code=…`.
3. The app's deep-link handler calls `GET /api/oauth/mobile?code=…`, which performs the same exchange and returns `{ app_session_id, user }` in JSON.
4. The session token is stored in `SecureStore` and sent as `Authorization: Bearer <token>` on subsequent requests.

**Session validation** is performed in `sdk.authenticateRequest(req)`, which checks the cookie (web) or Bearer header (native) on every request. The tRPC `createContext` function calls this and attaches the resolved `User | null` to the context.

### 5.2 Role-Based Access Control

Three roles are defined. Access is enforced at the tRPC procedure level, not just in the UI.

| Role | Capabilities |
|---|---|
| `user` | Upload videos, view own videos, delete own videos, generate share links, submit suggestion feedback |
| `coach` | All `user` capabilities + save coach notes on any video |
| `admin` | All `coach` capabilities + list all users, update any user's role, view/delete any video |

Two tRPC middleware factories enforce this:

- **`protectedProcedure`** — throws `UNAUTHORIZED` if `ctx.user` is `null`.
- **`adminProcedure`** — throws `FORBIDDEN` if `ctx.user.role !== 'admin'`.

Row-level ownership checks (e.g. `video.userId !== ctx.user.id`) are applied inside individual procedures for `get`, `delete`, `reanalyze`, `generateShareToken`, and `saveCoachNotes`.

---

## 6. Core Feature: AI Video Analysis

### 6.1 Upload Pipeline

The upload flow is handled by a dedicated REST endpoint (`POST /api/upload-video`) rather than tRPC because multipart form data does not fit the tRPC request model.

```
Client                          Server                         External
  │                               │                               │
  │── POST /api/upload-video ────▶│                               │
  │   (multipart: video, title,   │                               │
  │    playerName, description)   │                               │
  │                               │── multer disk storage ───────▶│ (temp file)
  │                               │── sdk.authenticateRequest()   │
  │                               │── storagePutFile() ──────────▶│ S3
  │                               │◀─ { videoUrl } ───────────────│
  │                               │── db.createVideoAnalysis()    │
  │◀── { id, videoUrl } ──────────│                               │
  │   (response sent immediately) │                               │
  │                               │── analyzeSquashVideoPublic()  │
  │                               │   (async, non-blocking)       │
```

Key design decisions in the upload endpoint:

- **Disk-based multer storage** streams the incoming file to a temp directory rather than buffering it in RAM, supporting videos up to 2 GB without OOM risk.
- The response is sent **before** analysis completes. The client polls `videos.get` until `status` transitions from `analyzing` to `complete` or `failed`.
- The temp file is deleted in the `finally` block regardless of success or failure.
- **MIME normalisation**: `video/quicktime` (`.mov`) is stored as-is but ffmpeg handles it transparently since both H.264 containers are supported.

### 6.2 Frame Extraction

`extractAndUploadFrames(videoUrl, frameCount = 12)` in `server/videoFrames.ts`:

1. Downloads the video from S3 to a temp directory as `video.mp4`.
2. Uses `ffprobe` to determine the video duration in seconds.
3. Calculates 12 evenly-spaced timestamps: `interval × (i + 0.5)` for `i = 0..11`, which avoids the very start and end of the clip.
4. Calls `ffmpeg` for each timestamp to extract a single JPEG frame, scaled to a maximum width of 1280 px.
5. Uploads each JPEG to S3 under `frames/{timestamp}-frame-{i}.jpg` and collects the public URLs.
6. Cleans up the temp directory.

### 6.3 LLM Analysis

`analyzeSquashVideoPublic(videoUrl, playerName, playerDescription, coachNotes?)` in `server/routers.ts`:

The function constructs a two-message conversation for Gemini 2.5 Flash:

**System message** establishes the persona and injects any existing coach notes as ground truth:

> "You are an expert squash coach analyzing game footage. You are given N frames extracted evenly across the full video duration… [If coach notes exist:] IMPORTANT: A human coach has reviewed this player and provided the following notes. You MUST take these into account…"

**User message** instructs the model to produce a structured JSON response covering:

1. Shot counts by type (drives, drops, boasts, lobs, nicks, serves) with winners, unforced errors, and forced errors per type.
2. Aggregate game statistics: `totalShots`, `totalRallies`, `avgRallyLength`, `shortRallyWinPct`, `longRallyWinPct`.
3. A `strategyOverview` object with four arrays of 2–3 bullet strings: `strengths`, `strategyUsed`, `opponentWeaknesses`, `strategicAdjustments`.
4. The **top 4** improvement suggestions ranked by `occurrence_count`, each with: `category`, `title`, `description`, `severity` (low/medium/high), `occurrence_count`, `impactEstimate`, `drill`, and frame index ranges for clip playback.
5. A `performanceScore` (0–100) and `performanceGrade` (A/B/C/D).

The model is invoked with `max_tokens: 32768` and a `thinking.budget_tokens: 128` parameter. The response is parsed from JSON and stored in `video_analyses.analysisResults`.

### 6.4 Re-analysis

`videos.reanalyze` is a `protectedProcedure` that re-runs `analyzeSquashVideoPublic` on an existing video, this time passing any saved `coachNotes` as the fourth argument. This allows the AI output to be regenerated after a coach has added their observations, producing a blended human-AI analysis.

---

## 7. API Reference

### 7.1 REST Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/health` | None | Liveness check; returns `{ ok: true, timestamp }` |
| `POST` | `/api/upload-video` | Optional (cookie / Bearer) | Multipart video upload; returns `{ id, videoUrl }` |
| `GET` | `/api/oauth/callback` | None | Web OAuth callback; sets session cookie |
| `GET` | `/api/oauth/mobile` | None | Native OAuth callback; returns `{ app_session_id, user }` |
| `POST` | `/api/auth/logout` | None | Clears session cookie |
| `GET` | `/api/auth/me` | Optional | Returns `{ user }` for current session |

### 7.2 tRPC Procedures (`/api/trpc`)

All tRPC procedures use **superjson** as the transformer. The full router type is exported as `AppRouter` and consumed by the client via `createTRPCReact`.

**`videos` router**

| Procedure | Type | Auth | Description |
|---|---|---|---|
| `videos.list` | Query | Public* | List video analyses (scoped to user if authenticated) |
| `videos.get` | Query | Protected | Get a single video by ID (owner or admin) |
| `videos.upload` | Mutation | Protected | Create a `pending` record after REST upload |
| `videos.reanalyze` | Mutation | Protected | Re-run AI analysis, incorporating coach notes |
| `videos.delete` | Mutation | Protected | Delete a video (owner or admin) |
| `videos.saveCoachNotes` | Mutation | Protected (coach/admin) | Persist structured coach notes |
| `videos.generateShareToken` | Mutation | Protected | Generate a random share token for a video |
| `videos.getByShareToken` | Query | Public | Retrieve a video by its share token |

*`videos.list` is temporarily set to `publicProcedure` for testing; it should be restored to `protectedProcedure` before production.

**`admin` router**

| Procedure | Type | Auth | Description |
|---|---|---|---|
| `admin.listUsers` | Query | Protected (admin) | List all users with roles |
| `admin.updateUserRole` | Mutation | Protected (admin) | Assign `user`, `coach`, or `admin` role |

**`feedback` router**

| Procedure | Type | Auth | Description |
|---|---|---|---|
| `feedback.submit` | Mutation | Public | Upsert or remove a thumbs up/down vote |
| `feedback.getCounts` | Query | Public | Get aggregated vote counts per suggestion |

---

## 8. Screen Inventory & Navigation

The app uses **Expo Router** file-based routing with a root Stack navigator and a nested Tab navigator for the main experience.

| Route | Screen | Description |
|---|---|---|
| `(tabs)/index` | Home | Upload form + list of past analyses with status badges |
| `(tabs)/history` | History | Full history of all analyses with filtering |
| `login` | Login | OAuth sign-in screen (full-screen modal) |
| `video/[id]` | Video Detail | Full analysis: game stats, strategy overview, suggestions with frame clips, performance score, coach notes (role-gated), share button |
| `shared/[token]` | Shared View | Public read-only analysis view accessible without login |
| `profile` | Profile | User info, sign-out, admin panel link (admin only) |
| `admin` | Admin | User list with role assignment (admin only) |
| `oauth/callback` | OAuth Callback | Handles deep-link OAuth return on native |

---

## 9. Key Design Decisions & Trade-offs

**Async analysis with polling.** The upload endpoint responds immediately after the video is stored, and analysis runs asynchronously. The client polls `videos.get` at a fixed interval until `status` is `complete` or `failed`. This avoids HTTP timeout issues for long videos (analysis can take 60–120 seconds) at the cost of slightly more complex client state management.

**Disk-based multer storage.** Large video files (hundreds of MB to 2 GB) are streamed to a temp directory rather than held in memory. This prevents OOM crashes on the Node.js server at the cost of disk I/O during upload.

**Frame-based analysis instead of full video.** Sending 12 JPEG frames to the LLM rather than the raw video file keeps token usage predictable and avoids the latency and cost of video transcoding. The trade-off is that very fast rallies or brief technique errors between frames may be missed.

**Coach notes as a separate JSON column.** Coach observations are stored in `coachNotes` independently of `analysisResults`. This allows the AI output to be regenerated without losing human annotations, and it enables the system to clearly attribute which insights came from the AI versus the human coach.

**Share tokens without expiry.** Share tokens are random 64-character strings stored in the `shareToken` column. They do not expire by default, which simplifies the implementation but means a shared link remains valid indefinitely. An expiry mechanism (e.g. `shareTokenExpiresAt` column) is a recommended future enhancement.

**Port-fixed server startup.** The Express server always attempts to bind to port 3000 and retries up to 10 times (2-second intervals) if the port is busy, rather than drifting to an alternative port. This is critical because the frontend derives the API URL by replacing `8081` with `3000` in the hostname; any port drift would silently break all API calls.

---

## 10. Known Limitations & Recommended Improvements

| Area | Current State | Recommended Improvement |
|---|---|---|
| Auth gate | Temporarily disabled for testing | Restore `protectedProcedure` on `videos.list` and the login gate in `app/(tabs)/index.tsx` before production |
| Share link expiry | Links never expire | Add `shareTokenExpiresAt TIMESTAMP` column; enforce in `getVideoAnalysisByShareToken` |
| Coach notes on shared links | Always visible | Add `shareCoachNotes BOOLEAN` flag to control visibility on public share pages |
| Upload progress | Text-only status message | Replace with `XMLHttpRequest` progress events and a percentage bar |
| File size feedback | No pre-upload warning | Check `file.size` before upload and warn for files over 200 MB |
| Server resilience | Restarts required after sandbox hibernation | Add a process supervisor (e.g. PM2) or health-check-based auto-restart |
| Role assignment UX | Admin must manually assign roles | Add an email-based coach invite flow that auto-assigns the `coach` role on first login |
| Admin audit log | No history of role changes | Add a `role_changes` table recording who changed what and when |
