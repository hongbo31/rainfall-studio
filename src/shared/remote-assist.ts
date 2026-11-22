import { z } from "zod";

export const remoteAssistPairCodeSchema = z.string().regex(/^[0-9]{6}$/u);
export const remoteAssistDeviceNameSchema = z.string().trim().min(1).max(48)
  .regex(/^[\p{L}\p{M}\p{N} .。_()（）·・—！!，,、？?＆&+'’\-]+$/u);
export const remoteAssistModeSchema = z.enum(["rainfall", "view"]);
export const remoteAssistSeqSchema = z.number().int().min(1).max(2_147_483_647);
const coordinate = z.number().min(0).max(1);
export const remoteAssistCommandSchema = z.discriminatedUnion("kind", [
  z.strictObject({ seq: remoteAssistSeqSchema, kind: z.literal("back") }),
  z.strictObject({ seq: remoteAssistSeqSchema, kind: z.literal("tap"), x: coordinate, y: coordinate }),
  z.strictObject({ seq: remoteAssistSeqSchema, kind: z.literal("swipe"), x: coordinate, y: coordinate, endX: coordinate, endY: coordinate }),
]);

export type RemoteAssistAction = "status" | "request" | "stop" | "input";
export type RemoteAssistMode = z.infer<typeof remoteAssistModeSchema>;
export type RemoteAssistCommand = z.infer<typeof remoteAssistCommandSchema>;
export type RemoteAssistFrame = { seq: number; jpeg: string };
export type RemoteAssistPhoneSession = {
  id: string;
  mode: RemoteAssistMode;
  phase: "pending" | "active";
  expiresAt: number;
};
export type RemoteAssistDevice = { id: string; name: string; pairedAt: number; lastRemoteContactAt: number | null };
export type RemoteAssistConnectionAction = "status" | "start" | "stop" | "pair" | "cancelPairing" | "removeDevice";
export type RemoteAssistNetworkInterface = { address: string; label: string };
export type RemoteAssistConnectionSnapshot = {
  running: boolean;
  interfaces: RemoteAssistNetworkInterface[];
  endpoint: string | null;
  apkDownloadUrl: string | null;
  pairExpiresAt: number | null;
  devices: Pick<RemoteAssistDevice, "id" | "name" | "pairedAt">[];
};
export type RemoteAssistSnapshot = {
  running: boolean;
  devices: RemoteAssistDevice[];
  session: (RemoteAssistPhoneSession & { deviceId: string; frame: RemoteAssistFrame | null; phoneContactAt: number | null }) | null;
};
