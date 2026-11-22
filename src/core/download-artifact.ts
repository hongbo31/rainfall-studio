import fs from "node:fs";
import { z } from "zod";
import type { ConfiguredDownloadKind } from "../shared/download-archive";
import { lyricResultText, lyricResultVersion } from "../shared/lyric-writing";
import { safeWorkFilenameStem } from "../shared/work-analysis";
import { exportCover } from "./assets";
import { zip } from "./backup";
import { saveConfiguredDownload } from "./download-archive";
import { materialEntries } from "./materials";
import type { Studio } from "./studio";
import { exportWorkAudio, workAudioExportInfo } from "./work-audio-share";
import { exportWorkCertificate, workCertificateExportInfo } from "./work-certificate";

const lyricSelection = z.strictObject({ jobId: z.uuid(), versionId: z.uuid() });
const workSelection = z.strictObject({ workId: z.uuid() });
const coverSelection = workSelection.extend({ size: z.number().optional(), noText: z.boolean().optional() });
const coverTaskSelection = workSelection.extend({
  brief: z.string().optional(), editedText: z.string().max(200_000).optional(),
});

export function downloadArtifact(s: Studio, kind: ConfiguredDownloadKind, input: unknown) {
  switch (kind) {
    case "workAudio": {
      const { filename } = workAudioExportInfo(s, input);
      return saveConfiguredDownload(s.repo, filename, file => exportWorkAudio(s, input, file));
    }
    case "workCertificate": {
      const { filename } = workCertificateExportInfo(s, input);
      return saveConfiguredDownload(s.repo, filename, file => exportWorkCertificate(s, input, file));
    }
    case "lyricResult": {
      const { jobId, versionId } = lyricSelection.parse(input);
      const job = s.lyricWritingService().read(jobId);
      const result = lyricResultVersion(job);
      if (!result || result.id !== versionId || !["complete", "rejected"].includes(job.state)) throw Error("LYRIC_DOWNLOAD_CHANGED");
      const filename = safeWorkFilenameStem(result.title) + ".txt";
      return saveConfiguredDownload(s.repo, filename, file => {
        fs.writeFileSync(file, "\uFEFF" + lyricResultText(result), { flag: "wx" });
        return {};
      });
    }
    case "cover": {
      const selection = coverSelection.parse(input);
      const work = s.get("works", selection.workId);
      const filename = safeWorkFilenameStem(work.title) + ".png";
      return saveConfiguredDownload(s.repo, filename, file => exportCover(s, work.id, file, selection));
    }
    case "coverTask": {
      const { workId, brief = "", editedText } = coverTaskSelection.parse(input);
      const filename = safeWorkFilenameStem(s.get("works", workId).title) + " - 封面任务.txt";
      return saveConfiguredDownload(s.repo, filename, async file => {
        const task = await s.call("cover.task", { workId, brief });
        const text = editedText || task.text;
        fs.writeFileSync(file, text, { flag: "wx" });
        s.save("works", { ...s.get("works", workId), coverTaskText: text, coverBrief: brief });
        return {};
      });
    }
    case "coverRequest": {
      const { requestId } = z.strictObject({ requestId: z.uuid() }).parse(input);
      const request = s.coverHandoff().exportRequest(requestId);
      const filename = safeWorkFilenameStem(request.context.title) + " - 封面请求.json";
      return saveConfiguredDownload(s.repo, filename, file => {
        fs.writeFileSync(file, JSON.stringify(request, null, 2), { flag: "wx" });
        return {};
      });
    }
    case "materials": {
      const { batchId } = z.strictObject({ batchId: z.uuid() }).parse(input);
      return saveConfiguredDownload(s.repo, `Rainfall-materials-${s.now().getTime()}.zip`, async file => {
        await zip(file, materialEntries(s, batchId));
        return { uploaded: false };
      });
    }
  }
}
