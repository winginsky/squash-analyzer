# Squash Game Analyzer - Mobile App Design

## Overview
A mobile app for analyzing squash game videos and providing AI-powered performance suggestions. The app allows users to upload videos, get them analyzed by AI, and receive actionable feedback to improve their game.

## Design Philosophy
- **Mobile-first**: Designed for portrait orientation (9:16) and one-handed usage
- **iOS HIG compliance**: Follows Apple Human Interface Guidelines for a native iOS feel
- **Simple workflow**: Upload → Analyze → Review → Improve

## Screen List

### 1. Home Screen (Main Tab)
**Primary Content:**
- List of analyzed videos (most recent first)
- Each video card shows: thumbnail, title, date, analysis status
- Empty state for new users with upload prompt

**Functionality:**
- Tap video card → navigate to Video Detail screen
- Pull-to-refresh to update list
- Upload button (floating action button or header button)

### 2. Upload Screen (Modal/Sheet)
**Primary Content:**
- Video picker interface
- Selected video preview
- Title input field
- Upload progress indicator

**Functionality:**
- Select video from device library
- Preview selected video
- Add optional title/notes
- Upload to server for analysis

### 3. Video Detail Screen
**Primary Content:**
- Video player with playback controls
- Analysis status indicator
- AI-generated suggestions organized by category:
  - Technique improvements
  - Positioning feedback
  - Shot selection advice
  - Movement patterns

**Functionality:**
- Play/pause video
- View analysis results
- Scroll through suggestions
- Share results (optional)

### 4. Profile/Settings Screen (Secondary Tab)
**Primary Content:**
- User statistics (total videos, analyses completed)
- Settings options
- About/help information

**Functionality:**
- View usage stats
- Adjust app preferences
- Access help/tutorial

## Key User Flows

### Flow 1: Upload and Analyze Video
1. User taps "Upload" button on Home screen
2. Upload sheet appears
3. User selects video from library
4. User adds optional title
5. User taps "Analyze" button
6. Video uploads with progress indicator
7. Sheet dismisses, returns to Home
8. Video appears in list with "Analyzing..." status
9. When complete, status updates to "Complete"

### Flow 2: Review Analysis
1. User taps video card on Home screen
2. Detail screen opens with video player
3. User watches video
4. User scrolls down to view AI suggestions
5. User reads categorized feedback
6. User can return to Home or upload another video

## Color Choices

### Brand Colors
- **Primary**: Deep Squash Court Blue (#0a7ea4) - represents the sport, professional
- **Background Light**: Clean White (#ffffff) - clarity and focus
- **Background Dark**: Deep Charcoal (#151718) - modern, premium
- **Surface Light**: Soft Gray (#f5f5f5) - subtle elevation
- **Surface Dark**: Dark Gray (#1e2022) - depth without harshness
- **Success**: Vibrant Green (#22C55E / #4ADE80) - positive feedback
- **Warning**: Amber (#F59E0B / #FBBF24) - areas to watch
- **Error**: Red (#EF4444 / #F87171) - critical issues

### Usage
- Primary color for CTAs, active states, and key actions
- Success for positive analysis points
- Warning for moderate improvement areas
- Error for critical technique issues
- Muted text for secondary information

## Layout Patterns

### Card Design
- Rounded corners (12-16px)
- Subtle shadows for depth
- Clear hierarchy with bold titles
- Generous padding for touch targets

### Video Cards (Home)
- 16:9 thumbnail
- Title (bold, 16-18px)
- Date and status (muted, 14px)
- Tap target: entire card

### Suggestion Cards (Detail)
- Icon indicating category
- Title (bold, 16px)
- Description (regular, 14px)
- Color-coded border (success/warning/error)

## Typography
- **Headings**: Bold, 24-32px
- **Titles**: Semibold, 16-18px
- **Body**: Regular, 14-16px
- **Captions**: Regular, 12-14px, muted color

## Interaction Design

### Priority Order
1. **Functionality**: Upload, analyze, view results all work
2. **Feedback**: Loading states, progress indicators, status updates
3. **Polish**: Smooth transitions, subtle animations (if time permits)

### Key Interactions
- **Upload button**: Scale feedback (0.97) + light haptic
- **Video card tap**: Opacity (0.7) + navigation
- **Video playback**: Standard video controls
- **Pull-to-refresh**: Standard iOS pattern

## Technical Considerations

### Video Handling
- Use expo-image-picker for video selection
- Use expo-video for playback
- Upload to server for AI analysis
- Store analysis results in database

### Data Storage
- Server-side: Video files, analysis results, user data
- Local cache: Recently viewed videos and analyses

### AI Analysis (Server-side)
- Accept video upload
- Process with AI vision model
- Extract key frames
- Analyze technique, positioning, movement
- Generate structured suggestions
- Return results to app

## Navigation Structure
```
Tab Bar (Bottom)
├── Home (house.fill icon)
│   ├── Video List
│   └── Video Detail (pushed)
└── Profile (person.fill icon)
    └── Settings/Stats

Modals
└── Upload Sheet (presented from Home)
```

## Empty States
- **No videos yet**: Friendly illustration + "Upload your first game" CTA
- **Analysis in progress**: Loading animation + "Analyzing your game..."
- **Analysis failed**: Error message + "Try again" button

## Success Metrics
- User can upload video in < 30 seconds
- Analysis results display clearly and actionably
- App feels responsive and native
- No broken flows or dead ends
