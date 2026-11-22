import React, { useEffect, useRef, useState } from "react";
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
    [error, setError] = useState(""),
    [connected, setConnected] = useState(false),
    [port, setPort] = useState(9222);
  const scopeEpoch = useRef(0);
  const account = data.accounts.find((a: any) => a.id === accountId);
  const supported = account?.provider === "tme";
  const messages: Record<string, string> = {
    CLOUD_BROWSER_SESSION_REQUIRED: "先连接已有官方会话，再核对账号身份。",
    BROWSER_CONNECTION_NOT_AUTHORIZED: "请明确连接已有官方会话。",
    CDP_CONNECTION_FAILED: "未能连接此端口。请检查已有官方浏览器会话。",
    CDP_CONNECTION_TIMEOUT: "连接超时，请检查已有官方浏览器端口。",
    SINGLE_TME_PAGE_REQUIRED: "请在已授权浏览器中保留一个腾讯音乐人页面。",
    LOGIN_EXPIRED: "官方登录已失效，请先在官方页面登录，再重新连接核对。",
    LOGIN_CHECK_REQUIRED: "本次登录尚未核对，请重新读取账号身份。",
    LOGIN_IDENTITY_MISMATCH: "当前官方账号与已确认映射不同，绑定已暂停。",
    ACCOUNT_CHANGED: "读取期间官方身份发生变化，请重新核对。",
    IDENTITY_MAPPING_CONFLICT:
      "此远端身份已有其他本地映射，请先核对或撤销原映射。",
    IDENTITY_CHECK_BUSY: "身份读取仍在进行，请等待本次结果。",
    BINDING_REVOKED: "此映射已撤销。",
    WORKSPACE_CHANGED: "工作区已变化，请重新连接并核对。",
  };
  const refresh = async (epoch = scopeEpoch.current) => {
    const value = await call("accountIdentity.list");
    if (epoch === scopeEpoch.current) setRows(value);
  };
  useEffect(() => {
    const epoch = ++scopeEpoch.current;
    setResult(null);
    setError("");
    setConnected(false);
    void call("accountIdentity.list")
      .then((value) => {
        if (epoch === scopeEpoch.current) setRows(value);
      })
      .catch(() => {
        if (epoch === scopeEpoch.current) setError("身份状态读取失败");
      });
    const status = async () => {
      try {
        const r = await window.rainfall.tmeAiPrepare("browserStatus", {});
        if (epoch === scopeEpoch.current)
          setConnected(r.ok && r.value.connected === true);
        await refresh(epoch);
      } catch {
        if (epoch === scopeEpoch.current) setConnected(false);
      }
    };
    if (supported) void status();
    const timer = supported
      ? setInterval(() => void status(), 5000)
      : undefined;
    return () => {
      scopeEpoch.current++;
      clearInterval(timer);
    };
  }, [artistId, accountId]);
  const act = async (action: string, input: any) => {
    if (busy) return;
    setBusy(true);
    setError("");
    const epoch = scopeEpoch.current;
    try {
      const value = await call("accountIdentity." + action, input);
      if (epoch !== scopeEpoch.current) return;
      setResult(value);
      await refresh(epoch);
    } catch (e: any) {
      if (epoch === scopeEpoch.current) setError(e.code ?? e.message);
    } finally {
      setBusy(false);
    }
  };
  const connection = async (action: "connectBrowser" | "disconnectBrowser") => {
    if (busy) return;
    setBusy(true);
    setError("");
    const epoch = scopeEpoch.current;
    try {
      const r = await window.rainfall.tmeAiPrepare(
        action,
        action === "connectBrowser" ? { port, allowConnection: true } : {},
      );
      if (!r.ok)
        throw Object.assign(Error(r.error.code), { code: r.error.code });
      if (epoch !== scopeEpoch.current) return;
      setConnected(r.value.connected === true);
      setResult(null);
      await refresh(epoch);
    } catch (e: any) {
      if (epoch === scopeEpoch.current) setError(e.code ?? e.message);
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
      {supported && (
        <>
          <div className="form-grid">
            <label>
              官方浏览器端口
              <input
                aria-label="官方浏览器端口"
                type="number"
                min="1024"
                max="65535"
                value={port}
                disabled={busy || connected}
                onChange={(e) => setPort(Number(e.target.value))}
              />
            </label>
            <div className="button-row">
              <button
                disabled={
                  busy ||
                  connected ||
                  !Number.isInteger(port) ||
                  port < 1024 ||
                  port > 65535
                }
                onClick={() => void connection("connectBrowser")}
              >
                连接已有会话
              </button>
              <button
                disabled={busy || !connected}
                onClick={() => void connection("disconnectBrowser")}
              >
                断开本次连接
              </button>
            </div>
          </div>
          <p role="status" className="muted">
            {connected
              ? "已连接官方会话 · 尚需核对本地账号映射"
              : "先连接已有官方会话"}{" "}
            · 不创建新登录
          </p>
        </>
      )}
      {account && !supported && (
        <p role="status" className="notice">
          此平台身份适配器待接入。
        </p>
      )}
      <div className="button-row">
        <button
          disabled={busy || !supported || !connected || !accountId || !artistId}
          onClick={() => void act("start", selection)}
        >
          读取账号身份
        </button>
        <button
          disabled={busy || !supported || !connected || !accountId || !artistId}
          onClick={() => void act("check", selection)}
        >
          核对登录状态
        </button>
      </div>
      {!accountId || !artistId ? (
        <p className="muted">先选择本平台账号和艺人。</p>
      ) : (
        <p className="muted">
          {names[account?.provider] ?? account?.provider} · {account?.name}
          。当前不会创建新浏览器持久会话。
        </p>
      )}
      {result?.reason === "IDENTITY_ADAPTER_UNVERIFIED" && (
        <p role="status" className="notice">
          此平台身份适配器待接入，绑定未完成。
        </p>
      )}
      {visible.map((b) => (
        <article key={b.id}>
          <strong>
            {bindingNames[b.bindingState]} ·{" "}
            {
              loginNames[
                !connected && b.loginState === "valid"
                  ? "unchecked"
                  : b.loginState
              ]
            }
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
                disabled={busy || !connected || b.loginState !== "valid"}
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
              撤销本地身份映射
            </button>
          </div>
        </article>
      ))}
      {!visible.length && <p className="muted">尚无已验证绑定 · 登录待核对</p>}
      {error && (
        <div role="alert">
          <p>
            {messages[error] ??
              "身份操作未完成，请检查官方会话和本地映射后重试。"}
          </p>
          <details>
            <summary>错误详情</summary>
            <code>{error}</code>
          </details>
        </div>
      )}
      <details>
        <summary>登录与发布状态说明</summary>
        <p>
          只连接已由你开启的本机官方浏览器端口，不启动浏览器、不复制登录凭据。读取身份后会保存等待确认的本地映射；确认按钮才将映射标为已绑定，不授予平台写入权限。客户端重启或断开连接后重新核对登录。TME
          账号与艺人 ID 不等于 QQ 登录 UIN；QQ/酷狗歌手 ID
          分开记录。提交结果未知时先对账，禁止重复上传或提交。
        </p>
      </details>
    </section>
  );
}
