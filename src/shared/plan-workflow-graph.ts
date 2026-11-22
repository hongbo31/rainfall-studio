import { z } from "zod";

const nodeId = z.string().regex(/^(lyrics|creation|(text|music|publish):[a-z][a-z0-9_-]{0,79})$/);
const edge = z.strictObject({ from: nodeId, to: nodeId });
const coordinate = z.number().int().min(0).max(2000);
type Edge = z.infer<typeof edge>;

function nodeKind(id: string) {
  return id === "lyrics" ? "text" : id.split(":", 1)[0];
}

export function canConnectPlanWorkflowNodes(edges: readonly Edge[], from: string, to: string) {
  const start = nodeKind(from), end = nodeKind(to);
  if (edges.some(link => link.to === to)) return false;
  const outgoing = edges.filter(link => link.from === from);
  if (start === "text") return outgoing.length === 0 && (end === "creation" || end === "music");
  if (start === "creation") return end === "music" ? outgoing.length === 0 : end === "publish" &&
    outgoing.every(link => nodeKind(link.to) === "publish");
  return start === "music" && end === "publish";
}

export function isLocalPublicationWorkflow(graph?: { nodes: readonly string[]; edges: readonly Edge[] }) {
  return !!graph && graph.nodes.length === 1 && graph.nodes[0] === "publish:fanqie" && graph.edges.length === 0;
}

export const PlanWorkflowGraphSchema = z.strictObject({
  nodes: z.array(nodeId).min(1).max(24),
  edges: z.array(edge).max(23),
  positions: z.record(nodeId, z.strictObject({ x: coordinate, y: coordinate })).optional(),
}).refine(graph => {
  const nodes = new Set(graph.nodes);
  if (Object.keys(graph.positions ?? {}).some(id => !nodes.has(id))) return false;
  if (isLocalPublicationWorkflow(graph)) return true;
  const kinds = graph.nodes.map(nodeKind);
  if (nodes.size !== graph.nodes.length || graph.edges.length !== nodes.size - 1 ||
    kinds.filter(kind => kind === "text").length !== 1 || kinds.filter(kind => kind === "music").length > 1 ||
    (!kinds.includes("creation") && !kinds.includes("music"))) return false;
  const accepted: Edge[] = [];
  for (const link of graph.edges) {
    if (!nodes.has(link.from) || !nodes.has(link.to) || !canConnectPlanWorkflowNodes(accepted, link.from, link.to)) return false;
    accepted.push(link);
  }
  return true;
}, "WORKFLOW_CONNECTIONS_REQUIRED");

export type PlanWorkflowGraph = z.infer<typeof PlanWorkflowGraphSchema>;
export const connectedPlanWorkflowGraph: PlanWorkflowGraph = {
  nodes: ["lyrics", "creation"], edges: [{ from: "lyrics", to: "creation" }],
};

export function workflowProvider(graph: PlanWorkflowGraph | undefined, role: "text" | "music") {
  const prefix = role + ":";
  return graph?.nodes.find(id => id.startsWith(prefix))?.slice(prefix.length);
}

export function workflowPublicationPlatforms(graph?: PlanWorkflowGraph) {
  return graph?.nodes.filter(id => id.startsWith("publish:")).map(id => id.slice("publish:".length)) ?? [];
}

export function workflowSequence(graph: PlanWorkflowGraph) {
  const steps: string[][] = [];
  let next = graph.nodes.filter(id => !graph.edges.some(edge => edge.to === id));
  while (next.length && steps.length < graph.nodes.length) {
    steps.push(next);
    next = graph.edges.filter(edge => next.includes(edge.from)).map(edge => edge.to);
  }
  return steps;
}
