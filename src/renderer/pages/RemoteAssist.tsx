import React, { useCallback, useEffect, useRef, useState } from "react";
import type { RemoteAssistCommand, RemoteAssistDevice, RemoteAssistMode, RemoteAssistSnapshot } from "../../shared/remote-assist";
import { Badge, PageHead } from "../context";
import RemoteAssistConnection from "../components/RemoteAssistConnection";
import "../remote-assist.css";

type Action = Parameters<typeof window.rainfall.remoteAssist>[0];
type Frame = NonNullable<NonNullable<RemoteAssistSnapshot["session"]>["frame"]>;
type Point = { x: number; y: number };
type Gesture = { pointerId: number; jpeg: string; start: Point; clientX: number; clientY: number };
type Viewer = {
  queue: Promise<unknown>;
  sessionId?: string;
  pendingExpiresAt?: number;
  frameSeq?: number;
  frameTimer?: number;
  busy: boolean;
};

const frameLifetime = 3000;
const remoteContactLifetime = 10_000;
const pairedTimeFormat = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "short", timeStyle: "medium", hourCycle: "h23",
});

function recentContact(at: number | null | undefined, now: number): number {
  return typeof at === "number" && now - at <= remoteContactLifetime ? at : 0;
}

function defaultDevice(devices: RemoteAssistDevice[], now: number) {
  return [...devices].sort((a, b) =>
    recentContact(b.lastRemoteContactAt, now) - recentContact(a.lastRemoteContactAt, now) ||
    (b.pairedAt ?? 0) - (a.pairedAt ?? 0),
  )[0];
}

function deviceLabel(device: RemoteAssistDevice, devices: RemoteAssistDevice[], now: number): string {
  const { id, name, pairedAt, lastRemoteContactAt } = device;
  const sameName = devices.filter(other => other.name === name);
  const parts = [name];
  if (sameName.length > 1) {
    const displayTime = (at: number) => Number.isFinite(at) ? pairedTimeFormat.format(at) : "";
    const time = displayTime(pairedAt);
    if (time) parts.push(`配对于 ${time}`);
    const sameTime = sameName.filter(other => displayTime(other.pairedAt) === time);
    if (sameTime.length > 1) parts.push(`设备 ${sameTime.findIndex(other => other.id === id) + 1}`);
  }
  if (recentContact(lastRemoteContactAt, now)) parts.push("远控页已连接");
  return parts.join(" · ");
}

function imagePoint(event: React.PointerEvent<HTMLImageElement>): Point {
  const rect = event.currentTarget.getBoundingClientRect();
  const unit = (value: number) => Math.max(0, Math.min(1, value));
  return { x: unit((event.clientX - rect.left) / rect.width), y: unit((event.clientY - rect.top) / rect.height) };
}

function stopSession(id: string) {
  return window.rainfall.remoteAssist("stop", { id }).catch(() => undefined);
}

