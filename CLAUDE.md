# Squash Analyzer — Claude Code Setup Guide

AI-powered squash game video analysis mobile app built with **Expo SDK 54**, **React Native**, **TypeScript**, and **tRPC**.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Mobile | Expo SDK 54, React Native 0.81, TypeScript |
| Routing | Expo Router 6 (file-based) |
| Styling | NativeWind 4 (Tailwind CSS for React Native) |
| API | tRPC 11 + TanStack Query |
| Backend | Express.js + TypeScript (`server/` directory) |
| Database | MySQL + Drizzle ORM |
| Storage | S3-compatible (AWS) |
| AI | OpenAI GPT-4o Vision (frame analysis) |
| Video DL | yt-dlp + curl (Google Drive support) |

---

## Prerequisites

- **Node.js** 22+ and **pnpm** 9+
- **MySQL** 8+ running locally or via Docker
- **ffmpeg** and **ffprobe** installed (`brew install ffmpeg` on macOS)
- **yt-dlp** installed (`brew install yt-dlp` on macOS)
- **Expo Go** app on your phone for mobile testing

---

## Quick Start

### 1. Install dependencies

```bash
pnpm install
```

### 2. Set up environment variables

Copy the example env file and fill in your values:

```bash
cp .env.example .env
```

Required variables (see `.env.example` for full list):

```env
# Database
DATABASE_URL=mysql://root:password@localhost:3306/squash_analyzer

# AWS S3 (for video and frame storage)
AWS_ACCESS_KEY_ID=your_key
AWS_SECRET_ACCESS_KEY=your_secret
AWS_REGION=us-east-1
AWS_S3_BUCKET=your-bucket-name
AWS_CLOUDFRONT_URL=https://your-cloudfront-domain.cloudfront.net

# OpenAI (for video frame analysis)
OPENAI_API_KEY=sk-...

# JWT secret (any random string)
JWT_SECRET=your-random-secret-here
```

### 3. Run database migrations

```bash
pnpm db:push
```

### 4. Start the development servers

```bash
pnpm dev
```

This starts:
- **Metro bundler** on port 8081 (Expo app)
- **API server** on port 3000 (Express + tRPC)

### 5. Open the app

- **Web**: http://localhost:8081
- **Mobile**: Scan the QR code with Expo Go

---

## Project Structure

```
app/                    ← Expo Router screens
  (tabs)/
    _layout.tsx         ← Tab bar config
    index.tsx           ← Home screen (video list + upload)
  player/
    [name].tsx          ← Player detail screen
  video/
    [id].tsx            ← Video analysis detail screen
  _layout.tsx           ← Root layout

server/                 ← Express backend
  _core/
    index.ts            ← Main server entry point + all HTTP routes
  routers.ts            ← tRPC router definitions
  db.ts                 ← Database query functions
  storage.ts            ← S3 file upload/download (streaming)
  videoUrl.ts           ← Google Drive download + yt-dlp
  videoFrames.ts        ← ffmpeg frame extraction + S3 upload
  analyze.ts            ← OpenAI GPT-4o frame analysis
  schema.ts             ← Drizzle ORM schema (also in drizzle/)

drizzle/
  schema.ts             ← Database schema (source of truth)
  migrations/           ← Auto-generated SQL migrations

components/             ← Shared React Native components
hooks/                  ← Custom hooks (useColors, useAuth, etc.)
constants/              ← Theme colors
```

---

## Key Features

### Video Upload
- **File upload**: Pick a video from device gallery
- **Google Drive URL**: Paste a Google Drive share link (async download)

### Analysis Pipeline
1. Video downloaded to temp dir (`/tmp/squash-url-*`)
2. Frames extracted with ffmpeg (every N seconds)
3. Frames uploaded to S3
4. OpenAI GPT-4o analyzes each frame
5. Results aggregated and stored in DB
6. Temp files cleaned up

### Video Status Flow
```
pending → downloading → analyzing → complete
                    ↘ failed
```

### Player Tracking
- Players are extracted from video titles (format: "Player1 vs Player2")
- Stats aggregated across all sessions per player
- Performance trends tracked over time

---

## Known Issues & TODOs

See `todo.md` for the full list. Key items:

- **YouTube downloads blocked**: Cloud server IPs are banned by YouTube. Use Google Drive instead.
- **Authentication disabled**: `protectedProcedure` replaced with `publicProcedure` in `routers.ts` for testing. Search for `TODO: restore` to re-enable.
- **Temp file cleanup**: `/tmp/squash-url-*` directories accumulate. Add a cron job to clean up files older than 1 hour.
- **Delete button on web**: `Alert.alert` is a no-op on web — needs `Platform.OS === 'web'` check with `window.confirm`.

---

## Environment Variables Reference

| Variable | Description | Required |
|----------|-------------|----------|
| `DATABASE_URL` | MySQL connection string | Yes |
| `AWS_ACCESS_KEY_ID` | AWS access key | Yes |
| `AWS_SECRET_ACCESS_KEY` | AWS secret key | Yes |
| `AWS_REGION` | AWS region | Yes |
| `AWS_S3_BUCKET` | S3 bucket name | Yes |
| `AWS_CLOUDFRONT_URL` | CloudFront CDN URL for serving files | Yes |
| `OPENAI_API_KEY` | OpenAI API key for GPT-4o Vision | Yes |
| `JWT_SECRET` | Secret for signing JWT tokens | Yes |
| `PORT` | API server port (default: 3000) | No |
| `EXPO_PORT` | Metro bundler port (default: 8081) | No |

---

## Development Notes

### Adding a new tRPC procedure

1. Add the function to `server/db.ts`
2. Add the procedure to `server/routers.ts`
3. Call it from the frontend with `trpc.procedureName.useQuery()` or `useMutation()`

### Database schema changes

1. Edit `drizzle/schema.ts`
2. Run `pnpm db:push` to apply migrations

### Styling

Uses NativeWind (Tailwind CSS). Theme colors defined in `theme.config.js`. Use `className` on React Native components.

### Important: Pressable nesting

**Never nest a `Pressable` inside another `Pressable`** — React Native swallows inner presses. If you need a tappable element inside a tappable card, make them siblings in a `View`, not nested.
