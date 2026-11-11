# 0.8.2-preview.1 原生交付

2026-10-17，SOURCE_WINDOWS_HOST。用户07:34 UTC明确授权打开最新客户端，此前的问题同时说明了验收和更新入口范围。产品源码 `2d065bd9183a0dd317d8d7f9d1415aa170b29273`，程序未追加修改。

当前同一个桌面快捷方式 `C:\Users\CLOUD_USER\Desktop\Rainfall Studio 音乐客户端.lnk` 已指向已验收0.8.2。实际进程PID28488，EXE为 `out/deep-copy-cleanup-2d065bd9183a-1792222241041/RainfallStudioCandidate.exe`；原dataRoot仍为 `out/tme-readiness-f98b20328ab4-1792145753240/candidate-data`。窗口停留《示例作品A》详情，试听已暂停。

- 旧0.8.1在作品库，搜索/新系列名/故事线输入均为空，已记录输入状态，正常关闭其已核对PID42612；未杀其他应用。
- 真正Windows桌面打包EXE验收26项通过，真实runtime返回packaged=true、appVersion=0.8.2-preview.1及原production root，fixtureBridge=false。
- 原作品详情实际DOM和UIA中，“这首作品，下一步”、重复“试听并核对歌词与音频”、常驻A/B与版权长段均不存在；“发布版本A”、试听/保存/封面/发布动作在位，A/B帮助键盘可用。
- 八个主菜单、五个平台配置及四分类可打开，顶栏三项36px/13px一致；1280×800和1000×700无横向溢出，版本位于播放器上方。
- 原封面可见，A/B均真实解码、播放时间推进并可暂停；不将机器播放检验当人工听感评价。原生QA正常关闭退出0，随后从更新后的原快捷方式打开，再经Windows UIA试听A和暂停。
- 重复原快捷方式复用PID28488；直接重复启动EXE的PID44916退出0，仍只有一个本项目可见主窗口，原PID和启动时间未变。Windows原生异常和本地生命周期失败均0。
- 两库37张表核对：原作品、配置、费用、任务、授权记录保持，4个素材SHA256一致；仅既有调度器clock.checkedAt正常推进。腾讯任务仍awaiting_terms_review、revision20、submissionByClient=false、remoteId=null。

备份与回滚：`output/deep-copy-native-delivery-backup-1792222544378`，包含旧指针、快捷方式、启动脚本、两库一致性副本和原四素材。旧0.8.1完整包保留。回滚应正常关闭本项目后恢复备份入口/指针，继续使用原库，不删除新版数据或用空库覆盖。

证据：`output/deep-copy-native/native-verification.json`、`repeat-verification.json`、`desktop-cycle-1.json`、`data-preservation.json`、`final-verification.json`。后台回归和28视图文案清单仍见上个交付说明。

真实窗口截图已保存Library，含Windows窗框、原作品与实际版本，无演示bridge：

| 截图 | 本地文件（output/deep-copy-native） | library_file_id | file_id |
| --- | --- | --- | --- |
| 新版作品详情 | desktop-work.png | libfile_aa9db96677f08191b91d9ae63b5ecc24 | file_000000003488820cb3418d62f59c3680 |
| 真实A版试听 | desktop-A-playing.png | libfile_eedf917c41a88191b5112851d0decefa | file_00000000bcdc820ca3ede7f623857b74 |

Library试听文件因同名保留为desktop-A-playing(1).png，本地原始路径仍是desktop-A-playing.png，两者身份和哈希已关联。未收费生成、绑定账号、正式提交、接受条款或推送远程Git。仍为离线便携开发交付，第三方接入权限不因本次验收增加；没有剩余阻塞本次打开和桌面交付的问题。
