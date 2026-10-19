# Drive v2 真实请求交接（2026-10-19）

本轮明确授权的隔离验收；不是生成成功回执。请求已由现有 PlanCenterService 保存到独立 SQLite，再由 syncPlanDot/exportPlanDotRequests 原样投影；未手工伪造 R、owner 或 generation。独立进程重开返回 unchanged。Google Drive 连接器重新读取了同步文件，2316 字节及文件 SHA256、contentHash、完整 R 一致。

## 可信目录与绑定

- 云端隔离项目：https://drive.google.com/drive/folders/160R7bkKmzjr9ejtsFRz-9ed5heioTqFy
- requests：https://drive.google.com/drive/folders/1UzrBotSXY4X-eoVShuA6YrmcA2ipkaFQ
- incoming 回传：https://drive.google.com/drive/folders/1q0vwFKuGJIdhPMpRb6tbYu13vF7EPVrA
- receipts 回读：https://drive.google.com/drive/folders/1Ko9zIQ-xW2p_dnPwSvNkvugNbBhhVLfe
- 真实 generation：https://drive.google.com/file/d/1EGo0mHUW7VDuOnJG246U5Nj72Yk1fq4O/view?usp=drivesdk
- Windows项目路径：`G:\我的云端硬盘\Rainfall Studio\dot-delivery\acceptance-v2-20261019`
- ownerId：`22aaaf87-47d5-419e-8643-d1e1afe410c1`
- channelId：`9ad441b7-2386-40be-bb35-b894a015a984`
- workspaceId：`91a53f80-6a6f-444e-820f-391dfcf4c1e7`
- workspaceRef：`rainfall-v2-acceptance-20261019`
- artistRef：`acceptance-creator`，artistId：`c514ac9c-4f94-42d7-a9e0-b0ff7168b181`
- generation sequence：1；contentHash：`7240ca9a26e158c80d3f885a3e83080784b67abd22f312ee2c02904565be6c45`
- generation文件原始字节SHA256：`ea93ebea057924dabb78bbb46a936ef4293b03d3f7351f10c647186dcf48407b`

正式库的已启用通道仍绑定父级 dot-delivery，历史隔离通道已暂停但保留相同父级绑定。本次先只读核对该事实，未向父级 incoming/receipts/requests 放包；新项目是父级下独立子目录，正式接收器只扫描原 incoming，不扫描本项目。没有把旧channel/artist映射复制给新工作区，没有修改正式计划或绑定。

## 完整真实请求 R（逐字段原样 requestEcho）

```json
{
  "requestVersion": 2,
  "requestId": "cad2433f-19a2-4680-9908-e6d988cd819a",
  "requestHash": "5d1ce61ea264288221e1cee873590b5b69d9f6ce906f6fd5a4fff502eb6c51cc",
  "planId": "44ed0192-6046-46c8-8380-8d36e298aec8",
  "planRevision": 1,
  "runId": "05b28431-37df-424d-a77c-7e8f9a099e44",
  "itemId": "05b28431-37df-424d-a77c-7e8f9a099e44:item:1",
  "ordinal": 1,
  "profileIdentity": "acceptance-creator",
  "channelId": "9ad441b7-2386-40be-bb35-b894a015a984",
  "workspaceId": "91a53f80-6a6f-444e-820f-391dfcf4c1e7",
  "workspaceRef": "rainfall-v2-acceptance-20261019",
  "artistId": "c514ac9c-4f94-42d7-a9e0-b0ff7168b181",
  "artistRef": "acceptance-creator",
  "expectedExternalItemId": "pc-58888831e34a7670e7c3bfb646a9e1bd8cb63c188676157eff846ee214cb8e0d",
  "revision": 1,
  "outputs": {
    "lyrics": true,
    "cover": true,
    "music": false
  },
  "brief": {
    "title": "把顺路走成每天",
    "theme": "温柔恋爱日常故事：两个人因下雨相识，从下班顺路并肩、记住彼此咖啡口味，到把普通的一天过成轻轻的告白。写一份完整原创中文歌词与一张原创封面；情绪温暖克制、细节具体，不引用现有歌曲，不使用真实人物肖像。不生成音频，不发布。",
    "styleTemplate": "中文温柔流行；木吉他与柔和钢琴的画面感，中慢节奏；歌词自然可唱。封面以雨后街角、两把靠近的伞、暖窗和淡紫暮色构图，方形，无字，不模仿现存专辑。"
  },
  "createdAt": "2026-10-19T07:00:11.957Z",
  "expiresAt": "2026-10-26T07:00:11.957Z"
}
```

