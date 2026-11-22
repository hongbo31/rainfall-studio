import React, { useEffect, useState } from "react";
import type { PlatformAccount } from "../../shared/platform-accounts";
import { platformPageUrls } from "../../shared/platform-directory";
import { accountLoginText, type AccountSessionStatus } from "../account-session";
import { Badge, useStudio } from "../context";

function openedSessionText(status: AccountSessionStatus) {
  if (status.puleState || status.qishuiState || status.loginState || status.profileVerified) return accountLoginText(status);
  return status.opened ? "请在专属窗口核对登录" : "窗口未打开";
}

export function usePlatformPage(provider: string, account?: PlatformAccount, missingAccount?: string) {
  const { data, runtime } = useStudio();
  const [opening, setOpening] = useState(false);
  const [watchAccount, setWatchAccount] = useState<string>();
  const [feedback, setFeedback] = useState<{ scope: string; text: string; error?: boolean }>();
  const accountId = account?.id;
  const scope = accountId ?? provider;
  const offline = runtime.offlineAcceptance;
  const watching = !!accountId && watchAccount === accountId && data.mode === "production" && !offline;

  useEffect(() => {
    if (!watching || !accountId) return;
    let mounted = true;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh(accountId: string) {
      try {
        const result = await window.rainfall.call("accountSession.status", { accountId });
        if (mounted && result.ok) {
          setFeedback({ scope: accountId, text: openedSessionText(result.value) });
          if (!result.value.opened) {
            setWatchAccount(undefined);
            return;
          }
        }
      } catch {
        // The next read can recover when the official page responds again.
      }
      if (mounted) timer = setTimeout(() => void refresh(accountId), 1_500);
    }
    timer = setTimeout(() => void refresh(accountId), 1_500);
    return () => { mounted = false; clearTimeout(timer); };
  }, [accountId, watching]);

  async function open() {
    if (opening) return;
    const blocked = offline ? "离线验收期间无法打开官网。"
      : accountId && data.mode !== "production" ? "请切换到真实本地库核对账号。"
      : !accountId && (missingAccount || (!Object.hasOwn(platformPageUrls, provider) && "请先配置平台页面。"));
    if (blocked) {
      setFeedback({ scope, text: blocked, error: true });
      return;
    }
    setOpening(true);
    setWatchAccount(undefined);
    setFeedback(undefined);
    try {
      const result = accountId
        ? await window.rainfall.call("accountSession.open", { accountId })
        : await window.rainfall.openOfficial(provider);
      if (!result.ok) throw Error(result.error.message);
      setFeedback({ scope, text: accountId ? openedSessionText(result.value) : "页面已打开" });
      if (accountId && result.value.opened && (account?.provider === "yourmusic" || account?.provider === "qishui")) {
        setWatchAccount(accountId);
      }
    } catch (cause) {
      setFeedback({ scope, text: cause instanceof Error ? cause.message : "打开页面失败，请重试。", error: true });
    } finally {
      setOpening(false);
    }
  }

  return { open, opening, feedback: feedback?.scope === scope ? feedback : undefined };
}

export default function PlatformCardHeader({ id, title, status, page, openDisabled, children }: {
  id: string;
  title: string;
  status?: string;
  page: ReturnType<typeof usePlatformPage>;
  openDisabled?: boolean;
  children: React.ReactNode;
}) {
  return <>
    <div className="platform-management-card-header">
      <h3 id={id}>{title}</h3>
      <div className="platform-management-card-actions">
        <button type="button" aria-label={`打开 ${title} 页面`} disabled={page.opening || openDisabled}
          onClick={() => void page.open()}>{page.opening ? "打开中…" : "打开页面"}</button>
        {children}
      </div>
      {status && <div className="platform-management-card-status"><Badge>{status}</Badge></div>}
    </div>
    {page.feedback && <small className={page.feedback.error ? "notice" : "muted"}
      role={page.feedback.error ? "alert" : "status"}>{page.feedback.text}</small>}
  </>;
}
