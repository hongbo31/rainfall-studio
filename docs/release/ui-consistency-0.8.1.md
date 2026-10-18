# 0.8.1-preview.1 全局界面整理候选

2026-10-17，代码、回归、构建和候选包内界面的后台无头验证已完成。包含客户端版本展示的当前程序源码为 `51ee699231dc5a5e36472e89f561ca0a15e73fab`（界面整理基线为 `17ed70abe0e906590bfd19a0759840305f1cfadb`）。后台构建阶段没有启动可见客户端、浏览器或终端，没有操作桌面输入或重启现有客户端；随后按本次明确授权完成原生验收。

**当前交付状态已更新：用户2026-10-17 06:44 UTC明确允许打开客户端后，原生验收与桌面入口更新完成。** 本文前述后台构建保持不变；随后24项真实原生检查、同一快捷方式启动、A/B真实播放、封面、单实例、正常关闭和重开均已验证。桌面入口现为0.8.1-preview.1，显式复用原dataRoot。详细证据、回滚位置和真实窗口截图见 [原生交付记录](ui-consistency-0.8.1-native.md)。

## 统一规则与页面清单

统一入口为 `src/renderer/ui-system.css`，按基础、桌面、工作流、系统四层组织旧样式和新规则。统一系统中文字体，正文/控件14px、辅助12px，标题保留28/18/16px层级及400/500/600字重。普通按钮、输入框和下拉框40px，帮助图标28px，帮助文字按钮32px，标签28px；顶栏三项统一36px/13px及12px水平内边距，保留状态色彩。基础间距4/8/12/16/20/24px，卡片内边距20px，表单列距16px。

| 页面或公共区域 | 实际变化 |
| --- | --- |
| 全局顶栏、左导航、播放器 | 状态/切库/备份对齐；按钮、图标、字体统一；去英文装饰标题和重复播放器说明，试听帮助可键盘访问。 |
| 作品库 | 标题改为“作品库”；筛选输入/下拉/选择按钮统一40px；紫色新建按钮、卡片文字/播放按钮、勾选、系列表单统一；保留故事、曲序和真实数据。 |
| 总览 | 简洁标题；去英文装饰和固定宣传故事线；保留用户系列故事、预算与真实状态。 |
| 本地模板 | 简洁标题、统一表单；流程默认折叠，本地模板及付费权限边界仍可见。 |
| 作品详情 | 统一标题、A/B、版本、歌词及权益表单；音频入库解释移帮助，缺素材/保存/权利状态保留。 |
| 封面工作室 | 简洁标题；交接、格式、排版说明收进帮助；图片接口未配置、真实导入及素材版本状态保留。 |
| AI聊天创作 | 创作对话、每日计划、文本/音乐、收件区说明精简；具体预算、调用确认、来源和未知结果风险保持。 |
| 数据看板 | 简洁标题；口径帮助及默认折叠CSV格式；未同步、未知数值、累计快照非增长、口径确认保持。 |
| 配置中心、账号与艺人、模型API | 控件和状态统一；模型说明折叠，凭据与连接处理不变。 |
| 发布中心及高级诊断 | 保留0.8的简洁发布路径；继承统一控件样式；高级身份、协议、费用、回执及未知结果说明保留。 |

全页面/组件盘点与未改高风险段落的理由见 `output/ui-consistency/inventory.txt`、`output/ui-consistency/copy-report.md`。新增 `HelpNote` 与原 `HelpHint` 共用视口定位：键盘聚焦后避让固定播放器，浮层可上翻并限制在视口内，支持Escape关闭。独立审查发现的帮助浮层边界和卡片内边距问题已关闭，无剩余重要发现。

## 当前客户端版本展示

侧栏底部通过现有安全桥显示 `v` 加当前客户端版本。真实桌面数据链为 Main `app.getVersion()` → trusted runtime RPC → frozen preload bridge → renderer runtime state → `clientVersionLabel`；未硬编码版本或使用服务器最新版。开发运行附加“开发运行”，缺失值显示“版本未知”；无 bridge 的 formatter 回退为“Web 预览 · 无客户端版本”。完整桌面 renderer 仍依赖既有 bridge 启动，未声明或验收无 bridge 的完整 Web 页面。

