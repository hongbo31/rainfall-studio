import { z } from "zod";

export const DownloadArchiveRevisionSchema = z.strictObject({
  expectedRevision: z.number().int().nonnegative(),
});
export const DownloadArchiveAccountSchema = DownloadArchiveRevisionSchema.extend({
  accountId: z.uuid().nullable(),
});
export const DownloadArchiveDirectorySchema = DownloadArchiveRevisionSchema.extend({
  root: z.string().min(1).max(32767).nullable(),
});
export const DownloadArchiveFolderSchema = z.strictObject({
  accountId: z.uuid(),
  root: z.string().min(1),
  rootIdentity: z.string().min(1),
  name: z.string().min(1),
  audioVersion: z.enum(["A", "B"]).optional(),
});
export type DownloadArchiveFolder = z.infer<typeof DownloadArchiveFolderSchema>;
export type DownloadArchiveSettings = {
  revision: number;
  root: string | null;
  accountId: string | null;
};

export const configuredDownloadKinds = ["workAudio", "workCertificate", "lyricResult", "cover", "coverTask", "coverRequest", "materials"] as const;
export type ConfiguredDownloadKind = (typeof configuredDownloadKinds)[number];

export function isConfiguredDownloadKind(kind: unknown): kind is ConfiguredDownloadKind {
  return configuredDownloadKinds.some(value => value === kind);
}

export const downloadArchiveErrors: Record<string, string> = {
  DOWNLOAD_ROOT_REQUIRED: "请先在配置中心设置下载目录。",
  DOWNLOAD_ROOT_INVALID: "请选择电脑上的普通文件夹。",
  DOWNLOAD_ROOT_UNAVAILABLE: "找不到下载目录，请重新选择。",
  DOWNLOAD_ROOT_CHANGED: "下载目录已被替换，请重新选择。",
  DOWNLOAD_WRITE_FAILED: "无法写入下载目录，请检查目录权限和剩余空间。",
};

export const DownloadArchiveSchemas = {
  "downloadArchive.read": z.strictObject({}),
  "downloadArchive.chooseDirectory": DownloadArchiveRevisionSchema,
  "downloadArchive.clearDirectory": DownloadArchiveRevisionSchema,
  "downloadArchive.setAccount": DownloadArchiveAccountSchema,
};
