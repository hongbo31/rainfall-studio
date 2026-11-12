import React, { useEffect, useState } from "react";
import { PageHead, names, useStudio } from "../context";
import {
  platformTargets,
  type PlatformTarget,
} from "../../shared/platform-config";
import PlatformConfigurationPanel from "../components/PlatformConfigurationPanel";
import FanqieConfigurationPanel from "../components/FanqieConfigurationPanel";
import ApiSettings from "../components/ApiSettings";
import TextConfiguration from "../components/TextConfiguration";
import TextCandidates from "../components/TextCandidates";
import DirectoryTaskSettings from "../components/DirectoryTaskSettings";
import FirstSetup from "../components/FirstSetup";
import ThemeSettings from "../components/ThemeSettings";
import Accounts from "./Accounts";
import PublicationDiagnostics from "./PublicationDiagnostics";

const categories = [
  ["platforms", "发布平台"],
  ["models", "模型 API"],
  ["inbox", "目录与收件"],
  ["artists", "艺人与预算"],
  ["diagnostics", "诊断与历史"],
  ["appearance", "外观"],
] as const;
function moveTab(event: React.KeyboardEvent<HTMLButtonElement>) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const tabs = Array.from(
    event.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>(
      '[role="tab"]',
    ),
  );
  const current = tabs.indexOf(event.currentTarget);
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : (current + (event.key === "ArrowLeft" ? -1 : 1) + tabs.length) %
          tabs.length;
  event.preventDefault();
  tabs[next].focus();
  tabs[next].click();
}
export default function ConfigurationCenter({
  initialTarget = "netease",
  initialCategory = "platforms",
  initialAccountId = "",
}: {
  initialTarget?: PlatformTarget;
  initialCategory?: "platforms" | "artists";
  initialAccountId?: string;
}) {
  const { go } = useStudio();
  const [category, setCategory] = useState<string>(initialCategory),
    [target, setTarget] = useState(initialTarget),
    [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  useEffect(() => {
    setTarget(initialTarget);
    setCategory(initialCategory);
    setDiagnosticsOpen(false);
  }, [initialTarget, initialCategory]);
  return (
    <div className="configuration-center">
      <PageHead
        title="配置中心"
        action={<button onClick={() => go("publish")}>返回发布中心</button>}
      />
      {category !== "appearance" && <details className="configuration-guide"><summary>首次使用引导</summary><FirstSetup
        onModels={() => setCategory("models")}
        onDirectories={() => setCategory("inbox")}
      /></details>}
      <div className="configuration-tabs" role="tablist" aria-label="配置分类">
        {categories.map(([id, title]) => (
          <button
            role="tab"
            type="button"
            id={"category-" + id}
            aria-controls={"category-panel-" + id}
            aria-selected={category === id}
            tabIndex={category === id ? 0 : -1}
            key={id}
            onKeyDown={moveTab}
            onClick={() => {
              if (id !== category) setDiagnosticsOpen(false);
              setCategory(id);
            }}
          >
            {title}
          </button>
        ))}
      </div>
      <section
        role="tabpanel"
        id={"category-panel-" + category}
        aria-labelledby={"category-" + category}
      >
        {category === "appearance" ? <ThemeSettings /> : category === "platforms" ? (
          <>
            <div
              className="platform-tabs"
              role="tablist"
              aria-label="发布平台配置"
            >
              {platformTargets.map((item) => (
                <button
                  type="button"
                  role="tab"
                  id={"platform-" + item}
                  aria-selected={target === item}
                  aria-controls="platform-configuration-panel"
                  tabIndex={target === item ? 0 : -1}
                  key={item}
                  onKeyDown={moveTab}
                  onClick={() => setTarget(item)}
                >
                  {names[item]}
                </button>
              ))}
            </div>
            <div
              role="tabpanel"
              id="platform-configuration-panel"
              aria-labelledby={"platform-" + target}
            >
              {target==='fanqie'?<FanqieConfigurationPanel key={initialAccountId} initialAccountId={initialAccountId}/>:<PlatformConfigurationPanel
                key={target}
                target={target}
                onManageAccounts={() => go("platform-accounts", target)}
              />}
            </div>
          </>
        ) : category === "models" ? (
          <>
            <ApiSettings compact />
            <TextConfiguration />
          </>
        ) : category === "inbox" ? (
          <DirectoryTaskSettings results={<TextCandidates />} />
        ) : category === "artists" ? (
          <Accounts showApi={false} compact />
        ) : (
          <details
            className="panel publication-diagnostics"
            onToggle={(event) => setDiagnosticsOpen(event.currentTarget.open)}
          >
            <summary>发布诊断与历史</summary>
            {diagnosticsOpen && <PublicationDiagnostics />}
          </details>
        )}
      </section>
    </div>
  );
}
