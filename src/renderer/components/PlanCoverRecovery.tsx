import React, { useCallback, useState } from "react";
import { useStudio, useStudioRequest } from "../context";
import { useCenterQuery } from "../use-center-query";
import LoadingIndicator from "./LoadingIndicator";

type Handoff = {
  planRecovery?: { locked: boolean; reason?: string };
  requests: { id: string; variant?: "B"; manualGeneration?: boolean }[];
  receipts: { id: string; requestId: string; assetId: string; image: { width: number; height: number } }[];
};

export default function PlanCoverRecovery({ workId, busy, locked, act }: {
  workId: string;
  busy: boolean;
  locked: boolean;
  act: (action: () => Promise<void>) => Promise<void>;
}) {
  const { data, call, importAsset, exportArtifact } = useStudio();
  const read = useStudioRequest();
  const load = useCallback((): Promise<Handoff> => read("cover.list", { workId }), [read, workId]);
  const handoff = useCenterQuery(load, { interval: 0 });
  const [selectedRequest, setSelectedRequest] = useState("");
  const requests = handoff.value?.requests.filter(request => !request.variant && !request.manualGeneration) ?? [];
  const requestId = requests.some(request => request.id === selectedRequest) ? selectedRequest : "";
  const receipts = handoff.value?.receipts.filter(receipt => requests.some(request => request.id === receipt.requestId)) ?? [];
  const recoveryLocked = locked || handoff.value?.planRecovery?.locked;
  const disabled = busy || recoveryLocked || !handoff.value || !!handoff.error;
  const selectedCover = data.works.find((work: { id: string }) => work.id === workId)?.assets?.cover;
  const receive = (role: "coverResultImage" | "coverResultManifest") => void act(async () => {
    await importAsset(role, workId, requestId);
    await handoff.refresh();
  });

  return <section className="cover-handoff" aria-label="最终歌词封面">
    {handoff.loading && <p role="status"><LoadingIndicator label="正在读取封面请求…" /></p>}
    {!!handoff.error && <p role="alert">封面请求读取失败 <button type="button" onClick={() => void handoff.refresh()}>重试</button></p>}
    {recoveryLocked && <p role="status">{handoff.value?.planRecovery?.reason === "STOP_REQUESTED"
      ? "本次计划已停止，封面更新已锁定。"
      : "计划已结束或最终歌词已变化，封面更新已锁定。"}</p>}
    {handoff.value && <>
      <button type="button" disabled={disabled} onClick={() => void act(async () => {
        const request = await read("cover.request", { workId, requestId: crypto.randomUUID(), brief: "" });
        setSelectedRequest(request.id);
        await handoff.refresh();
      })}>保存请求</button>
      <label>当前封面请求
        <select value={requestId} onChange={event => setSelectedRequest(event.target.value)}>
          <option value="">选择已保存请求</option>
          {requests.map(request => <option key={request.id} value={request.id}>{request.id.slice(0, 8)}</option>)}
        </select>
      </label>
      {requestId && <div className="button-row">
        <button type="button" disabled={busy} onClick={() => void exportArtifact("coverRequest", { requestId })}>导出封面请求</button>
        <button type="button" disabled={disabled} onClick={() => receive("coverResultManifest")}>导入结果清单</button>
        <button type="button" disabled={disabled} onClick={() => receive("coverResultImage")}>导入封面图片</button>
      </div>}
      {receipts.map(receipt => <div className="handoff-receipt" key={receipt.id}>
        <span>{receipt.image.width} × {receipt.image.height} · 请求 {receipt.requestId.slice(0, 8)}</span>
        <button type="button" disabled={disabled || selectedCover === receipt.assetId} onClick={() => void act(async () => {
          await call("work.selectAsset", { workId, assetId: receipt.assetId, role: "cover" });
        })}>{selectedCover === receipt.assetId ? "已选为歌曲封面" : "选为歌曲封面"}</button>
      </div>)}
    </>}
  </section>;
}
