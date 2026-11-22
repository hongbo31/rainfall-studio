# 番茄目录上传一键核对与续跑

## 现场

同一批两首作品已有官网作品 ID，最近记录均为「待授权」。12:58 与 12:59 两次核对分别打开账号窗口并查询了两首的回执。旧版看到本批已有准备合同的记录便返回「合同待确认」，即使原预览页已经离开。

## 流程

- 「核对投稿状态」读取同一账号、本批作品 ID 和歌名的官网状态后继续执行。官网尚未生成合同时，从已有作品恢复签约准备，停在用户确认页。已生成合同时，根据官网合同 ID 进入授权合同页。等待该页加载合同编号，核对「查看作品」中的完整曲目和 ID，再打开官方签约链接。[番茄成品发行](https://www.novelfm.com/creator/music/finished/ugc) · [番茄授权合同](https://www.novelfm.com/creator/music/contract?menuid=authorize)
- 用户在官网确认签署并完成验证。Rainfall 观察本批签约页与官网回执，核对作品进入审核或已上架后更新状态并继续余下批次。重启或离开原页后使用已有作品续跑。现场这一批原先已选择准备合同，续跑时沿用本批记录。
- `src/main/fanqie/catalog-lookup.ts` 和 `src/shared/fanqie-catalog.ts` 保留官网两种待授权状态及精确的合同 ID。`src/main/fanqie/authorize-records.ts`、`directory-run.ts` 和 `directory-signature.ts` 负责核对与续跑。`upload-broker.ts` 将按钮请求绑定到原批次。`src/renderer/components/FanqieDownloadUpload.tsx` 沿用续跑前已确认的设置，编辑适用于下一批的设置才需要重新确认。

## 验证与交付

- `tests/fanqie-downloads.test.mjs` 复现按钮只核对后返回的问题，并验证一次点击即可恢复旧批次、观察验证页及在审核状态出现后自动完成。`tests/fanqie-authorization.test.mjs` 覆盖恢复未生成的合同、打开已有合同、等待官网填入合同编号、校验实际曲目及拦截其他合同。`tests/fanqie-directory-catalog.test.mjs` 与 `tests/platform-management-ui.test.mjs` 覆盖精确 ID、旧批状态和续跑按钮。
- 目录与界面回归 29 项、番茄回归 119 项及 TypeScript 检查通过。网页与 Windows 客户端使用同一套逻辑。原浏览器入口仅构建模式和 Windows Electron 后台桥接通过，桥接验证了旧批次与错误批次 ID 的处理。真实账号签署和 Windows 原生窗口仍待验收。
- 浏览器使用原 `Start-Rainfall-Browser.bat` 启动新版。回退时恢复本轮修改的源码和测试，保留原批次、作品和回执。
