# 番茄目录上传同名歌手核对

2026-11-23，北京时间。RF-006 由 backend 实现合作艺人查询，qa 负责独立复现和批次验收，xb 接入批次、发布表单和构建。

## 原因与改动

- 旧发布表单按歌手姓名统计可见候选。多个同名时直接停止，返回较慢时也可能先看到另一位同名艺人。官网合作艺人页会显示账号名册里的艺人 ID，发布表单用艺人 ID 保存所选歌手。[合作艺人页面脚本](https://lf-serial-static.fanqienovel.com/obj/novel-serial-cdn/novel/fm_creator/dashboard/static/js/async/music-platform___dashboard/account/artist/page.4f4a9d14.js) · [歌手选择组件](https://lf-serial-static.fanqienovel.com/obj/novel-serial-cdn/novel/fm_creator/dashboard/static/js/async/9323.2abfa0a1.js)
- `src/main/fanqie/directory-run.ts` 在首次打开发布表单前，取本批候选的不同歌手名并查询。已确认投稿的歌曲按原回执或已有作品跳过。批内重复歌手共用一次查询。若合作名单没有唯一 ID，该歌手的歌曲记录具体原因，其余可发布的歌曲继续原流程。
- `src/main/fanqie/catalog-session.ts` 在同账号后台页打开「艺人信息 → 合作艺人」，搜索前后校验官网 UID。`src/main/fanqie/artist-creation.ts` 复用艺人搜索与翻页，核对实际请求的搜索名、页码和总数，收集所有精确同名的 ID。按字符串保留 19 位数字并对相同 ID 去重。
- `src/main/fanqie/directory-form.ts` 将合作名单核对到的 ID 带到「歌手」字段。用渲染候选绑定的 `artist.id` 选中对应艺人，核对详情请求的 `artist_id`，再读已选标签绑定值。点击「下一步」和确认上传前复核整批。一旦 ID 缺失或不匹配，表单结束在确认上传前。`src/shared/fanqie-downloads.ts` 增加对应的简短提示。[艺人详情脚本](https://lf-serial-static.fanqienovel.com/obj/novel-serial-cdn/novel/fm_creator/dashboard/static/js/async/9189.9d0346bc.js)
- 平台管理、计划中心和任务中心使用同一目录上传执行器，浏览器与 Windows 客户端使用同一实现。本轮身份核对覆盖目录上传的「歌手」字段。原回执、作品和批次历史沿用既有存储格式。

## 验证

- `tests/fanqie-directory-singers.test.mjs` 与艺人创建回归覆盖分页、重复 ID、多 ID、缺页、搜索响应不匹配及前后账号变化。
- `tests/fanqie-directory-catalog.test.mjs` 与 `tests/fanqie-downloads.test.mjs` 在独立 QA 隔离目录合跑 36 项通过。名册第 2 页才返回正确 19 位 ID，表单首项是其他同名艺人。模拟批次选中准确 ID、确认上传一次、跳过已投稿作品，签约仍由原确认流程处理。
- `tests/fanqie-directory-form.test.mjs` 与 `tests/fixtures/fanqie-directory-site.mjs` 增加 5 项定向无头回归。覆盖同名错误项先出现、艺人详情 ID 不一致、已选标签 ID 不一致、点击「下一步」后 ID 被换成另一位同名艺人。核对失败的用例均在上传确认前停止。
- 最终源码上的目录表单、批次、合作艺人查询和艺人创建无头回归共 37 项通过，见 `integration/form-and-roster-verified.log`。
- 目录、任务调度和基础回归 110 项，随包 Electron Node 模式 95 项，模拟番茄适配器和授权 31 项，番茄计划 18 项，平台与浏览器桥接界面 2 项通过。用 Windows 随包 Electron Node 模式复跑目录端到端用例，3 项通过。TypeScript 和原入口的 `-BuildOnly` 通过，构建快照与本轮 5 个运行源码文件的 SHA-256 一致。隔离日志位于 `../rainfall-studio-build/verification/rf006-c3387dd1`，以仓库根目录为基准。

## 待验收与回退

官网证据来自公开静态资源，提交动作使用隔离模拟站。真实账号投稿、Windows 原生窗口待验收。现有浏览器进程继续使用原快照，下次从原 `Start-Rainfall-Browser.bat` 启动会读取本轮源码。

回退时只撤回本轮所列文件中的差异，再用原入口构建。保留既有作品、账号、执行记录与官网回执。
