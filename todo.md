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
