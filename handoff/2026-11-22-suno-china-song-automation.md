# 苏诺之音歌曲制作自动化

2026-11-22

入口在「平台管理 → 歌曲生成 → 苏诺之音 → 执行」。选择专属账号与艺人，填写歌名、B 版歌名、风格和需要的歌词后，可以开始制作。需要先配置下载目录和封面 API，并在苏诺之音专属窗口登录。歌曲制作按平台积分计费，两张封面使用配置中心的默认封面 API。

- `src/main/suno-cn-browser-page.ts` 打开配置的邀请地址，允许官网跳转到 `www.suno.cn`，选择苏诺模型和自定义模式。按账号管理的艺人资料设置纯音乐、女声、男声或随机，以及自定义音色。音色权重和风格参考度按官网的 1% 步进取整，保留 0 值。官网在纯音乐模式下隐藏人声和音色，纯音乐任务按该模式运行，输出空的歌词 TXT。
- 点击创作前记住列表和首歌名，等待进行中与排队状态消失。确认两条新结果及首歌名变化后，按 B 版歌名修改第二首，再依次下载 A、B 的 WAV。没有填写 B 版歌名时，两首沿用同一标题。结果不明确、已有创作进行中或官网要求额外确认时停止，执行记录供本人核对。
- `src/main/pule-browser.ts` 与 `src/core/download-archive.ts` 共用谱乐的下载根目录、账号和歌手子目录、同名防覆盖、WAV 校验和文件命名。两版各生成 PNG 封面，WAV、PNG、TXT 使用相同文件名主体。发生中断时保留已保存的文件及执行记录。
- `src/core/index.ts`、`src/shared/pule-browser.ts`、`src/shared/schemas.ts`、`src/shared/platform-directory.ts`、`src/main/bootstrap.ts` 和 `src/main/browser-accounts.ts` 校验账号及工作区，读取艺人资料并管理独立会话和任务记录。`src/renderer/pages/PlatformManagement.tsx` 和 `src/renderer/components/PuleBrowserGeneration.tsx` 复用制作面板和执行记录。

## 验证与回退

- `tests/suno-cn-browser.test.mjs` 和 `tests/fixtures/suno-cn-browser.html` 使用本地网页替身验证邀请跳转、带歌词创作及权重、纯音乐、首歌名未变化和未登录拦截。`tests/platform-management-ui.test.mjs` 验证苏诺之音卡片、选用纯音乐艺人及制作请求。谱乐、工作台和归档回归覆盖共用路径。
- 80 项离线回归测试通过。TypeScript 检查和 `scripts/Start-Rainfall-Browser.ps1 -BuildOnly` 构建通过。
- 无头访问公开入口确认邀请链接跳转，核对创作表单控件，验证未登录时在创作前停止。真实账号的生成、改名、WAV 下载、封面 API 和 Windows 原生窗口待验收。浏览器与 Windows 客户端共用界面及执行逻辑，桌面入口未切换。
- 回退时撤销本次苏诺之音制作入口、任务方法和执行代码。可保留既有平台账号、登录目录、下载文件和 `runtime/suno-cn-browser-jobs` 下的记录。