侧栏改为弹性列布局，短窗口导航可滚动，底部版本保持可见；版本使用12px辅助文字，与播放器避让。新增4项单测先失败后通过；包内元数据与无头显示均为 `0.8.1-preview.1` / `v0.8.1-preview.1`。原后台阶段使用模拟 bridge；后续原生验收已实际调用真实 runtime，确认 packaged=true、appVersion=0.8.1-preview.1，真实桌面UIA也读到相同版本文本。

## 实际验证

- 当前版本展示单测4/4、UI回归41/41、基础3/3，类型检查和桌面构建通过。界面整理基线已验证文本费用/授权界面3/3、集成194/194；版本展示增量未修改后端，也未重跑这两组基线检查。构建只有已有前端包体积提示。
- 真正无头Chrome读取**当前最终包内** `resources/app/build/ui`，19项检查通过；报告保存HeadlessChrome UA、版本来源标记与每个实际UI文件SHA256。测试使用隔离原创演示快照和模拟bridge，不调用生产服务或原生对话框。
- 覆盖主导航和作品详情、顶栏尺寸、筛选、卡片/系列表单、字号层级、多宽布局、键盘帮助、8项说明浮层及强制靠底聚焦、播放器自身帮助。页面外部请求和渲染错误均为0。
- 顶栏原高度23/33/41.2px、字号10/11/12px的失败检查已记录；统一后实际三项均36px/13px。帮助边界测试先失败再修复。
- 候选的运行时二进制、SQLite预编译文件、core/preload与原已验收0.8包哈希相同，Main仅隔离默认数据路径横幅不同。此文件检查不冒充原生启动验收。
- 原生产库只读核对：schema3、原作品1首、素材4个SHA256通过；腾讯原任务仍待条款确认、revision20，未接受或提交。没有读取凭据、写生产库、生成扣费或联系发布平台。

证据：`output/ui-consistency/headless-verification.json`、`package-verification.json`及界面整理 `review.md`；版本展示限定复审为 `output/client-version/review.md`，Critical/Important均为0。增量日志位于 `output/client-version`。当前总清单同时写入 `output/ui-consistency/final-verification.json` 和 `output/client-version/final-verification.json`。

## 候选位置与截图

当前已验收EXE：`C:\Users\CLOUD_USER\Documents\Codex\2026-10-15\task\rainfall-studio-tme-mvp\out\ui-consistency-51ee699231dc-1792215103235\RainfallStudioCandidate.exe`。必须保留整个包目录。实际桌面入口显式复用原库；不要用包内默认隔离candidate-data空库替代原作品库。前一个 `ui-consistency-17ed70abe0e9-1792212717801` 候选保留，未覆盖或删除。

原入口仍是 `C:\Users\CLOUD_USER\Desktop\Rainfall Studio 音乐客户端.lnk`，权威指针现为0.8.1-preview.1，原数据根仍为 `out/tme-readiness-f98b20328ab4-1792145753240/candidate-data`。旧0.8.0包、旧候选和回退备份未清理。

以下为**无头渲染的演示数据**，不是实际桌面窗口截图，图上已加标记。均通过替换原 Library 文件保留身份和历史，当前 Library 版本为1；版本EA已写回原截图并读回验证。

| 页面 | 本地文件 | Library ID |
| --- | --- | --- |
| 作品库 | `output/ui-consistency/01-library-headless.png` | `libfile_3d3e5eb694888191b82afb307d06ec4d` |
| 配置中心 | `output/ui-consistency/配置中心-headless.png` | `libfile_4528484208c081919589a1702d79c7e1` |
| 总览 | `output/ui-consistency/总览-headless.png` | `libfile_debe815bd1e08191b318da3172e390dc` |

其他菜单和键盘帮助截图位于同目录；原上传记录保留在 `output/ui-consistency/library-upload.json`，当前替换记录为 `output/client-version/library-replacements.json`。开发复现：`npm run desktop:build`，再运行 `node scripts/test-ui-consistency-headless.mjs`；可附加包内 UI 目录参数。需本机已安装Chrome，脚本不会安装浏览器，缺少时直接失败。首次仅使用Electron的Node模式在output下建立隔离演示快照，不启动窗口。

原生验收与切换现已完成，授权及证据见原生交付记录。历史无头截图仍保持其演示数据标记，不用来冒充真实窗口；真实截图另存于 `output/ui-consistency-native` 并单独上传Library。
