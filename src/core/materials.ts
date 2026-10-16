import type { Studio } from "./studio";
import { hash } from "./database";
export function materialEntries(studio: Studio, batchId: string) {
  const batch = studio.get("batches", batchId),
    units = studio.all("units").filter((u) => u.batchId === batchId);
  if (!units.length) throw Error("BATCH_EMPTY");
  const files: { name: string; file?: string; text?: string }[] = [
    {
      name: "README.txt",
      text:
        "Rainfall Studio 人工投稿材料包。冻结的批次版本；未上传或发布任何作品。平台规格、权益、身份及AI标识仍需在官方后台核验。批次：" +
        batch.id,
    },
  ];
  const seen = new Map<string, string>();
  const manifestUnits: Record<string, unknown>[] = [];
  for (const u of units) {
    const w = u.snapshot,
      digest = hash(w);
    let prefix = seen.get(digest);
    if (!prefix) {
      prefix = w.id + "-" + digest.slice(0, 8);
      seen.set(digest, prefix);
      files.push(
        { name: prefix + "/metadata.json", text: JSON.stringify(w, null, 2) },
        { name: prefix + "/lyrics.txt", text: w.lyrics },
      );
      for (const [role, id] of Object.entries(w.assets)) {
        const a = studio.get("assets", id as string);
        files.push({
          name: prefix + "/" + role + "." + a.ext,
          file: studio.locate(a.id).file,
        });
      }
    }
    manifestUnits.push({
      unitId: u.id,
      workId: u.workId,
      revision: w.revision,
      accountId: u.accountId,
      bindingId: u.bindingId,
      destinations: u.destinations,
      snapshotDigest: digest,
      dataPrefix: prefix,
    });
  }
  files.push({
    name: "manifest.json",
    text: JSON.stringify(
      {
        formatVersion: 1,
        batchId: batch.id,
        mode: batch.mode,
        snapshotHash: batch.snapshotHash,
        units: manifestUnits,
        exportedAt: studio.now().toISOString(),
      },
      null,
      2,
    ),
  });
  return files;
}
