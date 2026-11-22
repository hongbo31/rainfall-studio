import React, { useId, useRef, useState } from "react";
import type { PlanWorkflowGraph } from "../../shared/plan-center";
import { canConnectPlanWorkflowNodes } from "../../shared/plan-workflow-graph";
import type { WorkflowNodeDefinition } from "../../shared/platform-directory";
import HelpNote from "./HelpNote";

type Point = NonNullable<PlanWorkflowGraph["positions"]>[string];
type NativeDrag = { kind: "add" | "link"; id: string };
type Move = { id: string; pointerId: number; offset: Point };

const dragType = "application/x-rainfall-plan-workflow";
const nodeWidth = 136;
const nodeHeight = 72;
const portRadius = 12;
const gutter = 40;
const columnStep = 200;
const rowStep = 88;
const minimumHeight = 184;
const positionLimit = 2000;
const stageOrder = { lyrics: 0, text: 0, creation: 1, music: 2, publish: 3 };
const kindLabels = { lyrics: "作词", text: "文本 API", creation: "创作", music: "音乐生成", publish: "发布" };
const moveKeys: Readonly<Record<string, Point>> = {
  ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 },
};

function unavailableNode(id: string): WorkflowNodeDefinition {
  const [prefix, provider] = id.split(":");
  const kind = prefix === "lyrics" || prefix === "creation" || prefix === "music" || prefix === "publish" ? prefix : "text";
  const label = kind === "lyrics" ? "AI作词" : kind === "creation" ? "创作中心" : provider ?? id;
  return { id, kind, label, available: false, reason: "此模块已从平台目录移除" };
}

function clampPosition({ x, y }: Point): Point {
  const clamp = (n: number) => Math.min(positionLimit, Math.max(0, Math.round(n)));
  return { x: clamp(x), y: clamp(y) };
}

function hasRoom(positions: Record<string, Point>, at: Point) {
  return Object.values(positions).every(other =>
    Math.abs(at.x - other.x) >= nodeWidth + 2 * portRadius + 8 ||
    Math.abs(at.y - other.y) >= nodeHeight + 8);
}

function openPosition(positions: Record<string, Point>, preferred: Point) {
  if (hasRoom(positions, preferred)) return preferred;
  for (let y = 0; y <= positionLimit; y += rowStep) {
    const candidate = { x: preferred.x, y };
    if (hasRoom(positions, candidate)) return candidate;
  }
  for (let x = 0; x <= positionLimit; x += columnStep) {
    for (let y = 0; y <= positionLimit; y += rowStep) {
      if (hasRoom(positions, { x, y })) return { x, y };
    }
  }
  return preferred;
}

function layoutNodes(nodes: readonly WorkflowNodeDefinition[], saved: PlanWorkflowGraph["positions"]) {
  const positions: Record<string, Point> = {};
  for (const { id } of nodes) {
    if (saved?.[id]) positions[id] = clampPosition(saved[id]);
  }
  const columns = [0, 1, 2, 3].map(stage => nodes.filter(node => stageOrder[node.kind] === stage))
    .filter(column => column.length);
  const rows = Math.max(1, ...columns.map(column => column.length));
  const firstRow = Math.max(0, (minimumHeight - 2 * gutter - nodeHeight - (rows - 1) * rowStep) / 2);
  columns.forEach((column, index) => column.forEach(({ id }, row) => {
    if (positions[id]) return;
    const preferred = clampPosition({ x: index * columnStep, y: firstRow + (row + (rows - column.length) / 2) * rowStep });
    positions[id] = openPosition(positions, preferred);
  }));
  return positions;
}

function portPosition(position: Point, output: boolean): Point {
  return { x: position.x + gutter + (output ? nodeWidth + portRadius : -portRadius),
    y: position.y + gutter + nodeHeight / 2 };
}

function connector(start: Point, end: Point) {
  const middle = (start.x + end.x) / 2;
  const middleY = (start.y + end.y) / 2;
  if (end.x <= start.x) {
    // Use the gap between vertically separated cards so the line stays in view.
    const lane = Math.abs(start.y - end.y) >= nodeHeight + 4 ? middleY : Math.min(start.y, end.y) - nodeHeight / 2 - 12;
    return {
      path: `M ${start.x} ${start.y} H ${start.x + 12} V ${lane} H ${end.x - 12} V ${end.y} H ${end.x}`,
      removeAt: { x: middle, y: lane },
    };
  }
  return {
    path: `M ${start.x} ${start.y} C ${middle} ${start.y} ${middle} ${end.y} ${end.x} ${end.y}`,
    removeAt: { x: middle, y: middleY },
  };
}

