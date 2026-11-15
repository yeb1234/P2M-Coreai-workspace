# P2 Learning OS 前端镜像：Node 构建 → nginx 静态托管
#
# VITE_API_BASE_URL 留空时，前端走相对路径，由 nginx 同源反代到 backend，
# 这样不需要配置 CORS，也不怕局域网 IP 变化。

FROM docker.m.daocloud.io/library/node:22-alpine AS build

ARG VITE_API_BASE_URL=""
ARG NPM_REGISTRY=https://registry.npmmirror.com

ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}

WORKDIR /app

# 先装依赖，利用层缓存
COPY package.json package-lock.json ./
RUN npm config set registry ${NPM_REGISTRY} \
    && npm ci --no-audit --no-fund

# 只拷构建必需的文件，避免把 backend/docs 拖进构建上下文
COPY tsconfig.json tsconfig.app.json tsconfig.node.json ./
COPY vite.config.ts postcss.config.js tailwind.config.js index.html ./
COPY src ./src
COPY public ./public
# src/lib/aiPromptDefaults.ts 会 re-export 这里的 clientPrompts.ts，
# 不拷会报「Cannot find module '../../prompts/clientPrompts'」，并连带
# 让 DEFAULT_PROMPT_TEMPLATES 退化成 any，触发一串隐式 any 错误
COPY prompts ./prompts

RUN npm run build

FROM docker.m.daocloud.io/library/nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/nginx.conf
# 安全头单独成文件：location 里的 add_header 会清空父块继承，
# 所以每个 location 都要 include 一次
COPY nginx-security-headers.conf /etc/nginx/security-headers.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -q --spider http://127.0.0.1/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
