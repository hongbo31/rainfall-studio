import React, { useState } from "react";
import { useStudio } from "../context";
export default function ManualReport({
  unit,
  onClose,
}: {
  unit: any;
  onClose: () => void;
}) {
  const { call } = useStudio();
  const [form, setForm] = useState({
    id: unit.id,
    remoteId: unit.receipt?.remoteId || "",
    remoteUrl: unit.receipt?.remoteUrl || "",
    review: unit.review || "unknown",
    publication: unit.publication || "unknown",
    reason: unit.reason || "",
    evidence: "",
    observedAt: new Date().toISOString(),
  });
  const [confirmed, setConfirmed] = useState(false);
  return (
    <div className="modal-backdrop">
      <form
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="人工登记回执"
        onSubmit={async (e) => {
          e.preventDefault();
          await call("publish.recordManual", form);
          onClose();
        }}
      >
        <h2>人工登记回执与状态</h2>
        <div className="notice">
          请先在官方后台核对。这里只保存用户录入的证据，不会提交作品，也不代表已通过
          API 验证。
        </div>
        <label>
          远端作品 / 投稿 ID
          <input
            required
            value={form.remoteId}
            onChange={(e) => setForm({ ...form, remoteId: e.target.value })}
          />
        </label>
        <label>
          官方后台或作品 HTTPS 链接
          <input
            type="url"
            required
            value={form.remoteUrl}
            onChange={(e) => setForm({ ...form, remoteUrl: e.target.value })}
          />
        </label>
        <div className="form-grid">
          <label>
            审核结果
            <select
              value={form.review}
              onChange={(e) => setForm({ ...form, review: e.target.value })}
            >
              <option value="unknown">未知</option>
              <option value="pending">待审核</option>
              <option value="approved">审核通过</option>
              <option value="rejected">已驳回</option>
              <option value="removed">已移除</option>
            </select>
          </label>
          <label>
            上线结果（独立核对）
            <select
              value={form.publication}
              onChange={(e) =>
                setForm({ ...form, publication: e.target.value })
              }
            >
              <option value="unknown">未知</option>
              <option value="scheduled">等待定时上线</option>
              <option value="live">已上线，有独立证据</option>
              <option value="unavailable">暂不可用</option>
              <option value="taken_down">已下架</option>
            </select>
          </label>
        </div>
        <label>
          驳回 / 下架原因
          <textarea
            value={form.reason}
            onChange={(e) => setForm({ ...form, reason: e.target.value })}
          />
        </label>
        <label>
          核对依据（至少10字）
          <textarea
            required
            minLength={10}
            value={form.evidence}
            onChange={(e) => setForm({ ...form, evidence: e.target.value })}
            placeholder="例如：在官方后台核对到上述投稿ID，审核状态为……；上线状态另行核对。"
          />
        </label>
        <p>观察时间：{new Date(form.observedAt).toLocaleString("zh-CN")}</p>
        <label className="inline-check">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          我已分别核对提交、审核与上线结果
        </label>
        <div className="button-row">
          <button type="submit" className="primary" disabled={!confirmed}>
            保存为用户录入证据
          </button>
          <button type="button" onClick={onClose}>
            取消
          </button>
        </div>
      </form>
    </div>
  );
}
