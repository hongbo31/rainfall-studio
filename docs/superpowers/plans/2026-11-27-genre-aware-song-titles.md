# 曲风感知的动态歌名 Implementation Plan

> **For agentic workers:** Use the `superpowers:subagent-driven-development` workflow task-by-task. Scope is one focused Core change; do not dispatch another implementer.

**Goal:** 让 AI 作词结果中所有歌曲类型（人声与纯音乐）的歌名一、歌名二都贴合歌词/创作内容与音乐风格，并避免纯音乐标题变成乐器或制作说明。

**Architecture:** 在共享 Core 的 AI 作词/灵感生成 system prompt 中统一引导模型从歌词/创作内容与曲风提炼自然歌名；纯音乐提示禁止把乐器和制作术语直接放入标题，有单独 `style` 字段时留在该字段，没有时省略。曲风、形态、氛围、用途、年份和“爆款”等描述词可由 AI 按风格自由选用零到多个，不固定年份、也不要求每首出现。避重上下文、标题字段和双端调用路径沿用现状。

**Tech Stack:** TypeScript、Zod、现有 SQLite Repository / Plan Center storage。

**Spec:** `docs/superpowers/specs/2026-11-27-genre-aware-song-titles-design.md`

## Global Constraints

- 歌名须贴合本首歌词/创作内容与音乐风格；乐器名称、音色标签和编曲/制作说明不直接作为歌名，有单独 `style` 字段时留在 `style`，没有时省略。
- 动态描述词可为零到多个，含曲风/形态、氛围/用途、年份和流行感；即使 `style` 明确出现曲风词，也不要求标题必须带标签。“爆款”与年份可按歌曲风格自由选择，不固定某年、也不强制每首添加。
- 同一批避重只使用当前已经产生的标题；不得为等标题而串行化计划、增加自动模型调用或费用。
- 同艺人近期避重最多参考 50 个作品名，按 `createdAt` 倒序；缺失时间或空标题不进入列表。
- 新任务在初始预算计算时冻结标题提示上下文，并在后续派发复用，保证预算和实际请求一致。旧任务记录没有该可选内部上下文时沿用旧版系统提示，避免升级后旧请求长度变化导致预留预算不匹配；不做数据库迁移，API/UI 不暴露该字段。
- 同批上下文查询在 SQLite 中只投影歌名/备选歌名及关联所需 ID；不得把包含歌词、素材或账号信息的完整计划条目/歌词任务载入 Core。
- 延用 `title`、`alternateTitle`、现有清理与长度校验；无数据库迁移、无 UI 变化。
- 不新增或运行测试；交付前做静态审阅和 `git diff --check`。只提交拥有的实现及交接文件到本地 `codex/genre-aware-song-titles` 分支，不推送。
- 浏览器与 Windows 继续共用 `src/core/lyric-writing.ts` 中的业务逻辑。

## Review Focus

- 歌名核心意象丢失或描述词与歌曲不符：核对每种生成提示都要求先提炼核心意象、描述词可省略。
- 乐器/制作细节进入纯音乐歌名：确认专属提示只要求这些信息启发歌曲意象；有单独 `style` 字段时保留在该字段，没有时省略。
- 人声歌名与歌词脱节：确认标题提示要求同时遵循歌词主题/记忆句与曲风，不只匹配 style 标签。
- 同批任务并行时标题尚未生成：仅使用当前已有标题，不改变工作流调度；明确这属于避重提示而非硬性唯一性保证。
- 同名艺人串入其他艺人的作品：近期历史必须按稳定的 `artistId` 精确筛选。
- 年份或“爆款”被写死/强制使用：提示允许自由选择，但不固定词语或年份，也不要求每首使用。

---

### Task 1: 共享曲风感知歌名提示与避重上下文

**Files:**
- Modify: `src/core/lyric-writing.ts`
- Modify: `handoff/2026-11-27-genre-aware-song-titles.md`
- The project manager updates `docs/project/board.md` after review.

**Interfaces:**
- Consumes: Existing `LyricWritingService`, `Job.planAttemptId`, `Repository.db` SQLite projections over `works` and Plan Center `settings`, plus the `CenterStore` key helpers.
- Produces: Existing `title` and `alternateTitle` outputs; no IPC/API contract changes.

