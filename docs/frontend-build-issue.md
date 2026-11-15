# 前端构建链路问题（未解决，留待明天）

时间：2026-11-16 03:30 – 05:05
现象：新增的「学习轨迹」页面代码写完了，通过 `http://localhost/#/journey` 能正常访问，
但**侧边栏没有入口**。

---

## 一、已经确认的事实

**代码层面是对的**（逐项验证过）：

```
src/components/journey/JourneyPage.tsx        页面组件存在，渲染正常（已截图）
src/config/pageRegistry.tsx:110               PAGES 里有 journey 条目（label='学习轨迹'）
src/config/pageRegistry.tsx:26                lazyPage 定义存在
src/config/pageRegistry.tsx:68                PAGE_LOADERS 有 journey
src/stores/uiStore.ts:7                       ActiveView 加了 'journey'
src/stores/uiStore.ts:14                      DEFAULT_NAV_ORDER 加了 'journey'
src/components/layout/Sidebar.tsx:25          orderedNav 补齐逻辑（useMemo）
src/components/layout/Sidebar.tsx:153         渲染用 orderedNav
```

**后端接口也是通的**：

```
GET /api/learning/journey  →  Lv.3 / 1078 经验 / 5 个成就 / 91 天热力图
```

**路由也是通的**：`http://localhost/#/journey` 能渲染出完整页面。

---

## 二、卡在哪里

侧边栏渲染出 27 项，**没有「学习轨迹」**。

用 Playwright 读运行时的侧边栏文本，确认：

```
工作台 / 待办事项 / 日历看板 / 周历 / 笔记 / 番茄钟 / 时间中心 / 健康助手 /
学习路径 / IT视频站 / 字幕转录王 / 产品对比 / 电商中心 / 赛事数据 / 数据中心 /
阅读器 / 代码片段 / 习惯追踪 / 闪卡记忆 / 书签收藏 / Token 用量 /
LeetCode / 面试题库 / 编程导航 / 灵境小助手 / OpenClaw / Hermes
```

27 项，从「学习路径」直接跳到「IT视频站」，中间缺 journey。

---

## 三、排查过的路径（都排除了）

### 1. IndexedDB 持久化覆盖默认值？—— 排除

```
P2MStorage.kv    = []     ← 空的
P2MStorage.users = []     ← 空的
```

persist 没有写入，所以 `navOrder` 用的是 `DEFAULT_NAV_ORDER`。
而 `stores-DQdqERbR.js` 里**确实含 "journey" 字符串**（说明 DEFAULT_NAV_ORDER 配对了）。

### 2. hash 路由不匹配？—— 排除

`useHashSync` 用 `PATH_VIEW[hash]`，`#/journey` 能匹配，页面确实渲染出来了。

### 3. Docker 镜像缓存？—— 部分排除

`docker compose build --no-cache frontend` 只用了 23 秒，镜像创建时间仍是旧的（02:23）。
后来用 `docker build --no-cache -t siteyeb-frontend:3.0 -f Dockerfile .` 直接构建，
日志显示 `npm run build` 跑了 7.2 秒、`COPY --from=build /app/dist` 完成、镜像 tag 更新了。

**但容器里 `index.html` 引用的还是 `index-DM1H2Eov.js`**。

### 4. dist 残留多个 chunk 导致 index.html 没更新？—— 排除

```
rm -rf dist && npm run build
→ dist/index.html 仍引用 index-DM1H2Eov.js
```

清空重建后引用不变，说明**这次构建的产物就是 `index-DM1H2Eov.js`**，不是残留。

### 5. grep 中文查不到 = 改动没进去？—— 这是**误判**

一开始用 `grep '学习轨迹' dist/assets/index-*.js` 返回 0，以为改动没进去。
但实际上：

- vite 构建会把中文转成 `\uXXXX` 转义，grep 中文当然找不到
- 而且 `journey` 这个配置在 `stores-*.js` 里，**不在 index chunk 里**
- `index-*.js` 不含 "journey" 是正常的

### 6. 绕道方案：挂载 dist（已做）

`docker-compose.yml` 给 frontend 加了：

```yaml
volumes:
  - ./dist:/usr/share/nginx/html:ro
```

挂载生效了（容器能读到本地 dist 的文件），但 `index.html` 引用还是旧的 —— 因为本地 dist 的
`index.html` 本身就引用 `index-DM1H2Eov.js`。

---

## 四、我的判断（下次从这里开始）

`index-DM1H2Eov.js` 里不含 `journey` 是**正常的**（配置在 stores chunk）。
真正要查的是：**Sidebar 组件编译到哪个 chunk，它有没有用上 `orderedNav`**。

下次用这个方式一次定位：

```bash
# 1. 找 Sidebar 在哪个 chunk（搜它的一个独有字符串，比如 dt 拖拽相关或 "hiddenNavItems"）
grep -l "hiddenNavItems" dist/assets/*.js

# 2. 在那个 chunk 里确认有没有 PAGES 引用（orderedNav 依赖它）
grep -c "PAGES" dist/assets/<找到的 chunk>

# 3. 如果 Sidebar 在 index chunk 且没有 PAGES 引用，说明改动没编进去 —— 检查
#    tsconfig 的 include 是否漏了 components/layout，或者 vite 的 build.rollupOptions 有手动分包
```

另一个更快的验证方式：**在 Sidebar 里临时加一行 `console.log('orderedNav', orderedNav.length)`**，
看浏览器 console 有没有输出、输出的数字是 27 还是 28。

- 输出 28 → 渲染问题，找 `PAGE_MAP['journey']` 为什么是 undefined
- 输出 27 → 编译问题，改动没进去
- 没输出 → Sidebar 根本没执行到这段（HMR 或缓存）

---

## 五、当前可用状态

**功能可用**，只是入口缺失：

```
http://localhost/#/journey    直接访问，页面完整
```

生产部署前必须解决（用户不可能手输 URL）。

---

## 六、教训

**这个问题的诊断成本远超修复成本。**

我从 03:30 查到 05:05，中间走了三条弯路：

1. 以为 `--no-cache` 构建生效了（看输出 "Built" 就信了，没核对镜像时间）
2. 以为 grep 中文查不到 = 改动没进去（实际是 unicode 转义）
3. 以为 dist 残留导致 index.html 不更新（清空重建后一样）

**下次遇到「代码写了但界面上没有」，第一步应该是在渲染处加一行 log 确认代码是否执行**，
而不是从构建链路往外查。**运行时证据优先于构建产物推断。**
