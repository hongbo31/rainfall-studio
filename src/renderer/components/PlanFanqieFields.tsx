import React, { useEffect, useRef, useState } from "react";
import type { PlanCenterPlan } from "../../shared/plan-center";
import { defaultFanqieAccountId } from "../../shared/platform-accounts";
import { useStudio } from "../context";
import {
  fanqieChoices,
  defaultFanqieChoice,
  fanqieScope,
} from "../fanqie-accounts";
import ChoiceButtons from "./ChoiceButtons";

export default function PlanFanqieFields({
  plan,
  patch,
}: {
  plan: PlanCenterPlan;
  patch: (value: Partial<PlanCenterPlan>) => void;
}) {
  const { data, go } = useStudio();
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = useRef(true);
  const currentPlan = useRef(plan);
  currentPlan.current = plan;
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const choices = fanqieChoices(data.accounts ?? []);
  const legacy = choices.some(
    (choice) => choice.value === defaultFanqieAccountId,
  )
    ? defaultFanqieAccountId
    : "";
  const accountId = plan.fanqie
    ? (plan.fanqie.accountId ?? legacy)
    : selected || defaultFanqieChoice(choices, data.platformConfigurations);
  const accountRequired = choices.length > 1 && !accountId;
  const clear = () =>
    patch({
      fanqie: undefined,
      authorization: {
        ...plan.authorization,
        publish: plan.publishTargets.some((target) => target.enabled),
      },
    });
  const enable = async () => {
    setBusy(true);
    setError("");
    const scope = fanqieScope(accountId);
    try {
      const config = await window.rainfall.fanqieUpload("configuration", scope);
      if (!active.current) return;
      if (!config.ok || !config.value.configurationHash)
        throw Error("请先保存该番茄账号的发布配置。");
      const opened = await window.rainfall.fanqieCatalog("open", scope);
      if (!active.current) return;
      if (!opened.ok) throw Error(opened.error.message);
      const read = await window.rainfall.fanqieCatalog("read", scope);
      if (!active.current) return;
      if (!read.ok) throw Error(read.error.message);
      if (!read.value.report?.complete)
        throw Error("作品列表未读全，请核对番茄账号。");
      patch({
        fanqie: {
          ...scope,
          accountKey: read.value.report.accountKey,
          configurationHash: config.value.configurationHash,
          materialsConsent: true,
        },
        authorization: { ...currentPlan.current.authorization, publish: true },
      });
    } catch (error) {
      if (active.current)
        setError(error instanceof Error ? error.message : "核对账号未完成");
    } finally {
      if (active.current) setBusy(false);
    }
  };
  return (
    <fieldset>
      <legend>上传</legend>
      {!!choices.length && (
        <ChoiceButtons
          label="计划番茄账号"
          choices={choices}
          value={accountId}
          disabled={busy}
          onChange={(id) => {
            if (id === accountId) return;
            setSelected(id);
            setError("");
            clear();
          }}
        />
      )}
      <label className="check">
        <input
          type="checkbox"
          checked={!!plan.fanqie && plan.authorization.publish}
          disabled={busy || accountRequired}
          onChange={(event) => {
            if (event.target.checked) void enable();
            else {
              setSelected(accountId);
              clear();
            }
          }}
        />
        {busy ? "正在核对账号…" : "批量上传并准备番茄合同"}
      </label>
      {accountRequired && <small>请选择番茄账号。</small>}
      {error && (
        <p role="alert">
          {error}{" "}
          <button
            type="button"
            onClick={() => go("platform-accounts", "fanqie")}
          >
            管理账号
          </button>
        </p>
      )}
    </fieldset>
  );
}
