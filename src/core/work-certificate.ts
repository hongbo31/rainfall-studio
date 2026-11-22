import { z } from "zod";
import { safeWorkFilenameStem } from "../shared/work-analysis";
import { exportManagedAsset } from "./assets";
import type { Studio } from "./studio";

const selectionSchema = z.strictObject({ workId: z.uuid(), assetId: z.uuid() });
const certificateMimes = new Map([
  ["pdf", "application/pdf"],
  ["png", "image/png"],
  ["jpg", "image/jpeg"],
  ["webp", "image/webp"],
]);

function resolveCertificate(s: Studio, input: unknown) {
  const { workId, assetId } = selectionSchema.parse(input);
  const work = s.get("works", workId);
  if (work.assets?.certificate !== assetId) throw Error("WORK_CERTIFICATE_CHANGED");
  const asset = s.get("assets", assetId);
  const expectedMime = certificateMimes.get(asset.ext);
  if (!expectedMime || expectedMime !== asset.mime || (asset.kind !== "document" && asset.kind !== "image"))
    throw Error("CERTIFICATE_FORMAT");
  return { asset, title: work.title };
}

export function workCertificateExportInfo(s: Studio, input: unknown) {
  const { asset, title } = resolveCertificate(s, input);
  return { filename: `${safeWorkFilenameStem(title)}.${asset.ext}`, extension: asset.ext };
}

export async function exportWorkCertificate(s: Studio, input: unknown, destination: string) {
  const { asset } = resolveCertificate(s, input);
  const target = await exportManagedAsset(s, asset.id, asset.sha256, destination);
  return { path: target, notice: "已保存证书原文件" };
}
