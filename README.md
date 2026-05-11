# SiteYeb / P2M CoreAI Workspace

SiteYeb is a local-first personal productivity workspace with a React frontend and a FastAPI backend. It combines todo management, Pomodoro focus sessions, calendar, notes, local video learning, subtitle transcription, and a local LLM assistant.

## Quick Start

### Daily use

```bash
cd backend
.venv311/Scripts/python -m uvicorn app.main:app --host 0.0.0.0 --port 80 --reload
```

- Local: http://localhost
- LAN: use your machine IP on port 80

If you only changed frontend code, run `npm run build` and refresh the browser. You do not need to restart the backend.

### Development

Terminal 1 — 后端（端口 80）:

```bash
cd backend
.venv311/Scripts/python -m uvicorn app.main:app --host 127.0.0.1 --port 80 --reload
```

Terminal 2 — 前端（端口 8000）:

```bash
npm install
npm run dev
```

- 访问 http://localhost:8000 — 改代码自动热更新
- API 自动代理到 80

## 端口说明

| 端口 | 用途 | 访问方式 |
| --- | --- | --- |
| 80 | 生产模式（前端+后端） | http://localhost 或 http://192.168.3.161 |
| 8000 | 开发模式前端（热更新） | http://localhost:8000 |
| 80 | 开发模式后端 API | 被 8000 自动代理，不用直接访问 |

## User System

- 多用户支持，JWT 认证（72 小时有效期）。
- 用户账号和所有个人数据（待办、日历、番茄钟、笔记等）存储在后端 SQLite 数据库。
- 跨设备同步 — 同一账号在任何设备上看到相同数据。
- 支持"记住密码"和自动登录。
- 首次登录自动从旧 IndexedDB 迁移数据。

## Tech Stack

| Area | Stack |
| --- | --- |
| Frontend | React 19, TypeScript 6, Vite 8 |
| UI | Tailwind CSS, lucide-react |
| State | Zustand persist, backend API storage |
| Backend | FastAPI, SQLAlchemy, SQLite, JWT auth |
| Video/AI | ffmpeg, Faster-Whisper, whisper.cpp external engine, LM Studio/OpenAI-compatible API |
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
    routers/            API routes (auth, videos, categories, ai_jobs, notes, admin, user_data)
    services/           scanner, transcription, subtitles, summary
    auth.py             JWT authentication utilities
    worker.py           AI job worker
  dist/                 Built frontend (served by backend in production mode)
  docs/                 Notes and implementation records
```

## Quality Checks

```bash
npm run lint
npm test
npm run build
cd backend && .venv311/Scripts/python -m compileall app
```

Current verified state:

- `npm test` passes: 6 test files, 40 tests.
- `npm run build` passes.
- Test coverage currently lives in `src/__tests__/`.

## Video Station Notes

- "Continue watching" opens the last unfinished video.
- "Recent watch history" previews three videos; clicking the count shows the latest eight watched videos in the main grid, newest first.
- "Latest videos" behaves the same way and shows the latest eight added/scanned videos in the main grid.
- Search and folder navigation automatically return the grid to normal browsing mode.
- Player settings such as volume, mute state, subtitle visibility, subtitle opacity/size, playback rate, and autoplay are persisted.
- Normal "generate subtitles" jobs do not run LLM correction by default.
- The explicit "correct subtitles" action forces `large-v3` and enables local LLM correction.
- Folder batch jobs have a separate "also correct subtitles" toggle; it is off by default.

## Performance Notes

- Startup scan skips full scanning when videos already exist in the database.
- Thumbnail/sprite generation should stay lazy or queued; avoid running large media jobs synchronously during page load.
- Faster-Whisper CPU thread limits are captured when jobs are created; restart the backend worker after `.env` changes.
- `whisper.cpp` external/GPU mode ignores the CPU thread setting for transcription; GPU use depends on the chosen `whisper-cli.exe` build and extra args.

## Git Hygiene

- `tools/` is local-only. It contains Whisper binaries and model files that can be several GB each.
- Do not stage `tools/`, model `.bin` files, or downloaded local tool binaries.
- If many `git.exe` processes appear, check whether a stuck `git add` is trying to stage `tools/` or other large local artifacts.

## License

MIT