- [x] Update `titleGuidance` so vocal, instrumental, and inspiration generation all ask for a short core name first, then optionally add zero or more relevant descriptors. Keep the core name first. Permit dynamic combinations such as “蹦跳墨尔本2027年爆款DJ纯音乐”, “蹦跳墨尔本纯音乐”, or “蹦跳墨尔本爆款”; make clear these are examples, not a fixed template.
- [x] Add optional internal title-prompt context to new saved lyric jobs and hide it from `visible()` output. Freeze the context before automatic budget calculation so it is reused for the actual generation request. During title-generation prompts, add only title strings: at most 50 nonempty recent `works.title` values for the exact same artist, sorted by `createdAt`; and available earlier-ordinal title strings from the same Plan Center run when `planAttemptId` maps to a lyric stage attempt. Do not read lyrics, assets, account details, or other artists’ works.
- [x] If an older stored job has no title-prompt context marker, keep its legacy system prompt so an upgrade cannot silently increase the prompt beyond that job's already reserved budget. Do not migrate old rows.
- [x] Keep title avoidance outside `creativeBrief()` hashing so retry-draft compatibility does not change. Include avoidance context only in title-generation request input; review/rewrite prompts should not receive it.
- [x] Preserve current title schemas, character cleanup, title limits, A/B distinction, job reservation, and scheduling behavior. Do not make new paid model calls or add hard uniqueness claims.
- [x] Update this handoff with actual changed files, behavior, static review evidence, unverified items, and rollback path. Do not revert any pre-existing uncommitted docs.
- [x] Inspect all three generation request branches and the recent-title filter statically; run `git diff --check` only. Do not add or run tests, start a visible app/browser, or call paid text APIs.
- [x] Commit only `src/core/lyric-writing.ts` and `handoff/2026-11-27-genre-aware-song-titles.md` on the local feature branch. Do not push or stage project-manager documentation.

- [x] Keep same-batch SQL reads title-only: query material title fields and required relation IDs without decoding complete plan items or lyric jobs containing lyrics/assets. Preserve the existing version-selection semantics while projecting only the selected title values. A follow-up review fix also guards malformed primitive/null legacy versions while preserving the previous truthy/falsy fallback behavior.

**Implementation note:** Plan Center siblings can be concurrent. Include titles that exist when a prompt is built; do not serialize other items just to manufacture an avoidance list. The model prompt reduces repetition but cannot guarantee unique model output.

---

### Task 2: 让 AI 作词歌名贴合内容与曲风

**Files:**
- Modify: `src/core/lyric-writing.ts`
- Modify: `handoff/2026-11-27-genre-aware-song-titles.md`
- The project manager updates `docs/project/board.md` after review.

**Interfaces:**
- Consumes: Current `LyricWritingService.messages()` branches, `songType`, lyric/inspiration input, and the generated `style` field.
- Produces: Existing `title` and `alternateTitle`; no UI, API, or database shape changes.

- [x] Revise the common generation guidance so both candidate titles fit the song's lyrics/creative content and style. For vocal works, draw from the lyrical theme, memorable phrase, action, or image; for instrumental works, draw from the music's identity without turning a style description into the title.
- [x] Keep instrument names, synth timbres, arrangement techniques, and production phrases out of titles; when the current output has a separate `style` field, keep those details there, and omit them when no such field exists. Do not produce title-shaped production notes such as “纸页翻动时的雾感合成器”. Preserve distinct, natural A/B title cores.
- [x] Keep genre/format/mood/use/year/popularity descriptors optional and variable. Neither title is required to carry a descriptor, even if `style` names a genre. AI may freely choose “爆款” and a year based on song style; do not hardcode 2027 or force any tag. Preserve user examples as possibilities, not a template.
- [x] Apply the shared natural-title rule to the red-box `title`/`alternateTitle` result fields for all song types: vocal generation and instrumental generation, plus inspiration title generation. Do not scope the core content/style matching rule to instrumental songs only. Instrumental-specific guidance that references generated `style` must be limited to the instrumental branch that actually emits `style`.
- [x] Preserve exact legacy prompts for existing jobs without `titleAvoidance`, the existing budget snapshot, title schema/cleanup, and no-extra-call behavior.
- [x] Update handoff with actual files, changes, static review evidence, unverified behavior, and rollback. Do not revert unrelated user changes.
- [x] Statically inspect human-vocal, instrumental, and inspiration generation system prompts, verify no style/production wording is copied into title instructions as title content, and run `git diff --check`. Do not add or run tests, typecheck, build, call paid APIs, or launch clients.
- [x] Commit only the implementation and handoff on local branch `codex/genre-aware-song-titles`; do not push. After review, project manager updates the board separately.
