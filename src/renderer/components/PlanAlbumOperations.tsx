import React, { useEffect, useRef, useState } from "react";
import { useStudio } from "../context";
import type { PlanCenterRun, PlanCenterItem } from "../../shared/plan-center";
import type { PlanAlbumOperation } from "../../shared/plan-albums";
import { hasPlanAlbumAdapter } from "../../shared/plan-albums";
import {
  AlbumCapabilities,
  AlbumCatalogEvidence,
  albumCatalogs,
  albumSource,
} from "./PlanAlbumFields";
const states: Record<string, string> = {
  prepared: "已准备，等待预览确认",
  authorized: "已授权，尚待执行",
  dispatching: "已派发，等待原流程回执",
  unknown: "结果未知，仅可核对原操作",
  succeeded: "操作完成",
  failed: "失败",
  not_found: "原操作未找到",
};
export default function PlanAlbumOperations({
  run,
  items,
  busy,
  act,
}: {
  run: PlanCenterRun;
  items: PlanCenterItem[];
  busy: boolean;
  act: (fn: () => Promise<any>) => Promise<void>;
}) {
  const { call } = useStudio();
  const [status, setStatus] = useState<any>(null),
    [targets, setTargets] = useState<Record<string, any>>({}),
    [preview, setPreview] = useState<any>(null),
    [acknowledged, setAcknowledged] = useState(false),
    [error, setError] = useState("");
  const epoch = useRef(0);
  const targetKey = JSON.stringify(
    run.snapshot.publishTargets.map((t) => [
      t.platform,
      t.accountId,
      t.enabled,
      t.album,
    ]),
  );
  const refresh = async () => {
    const ticket = ++epoch.current;
    const [s, t] = await Promise.all([
      call("planAlbums.status"),
      Promise.all(
        run.snapshot.publishTargets
          .filter((t) => t.enabled && t.accountId && hasPlanAlbumAdapter(t.platform))
          .map(async (target) => {
            const identity = {
              platform: target.platform,
              accountId: target.accountId,
            };
            const [c, capabilities] = await Promise.all([
              call("planAlbums.catalog", identity),
              call("planAlbums.capabilities", identity),
            ]);
            return [
              JSON.stringify([target.platform, target.accountId]),
              { catalogs: albumCatalogs(c), capabilities },
            ] as const;
          }),
      ),
    ]);
    if (ticket === epoch.current) {
      setStatus(s);
      setTargets(Object.fromEntries(t));
    }
  };
  useEffect(() => {
    setStatus(null);
    setTargets({});
    setPreview(null);
    setAcknowledged(false);
    void refresh().catch((e) => setError(e.message));
    const timer = setInterval(() => void refresh().catch(() => {}), 4000);
    return () => {
      epoch.current++;
      clearInterval(timer);
    };
  }, [run.id, targetKey]);
  const perform = (fn: () => Promise<any>) =>
    act(async () => {
      try {
        await fn();
      } finally {
        // A transport error can arrive after Main persisted an unknown result.
        // Read its journal immediately before exposing another action.
        await refresh();
      }
    });
  const operations: PlanAlbumOperation[] = (status?.operations ?? []).filter(
    (o: PlanAlbumOperation) => o.runId === run.id,
  );
  const inFlight = (platform: string, accountId: string) =>
    operations.some(
      (o) =>
        o.scope.platform === platform &&
        o.scope.accountId === accountId &&
        ["prepared", "authorized", "dispatching", "unknown"].includes(o.state),
    );
  return (
    <section className="plan-album-operations" aria-label="本次专辑操作">
      <h3>本次专辑操作</h3>
      {error && <p role="alert">{error}</p>}
      {run.snapshot.publishTargets
        .filter((t) => t.enabled)
        .map((target) => {
          const identity = {
              runId: run.id,
              platform: target.platform,
              accountId: target.accountId,
            },
            key = JSON.stringify([target.platform, target.accountId]),
            selectedAlbumId =
              target.album.mode === "existing" ? target.album.albumId : "",
            loaded = targets[key], supported = hasPlanAlbumAdapter(target.platform);
          return (
            <article className="plan-album-target" key={key}>
              <h4>
                {target.platform} · {target.accountId}
              </h4>
              {!supported && <p role="status">此平台专辑适配器未实现，绑定、新建和追加已禁用。</p>}
              <p>
                {target.album.mode === "new"
                  ? `新建：${target.album.title}`
                  : `已有专辑 ID：${target.album.albumId}`}
              </p>
              {loaded?.catalogs.map((c: any) => (
                <div key={c.id}>
                  <AlbumCatalogEvidence catalog={c} />
                  {target.album.mode === "existing" &&
                    c.entries
                      .filter((entry: any) => entry.id === selectedAlbumId)
                      .map((entry: any) => (
                        <button
                          key={entry.key}
                          disabled={
                            !supported ||
                            busy ||
                            run.stopRequested ||
                            inFlight(target.platform, target.accountId) ||
                            Date.parse(c.expiresAt) <= Date.now()
                          }
                          onClick={() =>
                            void perform(() =>
                              call("planAlbums.select", {
                                ...identity,
                                catalogId: c.id,
                                entryKey: entry.key,
                              }),
                            )
                          }
                        >
                          绑定已选专辑 ID
                        </button>
                      ))}
                </div>
              ))}
              <div className="plan-album-toolbar">
                {target.album.mode === "new" && (
                  <button
                    disabled={
                      !supported ||
                      busy ||
                      run.stopRequested ||
                      inFlight(target.platform, target.accountId) ||
                      !loaded?.capabilities?.create?.available
                    }
                    onClick={() =>
                      void perform(() =>
                        call("planAlbums.prepareCreate", identity),
                      )
                    }
                  >
                    准备新建专辑
                  </button>
                )}
                {items.map((item) => (
                  <button
                    key={item.id}
                    disabled={
                      !supported ||
                      busy ||
                      run.stopRequested ||
                      inFlight(target.platform, target.accountId) ||
                      !loaded?.capabilities?.append?.available
                    }
                    onClick={() =>
                      void perform(() =>
                        call("planAlbums.prepareAppend", {
                          ...identity,
                          itemId: item.id,
                        }),
                      )
                    }
                  >
                    准备追加第 {item.ordinal} 首
                  </button>
                ))}
              </div>
              <AlbumCapabilities value={loaded?.capabilities} />
            </article>
          );
        })}
      <p className="muted">
        追加准备复用原发布任务；准备完成后，仍须在原发布流程核对本次材料、版权与平台条款并确认提交。
      </p>
      {(status?.bindings ?? [])
        .filter((b: any) => b.createdByRunId === run.id)
        .map((b: any) => (
          <p key={b.id}>
            已绑定 {b.scope.platform} / {b.scope.accountId} · {b.albumId} ·{" "}
            {albumSource(b)}
          </p>
        ))}
      {operations.map((op) => (
        <article className="plan-album-operation" key={op.id}>
          <strong>
            {op.kind === "create" ? "新建专辑" : "追加准备"} ·{" "}
            {states[op.state] ?? op.state}
          </strong>
          <p>
            {albumSource(op)} · {op.scope.platform} / {op.scope.accountId}
          </p>
          <code>{op.operationId}</code>
          {op.albumId && <p>专辑 ID：{op.albumId}</p>}
          {op.reason && <p>{op.reason}</p>}
          {op.publicationTaskId && <p>原发布任务：{op.publicationTaskId}</p>}
          {["prepared", "authorized"].includes(op.state) && (
            <button
              disabled={busy || run.stopRequested || !hasPlanAlbumAdapter(op.scope.platform) || (op.kind === "append" && !op.itemId)}
              onClick={() =>
                void perform(async () => {
                  setPreview(null);
                  setAcknowledged(false);
                  const target = {runId: run.id, platform: op.scope.platform, accountId: op.scope.accountId};
                  await call(op.kind === "create" ? "planAlbums.prepareCreate" : "planAlbums.prepareAppend", {
                    ...target,
                    ...(op.kind === "append" ? {itemId: op.itemId} : {}),
                  });
                })
              }
            >
              重新准备
            </button>
          )}
          {["prepared", "authorized"].includes(op.state) && (
            <button
              disabled={busy || run.stopRequested || !hasPlanAlbumAdapter(op.scope.platform)}
              onClick={() =>
                void act(async () => {
                  setPreview(
                    await call("planAlbums.preview", {
                      operationId: op.operationId,
                    }),
                  );
                  setAcknowledged(false);
                })
              }
            >
              预览操作
            </button>
          )}
          {["unknown", "dispatching"].includes(op.state) && (
            <button
              disabled={busy || !hasPlanAlbumAdapter(op.scope.platform)}
              onClick={() =>
                void perform(() =>
                  call("planAlbums.reconcile", { operationId: op.operationId }),
                )
              }
            >
              只读核对原操作
            </button>
          )}
        </article>
      ))}
      {preview && (
        <div className="plan-modal-backdrop">
          <section
            className="plan-confirm plan-album-confirm"
            role="dialog"
            aria-modal="true"
            aria-label="确认专辑操作"
          >
            <h3>确认专辑操作</h3>
            <p>
              {preview.operation.kind === "create"
                ? "新建专辑"
                : "准备追加到已有专辑"}
            </p>
            <dl>
              <dt>平台 / 账号</dt>
              <dd>
                {preview.operation.scope.platform} /{" "}
                {preview.operation.scope.accountId}
              </dd>
              <dt>专辑</dt>
              <dd>
                {preview.operation.selection.mode === "new"
                  ? preview.operation.selection.title
                  : preview.operation.selection.albumId}
              </dd>
              <dt>描述</dt>
              <dd>{preview.operation.selection.description ?? "—"}</dd>
              <dt>证据</dt>
              <dd>{albumSource(preview.operation)}</dd>
              <dt>操作编号</dt>
              <dd>
                <code>{preview.operation.operationId}</code>
              </dd>
              {preview.operation.itemId && (
                <>
                  <dt>本次材料</dt>
                  <dd>
                    <code>{preview.operation.itemId}</code>
                    <code>{preview.operation.materialFingerprint}</code>
                  </dd>
                </>
              )}
            </dl>
            {preview.operation.kind === "append" && (
              <p>本操作只准备原发布任务；不会代替版权、条款确认或正式提交。</p>
            )}
            <label className="check">
              <input
                type="checkbox"
                aria-label="我已核对本次专辑操作"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
              />
              我已核对本次专辑操作
            </label>
            <div className="plan-editor-footer">
              <button disabled={busy} onClick={() => setPreview(null)}>
                取消
              </button>
              <button
                className="primary"
                disabled={busy || !acknowledged || run.stopRequested || !hasPlanAlbumAdapter(preview.operation.scope.platform)}
                onClick={() =>
                  void perform(async () => {
                    const current = preview;
                    setPreview(null);
                    setAcknowledged(false);
                    await call("planAlbums.confirm", {
                      operationId: current.operation.operationId,
                      summaryHash: current.summaryHash,
                      confirmed: true,
                    });
                  })
                }
              >
                确认执行本次操作
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
