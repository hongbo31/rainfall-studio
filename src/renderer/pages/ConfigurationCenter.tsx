import React, { useEffect, useState } from "react";
import { PageHead, useStudio } from "../context";
import ApiSettings from "../components/ApiSettings";
import PromptLibrary from "../components/PromptLibrary";
import DownloadArchiveSettings from "../components/DownloadArchiveSettings";
import FirstSetup from "../components/FirstSetup";
import ThemeSettings from "../components/ThemeSettings";
import PublicationDiagnostics from "./PublicationDiagnostics";
import SoftwareUpdateSettings from "../components/SoftwareUpdateSettings";

const categories = [
  ["models", "模型 API"],
  ["prompts", "提示词管理"],
  ["inbox", "下载目录"],
  ["diagnostics", "诊断与历史"],
  ["appearance", "外观"],
  ["update", "客户端更新"],
] as const;
type Category = typeof categories[number][0];

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
  initialCategory = "models",
}: {
  initialCategory?: Category;
}) {
  const { data, go } = useStudio();
  const [category, setCategory] = useState<Category>(initialCategory),
    [diagnosticsOpen, setDiagnosticsOpen] = useState(initialCategory === "diagnostics");
  useEffect(() => {
    setCategory(initialCategory);
    setDiagnosticsOpen(initialCategory === "diagnostics");
  }, [initialCategory]);
  return (
    <div className="configuration-center">
      <PageHead
        title="配置中心"
        action={<button onClick={() => go("publish")}>返回任务中心</button>}
      />
      {category !== "appearance" && category !== "update" && <details className="configuration-guide"><summary>首次使用引导</summary><FirstSetup
        onModels={() => setCategory("models")}
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
        {category === "update" ? <SoftwareUpdateSettings /> : category === "appearance" ? <ThemeSettings /> : category === "models" ? (
          <ApiSettings compact />
        ) : category === "prompts" ? (
          <PromptLibrary key={data.mode} />
        ) : category === "inbox" ? (
          <DownloadArchiveSettings key={data.mode} />
        ) : (
          <details
            className="panel publication-diagnostics"
            open={diagnosticsOpen}
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
