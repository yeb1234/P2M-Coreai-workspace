# 运行路径与视频库

> 状态：现行（最后校对 2026-11-16）

## 一句话结论

- **Docker 部署只看 `VIDEO_HOST_PATH`**：它是宿主机视频库根，挂到容器内 `/videos`（只读）。
- **容器内固定用 `VIDEO_FOLDER=/videos`**，不要把它改成宿主机的 `D:/ITJC`；数据库里的 `videos.filepath` 已经是 `/videos/...` 形式。
- **裸跑后端才看 `VIDEO_FOLDER`**；代码默认是 `<项目根>/video-library`，`.env` 里写相对路径时会按项目根解析。
- 项目内的 `video-library/` 只是挂载点，默认不提交媒体文件。

## 三套路径各自负责什么

| 位置 | 配置项 | 作用 | 默认 / 当前值 |
|---|---|---|---|
| Docker 宿主机 | `VIDEO_HOST_PATH` | 源视频库根，只读挂到容器 `/videos` | `./video-library` |
| Docker 容器内 | `VIDEO_FOLDER` | 后端扫描、播放、转写读取的根 | `/videos`（compose 固定写入） |
| 裸跑后端 | `VIDEO_FOLDER` | 不经 Docker 时的视频库根 | `<项目根>/video-library` |
| 产物目录 | `WORK_DIR` / `OUTPUT_DIR` / `THUMBNAIL_DIR` / `SPRITE_DIR` | 抽轨、字幕、缩略图、雪碧图 | 为空时从 `VIDEO_FOLDER` 派生 `/work`、`/output`、`/thumbnails`、`/sprites` |
| 旧库兼容 | `PATH_MAP` | 把数据库里的旧 Windows 绝对路径映射到容器路径 | compose 按 `VIDEO_HOST_PATH` 派生 |

Docker Compose 里 `${VIDEO_HOST_PATH}:/videos` 的**相对路径按 `docker-compose.yml` 所在目录解析**，不是按执行命令的当前目录。`VIDEO_HOST_PATH` 还会派生出 `thumbnails/`、`sprites/`、`output/`、`work/` 四个挂载。

## 当前这台机器

- 真实素材库：`D:\ITJC`。
- 项目内挂载点：`<项目根>\video-library`，目前是指向 `D:\ITJC` 的 junction，文件没有搬动。重建方式：

```powershell
New-Item -ItemType Junction -Path .\video-library -Target D:\ITJC
```

- `.env` 已改为：

```dotenv
VIDEO_FOLDER=./video-library
WORK_DIR=./video-library/work
OUTPUT_DIR=./video-library/output
THUMBNAIL_DIR=./video-library/thumbnails
SPRITE_DIR=./video-library/sprites
VIDEO_HOST_PATH=./video-library
```

- 数据库 `videos.filepath` 是 `/videos/...`，所以换宿主机挂载根不需要改数据库。
- 当前正在运行的容器仍是旧挂载；下次 `docker compose up -d --force-recreate` 后才会切到相对路径挂载。配置已用 `docker compose config` 验证会解析到项目内的 `video-library`。

## 换一台机器 / 上腾讯云

### 方案 A：素材库放项目内（最可移植）

```text
<项目根>/
  video-library/
    前端/
    产品经理/
    ...
    thumbnails/
    sprites/
    output/
    work/
```

`.env` 保持：

```dotenv
VIDEO_HOST_PATH=./video-library
```

Linux 如果素材库在别处，可以建 symlink：

```bash
ln -s /data/ITJC ./video-library
```

或者直接把素材目录挂到项目内的 `video-library` 路径。

### 方案 B：素材库在另一块盘（继续绝对路径）

Windows 的盘符之间没有“纯相对路径”可走：项目在 C 盘、素材在 D 盘时，相对路径从 C 盘出发到不了 D 盘。此时二选一：

1. 建 junction / symlink，让项目内有一个相对挂载点（推荐，配置仍是相对路径）；
2. 在 `.env` 设置绝对路径覆盖：

```dotenv
VIDEO_HOST_PATH=D:/ITJC
```

这只是宿主机路径覆盖，容器内仍然是 `/videos`，数据库不用改。

## 常见误区

- **不要把 `VIDEO_FOLDER` 设成 `D:/ITJC` 后启动 Docker**：compose 已把它固定成 `/videos`；在 `.env` 里写宿主机路径只会让裸跑和容器两套配置漂移。
- **不要直接把 `video-library/` 提交进 Git**：它是媒体挂载点，已加入 `.gitignore`。
- **不要为了换挂载根去改数据库里的 `/videos/...`**：容器内路径保持不变，换的是宿主机的源目录。
- `PATH_MAP` 只用于数据库里仍残留旧 Windows 绝对路径的兼容场景；当前库的路径是 `/videos/...`，不需要额外映射。如果迁移的是旧 `D:/ITJC/...` 数据库，`PATH_MAP` 要显式写绝对前缀，不能用相对路径。

## 验证

```bash
docker compose config
docker compose up -d --force-recreate backend worker
docker compose exec -T backend python -c "from app.database import settings; print(settings.video_folder, settings.output_dir)"
```

预期容器内打印 `/videos /data/output`；宿主机上 `video-library` 能列出真实课程目录。
