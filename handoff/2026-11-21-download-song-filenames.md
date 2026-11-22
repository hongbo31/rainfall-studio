# 下载文件统一按歌名保存

## 改动原因

自动归档会在音频、封面和歌词文件名中附加版本、素材类型和内容哈希。手动下载与谱乐下载也各自附加了类型或版本。新下载采用歌名和扩展名，例如 `信纸写了一半.wav`、`信纸写了一半.png`、`信纸写了一半.txt`。

## 命名与兼容性

- A、B 版分别使用各自保存的歌名。歌名自带的下划线会保留，Windows 文件名禁用字符和保留名沿用统一清理规则。
- 新归档继续放在配置中心选择的下载位置。计划与谱乐使用账号、歌手和提示词对应的目录。同名冲突时，额外的文件放进 `歌名 (2)`、`歌名 (3)` 等子目录，音频、封面和歌词在同一目录内用相同歌名。原创证书、授权附件和视频各用对应的素材子目录，文件本身仍用歌名。
- 新归档记录保存每个版本的实际位置，重试与补充素材可沿用同一位置。素材内容更换时，归档到新的编号目录。已有归档记录按原路径核验及补齐，历史文件无需批量改名。切换下载根目录后，写入新位置时采用新命名。
- 番茄目录上传识别平铺素材及一层编号子目录，按同名音频、封面和歌词配对。旧版带哈希的归档仍可读，授权附件按作品匹配。同名去重、文件身份校验和回收确认沿用原有流程。

## 涉及文件

- `src/core/download-filenames.ts` 提供同名目录分配及素材子目录规则。`src/core/download-archive.ts` 应用于计划、创作和发布归档，并记录重试所需位置。
- `src/core/download-artifact.ts`、`src/core/work-certificate.ts` 和 `src/shared/work-analysis.ts` 将手动下载的音频、歌词、封面和证书按歌名保存。
- `src/main/pule-browser.ts` 将谱乐 WAV、歌词和封面放到同一个实际版本目录，执行记录展示该目录。
- `src/core/fanqie-downloads.ts` 和 `src/main/fanqie/directory-run.ts` 识别新目录，校验素材范围后再执行既有回收流程。
- `tests/download-archive.test.mjs`、`tests/work-analysis-share.test.mjs`、`tests/creation-work-detail.test.mjs`、`tests/pule-browser.test.mjs` 和 `tests/fanqie-downloads.test.mjs` 覆盖新文件名、同名保护和兼容场景。

## 验证结果

构建和用例均在源码同级 `rainfall-studio-build/song-download-names-f0ed5ada/source` 的隔离副本运行，使用合成素材、测试库和无头 Chromium。浏览器与 Windows 客户端的导出请求进入共用的 Main 和 Core 处理函数。

| 范围 | 结果 |
| --- | --- |
| 计划归档、手动导出、创作详情、版本封面及计划工作流 | 53 项通过，覆盖原始字节、歌名中的下划线、A/B 配对、归档重试、同名证书和旧路径 |
| 谱乐自动化 | 46 项通过，覆盖不同歌名、同名录音、共享目录并发和中途下载失败 |
| 番茄目录上传 | 25 项通过，覆盖新旧命名、授权附件配对、同名判重及确认后回收 |
| 番茄计划发布 | 18 项模拟回归通过 |
| 浏览器入口与基础用例 | 4 项通过，验证构建后页面及导出请求桥接。文件落盘由共用 Core 用例验证 |
| Windows 客户端代码 | TypeScript 检查、Main / preload / Core / UI 构建和 Main、Core 语法检查通过。Vite 提示部分构建文件超过 500 kB |

## 待验收与回退

本次完成源码和隔离构建验证。Windows 原生窗口及真实平台的下载、发布尚未验收。桌面快捷方式仍指向当前已验收版本。

后续浏览器启动沿用 `Start-Rainfall-Browser.bat`，启动时从当前源码构建。桌面交付走 `Build-Latest.ps1` 和既有验收流程，数据根从 `verified-desktop.json` 读取。需要回退时，只撤回本交接列出的源码和测试变更，重新构建。已有归档路径和文件可保留。旧版番茄扫描仅处理外层账号目录，编号子目录可在新版恢复后继续识别。
