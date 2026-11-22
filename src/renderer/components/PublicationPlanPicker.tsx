import React, { useEffect, useId, useRef, useState } from "react";
import { publicationTaskPlanLimit, type PublicationPlan } from "../../shared/publication-tasks";

const planTime = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

function planInfo(plan: PublicationPlan, repeatedTitle: boolean) {
  const updatedAt = plan.updatedAt ? Date.parse(plan.updatedAt) : NaN;
  return [plan.artistName, repeatedTitle && Number.isFinite(updatedAt) ? planTime.format(updatedAt) : "",
    repeatedTitle ? plan.id.slice(0, 8) : ""].filter(Boolean).join(" · ");
}

export default function PublicationPlanPicker({ plans, initialIds, onConfirm, onClose }: {
  plans: PublicationPlan[];
  initialIds: string[];
  onConfirm: (ids: string[]) => void;
  onClose: () => void;
}) {
  const [ids, setIds] = useState(initialIds);
  const [query, setQuery] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const heading = useId();
  const byId = new Map(plans.map(plan => [plan.id, plan]));
  const counts = new Map<string, number>();
  for (const plan of plans) counts.set(plan.title, (counts.get(plan.title) ?? 0) + 1);

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    search.current?.focus();
    return () => { element?.close(); };
  }, []);

  const finish = (action: () => void) => {
    dialog.current?.close();
    action();
  };
  const toggle = (id: string, checked: boolean) => setIds(current =>
    checked ? current.includes(id) || current.length >= publicationTaskPlanLimit ? current : [...current, id]
      : current.filter(item => item !== id));
  const move = (id: string, delta: number) => setIds(current => {
    const index = current.indexOf(id), target = index + delta;
    if (index < 0 || target < 0 || target >= current.length) return current;
    const next = current.slice();
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  });
  const term = query.trim().toLocaleLowerCase();
  const results = plans.filter(plan => [plan.title, plan.artistName, plan.id].join(" ").toLocaleLowerCase().includes(term));

  return <dialog className="plan-editor publication-plan-picker scroll-panel" ref={dialog} aria-labelledby={heading}
    onCancel={event => { event.preventDefault(); finish(onClose); }}>
    <div className="section-title">
      <h2 id={heading}>选择关联计划</h2>
      <button type="button" onClick={() => finish(onClose)}>关闭</button>
    </div>
    <div className="scroll-panel-body">
    <div className="publication-plan-picker-grid">
      <section aria-label="计划中心的计划">
        <label>搜索计划<input ref={search} type="search" value={query} onChange={event => setQuery(event.target.value)}
          placeholder="按计划名称或艺人查找" /></label>
        {results.length ? <ul className="publication-plan-choices">
          {results.map(plan => {
            const checked = ids.includes(plan.id);
            const info = planInfo(plan, (counts.get(plan.title) ?? 0) > 1);
            return <li key={plan.id}>
              <label className="check">
                <input type="checkbox" checked={checked} disabled={!checked && ids.length >= publicationTaskPlanLimit}
                  onChange={event => toggle(plan.id, event.target.checked)} />
                <span>{plan.title}{info && <small>{info}</small>}</span>
              </label>
            </li>;
          })}
        </ul> : <p className="muted">{query ? "没有匹配的计划。" : "计划中心暂无可关联的音乐计划。"}</p>}
      </section>
      <section aria-label="执行顺序">
        <h3>执行顺序 <small aria-live="polite">{ids.length}/{publicationTaskPlanLimit}</small></h3>
        {ids.length ? <ol className="publication-plan-order">
          {ids.map((id, index) => {
            const plan = byId.get(id);
            const title = plan?.title ?? "不可用计划";
            const info = plan ? planInfo(plan, (counts.get(title) ?? 0) > 1) : id.slice(0, 8);
            return <li key={id}>
              <div className="publication-plan-order-row">
                <span>{title}{info && <small>{info}</small>}</span>
                <div className="publication-plan-order-actions">
                  <button type="button" aria-label={"上移 " + title} disabled={index === 0} onClick={() => move(id, -1)}>上移</button>
                  <button type="button" aria-label={"下移 " + title} disabled={index === ids.length - 1} onClick={() => move(id, 1)}>下移</button>
                  <button type="button" aria-label={"移除 " + title} onClick={() => toggle(id, false)}>移除</button>
                </div>
              </div>
            </li>;
          })}
        </ol> : <p className="muted">尚未选择计划。</p>}
      </section>
    </div>
    <div className="plan-editor-footer">
      <button type="button" onClick={() => finish(onClose)}>取消</button>
      <button className="primary" type="button" onClick={() => finish(() => onConfirm(ids))}>确认关联</button>
    </div>
    </div>
  </dialog>;
}
