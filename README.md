# App Functional Summary (Current Phase)

## 1. Login & User Session
- The app starts with a button to access your own session (user authentication or simple entry).
- Once logged in, the user should see only their own songs list — the ones they've added.

## 2. Song List & Adding Songs
- The main screen displays the user's songs.
- At the bottom-right, there's a "+" button.
    - When pressed, it should open a list of existing songs (from the global library).
    - It should also include an option to create a new song.

## 3. Creating a New Song
- When creating a song, the minimum required field is the song title.
- After creation, the song should appear in the user's list.

## 4. Song Detail View
- Each song has associated audio recordings.
- Any user can upload a new audio related to that song (it's collaborative).
- Every user can see all audios linked to that song, not only their own.
- Each audio should have playback controls:
    - Play / Pause / Forward / Rewind

## 5. Song Status Tags
- Songs can have two status tags:
    - Not started (default)
    - Practicing
    - Ready (or "Completed")
- The list view should visually separate songs using these tags, so users can distinguish what they're still practicing from what's already finished.