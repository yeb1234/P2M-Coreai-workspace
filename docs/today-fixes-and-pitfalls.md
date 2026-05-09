# 2026-05-10 改进与踩坑记录

## 视频站

- 最近观看和最新视频都改成“卡片预览 3 条，主列表展示 8 条”的模式。
- 点击“最近观看”的数量按钮时，下方视频网格显示最近观看的 8 条，顺序为从新到旧。
- 点击“最新视频”的数量按钮时，下方视频网格显示最新入库/扫描的 8 条。
- 搜索、进入文件夹、点击面包屑会退出历史/最新模式，避免列表上下文混乱。
- 小卡片不再直接展开到 8 条，避免导航区域高度跳动。

## 播放器和字幕

- 播放器参数从 localStorage 初始化后再进入 React state，避免 render 阶段读 ref 被 React hooks lint 报错。
- 字幕继续使用自定义 overlay，避免原生 track 和自定义字幕重复显示。
- 需要继续关注：不同字幕来源的兼容性，以及视频首次加载时字幕详情是否已经补齐。

## AI / 转写 / CPU

- Whisper 参数已经放到转写设置里，包括模型、语言、线程、计算类型、beam size、best of、temperature、VAD、总结和字幕修正。
- CPU 线程控制要从后端实际传入 Faster-Whisper / CTranslate2 参数才生效，单纯改 `.env` 后如果 worker 未重启或代码没读取该值，看起来会像“永远 100%”。
- 大模型转写和字幕修正会排队，页面不要在首屏主动批量触发大量任务。

## 性能

- 启动扫描现在应避免在数据库已有视频时全量扫描。
- 缩略图和雪碧图必须懒加载或后台队列化，不应在首页同步批量生成。
- 视频列表卡片使用 `loading="lazy"`，降低首屏图片压力。
- React lint 暴露的同步 effect setState 已处理，减少级联渲染风险。

## 测试环境

- Vitest/jsdom 默认没有 IndexedDB，Dexie 会报 `MissingAPIError IndexedDB API missing`。
- 现在 `idbStorage` 在无 IndexedDB 环境使用内存 Map fallback，浏览器环境仍使用 Dexie。
- 修复后 `npm test` 不再出现大量 unhandled rejection。

## 编码

- README 和 App 欢迎页出现过中文乱码，统一改回 UTF-8 中文。
- 后续编辑中文文件时确认编辑器和终端都使用 UTF-8。

## 验证

```bash
npm run lint
npm test
npm run build
backend/.venv311/Scripts/python -m compileall backend/app
```

最近一次执行结果：全部通过。
