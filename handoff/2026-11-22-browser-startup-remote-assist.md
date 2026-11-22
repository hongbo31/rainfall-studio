# 浏览器启动修复

## 原因与改动

- `Start-Rainfall-Browser.bat` 在构建阶段报 `ERR_MODULE_NOT_FOUND`。远控服务迁移后，构建脚本仍然导入已移除的 `src/main/sms-apk.ts`，共用界面也仍然依赖旧短信接口。
- `scripts/build-desktop.mjs` 和 `scripts/package-tme-candidate.mjs` 改用现有远控 APK 校验和暂存模块。浏览器和 Windows 共用的主进程、预加载及界面完成构建。
- `src/renderer/main.tsx` 移除了旧短信页面入口。`src/renderer/pages/RemoteAssist.tsx`、`src/renderer/components/RemoteAssistConnection.tsx` 和 `src/renderer/remote-assist.css` 在「远控」页通过现有远控接口提供网卡选择、配对地址、APK 下载二维码、六位口令和设备管理。移除了旧短信页面及其独立样式。
- 同一个 BAT 继续按仓库位置构建，不增加盘符或路径依赖。现有配对记录由远控服务按既有兼容逻辑读取。

## 验证

- 修复前用启动脚本的 `-BuildOnly` 复现截图中的模块缺失。修复后在仓库外运行同一个 BAT 的 `-BuildOnly`，构建成功。Node 24 的 TypeScript 检查通过。
- 后台启动实编 Electron 浏览器服务和无头 Chromium，验证总览、远控页和认证后的工作区快照。使用在同级预览目录创建的隔离离线测试库。
- 22 项浏览器工作台、远控服务、远控界面及路径兼容回归通过。覆盖设备确认、二维码、口令校验、停止连接、旧配对读取和超时清理。苏诺之音的 8 项模拟生成、下载及异常场景也通过。
- 两条扩展的任务中心回归断言旧的「谱乐 WAV 传输超时」文案，实际展示的是「谱乐音频下载超过 10 分钟，可重试原歌曲下载」。这两条检查仍失败。

## 交付范围与回退

- 验证使用隔离库。默认浏览器的可见打开动作、Windows 原生窗口、正式桌面打包与手机真机验收待完成。APK 服务使用测试夹具验证，本次预览快照没有新安卓安装包。
- 需要回退时，可回到最近可用的浏览器预览快照或从兼容的源码版本重建。回退不需要迁移作品、删除历史配对或更换桌面快捷方式。
