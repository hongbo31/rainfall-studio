import React, { useEffect, useId, useRef, useState } from "react";
import {
  promptContentLength,
  promptContentLimit,
  type PromptSummary,
  type SavedPrompt,
} from "../../shared/prompt-library";
import { date, useStudio } from "../context";

type Draft = Pick<SavedPrompt, "id" | "name" | "content"> & { revision: number | null };

export default function PromptLibrary() {
  const { call, data, notify } = useStudio();
  const countId = useId();
  const inFlight = useRef(false);
  const [prompts, setPrompts] = useState<PromptSummary[] | null>(null);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void call("promptLibrary.list").then(result => {
      if (active) setPrompts(result);
    }).catch(() => {
      if (!active) return;
      setError("读取提示词失败，请重新搜索。");
      setPrompts([]);
    });
    return () => { active = false; };
  }, [call]);

  const reload = async (keyword: string) => {
    try {
      setPrompts(await call("promptLibrary.list", { query: keyword }));
      setQuery(keyword);
    } catch {
      setError("读取提示词失败，请重新搜索。");
    }
  };

  const run = async (action: () => Promise<void>, failure: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (cause) {
      const code = (cause as { code?: string } | null)?.code;
      if (code === "REVISION_CONFLICT" || code === "NOT_FOUND") {
        await reload(query);
        setError("这条提示词已变更，请重新打开后再试。");
      } else {
        setError(failure);
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const searchFor = (keyword: string) => {
    setDeleteId(null);
    void run(() => reload(keyword.trim()), "搜索提示词失败，请重试。");
  };
  const open = (id: string) => {
    setDeleteId(null);
    void run(async () => {
      setDraft(await call("promptLibrary.get", { id }));
    }, "打开提示词失败，请重试。");
  };
  const count = promptContentLength(draft?.content ?? "");
  const tooLong = count > promptContentLimit;
  const save = (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft || !draft.name.trim() || !draft.content.trim() || tooLong) return;
    const { id, name, content, revision } = draft;
    void run(async () => {
      await call("promptLibrary.save", { id, name, content, expectedRevision: revision });
      setDraft(null);
      notify("提示词已保存");
      await reload(query);
    }, "保存提示词失败，请重试。");
  };
  const remove = ({ id, revision }: PromptSummary) => {
    setDeleteId(null);
    void run(async () => {
      await call("promptLibrary.delete", { id, expectedRevision: revision });
      notify("提示词已删除");
      await reload(query);
    }, "删除提示词失败，请重试。");
  };

  const loading = prompts === null;
  const linkedArtists = deleteId ? [...data.artists.filter((artist: { accountLocalArtist?: boolean }) => !artist.accountLocalArtist), ...(data.accountLocalArtists ?? [])]
    .filter((artist: { promptTemplateId?: string | null }) => artist.promptTemplateId === deleteId).length : 0;
  return (
    <section className="panel prompt-library" aria-label="提示词管理">
      <div className="section-title">
        <h2>提示词管理</h2>
        <button type="button" className="primary" disabled={busy || loading || !!draft} onClick={() => {
          setError("");
          setDeleteId(null);
          setDraft({ id: crypto.randomUUID(), name: "", content: "", revision: null });
        }}>＋ 新增提示词</button>
      </div>
      {error && <p role="alert">{error}</p>}
      {draft && (
        <form className="prompt-editor" aria-label={draft.revision === null ? "新增提示词" : "编辑提示词"} onSubmit={save}>
          <label>
            提示词名称
            <input required autoFocus disabled={busy} value={draft.name}
              onChange={event => setDraft({ ...draft, name: event.target.value })} />
          </label>
          <label>
            提示词内容
            <textarea required rows={12} disabled={busy} value={draft.content} aria-describedby={countId} aria-invalid={tooLong}
              onChange={event => setDraft({ ...draft, content: event.target.value })} />
          </label>
          <p id={countId} className={tooLong ? "notice" : "muted"} role={tooLong ? "alert" : undefined}>
            {count.toLocaleString("zh-CN")} / {promptContentLimit.toLocaleString("zh-CN")} 字
            {tooLong && " · 请缩短提示词内容"}
          </p>
          <div className="button-row">
            <button type="submit" className="primary" disabled={busy || !draft.name.trim() || !draft.content.trim() || tooLong}>保存提示词</button>
            <button type="button" disabled={busy} onClick={() => { setDraft(null); setError(""); }}>取消</button>
          </div>
        </form>
      )}
      <form className="prompt-search" role="search" aria-label="搜索提示词" onSubmit={event => {
        event.preventDefault();
        searchFor(search);
      }}>
        <input type="search" aria-label="提示词搜索关键词" placeholder="按名称或内容搜索"
          value={search} onChange={event => setSearch(event.target.value)} disabled={busy || loading} />
        <button type="submit" disabled={busy || loading}>搜索</button>
        {(search || query) && <button type="button" disabled={busy} onClick={() => { setSearch(""); searchFor(""); }}>清空</button>}
      </form>
      {loading ? <p role="status">正在读取提示词…</p> : prompts.length === 0 ? (
        <p className="muted">{query ? "未找到匹配的提示词。" : "暂无提示词。"}</p>
      ) : (
        <ul className="prompt-list" aria-label="提示词列表">
          {prompts.map(prompt => (
            <li className="row" key={prompt.id}>
              <div className="prompt-list-name"><strong>{prompt.name}</strong><small className="muted">{date(prompt.updatedAt)}</small></div>
              {deleteId === prompt.id ? (
                <div className="button-row" role="group" aria-label={`删除 ${prompt.name}`}>
                  <span>确认删除？{linkedArtists > 0 && `将解除 ${linkedArtists} 位艺人的关联。`}</span>
                  <button type="button" disabled={busy} onClick={() => remove(prompt)}>确认删除</button>
                  <button type="button" disabled={busy} onClick={() => setDeleteId(null)}>取消</button>
                </div>
              ) : (
                <div className="button-row">
                  <button type="button" disabled={busy || !!draft} onClick={() => open(prompt.id)}>查看 / 编辑</button>
                  <button type="button" disabled={busy || !!draft} onClick={() => setDeleteId(prompt.id)}>删除</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
