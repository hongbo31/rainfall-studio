# 番茄封面裁剪确认与 200 首批次

## 问题与证据

2026-11-27 的目录上传 trace 已成功完成歌曲 1 的音频、歌词、标题和三类署名。`upload:cover` 随后进入 `confirm-square-crop`，在封面裁剪弹窗定位处立即报 `ReferenceError: dialog is not defined`，后续 `upload:cover` 和 `directory:form` 也因同一异常失败。用户截图与 HTML 显示页面实际存在唯一可见的 Arco `role="dialog"` 弹窗，标题为“裁剪图片 (1/1)”，底部有“确定”按钮。因此按钮没被点击是因为定位函数在候选按钮查询前不存在，并非等待时间不够或按钮不可用。

## 修改

- 在目录上传表单恢复按可访问对话框名称精确定位、并保留无 role 弹窗标题回退的 `dialog()` helper。封面流程现在能定位“裁剪图片 (1/1)”并继续核对唯一可见“确定”按钮；仍等待裁剪弹窗关闭和封面读回成功后才继续。
- `fanqieDownloadBatchLimit` 从 100 调整到 200。共享 schema、目录上传设置界面、单次上传校验和计划中心复用此常量，允许新默认和用户设置达到 200；已有持久化的较低批量值会保留，用户可在设置中调到 200。
- 核对多首表单路径：目录运行按配置上限分批组装；表单按顺序逐首填写音频、可选歌词、标题、词作者、曲作者、歌手、封面及其他适用字段；官方虚拟列表通过索引和滚动定位卡片；点击“下一步”前再次遍历整批并逐字段读回，发现缺项时修复后重读，读回通过后才允许确认上传。

## 影响、验证与未验证

- 仅影响番茄目录上传弹窗定位和批次上限/默认值；不改作品库、素材或账号数据，不重放已提交作品。
- 对照用户提供的 Arco 裁剪弹窗 HTML，在 headless Chromium 中验证按 dialog 名称和“确定”按钮精确定位为唯一、可用；修改文件的定向 `git diff --check` 通过。全仓 `tsc --noEmit` 仍被既有错误阻断（`directory-run.ts`、`native-upload.ts`、远程协助类型依赖、苏诺 DOM 类型及计划执行标签重复键），本次 `directory-form.ts` 与批次上限未报新增类型错误。
- 运行现有目录表单隔离用例时，合成站点在封面阶段之前因旧艺人 fixture 缺少当前官网 DOM 所需的 `.artist-autocomplete-select` 而报 `FANQIE_AUTHOR_REGION_UNVERIFIED`，因此无法借该 fixture 覆盖封面提交或 200 首表单。未运行真实官网上传、200 首正式提交或构建。200 首实际耗时、官网页面资源压力及平台端 200 首接收仍需用隔离账号/未投稿样本验收，不复用已提交作品。
- `verified-desktop.json` 当前不可用，未能核验正式桌面数据根；未打包、未更新桌面入口或启动客户端。

## 回退

若需要回退，仅将 `src/shared/fanqie-downloads.ts` 上限恢复到 100，并从 `src/main/fanqie/directory-form.ts` 移除新增的 `dialog()` helper；同步恢复本交接及 `PROJECT-HANDOFF.md` 索引内容。用户保存在账号配置中的批次上限不被本次修改覆写。
