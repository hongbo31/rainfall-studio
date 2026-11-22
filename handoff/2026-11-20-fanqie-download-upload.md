# 番茄音乐按账号目录批量上传

## 业务流程

参考 `upload_same_mo_contract`、`Signed_Music` 和配套页面定位，原流程按账号前缀合并歌手目录，为每首歌配对音频、歌词和封面，填写署名并读取上传结果，再把同批作品放入一份合同，按官网作品 ID 归档。

1. 在「平台管理 → 番茄音乐 → 执行」打开「目录上传」。初始使用卡片的默认发布账号，也可在窗口中切换。下载位置读取「配置中心」保存的目录。
2. 扫描下载目录直属的 `发布账号_歌手_提示词引擎` 文件夹。例如 `素素_陈白狐_6080国语苦情女歌手` 对应账号「素素」、歌手「陈白狐」。账号或已登记歌手名含下划线时使用完整名称匹配。歌手取自各自目录，词曲署名依次使用已保存的艺人专用署名、对应艺人资料和账号备用署名。
3. 支持同名 WAV/MP3、UTF-8 TXT 和 PNG/JPG/JPEG，也支持 Rainfall 归档的 A/B 音频、歌词和封面命名。已登记为纯音乐的艺人可省略歌词。缺材料或遇到同名候选会在扫描结果里显示原因。确认后使用该账号的专属会话核对账号、官网作品目录及署名。
4. 逐首复用现有上传、封面处理、表单回显和作品 ID 核对流程。每批最多上传 100 首。已核对的同名作品和本地已有上传记录的相同录音会被拦截。保留原文件，上传使用工作区内的准备副本。
5. 把本批有新官网回执的歌曲放入同一份合同预览，由用户到番茄账号窗口确认。最近一批投稿逐首显示作品 ID 和官网状态。遇到不明确的结果会暂停，可用「核对投稿状态」回查，已确认过的上传不会重放。仅在明确处于提交前、原编辑页已关闭且官网查无该作品时，核对才释放该条已知失败记录供再次手动执行。

目录批次按可发布的原创 AI 歌曲处理。封面缺失时提示补齐。该入口使用 Rainfall 上传日志记录回执和签约状态。

## 涉及文件与兼容性

- `src/core/fanqie-downloads.ts`、`src/core/download-archive.ts`、`src/core/index.ts` 负责目录匹配、材料快照和工作区内调用。路径来自配置和数据根，保留现有归档布局。
- `src/main/fanqie/upload-broker.ts`、`account-sessions.ts`、`materials.ts`、`catalog-session.ts` 和 `src/main/bootstrap.ts` 负责按账号上传、保存回执及准备合同。最近批次保存于该账号状态目录的 `download-batch.json`，逐首操作沿用 `uploads/`，合同预览沿用 `authorizations/`。工作库继续使用原数据格式。
- `src/shared/fanqie-downloads.ts`、`contracts.ts`、`fanqie-catalog.ts` 和 `src/renderer/components/FanqieDownloadUpload.tsx`、`PublicationAutomationDialog.tsx`、`src/renderer/platform-management.css` 接入共用界面与桥接。计划工作流和作品库上传继续走原入口。
- `tests/fanqie-downloads.test.mjs`、`tests/platform-management-ui.test.mjs` 覆盖按账号切换、歌手匹配、上传确认和回执核对。

## 验证与回退

- Windows 隔离检出通过 TypeScript 检查。31 项目录、界面、浏览器桥接和番茄页面测试通过，90 项番茄及发布基础回归通过。
- `Start-Rainfall-Browser.ps1 -BuildOnly` 构建了 Windows 主进程、预加载、核心与界面。以独立测试库启动仅监听回环地址的 Windows 应用进程，用无头浏览器走通平台管理入口，确认真实桥接只显示所选账号的目录，扫描阶段未启动番茄会话。
- 官网上传及合同操作使用模拟页面和隔离数据验证。本轮验收范围未覆盖真实账号投稿、合同确认和 Windows 原生窗口。正式数据和已验收桌面入口保留。
- 如需回退，恢复本轮列出的源码改动并沿用已验收包。保留下载材料和番茄账号状态目录中的上传与合同记录，便于核对后续投稿。
