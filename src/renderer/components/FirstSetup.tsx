import React, { useEffect, useState } from "react";
import { useStudio } from "../context";
import HelpNote from "./HelpNote";

export default function FirstSetup({
  onModels,
  onDirectories,
}: {
  onModels: () => void;
  onDirectories: () => void;
}) {
  const { call, go } = useStudio();
  const [counts, setCounts] = useState<{
    profiles: number;
    plans: number;
    sources: number;
  } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const [profiles, textConfigs, directory] = await Promise.all([
          call("apiProfile.list", {}),
          call("textConfig.list", {}),
          call("directoryTasks.status", {}),
        ]);
        if (active) {
          setCounts({
            profiles: profiles.filter(
              (p: {
                id: string;
                kind: string;
                providerId: string;
                modelId?: string | null;
              }) =>
                p.kind === "text" &&
                p.providerId !== "text_pending" &&
                (p.modelId ||
                  textConfigs.some(
                    (c: { profileId: string; modelId?: string | null }) =>
                      c.profileId === p.id && c.modelId,
                  )),
            ).length,
            plans: directory.plans.length,
            sources: directory.sources.filter(
              (s: { planId: string | null }) => s.planId,
            ).length,
          });
          setFailed(false);
        }
      } catch {
        if (active) setFailed(true);
      }
    };
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  const steps = [
    {
      title: "模型 API",
      count: counts?.profiles,
      action: onModels,
      button: "配置模型 API",
    },
    {
      title: "计划",
      count: counts?.plans,
      action: () => go("plans"),
      button: "打开计划中心",
    },
    {
      title: "任务目录",
      count: counts?.sources,
      action: onDirectories,
      button: "配置任务目录",
    },
  ];
  return (
    <section className="first-setup" aria-label="空间准备">
      <div className="directory-heading">
        <h2>空间准备</h2>
        <HelpNote label="准备顺序">
          先保存文本模型配置，再在计划中心选择配置、预算与授权，最后选择目录并绑定已保存的计划。
          这里显示已保存的设置数量；凭据和真实连接是否可用，需要在模型 API
          中核对。保存目录后仍需单独启用扫描。
        </HelpNote>
      </div>
      {failed && <p role="status">暂时无法核对准备状态，可继续打开设置。</p>}
      <ol className="first-setup-steps">
        {steps.map((step, i) => (
          <li key={step.title}>
            <span className="first-setup-number" aria-hidden="true">
              {i + 1}
            </span>
            <div>
              <strong>{step.title}</strong>
              <span>
                {step.count === undefined
                  ? "检查中"
                  : step.count
                    ? `已保存 ${step.count} 项`
                    : "待设置"}
              </span>
            </div>
            <button type="button" onClick={step.action}>
              {step.button}
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
