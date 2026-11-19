P2M Desktop 1.0.0（Windows x64）
================================

一、安装
1. 双击 P2M-Desktop-1.0.0-x64.exe。
2. 选择安装目录，桌面和开始菜单会生成 P2M Desktop。
3. 首次启动默认连接：http://192.168.3.247:12302
4. 如果服务端还没启动，先启动 Docker；本机可访问：
   http://127.0.0.1:12302
   http://192.168.3.247:12302

二、改服务地址
默认地址写死在安装包里，正式部署建议用配置文件改，不需要重新打包。
配置文件位置：

   %APPDATA%\p2m-desktop\desktop-config.json

内容示例：

   {
     "url": "http://192.168.3.247:12302"
   }

改完关闭并重新打开桌面端。也可以用环境变量临时覆盖：

   set P2M_DESKTOP_URL=http://127.0.0.1:12302
   "P2M Desktop.exe"

三、桌面模式说明
- 桌面壳会自动在每个 API 请求带 X-Client-Type: desktop-exe。
- 后端只把这个值放进 request.state，用于 UI 分流，不参与登录、权限或 IPC 判定。
- 浏览器访问不带这个头，仍然走完整网页布局。
- 桌面模式隐藏了 29 项侧边栏，只保留首页、待办、番茄、视频、转写、AI Agent、设置入口。
- 伪造这个 Header 最多看到精简布局，不会获得任何特权。

四、验证方式
浏览器直接访问：
   http://192.168.3.247:12302/api/client-info
返回 {"client_type":"web"}

带 Header 访问：
   curl -H "X-Client-Type: desktop-exe" http://192.168.3.247:12302/api/client-info
返回 {"client_type":"desktop-exe"}

五、常见问题
1. Windows 提示“未知发布者”：安装包没有做代码签名，选择“更多信息 -> 仍要运行”。
2. 打开后提示连不上：确认 Docker 的 frontend/backend 已启动，端口 12302 没有被防火墙拦截；也确认配置文件里的 IP 是当前服务机 IP。
3. 页面能打开但所有操作卡住、视频点了不出画面：先检查 Docker Desktop 是否正常（不是只看容器窗口）。
   在 PowerShell 执行：
      docker version
      docker ps
   如果 docker version 报 npipe / 500，或日志出现 no route to host，说明 Docker 引擎掉线。
   先退出所有 P2M Desktop 窗口，再重启 Docker Desktop；等 docker ps 正常后再打开桌面端。
   本次已把视频 Range 请求从普通 API 限流/缓冲里拆出来，避免拖动进度条时被 429 或缓冲卡住。
4. 视频暂停时点击画面无反应：1.0.0 修复版已把点击区域扩大到整个播放器，并给暂停遮罩加了真实播放按钮；
   若浏览器仍拦截自动播放，左上角会给出“请点播放按钮继续”的提示，不再静默失败。
5. 重复双击桌面图标会打开多个实例、内存翻倍：修复版已加单实例锁，第二次启动只会把已有窗口拉到前台。
6. 从视频页切回工作台特别慢：keep-alive 会保留视频页，修复版在离开 /video 路由时自动暂停 video，
   不再让视频在隐藏页面里继续解码。实测切回工作台约 34ms。
7. 装到别的局域网电脑：安装包本身不需要 Node/Docker，只要能访问 192.168.3.247:12302 即可。
8. 卸载：Windows 设置 -> 应用 -> P2M Desktop。

六、本次修复校验
- SHA256：FDD8102A331031284E7166412528FFC5971233ACF7A6CF27927D1A54B4648AC8
- 视频接口实测：GET /api/videos/43304/file + Range: bytes=0-1023 -> 206，约 40ms。
- 播放器实测：Electron 内 video.play() 返回 resolved，currentTime 正常推进。
- 前端构建：npm run build 通过（tsc -b + vite build）。

七、当前构建说明
当前可执行壳使用 Electron。原因是本机没有 Rust/MSVC 工具链，Tauri 无法直接编译。
前端是 React 19 + Vite（不是 Vue），Header、客户端标识和布局分流代码在 React 侧完成，
后续装好 Rust/MSVC 后可以复用同一套前端逻辑迁移到 Tauri，不需要重写业务代码。

源码位置：
  C:\Users\yeb12\WorkBuddy\Worktrees\SiteYeb\p2u-3-0-langchain-529238b4\desktop-shell
  C:\Users\yeb12\WorkBuddy\Worktrees\SiteYeb\p2u-3-0-langchain-529238b4\src\lib\clientContext.ts
  C:\Users\yeb12\WorkBuddy\Worktrees\SiteYeb\p2u-3-0-langchain-529238b4\src\components\layout\DesktopNav.tsx
