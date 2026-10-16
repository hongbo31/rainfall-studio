export * from "../../shared/creation";
export type TextRequest = {
  kind: "generate" | "revise" | "evaluate" | "review";
  operationId: string;
  sessionId: string;
  modelId: string;
  context: unknown;
  maxOutputTokens: number;
};
export type TextResponse = {
  status: "ok" | "invalid" | "refused" | "unknown" | "confirmed_unsent";
  value?: unknown;
  actualCost: number | null;
  evidenceId?: string;
};
export interface TextProvider {
  id: string;
  source: "fixture" | "external" | "local";
  invoke(request: TextRequest): Promise<TextResponse>;
}
// No default provider or ambient fetch. A protocol implementation must be explicitly installed.
export class TextProviderRegistry {
  private adapters = new Map<string, TextProvider>();
  register(provider: TextProvider) {
    if (this.adapters.has(provider.id)) throw Error("DUPLICATE_ADAPTER");
    this.adapters.set(provider.id, provider);
  }
  get(id: string) {
    return this.adapters.get(id);
  }
  async invoke(id: string, request: TextRequest): Promise<TextResponse> {
    const a = this.adapters.get(id);
    if (!a) throw Error("TEXT_ADAPTER_UNAVAILABLE");
    return a.invoke(request);
  }
}
