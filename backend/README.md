# P2 Learning OS Backend

本地视频学习平台后端，支持 AI 字幕转录、智能总结、视频管理等功能。

## 功能

- 视频库扫描与管理
- Whisper 语音转文字
- Ollama / OpenAI 智能总结
- SRT 字幕生成
- 观看历史记录
- FTS5 全文搜索

## 快速启动

```bash
cd D:/SiteYeb/backend
.venv311/Scripts/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

启动后自动运行：API 服务 + AI Worker + 文件监控

## 配置

编辑 `.env` 文件：

```env
DATABASE_URL=sqlite:///D:/SiteYeb/learning_os.db
VIDEO_FOLDER=D:/ITJC
OLLAMA_BASE_URL=http://localhost:11434
OPENAI_BASE_URL=http://localhost:1234/v1
```

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/stats` | 统计数据 |
| GET | `/api/videos` | 视频列表 |
| GET | `/api/videos/{id}` | 视频详情 |
| POST | `/api/videos/{id}/ai-jobs` | 启动 AI 任务 |
| GET | `/api/ai-jobs/{job_id}` | 查询任务状态 |
| GET | `/api/videos/search/segments` | 搜索字幕 |

## 技术栈

- FastAPI + Uvicorn
- SQLAlchemy + SQLite
- Faster-Whisper
- Pydantic Settings

---

# P2 Learning OS Backend

Local video learning platform backend with AI subtitle transcription, smart summarization, and video management.

## Features

- Video library scanning & management
- Whisper speech-to-text
- Ollama / OpenAI smart summarization
- SRT subtitle generation
- Watch history tracking
- FTS5 full-text search

## Quick Start

```bash
cd D:/SiteYeb/backend
.venv311/Scripts/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Starts automatically: API server + AI Worker + File watcher

## Configuration

Edit `.env` file:

```env
DATABASE_URL=sqlite:///D:/SiteYeb/learning_os.db
VIDEO_FOLDER=D:/ITJC
OLLAMA_BASE_URL=http://localhost:11434
OPENAI_BASE_URL=http://localhost:1234/v1
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/stats` | Statistics |
| GET | `/api/videos` | Video list |
| GET | `/api/videos/{id}` | Video detail |
| POST | `/api/videos/{id}/ai-jobs` | Start AI job |
| GET | `/api/ai-jobs/{job_id}` | Job status |
| GET | `/api/videos/search/segments` | Search subtitles |

## Tech Stack

- FastAPI + Uvicorn
- SQLAlchemy + SQLite
- Faster-Whisper
- Pydantic Settings
