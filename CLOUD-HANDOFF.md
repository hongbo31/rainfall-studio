# Rainfall Studio — dot 云电脑源码交接

## 当前指令，优先于历史机器说明

- 用户已亲自提交既有歌曲审核。停止该歌曲的一切上传、协议勾选、提交或重试；不得根据历史授权重放。
- 用户要求后续在 dot 自己的云电脑调通自动化；不要回原 Windows 主机操作浏览器、启动客户端或调试。
- 此包为去敏源码快照，不含 Git 历史、凭据、真实账号库、浏览器登录态或用户音乐文件。原件保留在用户本机；未推送任何远端 Git。
- 在云端使用新的隔离 dataRoot、新的浏览器/进程绑定和测试作品。不要复用历史机器的路径、PID、HWND、Document RuntimeId 或正式库。
- Gmail 工作仍暂停。handoff/PAUSED-cover-gmail-plan.md 仅为保留未提交文档，不是恢复开发或发信的授权。

## 版本与基线

- package version: 0.8.3-preview.2
- 原始快照 HEAD: ec39d740a388f8b42d3cf3024ed8a350382ab64b
- 最新逻辑提交: aa7b0b9e138dfc8d45e1b715df237613d2c80e73
- 前一修复提交: bfbce770d0f774f7123dafefaa29d2b08419e44d
- 原始本地分支: feature/tme-uia-batch。无已推送分支可下载；请使用本源码包。
- 这是源码快照而非 git bundle。基线 commit 用于对照来源；云端可以自行初始化独立 Git 仓库。
- handoff/UNCOMMITTED-TRACKED.diff 为空：没有遗漏的未提交应用逻辑。唯一未跟踪的暂停计划另有去敏副本。

## 最新改动

1. Windows UIA 单次写入/点击后有界重读，不重复写入、打开文件或提交。
2. 读取上传后的部分表单；完整元数据不可读时在写入前停止，多个/折叠的已有曲目不得退回空上传入口。
3. 仅归一化已经证明属于同一外层的嵌套单选/开关/官方 PDF 文档，循环或独立祖先关系继续拒绝。
4. 封面检测使用可见的准确 Text 名称，并排除 Edit 祖先下的歌词/介绍内容，避免整页文本误触发裁剪状态。
5. 文件选择器先核对归属、进程、空文件名和未选择状态，再等待地址/目录就绪。

## 云端环境与启动

源开发环境为 Node.js 24 x64、PowerShell 7，Electron/React/Vite/esbuild 与 better-sqlite3 版本见 package-lock.json。依赖安装或构建仅在获准的云端执行，不在原机器继续调试：

```powershell
npm ci
npm test
npm run typecheck
npm run test:integration
npm run test:qq-preparation
node scripts/test-tme-ai-prepare.mjs
node scripts/test-tme-ai-submission.mjs
node scripts/test-tme-ai-prepare-ui.mjs
npm run desktop:build
```

`npm start` 为本地网页原型；`npm run desktop:dev` 会启动桌面窗口。先确认云端允许 GUI，再执行启动类命令。`node scripts/package-tme-candidate.mjs --simple-publishing` 需要已有 build 和云端独立 Git commit。

## Windows 原生依赖

- 真正的 UIA 适配器需要 Windows 交互桌面、PowerShell 7、UIAutomationClient/UIAutomationTypes、Win32 user32 和可访问的 Chrome/Edge。
- 云端若为 Linux 或无桌面环境，只能先测 core/renderer/离线协议，不能把无头结果当 Windows 原生验收。
- 浏览器和执行进程必须处于可交互的同一会话与合适的完整性级别；锁屏、服务会话、后台前台锁定可能使可见点击失败。
- UIA identity / HWND / 文档绑定必须在云端重新采集，不能绕过所有者或前台检查，也不能沿用原机器正式账号库。
- 不复制 Cookie、浏览器 profile、DPAPI vault 或 API key。需要时由用户在云端自行提供新的授权和配置。

## 实测基线与待修缺口

原始基线在源 Windows 上完成 305 项测试、typecheck 和 desktop build；此导出过程没有重新运行应用、浏览器或测试。去敏包替换了真实歌词与身份引用，数据相关夹具须用云端自有样例核验，不能宣称已经在云端通过。

待继续处理：
- 尚未完成完整离线裁剪确认的一次调用、成功及超时读回组合回放。
- 平台返回上一步/下一步后的异步旧树与封面回显差异，需要云端隔离作品复现；不可据一次瞬态读回判定真实封面持久化。
- 智能封面提示带图标前缀时，准确 Text 匹配可能漏记 banner；当前无手动按钮时仍失败关闭。
- 前台激活在原机器失败；需云端真实交互会话验证，不能用后台解析成功冒充物理点击成功。
- 发布中心材料检查、原生准备器与实际官方提交的端到端衔接仍需完善；本地检查不是上传/提交回执。
- 远端专辑记录与单曲记录必须分开，不能把专辑审核中/专辑ID当单曲提交成功/单曲ID；用户已手工提审的既有歌曲不得重试。
- 真实生成、费用、权属、第三方权限与模型/平台接入需要各自授权；不得创建凭据或擅自扣费。

## 去敏说明

未包含用户音频、封面、账号数据库、凭据、环境文件、浏览器状态、node_modules、已构建二进制、out/output 运行目录。仅保留 assets/rainfall.png 与 rainfall.ico 两个项目品牌图标。真实歌词 fixture 和请求样例已替换为明确占位文本；本机用户名、艺名、已知账号/作品/素材标识和签名值进行了去敏。SANITIZATION-MANIFEST.json 列明文件哈希及变换，不包含被去掉的原值。
