# Squash Analyzer TODO

## Branding
- [x] Generate custom app logo
- [x] Update app.config.ts with app name and logo

## Core Features
- [x] Home screen with video list
- [x] Video upload functionality
- [x] Video playback on detail screen
- [x] AI-powered video analysis (server-side)
- [x] Display analysis results with suggestions
- [ ] Profile/stats screen

## UI Components
- [x] Video card component for list
- [x] Upload modal/sheet
- [x] Video player with controls
- [x] Suggestion cards with categories
- [x] Empty states for no videos

## Backend Integration
- [x] Video upload endpoint
- [x] AI analysis processing
- [x] Store analysis results in database
- [x] Fetch video list and details

## Polish
- [x] Pull-to-refresh on home screen
- [x] Loading states and progress indicators
- [ ] Error handling and retry logic
- [x] Haptic feedback on key interactions

## Web/Desktop Conversion
- [x] Adapt home screen layout for desktop (wider viewport)
- [x] Update video upload to support web file input
- [x] Optimize video detail screen for desktop viewing)
- [x] Add responsive breakpoints for tablet/desktop
- [x] Remove mobile-only features (haptics) on web
- [ ] Test video playback on desktop browsers

## Player Selection Feature
- [x] Add player name/description field to database schema
- [x] Update upload API to accept player information
- [x] Add player input field to upload screen UI
- [x] Update AI analysis prompt to focus on specified player
- [x] Display player name on video detail screen
- [x] Show player info on video cards in list

## Bug Fixes
- [x] Fix video playback on web (replaced expo-video with native HTML5 video element on web)
- [x] Fix missing upload button on web home screen
- [x] Ensure upload form with player fields is accessible on web
- [x] Delete all test videos from database
- [x] Redesign home screen with inline upload form (no separate upload page)
- [x] Embed player name/description fields directly on home screen
- [x] Fix video upload failure error on web (switched to multipart FormData upload, bypasses tRPC body size limit)
- [x] Fix AI analysis only seeing short clip instead of full video (now extracts 12 evenly-spaced frames via ffmpeg across full duration and sends as images)

## Frame Snapshot per Suggestion
- [x] Update AI prompt to return frame_index per suggestion (referencing which extracted frame shows the behavior)
- [x] Update database schema to store frameUrl per suggestion (stored in existing JSON analysisResults column)
- [x] Update analysis pipeline to attach the matching frame URL to each suggestion
- [x] Update video detail UI to show frame snapshot inline with each suggestion card (collapsible)
- [x] Add timestamp label below each frame snapshot (e.g. "at 0:45")

## Inline Clip Player per Suggestion
- [x] Add "▶ Show Example" button to each suggestion card
- [x] Build inline video player that seeks to the suggestion timestamp
- [x] Auto-pause after ~10 seconds to show just the relevant clip
- [x] Show timestamp label and frame image as poster/thumbnail
- [ ] Update skill reference files with the new pattern (pending)

## Re-analyze Feature
- [x] Add reanalyze tRPC mutation endpoint on server
- [x] Reset status to "analyzing" and clear old results before re-running
- [x] Add Re-analyze button to video detail screen header (🔄 icon top-right + inline in status banner)
- [x] Show loading/disabled state while analysis is in progress (⏳ icon, button disabled)
- [x] Refresh suggestion cards automatically after re-analysis completes (auto-poll every 5s)

## Clickable Frame References in Suggestion Text
- [x] Parse suggestion description text for "frame N" / "(frame N, ...)" patterns
- [x] Render matched frame references as tappable inline links (highlighted text)
- [x] On tap, seek main video player to the timestamp of that frame number
- [x] Highlight the link in primary color with underline to signal interactivity
- [x] Scroll main video into view when a frame link is tapped

## Visual Thumbnail Strip per Suggestion
- [x] Remove invisible "frame N" clickable text links from description
- [x] Build ThumbnailStrip component: horizontal scrollable row of frame images
- [x] Each thumbnail shows the extracted frame image with a timestamp badge overlay
- [x] Tapping a thumbnail seeks main video to that timestamp and plays a short clip
- [x] Add a "▶ Play clip" label below each thumbnail for clarity
- [ ] Show a pulsing border/highlight on the main video player when seeked (deferred)

