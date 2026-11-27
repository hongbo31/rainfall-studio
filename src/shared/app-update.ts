export type AppUpdateState =
  | "unsupported"
  | "not-configured"
  | "initializing"
  | "idle"
  | "checking"
  | "downloading"
  | "downloaded"
  | "up-to-date"
  | "error";

export interface AppUpdateStatus {
  supported: boolean;
  state: AppUpdateState;
  currentVersion: string;
  releaseName?: string;
}
