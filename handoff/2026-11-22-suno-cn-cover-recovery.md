# 苏诺之音封面 HTTP 400 与补生成

2026-11-22

## 现场与原因

- 只读核对了 11:41 更新的苏诺之音执行记录。A、B 版 WAV 和同名 TXT 都在配置的下载目录中，两个 PNG 尚未生成。任务在 A 版封面请求收到 `PULE_COVER_HTTP_400`。按两版归档目录匹配到的艺人配置为 1440 × 1440。
- 当时的默认接口为智谱 `cogview-3-flash`，请求使用其支持的 1024 × 1024 方形尺寸，最终分辨率在本地调整。旧版把音乐风格、歌词等拼接后截到 800 字符。本次歌词本身有约 797 个字符，提示词过长是主要疑点。原记录只保存 HTTP 状态，因此具体业务错误码无法追溯。官方错误表将提示词超长和内容审核都列为 HTTP 400。 [智谱图像生成接口](https://docs.bigmodel.cn/api-reference/%E6%A8%A1%E5%9E%8B-api/%E5%9B%BE%E5%83%8F%E7%94%9F%E6%88%90) [智谱业务错误码](https://docs.bigmodel.cn/cn/api/api-code)

## 文件与行为

- `src/main/pule-browser.ts` 将苏诺之音和谱乐的自动出图输入整理成简短视觉描述，使用歌名、风格和少量歌词意象。完整歌词继续保存为 TXT。新苏诺记录内部保存每版的短描述及导出尺寸，方便在同一记录补图。
- `src/main/api-credentials.ts` 从智谱 HTTP 400 中提取四位业务码。`src/shared/pule-browser.ts` 和 `src/renderer/components/PuleBrowserGeneration.tsx` 保存并显示对应信息，区分提示词超长、内容审核和模型错误。请求正文、密钥和接口原始报错文本继续留在调用边界。
- `src/core/download-archive.ts`、`src/core/index.ts` 和 `src/main/bootstrap.ts` 为旧记录核对下载根和默认封面配置，按两版目录唯一匹配艺人及分辨率。原艺人无法唯一匹配时使用模型的方形输出尺寸。
- 浏览器与 Windows 客户端在「苏诺之音 → 执行记录」共用「补生成封面」。它沿用已经保存的歌曲，只为缺失的版本调用当前默认封面接口。补图写入对应 WAV 的同名 PNG，验证目录和原文件，并保护已有同名文件。

## 验证与回退

- `tests/suno-cn-browser.test.mjs` 用长歌词和风格的离线请求复现旧逻辑，并验证短提示词、错误码落盘、两版旧记录恢复、已生成封面保留，以及越界歌词路径拦截。`tests/zhipu-cover.test.mjs` 验证仅保留数字错误码。
- `tests/download-archive.test.mjs`、`tests/pule-browser.test.mjs` 和 `tests/platform-management-ui.test.mjs` 覆盖旧目录匹配、Core 配置读取、执行记录展示、补图入口和保存结果。
- 苏诺之音、图像接口、封面版本、归档和平台管理界面共 42 项回归通过。共用谱乐及计划流程 98 项回归通过。新增 Core 旧记录配置读取断言单独复验通过。
- TypeScript 与 `Start-Rainfall-Browser.ps1 -BuildOnly` 通过，编译了 Windows 和浏览器共用的 Main、preload、Core 和界面。真实智谱出图与 Windows 原生窗口待验收。生产文件与执行记录用于只读核对，桌面入口按验收流程切换。
- 验证日志位于 `../rainfall-studio-build/verification/suno-cover-313f0085`。通过原 `Start-Rainfall-Browser.bat` 启动后可打开原失败记录补图。回退时撤回本次所列文件的差异并重新构建。旧版可继续读取歌曲回执及归档文件，新字段为可选。
