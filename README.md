# SiteYeb / P2M CoreAI Workspace

SiteYeb is a local-first personal productivity workspace with a React frontend and a FastAPI backend. It combines todo management, Pomodoro focus sessions, calendar, notes, local video learning, subtitle transcription, and a local LLM assistant.

## Current Highlights

- VS Code-like workspace shell with sidebar, header actions, notifications, and a resizable AI panel.
- Local multi-user storage with user-prefixed persisted state.
- Video learning station with folder navigation, continue watching, recent watch history, latest videos, custom player controls, subtitles, AI summary, and playlist autoplay.
- Local AI assistant wired for LM Studio compatible chat completion endpoints.
- Whisper/Faster-Whisper transcription settings for model, language, CPU threads, compute type, beam size, VAD, summary, and subtitle correction.
- Theme system with CSS export/import and annotated editable variables.
- Pomodoro logic connected with todos, history, calendar, and dashboard summaries.

## Tech Stack

| Area | Stack |
| --- | --- |
| Frontend | React 19, TypeScript 6, Vite 8 |
| UI | Tailwind CSS, lucide-react |
| State | Zustand persist, IndexedDB/Dexie storage |
| Backend | FastAPI, SQLAlchemy, SQLite |
| Video/AI | ffmpeg, Faster-Whisper, LM Studio/OpenAI-compatible API |
| Tests | Vitest, jsdom |

## Project Structure

```text
SiteYeb/
  src/                  React frontend
    components/         Pages, layout, shared UI
    stores/             Zustand stores
    lib/                API clients, storage, themes, helpers
    hooks/              Cross-module and hydration hooks
    plugins/            Dashboard/plugin registration
    types/              Shared TypeScript types
  backend/app/          FastAPI backend
    routers/            API routes
    services/           scanner, transcription, subtitles, summary
    worker.py           AI job worker
  docs/                 Notes and implementation records
```

Implementation notes:

- [Codex improvement log](docs/codex-improvements.md)
- [Fixes and pitfalls, 2026-05-10](docs/today-fixes-and-pitfalls.md)

Generated runtime files are intentionally ignored: `.env`, SQLite databases, `output/`, `thumbnails/`, `sprites/`, `work/`, and Python virtual environments.

## Development

```bash
npm install
npm run dev
```

Default frontend URL:

```text
http://localhost:5173
```

Start the backend:

```bash
cd backend
.venv311/Scripts/python -m uvicorn app.main:app --host 127.0.0.1 --port 5200
```

Typical local LLM endpoint:

```text
http://127.0.0.1:1234/v1/chat/completions
```

## Quality Checks

```bash
npm run lint
npm test
npm run build
backend/.venv311/Scripts/python -m compileall backend/app
```

Latest verified checks:

- ESLint: pass
- Vitest: 5 files, 31 tests passed
- Production build: pass
- Backend compileall: pass

## Video Station Notes

- "Continue watching" opens the last unfinished video.
- "Recent watch history" previews three videos; clicking the count shows the latest eight watched videos in the main grid, newest first.
- "Latest videos" behaves the same way and shows the latest eight added/scanned videos in the main grid.
- Search and folder navigation automatically return the grid to normal browsing mode.
- Player settings such as volume, mute state, subtitle visibility, subtitle opacity/size, playback rate, and autoplay are persisted.

## Performance Notes

- Startup scan skips full scanning when videos already exist in the database.
- Thumbnail/sprite generation should stay lazy or queued; avoid running large media jobs synchronously during page load.
- Tests use an in-memory storage fallback when IndexedDB is unavailable in jsdom.

## License

MIT
