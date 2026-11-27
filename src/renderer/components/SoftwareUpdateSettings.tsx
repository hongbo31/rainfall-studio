import React, { useCallback, useEffect, useState } from "react";
import { useStudioRequest } from "../context";
import type { AppUpdateStatus } from "../../shared/app-update";

const stateLabels: Record<AppUpdateStatus["state"], string> = {
  unsupported: "此运行方式不支持客户端内更新。",
  "not-configured": "此安装包尚未配置更新源。",
  initializing: "安装初始化中，请稍后再检查。",
  idle: "点击检查更新，获取可用版本。",
  checking: "正在检查更新…",
  downloading: "正在下载新版，下载完成后可重启安装。",
  downloaded: "新版已下载，可重启安装。",
  "up-to-date": "当前已是最新版本。",
  error: "检查更新失败，请稍后重试。",
};

export default function SoftwareUpdateSettings() {
  const request = useStudioRequest();
  const [status, setStatus] = useState<AppUpdateStatus>();
  const [message, setMessage] = useState("");
  const [installing, setInstalling] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const value = await request("appUpdate.status") as AppUpdateStatus;
      setStatus(value);
      setMessage("");
    } catch {
      setMessage("暂时无法读取更新状态。请重开配置中心后重试。");
    }
  }, [request]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (status?.state !== "checking" && status?.state !== "downloading" && status?.state !== "initializing") return;
    const timer = window.setInterval(() => void refresh(), 1200);
    return () => window.clearInterval(timer);
  }, [refresh, status?.state]);

  const check = async () => {
    setMessage("");
    try {
      setStatus(await request("appUpdate.check") as AppUpdateStatus);
    } catch {
      setMessage("检查更新失败，请稍后重试。");
    }
  };

  const install = async () => {
    setInstalling(true);
    setMessage("");
    try {
      await request("appUpdate.install");
    } catch {
      setInstalling(false);
      setMessage("更新安装未能启动，请先保存工作后重试。");
    }
  };

  const canCheck = !!status?.supported &&
    !["not-configured", "initializing", "checking", "downloading", "downloaded"].includes(status.state);

  return (
    <section className="panel software-update-settings" aria-labelledby="software-update-title">
      <h2 id="software-update-title">客户端更新</h2>
      <p>当前版本：{status?.currentVersion ?? "读取中…"}</p>
      <p role="status" aria-live="polite">
        {message || (status ? stateLabels[status.state] : "正在读取更新状态…")}
        {status?.releaseName && status.state === "downloaded" ? ` · ${status.releaseName}` : ""}
      </p>
      <div className="button-row">
        <button type="button" onClick={() => void check()} disabled={!canCheck || installing}>
          {status?.state === "checking" ? "正在检查…" : "检查更新"}
        </button>
        {status?.state === "downloaded" && (
          <button type="button" className="primary" onClick={() => void install()} disabled={installing}>
            {installing ? "正在重启…" : "重启并更新"}
          </button>
        )}
      </div>
    </section>
  );
}
