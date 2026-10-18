import {
  LiveInspectSchema,
  LiveBatchSchema,
  LiveUnitSchema,
  LiveActSchema,
  LiveCancelSchema,
  LiveSyncSchema,
  type TmeLiveManager,
} from "./live";
export function registerTmeLiveHandlers(
  register: (
    name: string,
    handler: (event: any, input: unknown) => Promise<any>,
  ) => void,
  trusted: (e: any) => void,
  manager: TmeLiveManager,
  context: {
    mode: () => string;
    generation: () => number;
    unavailable: () => boolean;
  },
) {
  let generation: number | null = null;
  const available = () => {
    if (context.mode() !== "production" || context.unavailable())
      throw Error("WORKSPACE_UNAVAILABLE");
  };
  const assertScope = () => {
    available();
    if (generation !== context.generation()) throw Error("WORKSPACE_CHANGED");
  };
  register("rainfall:tme:live", async (e, raw) => {
    try {
      trusted(e);
      available();
      if (
        !raw ||
        typeof raw !== "object" ||
        Object.keys(raw).some((k) => !["action", "input"].includes(k))
      )
        throw Error("REQUEST_REJECTED");
      const { action, input } = raw as any;
      if (action === "inspect") {
        if (manager.isBusy()) throw Error("TME_BUSY");
        const before = context.generation();
        generation = null;
        const value = await manager.inspect(LiveInspectSchema.parse(input));
        available();
        if (before !== context.generation()) {
          manager.invalidate();
          throw Error("WORKSPACE_CHANGED");
        }
        generation = before;
        return { ok: true, value };
      }
      assertScope();
      const methods = {
        run: () => manager.runBatch(LiveBatchSchema.parse(input)),
        review: () => manager.review(LiveUnitSchema.parse(input)),
        act: () => manager.act(LiveActSchema.parse(input)),
        cancel: () => manager.cancel(LiveCancelSchema.parse(input)),
        sync: () => manager.sync(LiveSyncSchema.parse(input)),
        reconcile: () => manager.reconcile(LiveUnitSchema.parse(input)),
      };
      if (!Object.hasOwn(methods, action)) throw Error("ACTION_NOT_ALLOWED");
      const value = await methods[action as keyof typeof methods]();
      assertScope();
      return { ok: true, value };
    } catch (e) {
      const code =
        e instanceof Error && /^[A-Z0-9_]+$/.test(e.message)
          ? e.message
          : "TME_REQUEST_REJECTED";
      return {
        ok: false,
        error: { code, message: "腾讯窗口操作未完成：" + code },
      };
    }
  });
  return {
    assertScope,
    isBusy: () => manager.isBusy(),
    invalidate: () => {
      generation = null;
      manager.invalidate();
    },
  };
}
