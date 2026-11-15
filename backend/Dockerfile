# P2 Learning OS 后端镜像
#
# 说明：这里不写 `# syntax=docker/dockerfile:1`，因为该指令会去 Docker Hub
# 拉取 frontend 镜像，而本机直连 Hub 不通；Docker 23+ 的 BuildKit 已内置
# 支持 RUN --mount=type=cache，无需显式声明。
#
# 构建：
#   docker compose build backend                    # CPU 转写，镜像约 900MB
#   docker compose build --build-arg INSTALL_CUDA=true backend   # GPU 转写，+2~3GB
#
# 非 root 运行：容器内绑定 8000（<1024 端口非 root 无权限绑定），
# 由 compose 或 nginx 映射到对外 80。

FROM python:3.11-slim

ARG INSTALL_CUDA=false
ARG PIP_INDEX=https://pypi.tuna.tsinghua.edu.cn/simple
ARG APT_MIRROR=mirrors.tuna.tsinghua.edu.cn

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    TZ=Asia/Shanghai

# ffmpeg：音频抽轨；curl：容器健康检查；tzdata：时间戳正确
#
# 必须换国内 apt 源：直连 deb.debian.org 拉 ffmpeg 依赖会卡在下载阶段
# （实测两分钟不动，整个构建挂死十几次），换源后基本无等待。
RUN set -eux; \
    for f in /etc/apt/sources.list /etc/apt/sources.list.d/debian.sources; do \
        [ -f "$f" ] && sed -i "s|deb.debian.org|${APT_MIRROR}|g" "$f" || true; \
    done; \
    apt-get update; \
    apt-get install -y --no-install-recommends ffmpeg curl tzdata; \
    ln -snf /usr/share/zoneinfo/$TZ /etc/localtime; \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 先装依赖再拷代码：只改业务代码时不会触发重装依赖
# cache mount 让 pip 的 wheel 跨构建复用——langchain 全家桶下载要十几分钟，
# 没有这层缓存的话，构建一旦中断就得从头再下一次
COPY backend/requirements.txt backend/requirements-cuda.txt ./
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install -i ${PIP_INDEX} -r requirements.txt \
    && if [ "$INSTALL_CUDA" = "true" ]; then \
         echo "安装 CUDA 运行时..."; \
         pip install -i ${PIP_INDEX} -r requirements-cuda.txt; \
       else \
         echo "跳过 CUDA，转写将使用 CPU（int8）"; \
       fi

COPY backend/ .
COPY prompts/ ./prompts/

# 去掉 Windows 检出带来的 CRLF，否则容器会报 "no such file or directory"
COPY backend/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN sed -i 's/\r$//' /usr/local/bin/docker-entrypoint.sh \
    && chmod +x /usr/local/bin/docker-entrypoint.sh

# 运行时数据目录 + 非 root 用户
RUN useradd -m -u 1000 appuser \
    && mkdir -p /data/output /data/thumbnails /data/sprites /data/work \
    && chown -R appuser:appuser /app /data
USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8000/health || exit 1

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