autopublish 不是 R schema 字段，不能往 requestEcho 添加该字段；本地计划实际为 enabled=false、publishTargets=[]、authorization.publish=false，且 music=false、music.consent=false。没有运行模型评分/音乐/发布业务 tick。请求导出时 works/assets/operations/ledger 均为0。

## 父会话 producer 回传

请以同一 owner 的最高完整有效 generation 为准，只处理 pending 且未过期 R。生成一份完整原创中文歌词和一张静态原创封面，无音频、无发布。不要修改 R，不要因暂时没有回执重生成。

1. producer 持久固定 requestId/requestHash → batchId/deliveryId；建议本次固定 `dot-rainfall-acceptance-20261019-001`，重复投递沿用相同 ID 与最终字节。
2. 在本项目 incoming 下提交同名目录，包含 text.json（Inbox schemaVersion:2，requestEcho完整复制上面的R，externalItemId/revision/artistRef/workspaceRef与R相同）、封面文件、manifest.json、最后的 READY.json。
3. 本次 R.cover=true：可用 deliveryVersion:1 的既有文本+封面包装，或本轮 deliveryVersion:2 严格包装；必须且只交付一张对应封面。封面是 PNG/JPEG/WebP 静态图，命名 cover-<原始字节SHA256>.png/jpg/webp，文件、尺寸、MIME、字节数按实际填写。不要把 CoverHandoff 工作室 JSON 当作 PlanDot 文本包。
4. text 的 draft 必须符合现有 CreativeDraft schema：title/topic/storyBeat/language/style/instrumental、sections/hook/vocalPlan、suno与yourmusic两份musicPrompts、continuityNotes；这些提示词不是音频生成调用。provenance填真实producer/model或null，不能假报已生成音频。
5. 哈希对最终文件原始字节计算，READY只含deliveryId与manifestSha256。同步文件未齐会waiting；不要覆盖已接受包。完整旧v1包装字段详见 dot-plan-drive-protocol-20261019.md，新增纯歌词路径见 dot-delivery-v2-lyrics-only.md。
6. 回传完成后告知父会话精确 deliveryId。客户端可执行下述一次收件；再通过云端 receipts 链接读回匹配 manifestSha256、batch/workspace/items/coverSha，核对本地association的requestId/hash/run/item。imported/model_pending不表示评分、音乐或发布完成。

## 一次收件与边界

在仓库根执行（无可见窗口）：

```powershell
node scripts/prepare-drive-v2-acceptance.mjs --electron out/album-service-91aa54160c11-1792392157056/RainfallStudioCandidate.exe --receive-once
```

该命令重新构建当前源码的专用Core模块，借用已安装Electron的Node运行时；它不是启动旧版客户端Main。只连接上面的现有隔离工作区，做有界收件、requestEcho关联、不可变状态投影和回执写回；不调用模型评分、音乐或发布，不启动定时/后台常驻任务。完成后退出。默认准备命令不要在已消费后反复运行来制造新请求。

07:04 UTC 已对空incoming执行一次收件，候选/草稿/资产/作品/操作/费用均0，bridge及receiver lastError=null。尚无producer返回包，真实回传/封面入库/云端receipt回读尚未验收。没有声称免费Codex图像API或自动唤醒dot。
