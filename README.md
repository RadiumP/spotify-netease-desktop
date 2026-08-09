# spotify-netease-desktop

Spotify → 网易云音乐 歌单搬家工具，Electron + React + TypeScript 桌面应用。

三步流程：**设置** → **网易云扫码登录** → **导出/匹配/审核/导入**。

跟纯脚本版比，这个 UI 版最大的区别是：每首歌匹配到哪个网易云曲目，会先列成表格给你看置信度，
你可以在下拉框里换成候选列表里的其他结果，或者直接跳过，而不是等导入完了再看 `unmatched.txt` 补救。

## 目录结构

```
electron/          # 主进程（Node 环境）
  main.ts           # 建窗口、注册所有 IPC handler
  preload.ts         # 用 contextBridge 暴露安全的 API 给页面
  config.ts           # 配置和 cookie 的本地持久化
  neteaseServer.ts     # 内嵌启动 NeteaseCloudMusicApi 本地服务
  ipc/
    spotify.ts          # 拉取 Spotify 歌单
    netease.ts           # 网易云登录/搜索/建歌单/加歌
    match.ts               # 字符串相似度打分

src/                # 渲染进程（React，跑在 Chromium 里）
  App.tsx            # 三步流程的状态和路由
  pages/
    SettingsPage.tsx   # Spotify 凭证 + 歌单信息
    NeteaseLoginPage.tsx # 扫码登录，二维码直接渲染在页面上
    MatchReviewPage.tsx  # 导出+匹配、审核表格、一键导入

shared/types.ts     # 两边都用到的类型定义，包括 IPC 频道名
```

## 跑起来

```bash
npm install       # 会下载 Electron 本体，第一次会比较大/慢
npm run dev        # 起 vite 开发服务器 + 编译 electron + 拉起窗口
```

`npm run dev` 做了三件事（用 concurrently 并行跑）：起 Vite 开发服务器、把 `electron/` 编译成 JS、
等两边都好了之后拉起 Electron 窗口指向 Vite 的 dev server（改代码热更新）。

## 使用

**重要：Spotify 在 2026 年 2 月做了一次 API 收紧**，开发模式应用不能再免登录读任意公开歌单了，
新的 `/playlists/{id}/items` 端点只对**你自己拥有或协作的歌单**开放。所以现在必须先用你自己的
Spotify 账号登录授权，而且只能搬自己名下（或被拉进协作的）歌单，公开但不是你自己的歌单搬不了。

0. **注册 App**：设置页里第一步就是引导——打开 Spotify 开发者后台创建 App，Redirect URI 填
   `http://127.0.0.1:8888/callback`（页面上有复制按钮），保存后把 Client ID 粘回设置页。用的是
   PKCE 授权流程，**不需要 Client Secret**，Client ID 本身不是敏感信息，可以放心让朋友各自建自己的
   App，不用共享任何密钥。

1. **设置页**：按引导建好 App、填好 Client ID 之后，点"登录 Spotify"会弹系统默认浏览器走 Spotify
   授权页，登录同意后浏览器跳回一个本地页面提示成功，回到应用就自动记录登录状态了。再填要搬的歌单 ID
   （必须是自己账号下的歌单）和网易云新建歌单的名字。
2. **网易云登录页**：点"生成二维码"，用网易云音乐 App 扫，自动轮询登录状态，成功后自动跳下一步。
3. **匹配 & 导入页**：点"从 Spotify 导出并匹配"，逐首搜索打分（有进度条）。表格里每行可以在下拉框
   换成其他候选或者选"跳过这首"，确认后点"导入到网易云"。

## 打包成安装包

```bash
npm run package   # electron-builder，产物在 release/ 目录
```

## 已知没做的地方 / 可以自己接着改的

- **网易云内嵌服务**：`neteaseServer.ts` 用的是 `NeteaseCloudMusicApi` 包导出的 `serveNcmApi()` 编程接口
  （对应它 README "作为 Node.js 模块使用"那部分）。如果你装的版本没有导出这个函数，会自动退回到
  `spawn` 子进程的 fallback，但 fallback 假设了 `node_modules/.bin` 里有可执行文件，路径可能要按实际
  打包结构调一下。
- **搜索限流**：现在每首歌之间硬编码 sleep 300ms，歌单很大的话总时间会比较长，可以考虑改成并发+限速
  （比如一次 3-5 个并行）。
- **想分享给朋友用**：Spotify 开发模式的 App 最多只能有 5 个授权用户（在 developer.spotify.com 后台
  加白名单邮箱），超过这个数就得申请 Extended Quota Mode——但那个门槛是"注册公司 + 月活25万"，个人
  小工具基本不用考虑。现实的做法是最多 5 个人共用你建的 App（把他们邮箱加进白名单），或者每人自己
  照着设置页的引导建一个自己的 App（几分钟的事，且不需要共享任何密钥，因为用的是 PKCE）。
- **Spotify 只能搬自己的歌单**：这是 Spotify 2026年2月政策变更带来的硬限制，不是这个工具的设计选择，
  没法绕过。如果想搬别人分享的公开歌单，得先在 Spotify 里把那个歌单"添加到你的资料库"，这样它会出现在
  你自己的 `我的歌单` 里，理论上就能读了（没实测过，Spotify 文档没写清楚"添加到资料库"算不算协作）。
- **候选数量**：搜索默认拿 5 个候选，`electron/ipc/netease.ts` 里的 `searchCandidates` 第三个参数可以调。
- **日志**：`electron/logger.ts` 会把关键事件（导出开始/完成、每首歌搜索失败的详情、匹配结果统计）
  写到本地文件，按天分文件。匹配页有个"查看日志"按钮直接打开文件夹，也可以自己去
  `%APPDATA%\spotify-netease-desktop\logs\`（Windows）或 `~/Library/Application Support/spotify-netease-desktop/logs/`（Mac）看。
  遇到限流之类的问题，把对应日志文件里的内容发出来最好排查。
- 目前没写自动化测试，`tsc --noEmit` 和 `vite build` 过了，但没有用真实 Spotify/网易云账号联调过。
