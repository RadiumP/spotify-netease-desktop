# spotify-netease-desktop

Spotify → 网易云音乐 歌单搬家工具。Electron + React + TypeScript 桌面应用，双击运行，不用装 Node / npm。

三步流程：**设置** → **网易云扫码登录** → **导出 / 匹配 / 审核 / 导入**。

跟直接调接口的脚本比，这个 UI 版核心价值在于：每首歌匹配到哪个网易云曲目会实时列成表格给你看置信度，
可以在下拉框里换成候选列表里的其他结果，或者直接跳过；遇到网易云限流/断网这类问题会自动暂停并保留进度，
不用整批重来。

## 功能

- **Spotify 登录**：PKCE 授权码流程，只需要 Client ID，不需要 Client Secret，安全一些，也方便多人各自用自己的 Spotify App
- **网易云扫码登录**：二维码直接渲染在界面里，自动轮询登录状态
- **实时匹配**：每首歌搜索完立刻显示在表格里，不用等整个歌单跑完
- **匹配审核**：每首歌显示匹配置信度，可以手动换成其他候选或跳过，不满意的不会被强制导入
- **自适应限流应对**：请求间隔带随机抖动，遇到限流自动拉长间隔，顺利之后再慢慢降回来
- **自动暂停 + 断点续传**：连续遇到限流或网络错误（超时/断网/待机唤醒后连接失效）会自动停止并保存进度，
  已经匹配到的部分可以直接导入；重新点"导出并匹配"会检测到上次的进度，可以选择继续或重新开始
- **导入去重**：导入时如果网易云已经有同名歌单会直接复用（不会重复建歌单），并自动跳过已经在里面的曲目
- **防止系统休眠**：跑导出/导入期间会阻止系统自动待机，跑完自动解除，不影响正常省电
- **本地日志**：关键事件（导出、匹配失败详情、限流触发等）按天写到本地文件，界面上有按钮直接打开日志文件夹

## 目录结构

```
electron/               # 主进程（Node 环境）
  main.ts                 # 建窗口、注册所有 IPC handler
  preload.ts               # 用 contextBridge 暴露安全的 API 给页面
  config.ts                 # 配置 / cookie / token / 断点续传 的本地持久化
  logger.ts                  # 按天写本地日志
  httpClient.ts                # 统一的 axios 实例（带超时，防止待机唤醒后请求卡死）
  neteaseServer.ts               # 内嵌启动 NeteaseCloudMusicApi 本地服务
  ipc/
    spotify.ts                     # 拉取 Spotify 歌单（新版 /playlists/{id}/items 端点）
    spotifyAuth.ts                   # Spotify PKCE 授权码登录 / 刷新 token
    netease.ts                        # 网易云登录 / 搜索 / 建歌单或复用同名歌单 / 加歌
    match.ts                           # 字符串相似度打分

src/                     # 渲染进程（React，跑在 Chromium 里）
  App.tsx                  # 三步流程的状态和路由
  pages/
    SettingsPage.tsx          # Spotify App 创建引导 + 登录 + 歌单信息
    NeteaseLoginPage.tsx        # 扫码登录
    MatchReviewPage.tsx          # 导出+实时匹配、审核表格、断点续传、导入

shared/types.ts          # 两边都用到的类型定义，包括 IPC 频道名
```

## 快速开始

### 1. 装依赖

```bash
npm install       # 会下载 Electron 本体，第一次比较大/慢；国内网络建议参考下面的镜像配置
```

如果装 `electron` 卡住报 `ECONNRESET`，在项目根目录建一个 `.npmrc`：

```
registry=https://registry.npmmirror.com
electron_mirror=https://npmmirror.com/mirrors/electron/
electron_builder_binaries_mirror=https://npmmirror.com/mirrors/electron-builder-binaries/
```

### 2. 起开发模式

```bash
npm run dev        # 起 Vite 开发服务器 + 编译 electron + 拉起窗口，改代码热更新
```

### 3. 打包成安装包

```bash
npm run package   # electron-builder，产物在 release/ 目录，双击就能装
```

### 4. 发布到 GitHub Releases（多平台下载页面）

