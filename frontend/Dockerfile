# P2 Learning OS 前端镜像：Node 构建 → nginx 静态托管
#
# 构建上下文是仓库根目录：前端源码在 frontend/，提示词在 configs/，
# nginx 配置在 infra/。VITE_API_BASE_URL 留空时前端走同源反代。

FROM docker.m.daocloud.io/library/node:22-alpine AS build

ARG VITE_API_BASE_URL=""
ARG NPM_REGISTRY=https://registry.npmmirror.com

ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}

WORKDIR /app/frontend

# 先装依赖，利用层缓存
COPY frontend/package.json frontend/package-lock.json ./
RUN npm config set registry ${NPM_REGISTRY} \
    && npm ci --no-audit --no-fund

COPY frontend/tsconfig.json frontend/tsconfig.app.json frontend/tsconfig.node.json ./
COPY frontend/vite.config.ts frontend/postcss.config.js frontend/tailwind.config.js frontend/index.html ./
COPY frontend/src ./src
COPY frontend/public ./public
# 前端提示词从 configs 层读取，保持“提示词只有一份”的单一事实源。
COPY configs/prompts/clientPrompts.ts /app/configs/prompts/clientPrompts.ts

RUN npm run build

FROM docker.m.daocloud.io/library/nginx:alpine

COPY --from=build /app/frontend/dist /usr/share/nginx/html
COPY infra/nginx.conf /etc/nginx/nginx.conf
# 安全头单独成文件：location 里的 add_header 会清空父块继承，
# 所以每个 location 都要 include 一次
COPY infra/nginx-security-headers.conf /etc/nginx/security-headers.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -q --spider http://127.0.0.1/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
