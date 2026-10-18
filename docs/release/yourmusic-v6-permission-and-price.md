# 谱乐 v6 权限、积分与两首请求准备

2026-10-16 限定只读核验。**认证成功；当前 API Key 的 v6 执行权限、正常模式单次两首准确积分与成本上界仍未确认。没有提交付费任务。**

## 已取得的证据

1. [当前官方 OpenAPI](https://api.yourmusic.fun/v1/openapi.json?lang=zh) 本次无凭据重新取得 HTTP 200。custom 模型枚举为 chirp-v6、chirp-v6-wild、chirp-v6-mini；一次 Suno 提交返回两首。这是通用接口合同，不能当成当前账号授权响应。公开 GET 仅有历史/结果、上传任务、分轨工具及声音任务查询，没有模型权限、账户余额或报价接口。没有猜测私有端点，也没有将 vault 密钥导出到脚本。
2. [正常已登录 API 控制台](https://api.yourmusic.fun/dashboard) 实际显示可用积分 **385**。Suno 自定义生成价格行仍显示“3 / 5 积分”，明细只列 v3-5 至 v5.5，没有 v6。不能把旧型号 5 积分、每首 5 积分或 10 积分合计套用于 v6。
3. 控制台明确生成类在提交成功后扣积分，查询类不扣积分。Max Mode 合同明确每首两倍积分，本次预备参数为 false。关闭 MaxMode 也不能补足缺失的 v6 基础价格。
4. [供应商 v6 帮助页](https://yourmusic.fun/suno-v6) 自己明确该页不作为谱乐接入公告，是否支持与权限须看实际产品选项。该页介绍的是 Suno 自有 Pro/Premier/免费套餐，不能移植为谱乐 API Key 权限。站点[“收费标准”页](https://yourmusic.fun/pricing-standard) 实为广告投放收费，没有音乐 API 的 v6 报价。

本轮只读信息未能完成 v6 执行授权或准确费用确认。不能断言“只能付费试调”：供应商可人工确认或提供免费权限/报价接口；当前可核对资料没有该接口，继续试探不同端点不合理。若供应商只接受付费试调，必须先说明 v6 正常模式一次返回两首的扣费总额/上限及失败扣费规则，再决定是否另行授权。**当前没有已验证的付费请求最大成本，385 余额也不代表安全的单次预算。此次只读调查触发积分消费为 0。**

## 充值、余额与既有消费

- [账单页](https://api.yourmusic.fun/dashboard/billing) 同样显示余额 385，并存在既有“专业套餐 480 积分 / 已支付”记录。它不是本次操作创建的充值；没有点充值套餐、创建订单、付款或申请发票。
- [用量页](https://api.yourmusic.fun/dashboard/usage) 可见 10-10 至 10-16 的调用图，总次数 2，峰值“10-16 · 2 次”。这个页面没有提供可对应 v6 的模型权限、单次报价或积分消费明细。不能把这些次数当作付费生成次数，也不能从 480 与 385 的差额推断历史消费额。
- 控制台和账单两次观察余额均为 385。本轮只有官方公共 GET 与正常会话导航读取；没有生成 POST、充值、发布或每日计划变更。没有再次点击客户端认证检查。
- 浏览器使用原有正常登录会话；客户端此前认证沿正常 Main/vault 路径完成。没有读取密钥或网页认证头。没有把浏览器 session 与 API Key 的账户主体作秘密比对，因此浏览器余额注明来源，不提升为 API Key 绑定账户的已证实余额。

## 已准备但未提交

`docs/integrations/yourmusic-v6-two-output-request.json` 是不含认证信息的完整请求 body。目标为 `POST https://api.yourmusic.fun/v1/suno/generate/custom`，**仅一次提交、预期返回 A/B 两个版本**，不连发两个请求。Suno custom 没有 n 参数，未添加 n=2。

参数：chirp-v6、非纯音乐、中文流行抒情、温暖告白、男声、88 BPM 风格标签、180 秒、is_max_mode=false、aug_creativity=0。它使用仓库既有《从今天起》四行原创副歌样本；这些是准备用默认值，**不是用户确认的完整歌曲定稿**，没有改写用户作品或每日计划。后续正式作品应替换为用户选定的已确认歌词。

模型资格与准确费用未确认，所以该文件不带自动提交脚本、认证头、Key、自动重试或执行队列。生产付费 transport 保持未注册。

## 本机证据与验证

- 公开资料：`output/yourmusic-v6-recheck-openapi.json`、`output/yourmusic-v6-recheck-dashboard.html`、`output/yourmusic-v6-public-recheck-receipt.json`。
- 正常会话脱敏观察：`output/yourmusic-v6-normal-browser-observation.json`、`yourmusic-v6-live-pricing-observation.json`、`yourmusic-v6-billing-observation.json`、`yourmusic-v6-usage-card-observation.json`。
- 汇总结论：`docs/integrations/yourmusic-v6-readiness-2026-10-16.json`。
- 本次仅新增准备文件与证据说明，未改动执行代码、账号配置或用户数据。对 body 依据刚取得的 GenerateCustomDto 检查必填字段、字段类型、枚举、上下限、字符串长度及禁止额外字段，并检查 false MaxMode 和固定两首响应合同。
