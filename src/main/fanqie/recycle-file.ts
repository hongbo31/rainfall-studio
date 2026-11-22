import fs from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { assertFanqieDownloadFile, type FanqieDownloadFile } from "../../core/fanqie-downloads";

const recycleRetryDelaysMs = [150, 400] as const;

function isRecordedFilePresent(source: FanqieDownloadFile) {
  try {
    assertFanqieDownloadFile(source);
    return true;
  } catch (error) {
    // The identity check reports missing, changed and inaccessible paths alike.
    let entry: fs.Stats | undefined;
    try {
      entry = fs.lstatSync(source.file, { throwIfNoEntry: false });
    } catch {
      throw Error("FANQIE_RECYCLE_FILE_CHECK_FAILED");
    }
    if (entry === undefined) return false;
    throw error;
  }
}

export async function recycleFanqieFile(
  source: FanqieDownloadFile,
  trash: (file: string) => Promise<void>,
  guard: () => void,
  retryDelays: readonly number[] = recycleRetryDelaysMs,
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    guard();
    if (!isRecordedFilePresent(source)) return;
    try {
      await trash(source.file);
    } catch {
      // The system can report a failure after moving the file.
    }
    guard();
    if (!isRecordedFilePresent(source)) return;
    const retryDelayMs = retryDelays[attempt];
    if (retryDelayMs === undefined) throw Error("FANQIE_RECYCLE_OS_FAILED");
    await delay(retryDelayMs);
  }
}
