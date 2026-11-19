# P2 局域网演示中心

## 访问地址

优先使用：

- `http://192.168.3.247/demo/`
- `http://192.168.3.247:12302/demo/`

`80` 和 `12302` 都是 P2 现有的 Docker nginx 入口；演示中心挂在 `/demo/` 子路径，没有新增端口。

## 当前 Tab

1. 多集群监控 DEMO
2. P2 实时监控
3. 语控台设计稿
4. UI 布局实验
5. AI 检索评估报告
6. 端口号段规划
7. 面试冲刺手册

## Docker 集成方式

没有新建容器，复用 `p2-siteyeb-frontend-1`：

- 宿主机 `C:\SiteYeb\demo-hub\site` → 容器 `/demo-site:ro`
- `nginx-demo.conf` → 容器 `/etc/nginx/conf.d/demo.conf:ro`
- `nginx-p2-demo.conf` → 容器 `/etc/nginx/nginx.conf:ro`

P2 镜像的 nginx 使用完整自定义配置，不自动加载 `conf.d/*.conf`，所以 `nginx-p2-demo.conf` 是当前完整网关配置的副本，只在 `server` 内加了一行：

```nginx
include /etc/nginx/conf.d/demo.conf;
```

主站原来的限流、API 代理、安全头和 SPA fallback 都保留。改动前的 compose 备份：

```text
C:\Users\yeb12\WorkBuddy\Worktrees\SiteYeb\p2u-3-0-langchain-529238b4\docker-compose.yml.bak-20261118-demo-hub
```

## 监控 API 代理

监控页里的 `/api/status` 已改为 `/demo/api/status`，由 nginx 转到宿主机现有监控服务：

```text
/demo/api/status → http://host.docker.internal:12702/api/status
```

监控服务本身仍是宿主机的 `monitor_server.py`，没有塞进容器；如果它停了，监控页会回退到内嵌快照。

## 更新展示页

源 HTML 改动后，重新同步到演示中心：

```powershell
cd C:\SiteYeb\demo-hub
python .\scripts\sync_demo_pages.py
```

同步脚本会：

- 把多集群 DEMO、语控台、UI 实验、评估报告、端口规划、面试手册复制到 `site/pages/`
- 复制监控页并改写 `/assets`、`/demo/api/status`
- 复制监控 logo 到 `site/assets/`

页面是 bind mount，同步后刷新浏览器即可，不需要重启容器。

## 重建 frontend

如果改了 nginx 配置或 compose 挂载：

```powershell
$docker = 'C:\Program Files\Docker\Docker\resources\bin\docker.exe'
cd 'C:\Users\yeb12\WorkBuddy\Worktrees\SiteYeb\p2u-3-0-langchain-529238b4'
& $docker compose -f docker-compose.yml up -d --no-deps --force-recreate frontend
```

## 验收命令

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:12302/demo/ | Select-Object StatusCode
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:12302/demo/api/status | Select-Object StatusCode
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:12302/ | Select-Object StatusCode
```

## 边界

- 只读演示，没有登录和权限控制；不要把这个入口映射到公网。
- 演示页内容是静态副本，源文件更新后要跑一次同步脚本。
- 以后如果 P2 前端镜像更新了 `nginx.conf`，需要把新配置重新同步到 `nginx-p2-demo.conf`，再保留 demo 的 `include` 行。
