# 《示例作品A》封面交接诊断

2026-10-16 12:52 UTC，已在SOURCE_WINDOWS_HOST当前候选Main30528窗口与只读数据库核对。页面为封面工作室，显示图片接口未配置；创建请求后停在等待真实图片，没有运行时错误提示。Core的cover.request只保存绑定作品上下文的请求，provider为dot_handoff，cover.list返回unconfigured、executionEnabled=false。没有图像API调用或自动调度当前dot。

用户截图选定请求为 `eb8307de-95a7-425e-bff5-01ea6789e5e3`，作品 `00000000-0000-4000-8000-000000000002`，完整contextHash `0c8147c54502161e0c294f6cc40dd1bcaabe725874c999f6c2fc9bf6570463c5`，workspaceRef `1b3ff7e8-0ae1-4335-bfc4-ae7f78435c53`。状态awaiting_result，封面回执为空，作品尚未关联cover。另有用户后续保存的请求，本次不创建新请求、不改动任一请求。音乐A/B资产不变。

问题在于“创建封面生成请求”容易被理解为已经启动出图。最小修复只改现有封面页：按钮“保存封面交接请求（不出图）”，明确提示把提示词/请求交给支持出图的会话，拿到图片后导入；等待状态补充具体下一步。不新增供应商或假一键接口。原有manifest导入、真实图片导入、版本选择仍保留。

确切原请求、完整提示词和机器可读约束已导出到 `output/cover-results/leave-a-light-eb8307de/{request.json,prompt.txt,result-requirements.json}`。导入约束：PNG/JPEG/WebP、方形512–10000px、单张≤50MiB、≤100MP。3000×3000是本地目标，原生1024/1536方图可导入并保留原件，再本地派生适配。manifest图片名仅同目录basename，SHA256、MIME和宽高取实际文件；来源只按实际生成者声明，未知模型和时间填null，不伪造证明，generationVerified仍false。

原请求画面方向：无字方形母版，雨天街角、雨夜、暖紫与雾蓝、细腻电影感留白；歌曲故事是下班回家、留灯、一起晚饭与对普通共同生活的期待，曲风温柔恋爱流行。生成工具可据此表现暖灯窗口与日常陪伴，不模仿其他作品。歌名艺名在应用后续排版。

修复前UI断言针对旧误导措辞确实失败；修复后封面/歌词相关15/15通过，项目测试3/3通过，TypeScript通过。日志 `output/cover-handoff-label-{red,green}.log`、`output/cover-handoff-project-tests.log`、`output/cover-handoff-typecheck.log`。当前仅源码修复，运行窗口仍为f3f8500包；待父会话提供真实图像后合并完成候选更新及导入视觉验收，避免宣称当前窗口已经更新或封面已经生成。

## 真实图片闭环已完成（13:10 UTC）

父会话通过内置image_gen生成，原图Library ID `libfile_6d6112ca4ebc81919593afc921840f69`。使用Library准备物化和原版文件传输helper下载；Windows Python缺少os.setxattr，临时兼容runner将身份/版本元数据持久保存在NTFS命名数据流，原helper未修改，下载未使用第三方托管。

实际原图1254×1254、PNG、2206517字节、SHA256 `c4b195e81b380a459dd2ebd37dbf3708578e74afc4f115432340e82dcac364fc`。manifest的producer为image_gen，实际具体模型和生成时间未提供，因此均为null。回执是external-manifest来源声明，generationVerified=false，不把声明当作身份认证。

正常关闭Main后，用客户端现有CoverHandoff.receiveFile、work.selectAsset与exportCover实现导入和导出，再正常重开验收；未绕过图片及上下文校验，未直接修改SQL。原请求eb8307de已received，原图资产 `df894955-ded9-4719-a54a-21b1dde1eebc`。无字3000×3000本地放大派生资产 `86162979-d34e-4c96-a492-bdf71dec304e`，parentId指向原图，14525433字节，SHA256 `640e251428f11921ad25220159975cb6cd4406f791a952c3a3cae50015aa252a`，已选为该作品封面。没有宣称原生3000，也未烧入“我的艺人”占位文字。

真实视觉验收另外发现旧预览额外叠加账户名、已有回执仍显示通用等待提示，已做有限修复：真实封面预览只显示图片、默认无字导出、展示实际尺寸及本地派生提示，有回执后显示已有图片接收记录。对应新增断言先失败，修复后封面/歌词16/16通过，项目3/3、类型检查、Desktop构建通过。

最终候选源码 `06b7cb11d619eaedfe86806488607242ab3aa3f1`，实际Main18268，启动器 `out/music-live-once-06b7cb11d619-1792156137836/Launch-Rainfall.cmd`，数据根仍为原tme-readiness目录。正常重开后原请求已接收，实际预览、两版本、3000派生选中状态均保留；无通用等待假状态及占位艺名叠字。原有两次请求仍只有2条，本次未新增请求；另一条用户先前创建的请求保留原状态。音乐A/B及其他作品、plans/dailyPlans/publication units哈希不变。

证据：`output/leave-a-light-cover-final-verification.json`、`output/leave-a-light-cover-final-ui-verification.json`、`output/leave-a-light-cover-import-receipt.json`。文件为 `output/cover-results/leave-a-light-eb8307de/cover.png` 与 `示例作品A-封面-3000x3000-无字-放大派生.png`。

三个Library交付均已成功：重开预览截图 `libfile_88a3f7de8e648191b15c690db491b017`，接收记录和实际尺寸截图 `libfile_76a900a4cc008191970f25323047d773`，3000放大派生PNG `libfile_7657ee5a30e88191adf04ffa07333a76`。完整成功回执在 `output/leave-a-light-cover-library-upload-receipt.json`。

用户后续要求界面仅保留生成图片/导入图片，并让当前dot自动出图回填。这个新自动触发流程尚未实现，不把本次人工协调完成的真实图像闭环冒充自动一键。已有交接控件将来应移入工程诊断，待真正的唤醒机制确认后再实施。
