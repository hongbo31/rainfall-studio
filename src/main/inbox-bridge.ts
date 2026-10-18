type Scope = {
  mode: string;
  generation: number;
  available: boolean;
  epoch?: number;
};
type Dependencies = {
  capture: () => Scope;
  choose: () => Promise<{ canceled: boolean; filePaths: string[] }>;
  rpc: (method: string, input?: any) => Promise<any>;
};
/** Called only after Main validates the sender and an empty request. No renderer-provided paths. */
export async function chooseInboxBridgeProject(deps: Dependencies) {
  const initial = deps.capture();
  if (!initial.available) throw Error("WORKSPACE_UNAVAILABLE");
  const status = await deps.rpc("inbox.status", {});
  if (!status.ok) return status;
  const beforeChooser = deps.capture();
  if (
    !beforeChooser.available ||
    beforeChooser.mode !== initial.mode ||
    beforeChooser.generation !== initial.generation ||
    beforeChooser.epoch !== initial.epoch
  )
    throw Error("WORKSPACE_CHANGED");
  const selection = await deps.choose();
  const current = deps.capture();
  if (
    !current.available ||
    current.mode !== initial.mode ||
    current.generation !== initial.generation ||
    current.epoch !== initial.epoch
  )
    throw Error("WORKSPACE_CHANGED");
  if (selection.canceled) return { ok: true, value: null };
  if (selection.filePaths.length !== 1)
    throw Error("BRIDGE_DIRECTORY_REQUIRED");
  return deps.rpc("internal.inboxBridge.configure", {
    projectRoot: selection.filePaths[0],
    expectedRevision: status.value.bridge?.revision ?? 0,
  });
}
