# 番茄音乐歌词附件可选

2026-11-27，用户提出番茄音乐上传时，作品没有歌词可以不上传歌词文件。

## 实现

- 有效歌词仍按原流程准备、上传并核对官网回执。
- 作品没有歌词、扫描目录里没有对应 TXT、或对应 TXT 为空/纯空白时，不生成空歌词附件，也不阻断上传；音频、封面、标题和署名仍照常校验。
- 单曲来源、目录批次和材料清单都允许缺少歌词附件。上传角色列表只在存在有效歌词附件时包含歌词。
- 上传步骤会记录 `upload:lyrics:skipped-no-lyrics`，便于从执行记录确认未上传歌词。
- 有歌词文件但编码无效、含 NUL、超过大小限制或内容无法通过既有校验时，仍按错误处理；不会把损坏文件当成无歌词静默跳过。

## 涉及文件

- `src/shared/fanqie.ts`
- `src/core/fanqie.ts`
- `src/core/fanqie-work.ts`
- `src/core/fanqie-downloads.ts`
- `src/shared/fanqie-downloads.ts`
- `src/main/fanqie/materials.ts`
- `src/main/fanqie/native-upload.ts`
- `src/main/fanqie/first-step.ts`
- `src/main/fanqie/directory-run.ts`
- `src/main/fanqie/directory-form.ts`
- `src/main/fanqie/upload-broker.ts`
- `src/main/fanqie/catalog-session.ts`

## 影响与验证范围

不改变纯音乐逻辑和合同/授权边界。已做静态调用链检查，覆盖作品解析、材料扫描、空白歌词归一、上传角色选择、表单回读和材料清单解析。本轮未运行测试或构建，未打开番茄官网，也未操作账号或提交作品。

## 回退

共享工作树含其他并行修改。回退时只撤销本交接所列的歌词可选判断和对应文案，不要整体还原这些共享文件。保留已有任务记录与其他上传改动。
