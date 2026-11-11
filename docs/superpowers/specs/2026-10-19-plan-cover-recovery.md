# 最终歌词封面恢复与本地重试

已采纳范围：纯歌词与封面计划在模型改写后，可显式保存最终歌词到本地作品、进入既有封面工作室，以本地真实图片完成交接和显式选图，再返回原计划重试。保留原 dot 请求和原始素材，不触发音乐、图片 API、扣费或发布。

`planCenter.prepareCoverWork` 只接收 item ID、最终 draft ID 和 pair hash。Core 在 SQLite immediate 事务内从已成功评分、持久评价与最终稿推导艺人和内容，保存无音频、无旧封面的本地作品。独立 `plan-cover-work:<itemId>` 记录 run/item/artist/work/final draft/pair/raw lyrics/title/score/source，重复调用复用作品；停止、过期或跨范围输入拒绝写入。

封面成功须有该作品、当前上下文的 CoverHandoff 请求和真实图片 receipt，用户显式选择的 asset 必须匹配 receipt 和实际文件。原素材的旧图片 hash 不得解除改写阻塞。同图的旧上下文 receipt 不遮蔽当前上下文有效 receipt；同上下文重复导入保持证明稳定。工作室仅为此类作品禁用无交接的直接导入，停止/最终内容变化/执行结束时显示锁定原因。普通作品保持既有行为。

异步图片读取结束后，在持久化资产的 immediate 事务内复核计划和上下文；receipt 提交再次复核。cover/materials worker 只处理 ready 或当前已持久 claim 的 dispatching attempt，整个本地执行与记录置于同一事务，dispatching 不重复 claim，unknown 不执行。materials 完成前再次核对最终歌词、上下文、当前选图及已成功 cover 的证明。

验证顺序：先用真实生产 Core 和隔离 SQLite 复现缺入口与 dispatching 悬停；再验证完整恢复、材料 retry、幂等、停止、重启 unknown、旧图、错艺人、歌词/选图漂移、旧 receipt、损坏文件、异步停止；最后运行现有音频绑定/封面歌词/UI 回归、typecheck 与实际 React 应用无头路径截图。脚本为 `scripts/test-plan-cover-recovery.mjs` 和 `scripts/test-plan-cover-recovery-ui.mjs`。不读取正式数据库或凭据；无原生窗口和真实平台执行。源码未提交，由主任务统一审查和打包。
