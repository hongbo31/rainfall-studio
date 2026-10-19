import React, { useEffect, useRef, useState } from "react";
import { useStudio } from "../context";
import type { PlanCenterPublishTarget } from "../../shared/plan-center";
import type { PlanAlbumCatalog } from "../../shared/plan-albums";
import { hasPlanAlbumAdapter } from "../../shared/plan-albums";

export const albumSource = (value: {
  source?: string;
  onlineVerified?: boolean;
}) =>
  value.source === "offline-fixture"
    ? "离线夹具 · 线上未验证"
    : value.onlineVerified
      ? "官方证据 · 当前账号已验证"
      : "官方接入 · 线上未验证";
const completeness: Record<string, string> = {
  complete: "完整目录",
  partial: "部分目录",
  "visible-candidates": "可见候选",
};
export function albumCatalogs(value: any): PlanAlbumCatalog[] {
  return Array.isArray(value)
    ? value
    : Array.isArray(value?.catalogs)
      ? value.catalogs
      : value?.catalog
        ? [value.catalog]
        : value?.entries
          ? [value]
          : [];
}
export function AlbumCatalogEvidence({
  catalog,
}: {
  catalog: PlanAlbumCatalog;
}) {
  return (
    <p className="plan-album-evidence">
      {albumSource(catalog)} ·{" "}
      {completeness[catalog.completeness] ?? catalog.completeness}
      <br />
      观察时间 {catalog.observedAt} · 有效期至 {catalog.expiresAt}{catalog.coverage&&<><br />{catalog.coverage.source==='official-album-directory'?'官方专辑目录':'待发布歌曲引用'} · 已读 {catalog.coverage.pagesRead} 页 / {catalog.coverage.rowCount} 条 · {catalog.coverage.complete?'该来源已遍历':'该来源未完整遍历'}</>}
    </p>
  );
}
export function AlbumCapabilities({ value }: { value: any }) {
  return (
    value && (
      <details className="plan-album-capabilities">
        <summary>专辑能力与缺口</summary>
        {(["query", "select", "create", "append", "reconcile"] as const).map(
          (key) => {
            const c = value[key];
            if (!c) return null;
            return (
              <p key={key}>
                {
                  {
                    query: "目录查询",
                    select: "ID 绑定",
                    create: "新建专辑",
                    append: "追加准备",
                    reconcile: "新建原操作核对",
                  }[key]
                }
                ：
                {c.implemented === false
                  ? "尚未实现"
                  : c.available
                    ? "可用"
                    : "代码路径已实现，当前不可用"}
                {[
                  ...new Set([
                    ...(c.missing ?? []),
                    ...(c.reasons ?? []),
                    ...(c.reason ? [c.reason] : []),
                  ]),
                ].map((reason: any) => (
                  <code key={String(reason)}>{String(reason)}</code>
                ))}
              </p>
            );
          },
        )}
      </details>
    )
  );
}

