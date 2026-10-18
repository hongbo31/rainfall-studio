# 功能清晰度第一轮验证

2026-10-16，SOURCE_WINDOWS_HOST。独立目录：`C:\Users\CLOUD_USER\Documents\Codex\2026-10-15\task\rainfall-studio-tme-mvp`。分支 `feature/clarity-first-pass`，基线 `3fbcb08`，实现提交 `6ed3817`、`eb2eeeb`。仅本地提交；未推送、打包、替换日用客户端或数据。

## 改动与范围

- 首页提供聊新想法、本地模板起草和整理已有作品三个明确入口。无 Key 仍可保存想法，不伪造 AI 回复。
- “创作向导”改称“本地模板”；旧定时功能明确为创建本地模板草稿，不冒充真实 AI 生成。
- 作品详情显示当前发布音频 A、材料缺项和可点击的下一步；保存后仅带当前作品进入发布准备。试听 B 不改变发布 A 或歌词匹配确认。
- 播放器空闲显示尚未选择试听；已有音频不误报缺失。使用本地真实音频解码，无音频不假播。
- 腾讯面板区分本地准备、客户端连接、页面契约与身份核对。外部工具能操作 Chrome 不等于客户端已连接。
- 统计先选择日期和平台，再由用户确认同口径；日期、平台或来源内容变化即撤销确认。缺失、实测0和部分已知分别显示，覆盖度随数值展示；整数溢出拒绝给出错误总数。

Core、生产 Main、共享 schema、浏览器适配器和真实执行开关未修改。五项导航重构、一次性导入已有歌曲、封面重新分组与持久错误体系留待后续。

## 启动

复用已安装 Node24.14.0、Electron44.7.2、PowerShell7.6.5及现有依赖，无新增安装。

```powershell
Set-Location 'C:\Users\CLOUD_USER\Documents\Codex\2026-10-15\task\rainfall-studio-tme-mvp'
$env:RAINFALL_DATA_ROOT = Join-Path $PWD 'output\manual-clarity'
$env:RAINFALL_MODE = 'production'
npm.cmd run desktop:dev
```

运行的是源码 Electron 桌面应用；相同数据根支持重启持久化。不要使用日用数据根或同时打开同一库。本轮没有新安装器，不改变现有0.5.1发行物。

## 实际验证

| 检查 | 结果 | 本地日志 |
|---|---|---|
| `node scripts/test-clarity.mjs` | 10/10 | `output-clarity-targeted-final.log` |
| `node scripts/test-headless.mjs` | 145/145 | `output-clarity-core-final.log` |
| `node scripts/test-tme.mjs` | 32/32 | `output-clarity-tme-final.log` |
| `node scripts/test-inbox-unit.mjs --regression` | 42/42 | `output-clarity-inbox-final.log` |
| `npm test` | 3/3 | `output-clarity-base-final.log` |
| `npm run typecheck` | 退出0 | `output-clarity-typecheck-final.log` |
| `npm run desktop:build` | 退出0 | `output-clarity-build-final.log` |
| `node scripts/clarity-desktop-qa.mjs` | 5项主流程通过 | 下述 report.json |

先复现缺失 helper 和旧入口/连接文案的失败，再实现。隐藏 Electron QA 曾因聊天输入框隐式标签包含默认文字而失败；补充稳定的 `aria-label` 后，同一主流程通过。没有为可逆文案增加镜像测试；定向测试集中验证数据含义、确认失效与材料状态。

最终证据目录：`output/playwright/clarity-326c22bf-551d-4a00-a5ec-ab2507e5916a`。

- `report.json`：5项通过；rendererErrors与观察到的Electron HTTP/HTTPS请求为空；真实提供方调用、平台上传、审核提交、启用定时任务均为0。
- `home.png`：三个入口和空闲播放器。
- `work-next-step.png`：当前作品材料下一步。
- `client-connection.png`：本地准备界面及真实页面待校准状态。
- `report-coverage.png`：同口径确认门槛，导入行中的20、实测0与缺失“—”。隐藏抓图的绘制帧未显示最终已勾选后的汇总；汇总值、覆盖度和来源变化重置由实际交互断言验证，不把截图当作该终态证据。

四张截图已实际查看，深色暖紫布局清晰，未见遮挡或溢出。QA使用原创本地合成短音和图片、隔离数据库；音频静音后实际解码和时间推进已验证，试听B后发布A及歌词确认不变。

按“不抢焦点”要求，测试专用Main构建在启动前抑制全部5处show/focus路径，生产Main不变。实际窗口始终不可见、无焦点，仅记录启动show被抑制；用Electron `capturePage(stayHidden:true)`获取渲染像素。未重新验收正常可见窗口的系统边框、安装启动或全新Windows兼容性。

## 一次独立审查与取舍

Astra只读审查基线至实现提交：无Critical、无Important，1项非阻塞Minor。未重复发起审查。

Minor暂缓：用户保留合法括号内容并已确认音频匹配时，`work-readiness.ts` 仍可能把括号提示合并为“试听并核对歌词与音频”。重复确认无法消除此引导，但独立发布准备入口仍可用。后续应将括号建议与缺少匹配确认分开。

审查边界与全部执行裁量记录：

1. 用户已明确要求按完整Astra设计执行，沿用独立检出并直接实现；误解的代价限定为可逆界面改动。
2. PowerShell7手动账本替代Unix脚本；代价是人工维护步骤状态。
3. 按用户追加要求加入作品摘要和腾讯连接状态；代价是界面范围稍增，服务能力不变。
4. 数据无可机器核验的统计口径，采用显式确认；代价是每个范围多一次确认。
5. 隐藏验收遵守不抢焦点；代价是正常可见窗口行为未重验。
6. 真实腾讯账户、素材与UIA不属于代码审查证据，单独保留现场记录；混同会夸大客户端上传能力。
7. 导航、导入、封面分组、持久错误体系不在本轮；代价是这些原有使用摩擦仍存在。
8. 发布文档在审查后补齐并核对；避免证据与交付说明不一致。
9. 上述Minor按计划暂缓，保留明确的下一轮修正点，不扩展成第二次实现/审查循环。

## 接入与现场证据边界

本轮客户端QA零真实调用。后续独立获准的腾讯正常页面操作已经实际上传一次音频、保存并重新打开草稿；那是外部UIA链路，不是本客户端按钮成功。当前客户端页面契约仍待校准、真实上传仍未接通。现场记录、账号与草稿标识只在被忽略的 `output/tme-observation` 中保留，不进入Git。

Suno/谱乐真实生成、多平台上传与在线统计、Codex图像API均未因本轮界面修改而接通；封面仍为人工协作、真实文件导入与显式选版。没有审核提交、签约、新授权选择或扣费。