export default function PlanWorkflowCanvas({ value, catalog, selectedNode, onSelect, onChange }: {
  value: PlanWorkflowGraph;
  catalog: readonly WorkflowNodeDefinition[];
  selectedNode: string;
  onSelect: (id: string) => void;
  onChange: (draft: PlanWorkflowGraph) => void;
}) {
  const arrowId = `plan-workflow-arrow-${useId()}`;
  const stage = useRef<HTMLDivElement>(null);
  const movement = useRef<Move | null>(null);
  const movedNode = useRef("");
  const [dragging, setDragging] = useState<NativeDrag | null>(null);
  const [selectedOutput, setSelectedOutput] = useState<string | null>(null);
  const [linkPreview, setLinkPreview] = useState<Point | null>(null);
  const [moving, setMoving] = useState<{ id: string; at: Point } | null>(null);

  const directory = new Map(catalog.map(node => [node.id, node]));
  const order = (a: WorkflowNodeDefinition, b: WorkflowNodeDefinition) => stageOrder[a.kind] - stageOrder[b.kind];
  const nodes = value.nodes.map(id => directory.get(id) ?? unavailableNode(id)).sort(order);
  const byId = new Map(nodes.map(node => [node.id, node]));
  const layout = layoutNodes(nodes, value.positions);
  const positions = moving ? { ...layout, [moving.id]: moving.at } : layout;
  const links = value.edges.filter(edge => byId.has(edge.from) && byId.has(edge.to));
  const activeOutput = dragging?.kind === "link" ? dragging.id : selectedOutput;
  const surfaceWidth = Math.max(0, ...Object.values(positions).map(at => at.x + nodeWidth + 2 * gutter));
  const surfaceHeight = Math.max(minimumHeight, ...Object.values(positions).map(at => at.y + nodeHeight + 2 * gutter));
  const canAdd = (node: WorkflowNodeDefinition) => node.available && !byId.has(node.id) && nodes.length < 24;
  const canLink = (from: string, to: string) => byId.get(from)?.available === true && byId.get(to)?.available === true &&
    canConnectPlanWorkflowNodes(value.edges, from, to);

  const canvasPoint = (event: { clientX: number; clientY: number }): Point => {
    const bounds = stage.current?.getBoundingClientRect();
    return { x: event.clientX - (bounds?.left ?? 0), y: event.clientY - (bounds?.top ?? 0) };
  };
  const addNode = (node: WorkflowNodeDefinition, at?: Point) => {
    if (!canAdd(node)) return;
    const nextNodes = [...nodes, node].sort(order).map(row => row.id);
    onChange({ ...value, nodes: nextNodes,
      ...(at && hasRoom(positions, at) ? { positions: { ...value.positions, [node.id]: at } } : {}),
    });
  };
  const removeNode = (id: string) => {
    if (selectedOutput === id) setSelectedOutput(null);
    const nextPositions = { ...value.positions };
    delete nextPositions[id];
    onChange({ nodes: value.nodes.filter(node => node !== id), edges: value.edges.filter(edge => edge.from !== id && edge.to !== id),
      ...(Object.keys(nextPositions).length ? { positions: nextPositions } : {}),
    });
  };
  const endDrag = () => { setDragging(null); setLinkPreview(null); };
  const connect = (from: string, to: string) => {
    if (!canLink(from, to)) return;
    setSelectedOutput(null);
    endDrag();
    onChange({ ...value, edges: [...value.edges, { from, to }] });
  };
  const startDrag = (event: React.DragEvent, drag: NativeDrag) => {
    event.dataTransfer.setData(dragType, `${drag.kind}:${drag.id}`);
    event.dataTransfer.effectAllowed = drag.kind === "link" ? "link" : "copy";
    setSelectedOutput(null);
    setDragging(drag);
  };
  const dragOver = (event: React.DragEvent) => {
    if (!dragging || !event.dataTransfer.types.includes(dragType)) return;
    if (dragging.kind === "link") {
      setLinkPreview(canvasPoint(event));
    } else {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    }
  };
  const dropNode = (event: React.DragEvent) => {
    if (dragging?.kind !== "add" || event.dataTransfer.getData(dragType) !== `add:${dragging.id}`) return;
    event.preventDefault();
    const node = directory.get(dragging.id);
    const point = canvasPoint(event);
    endDrag();
    if (node) addNode(node, clampPosition({ x: point.x - gutter - nodeWidth / 2, y: point.y - gutter - nodeHeight / 2 }));
  };

  const savePosition = (id: string, at: Point) => {
    if (at.x !== layout[id].x || at.y !== layout[id].y) onChange({ ...value, positions: { ...value.positions, [id]: at } });
  };
  const startMove = (event: React.PointerEvent<HTMLButtonElement>, id: string) => {
    if (event.button !== 0 || !event.isPrimary) return;
    movedNode.current = "";
    const point = canvasPoint(event);
    const start = layout[id];
    movement.current = { id, pointerId: event.pointerId, offset: { x: point.x - start.x, y: point.y - start.y } };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const cancelMove = () => { movement.current = null; setMoving(null); };
  const updateMove = (event: React.PointerEvent<HTMLButtonElement>, commit: boolean) => {
    const move = movement.current;
    if (!move || event.pointerId !== move.pointerId) return;
    const point = canvasPoint(event);
    const at = clampPosition({ x: point.x - move.offset.x, y: point.y - move.offset.y });
    if (commit) {
      cancelMove();
      const initial = layout[move.id];
      if (Math.abs(initial.x - at.x) + Math.abs(initial.y - at.y) > 4) {
        movedNode.current = move.id;
        savePosition(move.id, at);
      }
    } else {
      setMoving({ id: move.id, at });
    }
  };
  const nudgeNode = (event: React.KeyboardEvent<HTMLButtonElement>, id: string) => {
    const direction = moveKeys[event.key];
    if (!direction) return;
    event.preventDefault();
    const distance = event.shiftKey ? 32 : 8;
    const { x, y } = layout[id];
    savePosition(id, clampPosition({ x: x + distance * direction.x, y: y + distance * direction.y }));
    const handle = event.currentTarget;
    requestAnimationFrame(() => handle.scrollIntoView({ block: "nearest", inline: "nearest" }));
  };

  const drawnLinks = links.map(edge => ({ ...edge, ...connector(portPosition(positions[edge.from], true), portPosition(positions[edge.to], false)) }));
  const previewStart = dragging?.kind === "link" && positions[dragging.id] ? portPosition(positions[dragging.id], true) : null;

  return <fieldset className="plan-workflow-builder" onKeyDown={event => {
    if (event.key !== "Escape" || (!selectedOutput && !movement.current)) return;
    event.preventDefault();
    setSelectedOutput(null);
    cancelMove();
  }}>
    <legend>工作流程</legend>
    <div className="plan-workflow-palette" role="group" aria-label="流程模块">
      {catalog.map(node => <button key={node.id} type="button"
        draggable={canAdd(node)} aria-disabled={!canAdd(node)} title={node.reason ?? (byId.has(node.id) ? "已添加" : undefined)}
        onClick={() => addNode(node)} onDragStart={event => {
          if (canAdd(node)) startDrag(event, { kind: "add", id: node.id });
          else event.preventDefault();
        }} onDragEnd={endDrag}>{node.label}</button>)}
      <HelpNote label="操作帮助">拖入模块或点击添加。点击节点打开配置。单独的番茄音乐节点读取配置中心的下载目录。可将右侧输出拖到左侧输入，也可依次点击两端。拖动节点名称或按方向键移动，点击连线旁的 × 可断开连接。</HelpNote>
    </div>
    <div className={`plan-workflow-canvas${dragging?.kind === "add" ? " is-droppable" : ""}`}
      role="group" aria-label="工作流程画布" tabIndex={0} onDrop={dropNode} onDragOver={dragOver}>
      <div ref={stage} className="plan-workflow-surface" style={{ width: surfaceWidth, height: surfaceHeight }}>
        {!nodes.length && <p className="plan-workflow-empty">拖入或点击添加模块</p>}
        <svg className="plan-workflow-edges" aria-hidden="true">
          <defs><marker id={arrowId} markerWidth="8" markerHeight="8" refX="7" refY="4" markerUnits="userSpaceOnUse" orient="auto">
            <path d="M 0 0 L 8 4 L 0 8 Z" fill="currentColor" />
          </marker></defs>
          {drawnLinks.map(({ to, path }) => <path key={to} d={path} markerEnd={`url(#${arrowId})`} />)}
          {linkPreview && previewStart && <path className="plan-workflow-edge-preview"
            d={`M ${previewStart.x} ${previewStart.y} L ${linkPreview.x} ${linkPreview.y}`} />}
        </svg>
        {nodes.map(node => {
          const { id, label, kind, available } = node;
          const { x, y } = positions[id];
          const validTarget = !!activeOutput && canLink(activeOutput, id);
          const canStart = nodes.some(target => canLink(id, target.id));
          const linkedInput = links.some(edge => edge.to === id);
          const linkedOutput = links.some(edge => edge.from === id);
          return <div key={id} className={`plan-workflow-node${moving?.id === id ? " is-moving" : ""}`}
            data-kind={kind} data-selected={selectedNode === id}
            onClick={event => { if (!(event.target as HTMLElement).closest("button")) onSelect(id); }}
            role="group" aria-label={label} style={{ left: gutter + x, top: gutter + y, width: nodeWidth, height: nodeHeight }}>
            <div className="plan-workflow-node-heading">
              <button type="button" className="plan-workflow-move" aria-label={`配置${label}`} aria-pressed={selectedNode === id}
                title="点击配置 · 拖动或按方向键移动"
                onPointerDown={event => startMove(event, id)} onPointerMove={event => updateMove(event, false)}
                onPointerUp={event => updateMove(event, true)} onPointerCancel={cancelMove} onLostPointerCapture={cancelMove}
                onClick={event => {
                  if (event.detail > 0 && movedNode.current === id) { movedNode.current = ""; return; }
                  onSelect(id);
                }}
                onKeyDown={event => nudgeNode(event, id)}><strong>{label}</strong></button>
              <button type="button" className="plan-workflow-remove" aria-label={`移除${label}`} title={`移除${label}`}
                onClick={() => removeNode(id)}>×</button>
            </div>
            <small className={available ? undefined : "is-unavailable"} title={node.reason}>{available ? kindLabels[kind] : "不可用"}</small>
            {stageOrder[kind] > 0 && <button type="button"
              className={`plan-workflow-port is-input${validTarget ? " is-target" : ""}${linkedInput ? " is-linked" : ""}`}
              aria-label={`${label}输入`} title={`${label}输入`} disabled={!validTarget}
              onClick={() => { if (selectedOutput) connect(selectedOutput, id); }} onDragOver={event => {
                if (dragging?.kind !== "link" || !validTarget || !event.dataTransfer.types.includes(dragType)) return;
                event.preventDefault();
                event.stopPropagation();
                event.dataTransfer.dropEffect = "link";
                setLinkPreview(portPosition(positions[id], false));
              }} onDrop={event => {
                if (dragging?.kind !== "link" || !validTarget || event.dataTransfer.getData(dragType) !== `link:${dragging.id}`) return;
                event.preventDefault();
                event.stopPropagation();
                connect(dragging.id, id);
              }} />}
            {stageOrder[kind] < 3 && <button type="button"
              className={`plan-workflow-port is-output${linkedOutput ? " is-linked" : ""}`}
              aria-label={`${label}输出`} title={`${label}输出`} aria-pressed={activeOutput === id} disabled={!canStart}
              draggable={canStart} onClick={() => setSelectedOutput(selectedOutput === id ? null : id)}
              onDragStart={event => startDrag(event, { kind: "link", id })} onDragEnd={endDrag} />}
          </div>;
        })}
        {drawnLinks.map(({ from, to, removeAt }) => {
          const description = `${byId.get(from)?.label} → ${byId.get(to)?.label}`;
          return <button key={to} type="button" className="plan-workflow-disconnect" style={{ left: removeAt.x, top: removeAt.y }}
            aria-label={drawnLinks.length === 1 ? "断开连接" : `断开连接 ${description}`} title={`断开连接 ${description}`}
            onClick={() => onChange({ ...value, edges: value.edges.filter(edge => edge.from !== from || edge.to !== to) })}>×</button>;
        })}
      </div>
    </div>
  </fieldset>;
}
