import React, { useEffect, useState } from "react";
import { useStudio, names } from "../context";
const loginNames: Record<string, string> = {
  valid: "登录有效（近期核对）",
  unchecked: "登录待核对",
  expired: "需重新登录",
  identity_mismatch: "登录身份不一致",
};
const bindingNames: Record<string, string> = {
  bound: "已绑定",
  pending_verification: "等待确认映射",
  revoked: "已撤销",
  unsupported: "身份适配器待核实",
  unbound: "未绑定",
};
export default function AccountBinding({
  artistId,
  accountId,
}: {
  artistId: string | null;
  accountId: string | null;
}) {
  const { data, call } = useStudio(),
    [rows, setRows] = useState<any[]>([]),
    [result, setResult] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const account = data.accounts.find((a: any) => a.id === accountId);
  const refresh = async () => setRows(await call("accountIdentity.list"));
  useEffect(() => {
    setResult(null);
    setError("");
    void refresh().catch(() => setError("身份状态读取失败"));
  }, [artistId, accountId]);
  const act = async (action: string, input: any) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      setResult(await call("accountIdentity." + action, input));
      await refresh();
    } catch (e: any) {
      setError(e.code ?? e.message);
    } finally {
      setBusy(false);
    }
  };
  const selection = { artistId, accountId, provider: account?.provider },
    visible = rows.filter(
      (b) => b.artistId === artistId && b.accountId === accountId,
    );
  return (
    <section aria-label="真实账号绑定" className="panel">
      <h3>绑定账号</h3>
      <p className="muted">核对远端账号和艺人 ID，再确认本地映射。</p>
      <div className="button-row">
        <button
          disabled={busy || !accountId || !artistId}
          onClick={() => void act("start", selection)}
        >
          绑定账号
        </button>
        <button
          disabled={busy || !accountId || !artistId}
          onClick={() => void act("check", selection)}
        >
          核对登录状态
        </button>
        <button
          disabled={busy || !accountId || !artistId}
          onClick={() => void act("check", selection)}
        >
          重新登录后核对身份
        </button>
      </div>
      {!accountId || !artistId ? (
        <p className="muted">先选择本平台账号资料和本地艺人。</p>
      ) : (
        <p className="muted">
          {names[account?.provider] ?? account?.provider} · {account?.name}
          。当前不会创建新浏览器持久会话。
        </p>
      )}
      {result?.reason === "IDENTITY_ADAPTER_UNVERIFIED" && (
        <p role="status" className="notice">
          身份读取合同尚未核实，绑定未完成。
          {account?.provider === "tme"
            ? "现有 TME 读取器仅有酷狗绑定 ID、QQ 昵称和艺名，缺少可验证的远端艺人 ID。"
            : "此平台尚无已验证的身份适配器。"}{" "}
          缺项：{result.missing?.join("、")}
          。需要先校准官方已授权会话的只读身份来源，再由你确认映射。
        </p>
      )}
      {visible.map((b) => (
        <article key={b.id}>
          <strong>
            {bindingNames[b.bindingState]} · {loginNames[b.loginState]}
          </strong>
          <p>
            {b.provider} / {b.namespace} · 远端账号 {b.remoteAccountId} ·
            远端艺人 {b.remoteArtistId}
          </p>
          <p>
            {b.accountDisplayName} / {b.artistDisplayName} · 核对时间{" "}
            {b.checkedAt ?? "本次启动尚未核对"}
          </p>
          <div className="button-row">
            {b.bindingState === "pending_verification" && (
              <button
                disabled={busy || b.loginState !== "valid"}
                onClick={() =>
                  void act("confirm", {
                    id: b.id,
                    expectedRevision: b.revision,
                    confirmed: true,
                  })
                }
              >
                确认此账号与艺人映射
              </button>
            )}
            <button
              disabled={busy || b.bindingState === "revoked"}
              onClick={() =>
                void act("revoke", { id: b.id, expectedRevision: b.revision })
              }
            >
              撤销真实绑定
            </button>
          </div>
        </article>
      ))}
      {!visible.length && <p className="muted">尚无已验证绑定 · 登录待核对</p>}
      {error && <p role="alert">{error}</p>}
      <details>
        <summary>登录与发布状态说明</summary>
        <p>
          客户端重启后重新核对登录。失效只暂停对应账号；提交结果未知时先对账，禁止重复上传或提交。已绑定也不代表平台支持自动发布。
        </p>
      </details>
    </section>
  );
}