export default function RemoteAssist({ open, onOpen }: { open: boolean; onOpen: () => void }) {
  const [snapshot, setSnapshot] = useState<RemoteAssistSnapshot>();
  const [frame, setFrame] = useState<Frame | null>(null);
  const [loadedSource, setLoadedSource] = useState("");
  const [deviceChoice, setDeviceChoice] = useState("");
  const [mode, setMode] = useState<RemoteAssistMode>("rainfall");
  const [pollError, setPollError] = useState("");
  const [commandError, setCommandError] = useState("");
  const [pendingEnd, setPendingEnd] = useState<"ended" | "expired" | "">("");
  const [busy, setBusy] = useState(false);
  const [visible, setVisible] = useState(document.visibilityState === "visible");
  const viewer = useRef<Viewer | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const screenImage = useRef<HTMLImageElement>(null);
  const session = snapshot?.session;
  const shouldPoll = visible && (open || Boolean(session) || busy);

  const clearFrame = useCallback((current: Viewer) => {
    window.clearTimeout(current.frameTimer);
    gesture.current = null;
    setFrame(null);
    setLoadedSource("");
  }, []);

  const request = useCallback((current: Viewer, action: Action, input: unknown = {}) => {
    const next = current.queue.then(async () => {
      if (viewer.current !== current) return;
      try {
        const body = action === "status" && current.frameSeq !== undefined ? { afterSeq: current.frameSeq } : input;
        const result = await window.rainfall.remoteAssist(action, body);
        if (viewer.current !== current) {
          const id = result.ok && (result.value as RemoteAssistSnapshot).session?.id;
          if (action === "request" && id) void stopSession(id);
          return;
        }
        if (!result.ok) throw Error(result.error.message);
        const value: RemoteAssistSnapshot = result.value;
        const session = value.session;
        if (session || action === "stop") {
          setPendingEnd("");
        } else if (action === "status" && current.pendingExpiresAt !== undefined) {
          setPendingEnd(Date.now() >= current.pendingExpiresAt ? "expired" : "ended");
        }
        current.pendingExpiresAt = session?.phase === "pending" ? session.expiresAt : undefined;
        const incoming = session?.phase === "active" ? session.frame : null;
        if (session?.id !== current.sessionId) {
          clearFrame(current);
          current.sessionId = session?.id;
          current.frameSeq = undefined;
          if (action === "status") setCommandError("");
        }
        if (incoming && (current.frameSeq === undefined || incoming.seq > current.frameSeq)) {
          if (gesture.current && gesture.current.jpeg !== incoming.jpeg) gesture.current = null;
          current.frameSeq = incoming.seq;
          setFrame(incoming);
          window.clearTimeout(current.frameTimer);
          current.frameTimer = window.setTimeout(() => clearFrame(current), frameLifetime);
        }
        setSnapshot({ ...value, session: session && { ...session, frame: null } });
        setPollError("");
      } catch (error) {
        if (viewer.current !== current) return;
        const message = error instanceof Error ? error.message : "远控请求未完成。";
        if (action === "status") {
          clearFrame(current);
          setPollError(message);
        } else setCommandError(message);
      }
    });
    current.queue = next;
    return next;
  }, [clearFrame]);

  useEffect(() => {
    function disconnect(clear: boolean) {
      const previous = viewer.current;
      viewer.current = null;
      if (previous) {
        window.clearTimeout(previous.frameTimer);
        if (previous.sessionId) void stopSession(previous.sessionId);
      }
      gesture.current = null;
      if (clear) {
        setVisible(false);
        setSnapshot(undefined);
        setFrame(null);
        setLoadedSource("");
        setBusy(false);
        setCommandError("");
        setPollError("");
        setPendingEnd("");
      }
    }
    function visibilityChanged() {
      if (document.visibilityState !== "visible") {
        disconnect(true);
        return;
      }
      if (viewer.current) return;
      viewer.current = { queue: Promise.resolve(), busy: false };
      setVisible(true);
    }
    const pageHidden = () => disconnect(true);
    document.addEventListener("visibilitychange", visibilityChanged);
    window.addEventListener("pagehide", pageHidden);
    window.addEventListener("pageshow", visibilityChanged);
    visibilityChanged();
    return () => {
      document.removeEventListener("visibilitychange", visibilityChanged);
      window.removeEventListener("pagehide", pageHidden);
      window.removeEventListener("pageshow", visibilityChanged);
      disconnect(false);
    };
  }, []);

  useEffect(() => {
    const current = viewer.current;
    if (!shouldPoll || !current) return;
    let disposed = false;
    let timer: number;
    async function poll() {
      if (!current || disposed || viewer.current !== current) return;
      await request(current, "status");
      if (!disposed && viewer.current === current) timer = window.setTimeout(poll, 500);
    }
    void poll();
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [request, shouldPoll]);

  useEffect(() => { gesture.current = null; }, [open]);

  const run = useCallback(async (action: Exclude<Action, "status">, input: unknown) => {
    const current = viewer.current;
    if (!current || current.busy || document.visibilityState !== "visible") return;
    current.busy = true;
    setBusy(true);
    setCommandError("");
    if (action === "stop") clearFrame(current);
    await request(current, action, input);
    current.busy = false;
    if (viewer.current === current) setBusy(false);
  }, [clearFrame, request]);

  const devices = snapshot?.devices ?? [];
  const now = Date.now();
  const selectedDevice = devices.find(device => device.id === (session?.deviceId ?? deviceChoice)) ?? defaultDevice(devices, now);
  const deviceId = session?.deviceId ?? selectedDevice?.id ?? "";
  const pendingSession = session?.phase === "pending" ? session : null;
  const receivedRequest = Boolean(pendingSession && recentContact(pendingSession.phoneContactAt, now));
  const connectedDuplicate = Boolean(pendingSession && selectedDevice && !receivedRequest &&
    !recentContact(selectedDevice.lastRemoteContactAt, now) && devices.some(device =>
      device.id !== deviceId && device.name === selectedDevice.name && recentContact(device.lastRemoteContactAt, now)));
  let pendingHint = "请保持手机 App 的「远控」页打开，并确认两端已连上同一局域网或私有组网。";
  if (receivedRequest) {
    pendingHint = "手机已收到请求，请点「允许本次会话」。";
  } else if (connectedDuplicate) {
    pendingHint = "另一条同名配对记录已连接。取消请求后，选择标有「远控页已连接」的设备。";
  } else if (pendingSession?.phoneContactAt != null && pendingSession.mode === "view") {
    pendingHint = "手机曾收到请求。请完成系统共享授权，或返回手机 App 的「远控」页。";
  }
  const source = frame ? `data:image/jpeg;base64,${frame.jpeg}` : "";
  const canAct = Boolean(snapshot?.running && !pollError && !busy);
  const canInput = Boolean(canAct && session?.phase === "active" && session.mode === "rainfall" && frame && source === loadedSource);
  const activeStatus = session?.mode === "view" ? "仅查看" : "可操作";

  const sessionId = session?.id;
  const sequence = frame?.seq;
  const send = useCallback((command: RemoteAssistCommand) => {
    if (sessionId && canInput && command.seq === sequence) void run("input", { id: sessionId, command });
  }, [canInput, run, sequence, sessionId]);

  const scrollPhone = useCallback((down: boolean) => {
    if (sequence !== undefined) send({
      kind: "swipe", seq: sequence, x: 0.5, y: down ? 0.7 : 0.3, endX: 0.5, endY: down ? 0.3 : 0.7,
    });
  }, [send, sequence]);

  useEffect(() => {
    const image = screenImage.current;
    if (!canInput || !image) return;
    function scroll(event: WheelEvent) {
      if (!event.deltaY || event.ctrlKey) return;
      event.preventDefault();
      scrollPhone(event.deltaY > 0);
    }
    image.addEventListener("wheel", scroll, { passive: false });
    return () => image.removeEventListener("wheel", scroll);
  }, [canInput, open, scrollPhone]);

  function startGesture(event: React.PointerEvent<HTMLImageElement>) {
    if (!canInput || !frame || !event.isPrimary || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = {
      pointerId: event.pointerId, jpeg: frame.jpeg, start: imagePoint(event), clientX: event.clientX, clientY: event.clientY,
    };
  }

  function endGesture(event: React.PointerEvent<HTMLImageElement>) {
    const start = gesture.current;
    gesture.current = null;
    if (!frame || !start || start.pointerId !== event.pointerId || start.jpeg !== frame.jpeg) return;
    const end = imagePoint(event);
    if (Math.hypot(event.clientX - start.clientX, event.clientY - start.clientY) < 8) {
      send({ kind: "tap", seq: frame.seq, ...end });
    } else {
      send({ kind: "swipe", seq: frame.seq, ...start.start, endX: end.x, endY: end.y });
    }
  }

  const backControl = session?.phase === "active" && session.mode === "rainfall" && <button type="button" disabled={!canInput}
    onClick={() => frame && send({ kind: "back", seq: frame.seq })}>返回</button>;
  const endControl = session && <button type="button" disabled={busy} onClick={() => void run("stop", { id: session.id })}>
    {session.phase === "pending" ? "取消请求" : "断开会话"}
  </button>;
  const stage = (
    <div className="remote-assist-stage">
      {source ? <img ref={screenImage} className={canInput ? "remote-assist-live remote-assist-interactive" : "remote-assist-live"}
        src={source} alt="实时手机画面" draggable={false} tabIndex={canInput ? 0 : undefined}
        onLoad={event => setLoadedSource(event.currentTarget.currentSrc)}
        onError={() => setLoadedSource("")}
        onPointerDown={startGesture} onPointerUp={endGesture}
        onPointerCancel={() => { gesture.current = null; }}
        onKeyDown={event => {
          if (!canInput || !frame) return;
          if (event.key === "Backspace") send({ kind: "back", seq: frame.seq });
          else if (event.key === "ArrowDown" || event.key === "ArrowUp") scrollPhone(event.key === "ArrowDown");
          else return;
          event.preventDefault();
        }} /> :
        <div className="remote-assist-idle" role="status">
          {pendingSession ? <>
            <strong>{receivedRequest ? "等待手机确认" : "等待手机连接"}</strong>
            <small>{pendingHint}</small>
            <small aria-hidden="true">剩余 {Math.max(0, Math.ceil((pendingSession.expiresAt - now) / 1000))} 秒</small>
          </> : session?.phase === "active" ? <strong>等待手机画面</strong> : pendingEnd ? <>
            <strong>{pendingEnd === "expired" ? "连接请求已超时" : "连接请求已结束"}</strong>
            <small>确认手机 App 的「远控」页已打开后，重新点击「请求连接」。</small>
          </> : <strong>暂无远控会话</strong>}
        </div>}
    </div>
  );

  if (!open) return session ? (
    <section className="panel remote-assist-dock" aria-label="手机画面浮窗">
      <div className="remote-assist-heading">
        <h2>手机画面</h2>
        {session.phase === "active" && <Badge>{activeStatus}</Badge>}
        {backControl}
      </div>
      {stage}
      <div className="button-row remote-assist-dock-actions">
        <button type="button" onClick={onOpen}>打开远控</button>
        {endControl}
      </div>
      {(pollError || commandError) && <p className="remote-assist-error" role="alert">{pollError || commandError}</p>}
    </section>
  ) : null;

  return (
    <div>
      <PageHead title="远控" sub="连接诊断页支持点击、滚动和返回。切换 Rainfall 工作台模块后，可在手机画面浮窗继续会话。查看其他应用需 Android 14 或更新版本，由手机在系统界面选择单个应用。" />
      <div className="remote-assist-layout">
        <div className="remote-assist-sidebar">
          <RemoteAssistConnection />
          <section className="panel remote-assist-setup" aria-labelledby="remote-assist-setup">
            <h2 id="remote-assist-setup">连接设置</h2>
            <label>
              手机设备
              <select aria-label="手机设备" value={deviceId} disabled={!canAct || Boolean(session) || !devices.length}
                onChange={event => setDeviceChoice(event.currentTarget.value)}>
                {devices.length ? devices.map(device => <option key={device.id} value={device.id}>{deviceLabel(device, devices, now)}</option>) :
                  <option value="">暂无已配对设备</option>}
              </select>
            </label>
            <label>
              会话方式
              <select aria-label="会话方式" value={session?.mode ?? mode} disabled={busy || Boolean(session)}
                onChange={event => setMode(event.currentTarget.value === "view" ? "view" : "rainfall")}>
                <option value="rainfall">操作 Rainfall 手机端</option>
                <option value="view">查看手机所选应用</option>
              </select>
            </label>
            <div className="button-row">
              {session ? endControl : <button type="button" className="primary" disabled={!canAct || !deviceId}
                onClick={() => void run("request", { deviceId, mode })}>请求连接</button>}
            </div>
            {!snapshot && !pollError && <p className="muted" role="status">正在读取连接状态…</p>}
            {snapshot && !pollError && !snapshot.running && <p className="muted">启动连接后可下载 App 并连接手机。</p>}
            {snapshot?.running && !pollError && !devices.length && <p className="muted">完成手机配对后即可请求连接。</p>}
            {pollError && <p className="remote-assist-error" role="alert">{pollError}</p>}
            {commandError && !pollError && <p className="remote-assist-error" role="alert">{commandError}</p>}
          </section>
        </div>

        <section className="panel remote-assist-viewer" aria-labelledby="remote-assist-screen">
          <div className="remote-assist-heading">
            <h2 id="remote-assist-screen">手机画面</h2>
            {session?.phase === "active" && <Badge>{activeStatus}</Badge>}
            {backControl}
          </div>
          {stage}
          <details className="remote-assist-help">
            <summary>手机安装与配对步骤</summary>
            <ol>
              <li>同一局域网可直接选择电脑的 Wi-Fi 或有线网卡。两端在不同网络时，先加入同一 Tailscale 私有网络，再选择电脑上的 Tailscale 网卡。选好后点击「启动连接」。</li>
              <li>用安卓手机相机扫描下载二维码，安装或覆盖安装 APK。</li>
              <li>首次配对时，在电脑点击「复制地址」，把完整地址（含 # 后的内容）发给手机，粘贴到手机 App 的「电脑端配对地址」。</li>
              <li>在电脑输入自定的 6 位数字，点击「开始配对」。在手机填写名称和相同的 6 位数字，点击「配对」。已配对的手机直接进行下一步。</li>
              <li>在手机 App 打开「远控」。电脑选择该设备和会话方式，点击「请求连接」。在手机点「允许本次会话」。</li>
            </ol>
            <p className="muted">切换网卡前先点击「停止连接」。配对地址变更后，在手机解除配对，再用新地址重新配对。</p>
          </details>
        </section>
      </div>
    </div>
  );
}
