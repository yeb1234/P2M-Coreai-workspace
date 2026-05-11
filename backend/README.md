# P2 Learning OS Backend

本地视频学习平台后端，提供视频管理、字幕转写、智能总结、观看历史和全文搜索。

## 主要功能

- 视频库扫描与管理
- Whisper 语音转文字
- Ollama / OpenAI 兼容接口的智能总结
- SRT 字幕生成
- 观看历史记录
- FTS5 全文搜索

## 快速启动

```bash
cd C:/SiteYeb/backend
.venv311/Scripts/python -m uvicorn app.main:app --host 0.0.0.0 --port 80 --reload
```

启动后会同时提供 API 和页面入口。

## 环境配置

编辑项目根目录的 `.env` 文件：

```env
DATABASE_URL=sqlite:///C:/SiteYeb/learning_os.db
VIDEO_FOLDER=D:/ITJC
OLLAMA_BASE_URL=http://localhost:11434
OPENAI_BASE_URL=http://localhost:1234/v1
OPENAI_API_KEY=lm-studio
OPENAI_MODEL=qwen3-4b
```

雪碧图预览质量也可以通过 `.env` 调整：

```env
SPRITE_FRAME_WIDTH=320
SPRITE_FRAME_INTERVAL=5
SPRITE_COLUMNS=10
SPRITE_JPEG_QUALITY=2
```

默认 `320x180` 适合当前播放器和视频卡片预览。如果想更清晰，可以提高 `SPRITE_FRAME_WIDTH`，但会增加生成时间和图片体积。

## API 端点

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/stats` | 统计数据 |
| GET | `/api/videos` | 视频列表 |
| GET | `/api/videos/{id}` | 视频详情 |
| POST | `/api/videos/{id}/ai-jobs` | 启动 AI 任务 |
| GET | `/api/ai-jobs/{job_id}` | 查询任务状态 |
| GET | `/api/videos/search/segments` | 搜索字幕 |

## 验证

根目录可直接运行：

```bash
npm test
npm run build
```

当前已验证状态：

- `npm test` 通过，40 个测试全部通过。
- `npm run build` 通过。

## 技术栈

- FastAPI + Uvicorn
- SQLAlchemy + SQLite
- Faster-Whisper
- Pydantic Settings
