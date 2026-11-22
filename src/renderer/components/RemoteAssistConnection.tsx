import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import qrcode from "qrcode-generator";
import {
  remoteAssistPairCodeSchema,
  type RemoteAssistConnectionAction,
  type RemoteAssistConnectionSnapshot,
} from "../../shared/remote-assist";
import { Badge } from "../context";

type Command = Exclude<RemoteAssistConnectionAction, "status">;

const dateTime = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function Timestamp({ value }: { value: number }) {
  return <time dateTime={new Date(value).toISOString()}>{dateTime.format(value)}</time>;
}

export default function RemoteAssistConnection() {
  const [snapshot, setSnapshot] = useState<RemoteAssistConnectionSnapshot>();
  const [addressChoice, setAddressChoice] = useState("");
  const [code, setCode] = useState("");
  const [codeInvalid, setCodeInvalid] = useState(false);
  const [confirmDeviceId, setConfirmDeviceId] = useState("");
  const [pollError, setPollError] = useState("");
  const [commandError, setCommandError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copyMessage, setCopyMessage] = useState("");
  const addressField = useRef<HTMLInputElement>(null);
  const pairCodeField = useRef<HTMLInputElement>(null);
  const session = useRef<{ pending: Promise<boolean> } | null>(null);

  const request = useCallback((action: RemoteAssistConnectionAction, input: unknown = {}) => {
    const current = session.current;
    if (!current) return Promise.resolve(false);

    const pending = current.pending.then(async () => {
      if (session.current !== current) return false;
      try {
        const result = await window.rainfall.remoteAssistConnection(action, input);
        if (session.current !== current) return false;
        if (!result.ok) {
          if (result.error.code === "ASSIST_PRODUCTION_REQUIRED" || result.error.code === "OFFLINE_ACCEPTANCE_ACTION_DISABLED") {
            setSnapshot(undefined);
          }
          throw Error(result.error.message);
        }
        setSnapshot(result.value);
        setPollError("");
        return true;
      } catch (error) {
        if (session.current !== current) return false;
        const message = error instanceof Error ? error.message : "远控操作未完成。";
        if (action === "status") setPollError(message);
        else setCommandError(message);
        return false;
      }
    });
    current.pending = pending;
    return pending;
  }, []);

  useEffect(() => {
    const current = { pending: Promise.resolve(false) };
    session.current = current;
    let timer: number;
    async function poll() {
      await request("status");
      if (session.current === current) timer = window.setTimeout(poll, 1500);
    }
    void poll();
    return () => {
      session.current = null;
      window.clearTimeout(timer);
    };
  }, [request]);

  async function run(action: Command, input?: unknown) {
    if (busy) return false;
    const current = session.current;
    setBusy(true);
    setCommandError("");
    const ok = await request(action, input);
    if (session.current === current) setBusy(false);
    return ok;
  }

  async function copyAddress() {
    if (!snapshot?.endpoint) return;
    try {
      await navigator.clipboard.writeText(snapshot.endpoint);
      setCopyMessage("地址已复制");
    } catch {
      addressField.current?.focus();
      addressField.current?.select();
      setCopyMessage("按 Ctrl+C 复制已选中的地址。");
    }
  }

  async function submitPairing(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canControl || pairing) return;
    if (!remoteAssistPairCodeSchema.safeParse(code).success) {
      setCodeInvalid(true);
      pairCodeField.current?.focus();
      return;
    }
    if (await run("pair", { code })) setCode("");
  }

  const interfaces = snapshot?.interfaces ?? [];
  const address = interfaces.some(entry => entry.address === addressChoice)
    ? addressChoice
    : interfaces[0]?.address ?? "";
  const devices = snapshot?.devices ?? [];
  const canControl = Boolean(snapshot) && !busy && !pollError;
  const pairExpiresAt = snapshot?.pairExpiresAt;
  const pairing = pairExpiresAt != null && pairExpiresAt > Date.now();
  const apkDownloadUrl = pollError ? null : snapshot?.apkDownloadUrl;
  const downloadCode = useMemo(() => {
    if (!apkDownloadUrl) return null;
    const qr = qrcode(0, "M");
    qr.addData(apkDownloadUrl);
    qr.make();
    return qr.createDataURL(6, 24);
  }, [apkDownloadUrl]);

  return (
    <section className="panel remote-assist-connection" aria-labelledby="remote-assist-connection-title">
      <div className="remote-assist-heading">
        <h2 id="remote-assist-connection-title">连接与配对</h2>
        {snapshot && <Badge tone={snapshot.running && !pollError ? "remote-assist-connected" : ""}>
          {pollError ? "连接异常" : snapshot.running ? "已启动" : "已停止"}
        </Badge>}
      </div>
      {pollError && <p className="remote-assist-error" role="alert">{pollError}</p>}
      {!snapshot && !pollError && <p className="muted" role="status">正在读取连接状态…</p>}
      {snapshot && (snapshot.running ? (
        <>
          <div className="remote-assist-connection-controls">
            <label>
              配对地址
              <input readOnly ref={addressField} value={snapshot.endpoint ?? ""}
                onFocus={event => event.currentTarget.select()} />
            </label>
            <button type="button" disabled={!snapshot.endpoint} onClick={() => void copyAddress()}>复制地址</button>
            <button type="button" disabled={!canControl} onClick={() => {
              setCopyMessage("");
              setCode("");
              setCodeInvalid(false);
              void run("stop");
            }}>停止连接</button>
          </div>
          {copyMessage && <p className="muted" role="status">{copyMessage}</p>}
          <div className="remote-assist-android">
            <h3>下载安卓 App</h3>
            {downloadCode
              ? <img src={downloadCode} width={176} height={176} alt="安卓 APK 下载二维码" />
              : <p className="muted">安卓安装包暂不可下载。</p>}
          </div>
          {pairing ? (
            <div className="remote-assist-pairing">
              <div>
                <strong>等待手机配对</strong>
                <small>请在手机输入相同口令 · 截止 <Timestamp value={pairExpiresAt} /></small>
              </div>
              <button type="button" disabled={!canControl} onClick={() => void run("cancelPairing")}>取消配对</button>
            </div>
          ) : (
            <form className="remote-assist-connection-controls remote-assist-pairing" onSubmit={event => void submitPairing(event)}>
              <label>
                <span className="remote-assist-pair-label">
                  配对口令
                  <small id="remote-assist-pair-code-count">{code.length}/6 位</small>
                </span>
                <input ref={pairCodeField} type="password" inputMode="numeric" autoComplete="off"
                  aria-label="配对口令" aria-invalid={codeInvalid || undefined}
                  aria-describedby={codeInvalid ? "remote-assist-pair-code-count remote-assist-pair-code-error" : "remote-assist-pair-code-count"}
                  placeholder="两端输入相同的 6 位数字" value={code} disabled={!canControl}
                  onChange={event => {
                    setCode(event.currentTarget.value.normalize("NFKC").replace(/[^0-9]/gu, "").slice(0, 6));
                    setCodeInvalid(false);
                  }} />
              </label>
              <button type="submit" className="primary" disabled={!canControl}>开始配对</button>
              {codeInvalid && <p id="remote-assist-pair-code-error" className="remote-assist-error" role="alert">
                请输入 6 位数字口令。
              </p>}
            </form>
          )}
        </>
      ) : (
        <div className="remote-assist-connection-controls">
          <label>
            连接网卡
            <select aria-label="连接网卡" value={address} onChange={event => setAddressChoice(event.currentTarget.value)}
              disabled={!canControl || !interfaces.length}>
              {interfaces.length ? interfaces.map(entry => (
                <option key={entry.address} value={entry.address}>{entry.label} · {entry.address}</option>
              )) : <option value="">暂无可用网卡</option>}
            </select>
          </label>
          <button type="button" className="primary" disabled={!canControl || !address}
            onClick={() => void run("start", { address })}>启动连接</button>
        </div>
      ))}
      {commandError && <p className="remote-assist-error" role="alert">{commandError}</p>}
      {snapshot && <section className="remote-assist-paired-devices" aria-labelledby="remote-assist-paired-devices-title">
        <h3 id="remote-assist-paired-devices-title">已配对设备</h3>
        {devices.length ? (
          <ul>
            {devices.map(device => (
              <li key={device.id}>
                <div className="remote-assist-paired-device">
                  <div>
                    <strong>{device.name}</strong>
                    <small>配对于 <Timestamp value={device.pairedAt} /></small>
                  </div>
                  {confirmDeviceId !== device.id && <button type="button" disabled={!canControl}
                    onClick={() => setConfirmDeviceId(device.id)}>解除配对</button>}
                </div>
                {confirmDeviceId === device.id && (
                  <>
                    <p>解除「{device.name}」的配对？</p>
                    <div className="button-row">
                      <button type="button" disabled={!canControl} onClick={async () => {
                        if (await run("removeDevice", { id: device.id })) setConfirmDeviceId("");
                      }}>确认解除</button>
                      <button type="button" onClick={() => setConfirmDeviceId("")}>取消</button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        ) : <p className="muted">暂无已配对的手机。</p>}
      </section>}
    </section>
  );
}
