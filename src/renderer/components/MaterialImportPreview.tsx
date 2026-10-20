import React, { useEffect, useRef, useState } from "react";
import { Badge, useStudio } from "../context";
import HelpNote from "./HelpNote";
import type {
  MaterialImportConfirmInput,
  MaterialImportPreview as ImportPreview,
  MaterialImportRow,
  MaterialImportRole,
  MaterialImportUpdateInput,
} from "../../shared/material-import";
import "../material-import-preview.css";

type Draft = Pick<
  MaterialImportUpdateInput,
  "title" | "lyricsPath" | "stylePath" | "coverPath" | "existingMaterialId"
>;
const draftOf = (r: MaterialImportRow): Draft => ({
  title: r.title,
  lyricsPath: r.lyricsPath,
  stylePath: r.stylePath,
  coverPath: r.coverPath,
  ...(r.existingMaterialId ? { existingMaterialId: r.existingMaterialId } : {}),
});
const roles: MaterialImportRole[] = ["lyrics", "style", "cover"];
const labels: Record<MaterialImportRole, string> = {
  lyrics: "歌词",
  style: "Style",
  cover: "封面",
};
const dirty = (r: MaterialImportRow, d: Draft) =>
  JSON.stringify(draftOf(r)) !== JSON.stringify(d);
