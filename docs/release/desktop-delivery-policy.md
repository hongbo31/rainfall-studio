# 桌面统一交付规范

用户于2026-10-16明确要求：“后续有新版了，都往我的桌面生成最新的一版”。含义是后续验收通过的交付版继续更新同一个 当前用户桌面的 `Rainfall Studio 音乐客户端.lnk`，不让用户在测试候选文件夹间寻找新版。未验收测试候选不得覆盖桌面入口；保留原作品、素材、配置及可回退版本。这是持续交付要求，不代表开启在线自动更新。

## 固定入口与数据根

桌面入口调用 PowerShell 7 和稳定脚本 `%LOCALAPPDATA%\RainfallStudioLauncher\Launch-Verified.ps1`。该脚本的源码在 `scripts/Launch-Verified.ps1`。

当前权威指针是同目录 `verified-desktop.json`，包含已验收标记、源码提交、可执行文件、完整包目录、显式dataRoot和关键程序文件哈希。每次启动先校验包和现有SQLite头/版本，再启动真实本地库；已由该入口启动的同一窗口会复用。发现其他旧窗口时不强制关闭，保留未保存编辑并提示。缺库或包变化时不启动空白库。

现有数据根以 `verified-desktop.json` 中的 `dataRoot` 为准。它是持续使用的作品库。后续更换运行包时必须复用该目录。如需迁移数据，先备份并验证作品 ID、数量、素材 SHA-256 和配置，再显式切换。

旧版管理器的 `Launch.ps1/current.json` 留作历史回退，没有被篡改为与其asar目录格式不兼容的新指针。当前桌面不再调用该旧入口。旧版独立目录和数据保持原样。

## 每次交付验收

1. 只读记录当前.lnk、启动配置、实际进程、已使用库、作品ID和素材状态。若运行窗口可能有未保存编辑，不强制关闭。
2. 备份快捷方式、当前指针和启动脚本；数据升级前另做SQLite一致性快照和素材备份。不读取或导出凭据，不覆盖旧作品。
3. 新版在独立目录完成构建及所需检查，确认数据schema兼容和现有素材可读。只在已验收后更新verified-desktop.json、稳定脚本及同一个桌面.lnk，保留上一指针、原包和原库。
4. 从桌面快捷方式实际启动，核对实际EXE、源码提交、显式dataRoot、作品数量/ID、音频播放及封面显示；再次点击应复用同一窗口。
5. 若不可验证，保留旧入口，不把“文件已复制”当成交付完成。报告截图、实际版本与数据路径、备份位置。回退只恢复此前备份的入口/指针，不删除新版数据；回退旧库不会自动显示之后新增的作品。

## 本次修复证据（2026-10-16）

桌面原入口是Windows PowerShell→旧Launch.ps1→`0.5.0-preview.2-229097c93bd7`，实际旧真实库0首、0素材；更早legacy真实库亦0首。正确库有《示例作品A》work `00000000-0000-4000-8000-000000000002`、两个真实音频和两个封面版本，隔离演练库仍有三首原示例。没有数据丢失或需要合并的旧真实作品。

已备份到 `output/desktop-entry-repair-20261016-1344`：原.lnk与属性、旧启动脚本和配置、三个SQLite一致性快照、四个素材的哈希一致副本。凭据未读、未复制；没有数据迁移或重复导入。

当前桌面指向已验收源码 `06b7cb11d619eaedfe86806488607242ab3aa3f1`，运行包 `out/music-live-once-06b7cb11d619-1792156137836`。已从同一个.lnk实际启动，打开作品库及原作品，A/B均可加载播放，封面可见。证据为 `output/desktop-fixed-launch-verification.json`、`desktop-fixed-library-verification.json`、`desktop-fixed-cover-verification.json`、`desktop-fixed-repeat-invocation.json` 和 `desktop-launch-negative-verification.json`。变更哈希的隔离配置被拒绝，未影响生产指针；重复入口的启动时间比较曾被PowerShell日期解析影响，已统一UTC标准时间后验证。

截图 `output/desktop-fixed-play-A.png` 已上传Library：`libfile_732e4fe4ec0c8191a7c0924544083d9d`。本次不继续已暂停的Gmail工作、不发信、不生成音乐、不发布、不推Git。
