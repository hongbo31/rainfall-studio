# 曲风感知的动态歌名 Implementation Plan

> **For agentic workers:** Use the `superpowers:subagent-driven-development` workflow task-by-task. Scope is one focused Core change; do not dispatch another implementer.

**Goal:** 让 AI 为每首歌先提炼核心歌名，再按本首曲风和内容动态选择可选描述词，降低同批及同艺人近期标题重复。

**Architecture:** 在共享 Core 的作词/灵感提示中统一加入“核心名 + 可变描述”的命名规则。生成阶段按需提供同艺人最近 50 个作品名和同一计划执行中已生成的先前标题作为避重提示；保留现有标题字段、校验、计划节奏和浏览器/Windows 调用路径。

**Tech Stack:** TypeScript、Zod、现有 SQLite Repository / Plan Center storage。

**Spec:** `docs/superpowers/specs/2026-11-27-genre-aware-song-titles-design.md`

## Global Constraints

- 核心歌名在前，动态描述词在后；描述数量、组合和词序按歌曲变化，且可全部省略。
- 可选描述涵盖曲风/形态（如 DJ、纯音乐）、氛围/用途（如助眠、空灵）以及年份/流行感（如 2027 年、爆款）；年份不得硬编码。
- 同一批避重只使用当前已经产生的标题；不得为等标题而串行化计划、增加自动模型调用或费用。
- 同艺人近期避重最多参考 50 个作品名，按 `createdAt` 倒序；缺失时间或空标题不进入列表。
- 新任务在初始预算计算时冻结标题提示上下文，并在后续派发复用，保证预算和实际请求一致。旧任务记录没有该可选内部上下文时沿用旧版系统提示，避免升级后旧请求长度变化导致预留预算不匹配；不做数据库迁移，API/UI 不暴露该字段。
- 延用 `title`、`alternateTitle`、现有清理与长度校验；无数据库迁移、无 UI 变化。
- 不新增或运行测试；交付前做静态审阅和 `git diff --check`。只提交拥有的实现及交接文件到本地 `codex/genre-aware-song-titles` 分支，不推送。
- 浏览器与 Windows 继续共用 `src/core/lyric-writing.ts` 中的业务逻辑。

## Review Focus

- 歌名核心意象丢失或描述词与歌曲不符：核对每种生成提示都要求先提炼核心意象、描述词可省略。
- 纯音乐和人声使用错误描述：核对提示上下文传递 `songType`、曲风和本首内容。
- 同批任务并行时标题尚未生成：仅使用当前已有标题，不改变工作流调度；明确这属于避重提示而非硬性唯一性保证。
- 同名艺人串入其他艺人的作品：近期历史必须按稳定的 `artistId` 精确筛选。
- 年份被固定或凭空生成：年份只在本首创作/发行语境明确时加入，否则省略。

---

### Task 1: 共享曲风感知歌名提示与避重上下文

**Files:**
- Modify: `src/core/lyric-writing.ts`
- Modify: `handoff/2026-11-27-genre-aware-song-titles.md`
- The project manager updates `docs/project/board.md` after review.

**Interfaces:**
- Consumes: Existing `LyricWritingService`, `Job.planAttemptId`, `Repository.all("works")`, and Plan Center item/stage records.
- Produces: Existing `title` and `alternateTitle` outputs; no IPC/API contract changes.

- [x] Update `titleGuidance` so vocal, instrumental, and inspiration generation all ask for a short core name first, then optionally add zero or more relevant descriptors. Keep the core name first. Permit dynamic combinations such as “蹦跳墨尔本2027年爆款DJ纯音乐”, “蹦跳墨尔本纯音乐”, or “蹦跳墨尔本爆款”; make clear these are examples, not a fixed template.
- [x] Add optional internal title-prompt context to new saved lyric jobs and hide it from `visible()` output. Freeze the context before automatic budget calculation so it is reused for the actual generation request. During title-generation prompts, add only title strings: at most 50 nonempty recent `works.title` values for the exact same artist, sorted by `createdAt`; and available earlier-ordinal title strings from the same Plan Center run when `planAttemptId` maps to a lyric stage attempt. Do not read lyrics, assets, account details, or other artists’ works.
- [x] If an older stored job has no title-prompt context marker, keep its legacy system prompt so an upgrade cannot silently increase the prompt beyond that job's already reserved budget. Do not migrate old rows.
- [x] Keep title avoidance outside `creativeBrief()` hashing so retry-draft compatibility does not change. Include avoidance context only in title-generation request input; review/rewrite prompts should not receive it.
- [x] Preserve current title schemas, character cleanup, title limits, A/B distinction, job reservation, and scheduling behavior. Do not make new paid model calls or add hard uniqueness claims.
- [x] Update this handoff with actual changed files, behavior, static review evidence, unverified items, and rollback path. Do not revert any pre-existing uncommitted docs.
- [x] Inspect all three generation request branches and the recent-title filter statically; run `git diff --check` only. Do not add or run tests, start a visible app/browser, or call paid text APIs.
- [x] Commit only `src/core/lyric-writing.ts` and `handoff/2026-11-27-genre-aware-song-titles.md` on the local feature branch. Do not push or stage project-manager documentation.

**Implementation note:** Plan Center siblings can be concurrent. Include titles that exist when a prompt is built; do not serialize other items just to manufacture an avoidance list. The model prompt reduces repetition but cannot guarantee unique model output.