const issueMessages: Record<string, string> = {
  IMPORT_ROLE_MISSING_OR_AMBIGUOUS: "文件缺失或有多个候选，请明确选择文件",
  IMPORT_ROLE_FILE_MISSING: "找不到指定文件，请重新选择或修正路径",
  IMPORT_DIRECTORY_UNREADABLE: "目录无法读取，请检查权限后重新扫描",
  IMPORT_FILE_UNREADABLE: "文件无法读取，请检查权限或更换文件",
  IMPORT_PATH_OUTSIDE_ROOT: "路径必须位于所选目录内，请重新选择",
  IMPORT_LINK_REJECTED: "不支持链接或重定向路径，请选择目录内的实际文件",
  IMPORT_ROOT_LINK_REJECTED: "所选目录是链接，请选择实际素材目录",
  IMPORT_ROOT_LINK_OR_NOT_DIRECTORY: "请选择实际文件夹，不支持链接或普通文件",
  IMPORT_MOUNT_REJECTED: "不支持跨磁盘挂载路径，请将文件放入所选目录",
  IMPORT_SPECIAL_FILE_REJECTED: "不支持此类特殊文件，请选择普通文件",
  IMPORT_PREVIEW_STALE_SOURCE: "来源记录已更新，请取消预览后重新扫描",
  IMPORT_SOURCE_BYTES_CHANGED: "源文件已变化，请取消预览后重新扫描",
  SOURCE_CHANGED_RESCAN_REQUIRED: "源文件已变化，请取消预览后重新扫描",
  IMPORT_ROOT_CHANGED: "来源目录已变化，请取消预览后重新选择目录",
  IMPORT_PREVIEW_NOT_FOUND: "预览已失效，请取消预览后重新扫描",
  IMPORT_SOURCE_NOT_FOUND: "找不到素材来源，请重新选择目录",
  IMPORT_ROW_NOT_FOUND: "此素材预览已失效，请取消预览后重新扫描",
  IMPORT_DUPLICATE_REQUIRES_ACKNOWLEDGMENT:
    "检测到重复素材，请核对后勾选重复导入确认",
  IMPORT_DUPLICATE_ACKNOWLEDGMENT_REQUIRED:
    "请先核对重复素材并勾选重复导入确认",
  IMPORT_FILE_SIZE_LIMIT: "文件过大，请缩小文件后重新扫描",
  IMPORT_TEXT_SIZE_LIMIT: "文本文件过大，请精简内容后重新扫描",
  IMPORT_MANIFEST_SIZE_LIMIT: "素材清单过大，请拆分后重新扫描",
  IMPORT_TOTAL_BYTES_LIMIT: "素材总大小超过限制，请分批导入",
  IMPORT_FILE_COUNT_LIMIT: "文件数量超过限制，请分批导入",
  IMPORT_ROW_COUNT_LIMIT: "素材数量超过限制，请分批导入",
  IMPORT_DEPTH_LIMIT: "目录层级过深，请将素材移到较浅的目录",
  IMPORT_LEGACY_INDEX_SCHEMA:
    "旧版索引格式不正确，请检查索引或改用每首歌一个文件夹",
  IMPORT_MANIFEST_SCHEMA: "素材清单格式不正确，请检查清单中的标题和相对路径",
  IMPORT_NO_MATERIAL_FOLDERS:
    "未找到素材文件夹，请每首歌使用一个文件夹并放入歌词、Style 和封面",
  IMPORT_TITLE_REQUIRED_OR_TOO_LONG: "请填写标题，且不超过 500 个字符",
  IMPORT_SOURCE_KEY_AMBIGUOUS: "素材标识重复，请检查清单中的对应关系",
  IMPORT_ROLE_FORMAT:
    "文件格式不支持，请为歌词和 Style 选择文本文件，为封面选择 PNG 或 JPG",
  IMPORT_TEXT_ENCODING: "文本编码无法识别，请将文件另存为 UTF-8 后重新扫描",
  IMPORT_TEXT_EMPTY: "文本内容为空，请填写内容后重新扫描或更换文件",
  IMPORT_STYLE_SECTION_AMBIGUOUS:
    "无法唯一确定 Style 段落，请明确选择对应的 Style 文件",
  IMPORT_METADATA_MISMATCH: "元数据与素材不对应，请检查编号和文件对应关系",
  IMPORT_COVER_ASSIGNED_MULTIPLE_ROWS:
    "同一封面对应了多首素材，请分别核对封面路径",
  IMPORT_EXISTING_IDENTITY_OUTSIDE_SOURCE:
    "所选历史素材不属于此来源，请重新选择对应记录",
  IMPORT_EXISTING_IDENTITY_ASSIGNED_MULTIPLE_ROWS:
    "同一历史素材对应了多行，请修正历史对应关系",
  IMPORT_IDENTITY_MATCHED_BY_EXACT_SOURCE_HASHES:
    "文件内容与已有素材一致，已对应原记录，请核对标题",
  IMPORT_EXPLICIT_TITLES_CONFIRMATION_REQUIRED:
    "请先确认所选素材的标题和文件对应关系",
  IMPORT_PREVIEW_HAS_ERRORS: "来源仍有问题，请修复后重新扫描",
  IMPORT_ROW_HAS_ERRORS: "所选素材仍有问题，请修复并重新校验",
  IMPORT_PREVIEW_COVER_UNAVAILABLE: "封面预览不可用，请检查封面文件并重新扫描",
  EACCES: "无法读取文件或目录，请检查访问权限",
  EPERM: "无法读取文件或目录，请检查访问权限",
  ENOENT: "找不到文件或目录，请检查路径后重新扫描",
  cover_missing: "封面缺失，请明确选择封面文件",
};
function ImportIssue({ message, path }: { message: string; path?: string }) {
  const token = message.match(
    /IMPORT_[A-Z_]+|SOURCE_CHANGED_RESCAN_REQUIRED|EACCES|EPERM|ENOENT|cover_missing/,
  )?.[0];
  const prefix = message.match(/^(lyrics|style|cover):\s*/)?.[1] as
    MaterialImportRole | undefined;
  const suffix = token?.startsWith("IMPORT_")
    ? message
        .slice(message.indexOf(token) + token.length)
        .replace(/^:\s*/, "")
        .trim()
    : "";
  const issuePath =
    suffix ||
    path ||
    message.match(/(?:EACCES|EPERM|ENOENT)[^'"\n]*['"]([^'"\n]+)['"]/)?.[1];
  let text = token && issueMessages[token];
  if (!text) {
    if (/SyntaxError|JSON/i.test(message))
      text = "清单或索引无法解析，请检查文件格式";
    else if (
      /unsupported image|corrupt|decode|pixel limit|invalid image|Input buffer/i.test(
        message,
      )
    )
      text = "封面无法解码或图片过大，请更换有效的 PNG 或 JPG 图片";
    else
      text =
        /[\u4e00-\u9fff]/.test(message) && !token
          ? message
          : "校验未通过，请核对文件和路径后重新扫描";
  }
  return (
    <div className="material-import-issue">
      <span>
        {prefix ? labels[prefix] + "：" : ""}
        {text}
      </span>
      {issuePath && (
        <small style={{ display: "block", overflowWrap: "anywhere" }}>
          {issuePath}
        </small>
      )}
      <details>
        <summary>查看原始错误</summary>
        <code style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
          {message}
        </code>
      </details>
    </div>
  );
}
export default function MaterialImportPreview({
  preview,
  onPreview,
  onClose,
  onImported,
  existingMaterials = [],
}: {
  preview: ImportPreview;
  onPreview: (value: ImportPreview) => void;
  onClose: () => void;
  onImported: () => Promise<void>;
  existingMaterials?: { id: string; title: string }[];
}) {
  const { call } = useStudio();
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(preview.rows.map((r) => [r.id, draftOf(r)])),
  );
  const [selected, setSelected] = useState(() => preview.rows.map((r) => r.id));
  const [expandedOptions, setExpandedOptions] = useState<
    Record<string, boolean>
  >({});
  const toggleOptions = (key: string, open: boolean) =>
    setExpandedOptions((old) =>
      old[key] === open ? old : { ...old, [key]: open },
    );
  const [confirmedTitles, setConfirmedTitles] = useState(false),
    [acceptDuplicates, setAcceptDuplicates] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [largeCoverId, setLargeCoverId] = useState("");
  const inFlight = useRef(false),
    dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    const origin = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => origin?.focus();
  }, []);
  const rows = preview.rows.filter((r) => selected.includes(r.id));
  const anyDirty = preview.rows.some((r) =>
    dirty(r, drafts[r.id] ?? draftOf(r)),
  );
  const duplicates = rows.some(
    (r) => r.duplicateMaterialIds.length > 0 || !!r.duplicateRowIds?.length,
  );
  const canConfirm =
    !busy &&
    rows.length > 0 &&
    !anyDirty &&
    !preview.errors.length &&
    rows.every((r) => r.ready) &&
    confirmedTitles &&
    (!duplicates || acceptDuplicates);
  const change = (row: MaterialImportRow, patch: Partial<Draft>) => {
    setDrafts((old) => ({ ...old, [row.id]: { ...old[row.id], ...patch } }));
    setConfirmedTitles(false);
    setAcceptDuplicates(false);
    setError("");
  };
  const save = async (row: MaterialImportRow) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const input: MaterialImportUpdateInput = {
        previewId: preview.id,
        rowId: row.id,
        ...drafts[row.id],
      };
      const next: ImportPreview = await call("materials.updatePreview", input);
      onPreview(next);
      const updated = next.rows.find((r) => r.id === row.id);
      if (updated) setDrafts((old) => ({ ...old, [row.id]: draftOf(updated) }));
      setConfirmedTitles(false);
      setAcceptDuplicates(false);
    } catch (e: any) {
      setError(e.message || "预览校验失败");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const confirm = async () => {
    if (!canConfirm || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const input: MaterialImportConfirmInput = {
        previewId: preview.id,
        rowIds: rows.map((r) => r.id),
        confirmTitles: true,
        ...(duplicates ? { acceptDuplicates: true } : {}),
      };
      await call("materials.confirmImport", input);
      await onImported();
    } catch (e: any) {
      setError(e.message || "导入失败，请重新扫描核对源文件");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const focusKeys = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key === "Escape" && !busy) {
      e.preventDefault();
      if (largeCoverId) setLargeCoverId("");
      else onClose();
    }
    if (e.key === "Tab") {
      const items = Array.from(
        e.currentTarget.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),select:not(:disabled),summary,[tabindex="0"]',
        ),
      ).filter((el) => el.getClientRects().length > 0);
      const first = items[0],
        last = items[items.length - 1];
      if (
        e.shiftKey &&
        (document.activeElement === first ||
          document.activeElement === e.currentTarget)
      ) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }
  };
  return (
    <div className="material-import-backdrop">
      <section
        ref={dialog}
        tabIndex={-1}
        className="material-import-preview"
        role="dialog"
        aria-modal="true"
        aria-label="素材导入预览"
        onKeyDown={focusKeys}
      >
        <header className="material-toolbar">
          <h2>素材导入预览</h2>
          <Badge>{preview.rebind ? "重新绑定预览" : "待确认"}</Badge>
          <button disabled={busy} onClick={onClose}>
            取消导入
          </button>
        </header>
        <div className="material-import-source">
          <span>{preview.root}</span>
          <Badge>来源修订 {preview.baseSourceRevision}</Badge>
          <HelpNote label="导入说明">
            预览不会修改素材、作品或队列。目录名和清单标题均需核对确认。修改文件对应关系后保存并重新校验；确认导入时会再次检查源文件。取消预览不会导入任何内容。重新绑定仅在确认后变更来源目录并保留匹配的历史记录。
          </HelpNote>
        </div>
        <HelpNote label="如何准备素材">
          每首歌使用一个文件夹，内含 lyrics.txt、style.txt 和
          cover.png/jpg/jpeg。也可使用清单指定相对路径。路径必须位于所选目录内；缺失或歧义文件需要明确选择，系统不会猜测。
        </HelpNote>
        {error && (
          <div role="alert" className="material-error">
            <ImportIssue message={error} />
          </div>
        )}
        {preview.errors.map((e, i) => (
          <div className="material-error" role="alert" key={i}>
            <ImportIssue message={e} />
          </div>
        ))}
        {preview.warnings.length > 0 && (
          <details>
            <summary>来源提示 ({preview.warnings.length})</summary>
            {preview.warnings.map((w, i) => (
              <ImportIssue key={i} message={w} />
            ))}
          </details>
        )}
        {!preview.rows.length && <p>未找到可预览的素材，请检查目录和文件。</p>}
        <div className="material-import-rows">
          {preview.rows.map((row) => {
            const draft = drafts[row.id] ?? draftOf(row),
              changed = dirty(row, draft);
            return (
              <article
                className="material-import-row"
                aria-label={"预览素材 " + row.id}
                key={row.id}
              >
                <div className="material-toolbar">
                  <label>
                    <input
                      aria-label={"导入 " + row.id}
                      type="checkbox"
                      checked={selected.includes(row.id)}
                      disabled={busy}
                      onChange={(e) => {
                        setSelected((old) =>
                          e.target.checked
                            ? [...old, row.id]
                            : old.filter((id) => id !== row.id),
                        );
                        setConfirmedTitles(false);
                        setAcceptDuplicates(false);
                      }}
                    />
                    导入此素材
                  </label>
                  <strong>{row.number || "未编号"}</strong>
                  <Badge tone={row.ready ? "ok" : "warn"}>
                    {changed ? "修改待校验" : row.ready ? "可导入" : "待修复"}
                  </Badge>
                  <small>{row.sourceKey}</small>
                </div>
                <label className="material-import-title">
                  标题
                  <input
                    aria-label={"标题 " + row.id}
                    value={draft.title}
                    maxLength={500}
                    disabled={busy}
                    onChange={(e) => change(row, { title: e.target.value })}
                  />
                  <Badge>待确认</Badge>
                </label>
                {row.suggestedTitle && row.suggestedTitle !== draft.title && (
                  <div className="material-toolbar">
                    <small>来源建议标题：{row.suggestedTitle}</small>
                    <button
                      disabled={busy}
                      onClick={() => change(row, { title: row.suggestedTitle })}
                    >
                      使用建议标题
                    </button>
                  </div>
                )}
                <div className="material-import-content">
                  <div className="material-import-cover">
                    {row.cover.previewUrl ? (
                      <button
                        className="material-import-cover-button"
                        aria-label={"放大封面 " + row.id}
                        onClick={() =>
                          setLargeCoverId(largeCoverId === row.id ? "" : row.id)
                        }
                      >
                        <img
                          className={largeCoverId === row.id ? "is-large" : ""}
                          src={row.cover.previewUrl}
                          alt={row.title + " 封面预览"}
                        />
                      </button>
                    ) : (
                      <span>暂无可用封面</span>
                    )}
                    <span>
                      {row.cover.width} × {row.cover.height}
                    </span>
                    <small>{row.coverPath || "未指定封面"}</small>
                    {row.checks.cover.sha256 && (
                      <small>{row.checks.cover.sha256}</small>
                    )}
                  </div>
                  <div>
                    <h3>歌词</h3>
                    <pre>{row.lyrics || "暂无已校验歌词"}</pre>
                    <h3>Style</h3>
                    <pre>{row.style || "暂无已校验 Style"}</pre>
                    {row.styleNotes && (
                      <details>
                        <summary>原始 Style 说明</summary>
                        <pre>{row.styleNotes}</pre>
                      </details>
                    )}
                  </div>
                </div>
                {row.errors.map((e, i) => (
                  <div className="material-error" key={i}>
                    <ImportIssue message={e} />
                  </div>
                ))}
                {row.warnings.length > 0 && (
                  <details>
                    <summary>素材提示 ({row.warnings.length})</summary>
                    {row.warnings.map((w, i) => (
                      <ImportIssue key={i} message={w} />
                    ))}
                  </details>
                )}
                {(row.duplicateMaterialIds.length > 0 ||
                  !!row.duplicateRowIds?.length) && (
                  <div className="material-import-duplicate">
                    <Badge tone="warn">检测到重复素材</Badge>
                    <small>
                      {[
                        ...row.duplicateMaterialIds,
                        ...(row.duplicateRowIds ?? []),
                      ].join("、")}
                    </small>
                  </div>
                )}
                <fieldset disabled={busy} className="material-import-paths">
                  <legend>文件对应关系</legend>
                  {roles.map((role) => {
                    const field = (role + "Path") as
                      "lyricsPath" | "stylePath" | "coverPath";
                    return (
                      <div className="material-import-role" key={role}>
                        <label>
                          {labels[role]}路径
                          <input
                            aria-label={labels[role] + "路径 " + row.id}
                            value={draft[field]}
                            onChange={(e) =>
                              change(row, { [field]: e.target.value })
                            }
                            placeholder="目录内的相对路径"
                          />
                        </label>
                        <details
                          onToggle={(event) =>
                            toggleOptions(
                              row.id + ":" + role,
                              event.currentTarget.open,
                            )
                          }
                        >
                          <summary>选择候选{labels[role]}</summary>
                          {expandedOptions[row.id + ":" + role] && (
                            <label>
                              候选文件
                              <select
                                aria-label={
                                  "候选" + labels[role] + " " + row.id
                                }
                                value=""
                                onChange={(e) => {
                                  if (e.target.value)
                                    change(row, { [field]: e.target.value });
                                }}
                              >
                                <option value="">选择候选文件</option>
                                {row.candidates[role].map((path) => (
                                  <option value={path} key={path}>
                                    {path}
                                  </option>
                                ))}
                              </select>
                            </label>
                          )}
                        </details>
                        <div>
                          {row.checks[role].valid ? (
                            "已校验"
                          ) : row.checks[role].reason ? (
                            <ImportIssue
                              message={row.checks[role].reason}
                              path={row.checks[role].path}
                            />
                          ) : (
                            <small>待校验</small>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </fieldset>
                <details
                  onToggle={(event) =>
                    toggleOptions(row.id + ":history", event.currentTarget.open)
                  }
                >
                  <summary>历史素材对应关系</summary>
                  {expandedOptions[row.id + ":history"] && (
                    <>
                      <label>
                        已有素材
                        <select
                          aria-label={"历史素材 ID " + row.id}
                          value={draft.existingMaterialId ?? ""}
                          disabled={busy}
                          onChange={(e) => {
                            const next = { ...draft };
                            if (e.target.value)
                              next.existingMaterialId = e.target.value;
                            else delete next.existingMaterialId;
                            setDrafts((old) => ({ ...old, [row.id]: next }));
                            setConfirmedTitles(false);
                            setAcceptDuplicates(false);
                          }}
                        >
                          <option value="">独立素材</option>
                          {draft.existingMaterialId &&
                            !existingMaterials.some(
                              (m) => m.id === draft.existingMaterialId,
                            ) && (
                              <option value={draft.existingMaterialId}>
                                {draft.existingMaterialId}
                              </option>
                            )}
                          {existingMaterials.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.title} · {m.id}
                            </option>
                          ))}
                        </select>
                      </label>
                      <HelpNote label="历史对应说明">
                        仅在确认是同一首素材时选择已有记录；同名不会自动合并。重新绑定会保留明确对应记录的
                        UUID、音频版本和发布历史。
                      </HelpNote>
                    </>
                  )}
                </details>
                <button
                  disabled={busy || !changed}
                  onClick={() => void save(row)}
                  aria-label={"保存并重新校验 " + row.id}
                >
                  保存并重新校验
                </button>
                {changed && (
                  <span className="material-import-unsaved">
                    预览内容仍为上次校验结果
                  </span>
                )}
              </article>
            );
          })}
        </div>
        <footer className="material-import-footer">
          <span>
            已选 {rows.length} / {preview.rows.length}
          </span>
          <label>
            <input
              type="checkbox"
              disabled={busy}
              checked={confirmedTitles}
              onChange={(e) => setConfirmedTitles(e.target.checked)}
            />
            我确认所选素材的标题和文件对应关系
          </label>
          {duplicates && (
            <label>
              <input
                type="checkbox"
                disabled={busy}
                checked={acceptDuplicates}
                onChange={(e) => setAcceptDuplicates(e.target.checked)}
              />
              我确认导入重复素材，保留独立记录和历史
            </label>
          )}
          {anyDirty && <span>请先保存并校验修改</span>}
          <div className="material-toolbar">
            <button
              className="primary"
              disabled={!canConfirm}
              onClick={() => void confirm()}
            >
              确认导入
            </button>
            <button disabled={busy} onClick={onClose}>
              取消预览
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