export default function PlanAlbumFields({
  target,
  index,
  update,
  busy,
}: {
  target: PlanCenterPublishTarget;
  index: number;
  update: (changes: Partial<PlanCenterPublishTarget>) => void;
  busy: boolean;
}) {
  const { call } = useStudio();
  const supported = hasPlanAlbumAdapter(target.platform);
  const [loaded, setLoaded] = useState<{
      key: string;
      catalogs: PlanAlbumCatalog[];
      capabilities: any;
    } | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  const request = useRef(0);
  const key = JSON.stringify([target.platform, target.accountId]);
  const selectedAlbumId =
    target.album.mode === "existing" ? target.album.albumId : "";
  const catalogs = loaded?.key === key ? loaded.catalogs : [],
    capabilities = loaded?.key === key ? loaded.capabilities : null;
  useEffect(() => {
    const ticket = ++request.current;
    setError("");
    if (!target.accountId || !supported) {
      setLoaded(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    void Promise.all([
      call("planAlbums.catalog", {
        platform: target.platform,
        accountId: target.accountId,
      }),
      call("planAlbums.capabilities", {
        platform: target.platform,
        accountId: target.accountId,
      }),
    ])
      .then(([c, cap]) => {
        if (ticket === request.current)
          setLoaded({ key, catalogs: albumCatalogs(c), capabilities: cap });
      })
      .catch((e) => {
        if (ticket === request.current) setError(e.message);
      })
      .finally(() => {
        if (ticket === request.current) setLoading(false);
      });
    return () => {
      request.current++;
    };
  }, [key]);
  const refresh = async () => {
    if (!supported) return;
    const ticket = ++request.current;
    setLoading(true);
    setError("");
    try {
      await call("planAlbums.refresh", {
        platform: target.platform,
        accountId: target.accountId,
      });
      const [c, cap] = await Promise.all([
        call("planAlbums.catalog", {
          platform: target.platform,
          accountId: target.accountId,
        }),
        call("planAlbums.capabilities", {
          platform: target.platform,
          accountId: target.accountId,
        }),
      ]);
      if (ticket === request.current)
        setLoaded({ key, catalogs: albumCatalogs(c), capabilities: cap });
    } catch (e: any) {
      if (ticket === request.current) setError(e.message);
    } finally {
      if (ticket === request.current) setLoading(false);
    }
  };
  return (
    <div className="plan-album-fields">
      <div className="form-grid">
        <label>
          专辑方式
          <select
            aria-label={`专辑方式 ${index + 1}`}
            value={target.album.mode}
            disabled={busy || !supported}
            onChange={(e) =>
              update({
                album:
                  e.target.value === "new"
                    ? { mode: "new", title: "" }
                    : { mode: "existing", albumId: "" },
              })
            }
          >
            <option value="existing">已有专辑</option>
            <option value="new">新建专辑</option>
          </select>
        </label>
        {target.album.mode === "existing" ? (
          <label>
            真实专辑列表
            <select
              aria-label={`真实专辑列表 ${index + 1}`}
              required
              value={target.album.albumId}
              disabled={busy || loading || !target.accountId || !supported}
              onChange={(e) =>
                update({ album: { mode: "existing", albumId: e.target.value } })
              }
            >
              <option value="">
                {loading ? "读取目录…" : "请选择已观察到 ID 的专辑"}
              </option>
              {target.album.albumId &&
                !catalogs.some((c) =>
                  c.entries.some((entry) => entry.id === selectedAlbumId),
                ) && (
                  <option value={target.album.albumId} disabled>
                    已保存 ID：{target.album.albumId}（需目录复核）
                  </option>
                )}
              {catalogs.flatMap((c) =>
                c.entries.map((entry) => (
                  <option
                    key={`${c.id}:${entry.key}`}
                    value={entry.id ?? `candidate:${c.id}:${entry.key}`}
                    disabled={
                      !entry.id || Date.parse(c.expiresAt) <= Date.now()
                    }
                  >
                    {entry.title} · {entry.id ?? "缺少远程 ID，不可选择"}
                    {Date.parse(c.expiresAt) <= Date.now() ? " · 已过期" : ""}
                  </option>
                )),
              )}
            </select>
          </label>
        ) : (
          <>
            <label>
              新专辑名称
              <input
                aria-label={`新专辑名称 ${index + 1}`}
                required
                maxLength={200}
                disabled={busy || !supported}
                value={target.album.title}
                onChange={(e) =>
                  update({
                    album: { ...target.album, title: e.target.value } as any,
                  })
                }
              />
            </label>
            <label>
              新专辑描述
              <textarea
                aria-label={`新专辑描述 ${index + 1}`}
                maxLength={2000}
                disabled={busy || !supported}
                value={target.album.description ?? ""}
                onChange={(e) =>
                  update({
                    album: {
                      ...target.album,
                      description: e.target.value,
                    } as any,
                  })
                }
              />
            </label>
          </>
        )}
      </div>
      <div className="plan-album-toolbar">
        <button
          type="button"
          disabled={busy || loading || !target.accountId || !supported}
          onClick={() => void refresh()}
        >
          只读刷新专辑目录
        </button>
        {!catalogs.length && (
          <span className="muted">当前账号暂无缓存目录</span>
        )}
      </div>
      {catalogs.map((c) => (
        <AlbumCatalogEvidence key={c.id} catalog={c} />
      ))}
      {error && (
        <p role="alert" className="plan-error">
          {error}
        </p>
      )}
      <AlbumCapabilities value={capabilities} />
      {!supported && <p role="status">此平台专辑适配器未实现，目录、新建和追加已禁用。</p>}
    </div>
  );
}
