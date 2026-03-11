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