仓库里配了 `.github/workflows/release.yml`：推一个 `v` 开头的 tag，GitHub Actions 会自动在
Windows / Mac / Linux 三台机器上分别打包，打包完自动传到对应 tag 的 Release 页面，用户去
Releases 页面就能看到三个平台的安装包分别下载。

```bash
git tag v0.1.0
git push origin v0.1.0
```

用之前记得把 `package.json` 里 `repository.url` 换成你自己的 GitHub 仓库地址（现在是占位符
`YOUR_GITHUB_USERNAME`）。不需要额外配置 token，GitHub Actions 自带的 `GITHUB_TOKEN` 权限够用。

打包出来的安装包默认没有代码签名，Windows 上装的时候会跳 SmartScreen"未知发布者"警告，Mac 上会被
Gatekeeper 拦一下，点"仍要运行/仍要打开"就行——个人项目分享给认识的人用可以不用管，真要去掉这些
警告需要买代码签名证书（Mac 还需要 Apple Developer 账号）。

## 使用说明

**前提：Spotify 2026 年 2 月做了一次 API 收紧**，开发模式应用不能再免登录读任意公开歌单了，新的
`/playlists/{id}/items` 端点只对**你自己拥有或协作的歌单**开放。所以必须先用自己的 Spotify 账号登录
授权，而且只能搬自己名下（或被拉进协作的）歌单，别人分享的公开歌单搬不了（除非先加进自己的资料库）。

1. **设置页**：跟着页面上的引导打开 Spotify 开发者后台创建一个 App（几分钟能搞定，只有自己用），
   Redirect URI 填 `http://127.0.0.1:8888/callback`（页面上有复制按钮），把 Client ID 粘回来，点
   "登录 Spotify" 走浏览器授权。再填要搬的歌单 ID 和网易云新建歌单的名字，所有字段会自动存本地。
2. **网易云登录页**：点"生成二维码"，用网易云音乐 App 扫，自动轮询登录状态，成功后自动跳下一步。
3. **匹配 & 导入页**：点"从 Spotify 导出并匹配"，逐首搜索打分，实时显示在表格里。每行可以在下拉框
   换成其他候选或选"跳过这首"，确认后点"导入到网易云"。如果中途被自动暂停了，已经匹配的部分照样能导入，
   剩下的等条件恢复了重新点一次会自动接着跑。

## 已知限制

- **只能搬自己的歌单**：Spotify 政策限制，没法绕过。想搬别人分享的公开歌单，得先在 Spotify 里把它
  "添加到你的资料库"。
- **Spotify 开发模式最多 5 个授权用户**：想给超过 5 个朋友用，要么在 Spotify 后台加白名单邮箱（上限 5），
  要么每个人自己照着设置页引导建一个自己的 App（不需要共享任何密钥，因为用的是 PKCE）。申请 Extended
  Quota Mode 门槛是"注册公司 + 月活 25 万"，个人小工具不用考虑。
- **网易云接口是非官方逆向的**（[NeteaseCloudMusicApi](https://github.com/Binaryify/NeteaseCloudMusicApi)），
  本身没有官方限流文档，触发限流的具体阈值是猜出来的，遇到持续限流只能等（几十分钟到几小时不等），
  没有稳定的解决办法。大歌单（几百首以上）建议分批跑，别一次冲完。
- **按歌单名字匹配复用**：导入时如果检测到同名歌单会直接复用，如果你账号下恰好有同名但无关的歌单，
  会被误认成"已有歌单"往里面加歌。建议把"网易云新建歌单名字"改成不容易撞名的名字。
- 没有自动化测试，靠 `tsc --noEmit` 和 `vite build` 做基本检查。

## Changelog

新功能往上加条目就行，不用重写整个文件。

### v0.1.0 — 首个版本

- Spotify PKCE 登录、网易云扫码登录
- 歌单导出、逐首搜索匹配（字符串相似度 + 歌手比对打分）
- 实时匹配结果展示 + 手动换候选/跳过
- 自适应节流（带随机抖动）+ 限流/网络错误自动暂停 + 断点续传
- 导入去重：复用同名歌单、跳过已有曲目
- 本地日志、防止系统休眠、请求超时兜底