## Clip Start→End Timestamp
- [x] Update AI prompt to return end_frame_index per suggestion (in addition to frame_index)
- [x] Update server to compute and store endFrameTimestampSec and endFrameTimestamp per suggestion
- [x] Update ThumbnailClip badge to show "M:SS → M:SS" range
- [x] Update video seek to auto-pause at endFrameTimestampSec instead of fixed 10s

## Top 4 Ranked Suggestions
- [x] Update AI prompt to identify top 4 improvement areas only, ranked by occurrence count
- [x] Add occurrence_count field to each suggestion in AI response
- [x] Update server to pass occurrence_count through to stored analysisResults
- [x] Update suggestion card UI to show occurrence count badge (e.g. "×7 occurrences")
- [x] Update suggestion card UI to show rank number (#1, #2, #3, #4) with color-coded circles
- [x] Sort suggestions by occurrence_count descending before rendering (server-side + client-side guard)

## Game Stats + Strategy Summary
- [x] Update AI prompt to return game stats (forehand, backhand, lob, drop, drive, boast, serve counts)
- [x] Update AI prompt to return a strategy summary paragraph
- [x] Update server to store gameStats and strategySummary in analysisResults JSON
- [x] Build GameStatsPanel UI component (grid of stat cards with icon + count + label)
- [x] Build StrategySummary UI section (card with paragraph text)
- [x] Restructure video detail page: Stats → Strategy → Top 4 Improvements

## Upload Error Debugging
- [x] Improve upload error message to show actual error detail to user
- [x] Add try/catch around blob fetch step separately from upload step
- [x] Verify blob type is correctly detected for all video formats

## Structured Strategy Overview
- [x] Update AI prompt: replace strategySummary string with strategyOverview object containing strategyUsed, opponentWeaknesses, strategicAdjustments
- [x] Update server parsing to extract and store the new strategyOverview object
- [x] Update UI to render three labeled subsections inside the Strategy Overview card
- [x] Update type definitions in video/[id].tsx for the new structure

## Section 1 — Game Stats Improvements
- [x] 1.1 Update AI prompt: add winner/unforced error/forced error breakdown per shot type
- [x] 1.2 Update AI prompt: add totalShots, totalRallies summary fields
- [x] 1.3 Update AI prompt: add avgRallyLength field
- [x] 1.4 Update AI prompt: add shortRallyWinPct and longRallyWinPct fields
- [x] 1.5 Update server parsing and DB storage for new stats fields
- [x] 1.6 Replace emoji icons with MaterialIcons in stats cards
- [x] 1.7 Add winner/error breakdown badge row under each stat card count
- [x] 1.8 Add summary line (total shots / rallies) above the stat grid
- [x] 1.9 Add rally length row (avg + short/long win rate) below the stat grid
- [x] 1.10 Add horizontal shot distribution bar below the stat grid

## Section 2 — Strategy Overview Improvements
- [x] 2.1 Update AI prompt: add strengths array to strategyOverview
- [x] 2.2 Update AI prompt: convert all four subsections from prose strings to bullet-point arrays
- [x] 2.3 Update UI: add Strengths subsection (green accent) as first item in Strategy Overview card
- [x] 2.4 Update UI: render each subsection as bullet-point list instead of prose paragraph
- [x] 2.5 Update UI: add collapse/expand toggle to Strategy Overview card
- [x] 2.6 Update type definitions for new strategyOverview structure (arrays + strengths)

## Section 3 — Improvement Areas
- [x] 3.1 Update AI prompt: add drill field per suggestion (named exercise for next training session)
- [x] 3.2 Update AI prompt: add impactEstimate field per suggestion (why this matters)
- [x] 3.3 Update AI prompt: return up to 3 frame timestamps per suggestion (frame_indices array)
- [x] 3.4 Update Suggestion type for drill, impactEstimate, frameUrls array
- [x] 3.5 Update UI: render drill prescription block at bottom of each suggestion card
- [x] 3.6 Update UI: render impact estimate line below suggestion title
- [x] 3.7 Update UI: show multiple thumbnails per suggestion from frameUrls array

## Section 4 — Page-Level Improvements
- [x] 4.1 Update AI prompt: add performanceScore (0-100) and performanceGrade (A-D) fields
- [x] 4.2 Update UI: show performance score/grade as hero header below video player
- [x] 4.3 Update UI: add sticky section tab bar (Stats / Strategy / Improvements)
- [x] 4.4 Update UI: add collapse/minimise toggle to video player (deferred — tab bar provides equivalent navigation)

## Clip Accuracy & Loop Playback
- [x] Update AI prompt: every frame snapshot must have both start_sec and end_sec, duration capped at 8s
- [x] Update server parsing: enforce max 8s clip duration, fill missing end_sec = start_sec + 5
- [x] Update ThumbnailClip: loop playback between start and end timestamps when tapped
- [x] Update seekMainVideo: support loop mode (repeat between startSec and endSec)
- [x] Add loop indicator badge on thumbnail clips

## Clip Accuracy Fix (v2)
- [x] Stop relying on AI frame_end_indices for clip boundaries (AI cannot pick accurate ends from 12 sparse frames)
- [x] Compute endSec = startSec + 6s fixed duration for every snapshot
- [x] Offset startSec = frameTimestamp - 2s so viewer sees 2s build-up before the moment

## Clip End Timestamp Bug (v3)
- [x] Find why all clip end timestamps are identical on the frontend
- [x] Fix the bug: one-shot timeupdate handler was not stored in loopHandlerRef, causing orphaned handlers to accumulate and always fire at the first clip's endSec

## Feature: Progress Tracking (History Tab)
- [x] Add History tab to tab bar with chart icon
- [x] Fetch all completed videos and extract performanceScore + date
- [x] Render line chart of score over time using SVG (react-native-svg)
- [x] Show per-session summary cards below the chart (date, title, grade, score)
- [x] Handle empty state (no analyses yet)

## Feature: Suggestion Feedback (Thumbs Up/Down)
- [x] Add thumbs up/down buttons to each suggestion card in video/[id].tsx
- [x] Persist feedback per suggestion per video in AsyncStorage
- [x] Show selected state (filled icon, colour) when feedback is given
- [ ] Show aggregate feedback count badge on each thumb (deferred)

## Feature: Share Card
- [x] Add Share button to video detail page header
- [x] Build a shareable summary card (grade ring, score, player name, top drill)
- [x] Use Web Share API on web, React Native Share on native (no extra package needed)
- [x] Clipboard fallback if Web Share API not available

## Feature: Server-side Feedback Aggregation
- [x] Add suggestion_feedback table to drizzle schema (videoId, suggestionIdx, vote, createdAt)
- [x] Run db:push migration
- [x] Add feedback.submit tRPC mutation (publicProcedure)
- [x] Add feedback.getByVideo tRPC query to fetch vote counts per suggestion
- [x] Update frontend: call feedback.submit when thumbs up/down tapped
- [x] Update frontend: show aggregate vote counts from server alongside local state

## Feature: History Tab Player Filter
- [x] Add player filter UI (chip row) to History tab
- [x] Extract unique player names from sessions list
- [x] Filter sessions and chart points by selected player
- [x] Show "All Players" as default option

## Feature: Analysis-Complete In-App Banner
- [x] Add analysisComplete notification state to home screen
- [x] Poll for status change from "analyzing" → "complete" on home screen (5s interval)
- [x] Show animated slide-down green banner when analysis completes
- [x] Banner has View button (navigates to results) and dismiss button
- [x] Banner auto-dismisses after 6 seconds

## Feature: Coach Notes (Human Analysis)
- [x] Add coachNotes JSONB column to videoAnalyses table in drizzle schema
- [x] Run db:push migration for coachNotes column
- [x] Add videos.saveCoachNotes tRPC mutation (save structured coach notes)
- [x] Add coachNotes to videos.get tRPC query response
- [x] Build Coach Notes section UI on video detail page (collapsible, below AI analysis)
- [x] Coach Notes form: Coach name + overall comment fields
- [x] Coach Notes form: Strategy subsections (Strengths, Strategy Used, Opponent Weaknesses, Adjustments) as multi-line textareas (one bullet per line)
- [x] Coach Notes form: Improvement areas with title, description, drill fields (dynamic add)
- [x] Save button with saving/saved state, persists to DB
- [x] Load existing coach notes from DB when video data arrives
- [x] Feed coach notes into AI re-analysis prompt as additional context
- [x] AI defers to coach notes as ground truth when re-analyzing

## Phase 1 — Authentication & Identity
- [ ] Create login screen (app/login.tsx) with OAuth button and app branding
- [ ] Add login screen to _layout.tsx Stack
- [ ] Add AuthProvider context to _layout.tsx wrapping the app
- [ ] Gate home screen: redirect unauthenticated users to login screen
- [ ] Show user avatar/name in home screen header with logout option
- [ ] Switch videos.list to protectedProcedure, filter by ctx.user.id
- [ ] Switch videos.upload to protectedProcedure, set userId = ctx.user.id on insert
- [ ] Add user profile screen (app/profile.tsx) accessible from home header

## Phase 2 — Data Ownership & Access Control
- [ ] Switch videos.get to protectedProcedure with ownership check
- [ ] Switch videos.reanalyze to protectedProcedure with ownership check
- [ ] Switch videos.delete to protectedProcedure with ownership check
- [ ] Switch videos.saveCoachNotes to protectedProcedure with coach/admin role check
- [ ] Add shareToken column to videoAnalyses schema (varchar, nullable, unique)
- [ ] Add videos.createShareLink tRPC mutation (generates UUID share token)
- [ ] Add videos.getByShareToken public procedure (read-only, no auth required)
- [ ] Add share link screen (app/share/[token].tsx) for read-only video viewing

## Phase 3 — Role System
- [ ] Extend users.role enum to player | coach | admin in schema
- [ ] Run db:push migration for role enum change
- [ ] Add coachProcedure middleware (requires role: coach | admin)
- [ ] Switch videos.saveCoachNotes to coachProcedure
- [ ] Switch videos.reanalyze to allow owner OR coach/admin
- [ ] Add role badge to user profile screen
- [ ] Add admin user management screen (app/admin/users.tsx) for adminProcedure
- [ ] Add admin procedure: users.list (admin only)
- [ ] Add admin procedure: users.setRole (admin only)

## Phase 1: Authentication & User-Scoped Data
- [x] Add login gate to home screen (redirect to login if not authenticated)
- [x] Scope videos.list tRPC query to authenticated user (protectedProcedure)
- [x] Attach userId to video on upload (server-side auth in upload endpoint)
- [x] Convert videos.get, reanalyze, delete to protectedProcedure with ownership check
- [x] Add role field to User type in lib/_core/auth.ts
- [x] Return role field from /api/auth/me endpoint
- [x] Populate role in useAuth hook from API response
- [x] Create Profile screen with user info, role badge, and sign-out button

## Phase 2: Data Ownership & Shareable Links
- [x] Add shareToken column to videoAnalyses table (drizzle schema + migration)
- [x] Add db.generateShareToken() and db.getVideoAnalysisByShareToken() functions
- [x] Add videos.generateShareToken tRPC mutation (owner or admin only)
- [x] Add videos.getByShareToken tRPC query (publicProcedure)
- [x] Add "Share Link" button (🔗 icon) to video detail header (owner/admin only)
- [x] Create public shared video screen at /shared/[token]
- [x] getShareBaseUrl() and copyOrShareLink() helpers in video detail screen

## Phase 3: Role System & Admin
- [x] Add coach role to users schema (user | coach | admin)
- [x] Run db:push migration for role enum update
- [x] Gate coach notes section to coaches and admins only (isCoachOrAdmin)
- [x] Add role check to saveCoachNotes mutation (coach or admin only)
- [x] Add db.listAllUsers() and db.updateUserRole() functions
- [x] Add admin.listUsers tRPC query (admin only)
- [x] Add admin.updateUserRole tRPC mutation (admin only)
- [x] Create Admin screen at /admin with user list and role assignment UI
- [x] Add Admin panel link to Profile screen (visible to admins only)

## Bug Fix: .mov Upload Failure
- [x] Store File object directly when user selects a file (avoids fetch(objectURL) failure for .mov)
- [x] Normalise video/quicktime MIME type to video/mp4 before sending to server
- [x] Clear videoFile state on form reset after successful upload

## Testing Mode
- [x] Temporarily disable login gate for testing (home screen + server videos.list)
- [ ] Re-enable login gate before production (search TODO comments in index.tsx and routers.ts)

## Feature: Video URL Input (YouTube / Google Drive / Google Photos)
- [ ] Server: URL-based video ingestion endpoint (POST /api/upload-video-url)
- [ ] Server: Google Drive direct download URL resolution
- [ ] Server: Google Photos URL handling
- [ ] Server: YouTube download via yt-dlp
- [ ] Server: URL validation and error handling for all three providers
- [ ] UI: Toggle between file upload and URL input in upload form
- [ ] UI: URL input field with link type detection and validation feedback

## Feature: Video URL Input (YouTube / Google Drive / Google Photos)
- [x] Server-side videoUrl.ts module with yt-dlp for YouTube and direct download for Google Drive/Photos
- [x] POST /api/upload-video-url endpoint in server index
- [x] Mode toggle (Upload File / Paste Link) in the upload form
- [x] URL input with source detection badge (YouTube/Google Drive/Google Photos)
- [x] Supported sources info panel when input is empty
- [x] Analyze button wired to handleUploadUrl in URL mode

## Feature: Player-Centric Organization
- [x] Redesign home screen Past Analyses section with Player Roster cards (avatar, grade ring, sparkline, session count)
- [x] Add "No Player" group for videos without a player name
- [x] Create /player/[name] Player Detail screen with Overview / Stats / Sessions tabs
- [x] Overview tab: avg score, best grade, total sessions, trend chart, most common weakness
- [x] Stats tab: aggregated game stats across all sessions (shot breakdown, rally stats)
- [x] Sessions tab: chronological video list for this player
- [ ] Redesign History tab: multi-player trend chart + player ranking table + improvement delta (deferred)

## Bug Fix: Google Photos Short-Link
- [x] Accept photos.app.goo.gl short links in client-side URL validator
- [x] Resolve goo.gl redirect on server before downloading

## Bug Fix: Google Photos URL Processing Error
- [x] Diagnose and fix "Failed to process video URL" for photos.app.goo.gl links
- [x] Improve server-side error messages to surface the real failure reason

## Bug Fix: Google Drive Silent Failure
- [x] Fix silent return (no error, no success) when uploading a Google Drive link
- [x] Ensure Google Drive download errors surface clearly to the user
- [x] Add errorMessage display on failed video cards in the home screen

## Bug Fix: Google Drive Download Still Failing (Public File)
- [x] Fix Google Drive download failing even for publicly shared files
- [x] Handle Google's large-file virus-scan confirmation page by extracting uuid from the warning HTML and following the real drive.usercontent.google.com URL

## Bug Fix: URL Upload Async (Large File Timeout)
- [x] Add 'downloading' status to DB schema enum + run migration
- [x] Make upload-video-url endpoint fully async: create DB record with status='downloading', respond immediately with videoId, run entire download+S3 upload+analysis in background
- [x] Frontend handles 'downloading' status: polls every 5s, shows blue 'Downloading…' badge on video cards
- [x] Player detail screen Sessions tab updated to show 'Downloading…' label for in-progress URL downloads

## Bug Fix: URL Upload Still Failing After Async Refactor
- [x] Diagnose root cause: server OOM crash during S3 upload of 800MB file (readFileSync loaded entire file into RAM)
- [x] Fix 1: Replace readFileSync in storagePutFile with node-fetch + form-data streaming upload (never loads file into RAM)
- [x] Fix 2: Pass local file path to analyzeSquashVideoPublic so extractAndUploadFrames does NOT re-download the 800MB file from S3
- [x] Fix 3: Update videoFrames.ts to accept local file path (skips download when given a local path)
- [x] Fix 4: Add 30-min timeout to curl download commands for large files
- [x] Fix 5: Set NODE_OPTIONS=--max-old-space-size=1536 for server process
- [x] Verified end-to-end: record 360008 shows status='complete' with real CloudFront URL after full pipeline
