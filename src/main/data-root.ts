import path from "node:path";
// Explicit QA roots remain a runtime input; packaged preview roots are defaults only.
export function resolveDataRoot(explicit: string | undefined, preview: string | undefined, appData: string) {
  return path.resolve(explicit || preview || path.join(appData, "RainfallStudio"));
}
