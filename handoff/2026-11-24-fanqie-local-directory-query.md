# 番茄本批作品查询失败

## 证据与原因

用户指出素材来自配置中心的本地下载目录。最新浏览器运行 `dd15be47-6183-4e3e-a2b8-c2c813e1110d` 的 trace 先记录账号读取成功，再进入 `catalog:batch-lookup`，约 18 秒后报 `FANQIE_CATALOG_LOOKUP_FAILED`。这发生在本地歌曲表单打开之前。下载目录扫描在第 1 步已发现 111 首候选、109 首可用。

番茄自动化会用每首本地歌曲的名称调用番茄创作者站的只读作品列表接口查重。失败来自浏览器内的官网请求，和本地文件是否位于配置中心下载目录无关。旧实现吞掉了 fetch 异常，也把所有非 2xx 状态压成同一错误码。

## 改动

- `src/main/fanqie/catalog-lookup.ts` 保留统一业务错误码，并将 fetch 的异常类型及非 2xx HTTP 状态、安全的响应类型写入 cause，供运行 trace 记录。
- `src/main/fanqie/directory-trace.ts` 同时提取 cause 的异常说明，供后续执行日志解释底层失败。
- 曾尝试让 `src/main/fanqie/directory-page.ts` 每次创建新页面。之后发现这会丢失番茄登录标签页可能依赖的会话状态，且时间上与目录接口失败相符，因此已恢复复用安全起始页面。

## 验证与边界

- `scripts/Start-Rainfall-Browser.ps1 -BuildOnly` 浏览器候选构建通过。未运行测试或真实账号请求。运行 dd15be47 的既有日志无法反推出它当时的 HTTP 状态或网络异常，因为原实现没有记录该信息。
- 下一次执行若再次失败，`catalog:batch-lookup` 事件会保留 HTTP 状态或浏览器 fetch 异常，届时可区分登录拒绝、服务器错误及网络失败。

## 回退

还原 `catalog-lookup.ts` 与 `directory-trace.ts` 中的 cause 诊断，移除本交接文件即可恢复原来的错误吞并行为。`directory-page.ts` 已恢复原逻辑。
