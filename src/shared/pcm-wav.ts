// Node-only PCM inspection for the native preparation broker.
import fs from "node:fs";
export function inspectPcmWav(file: string) {
  const fd = fs.openSync(file, "r");
  try {
    const size = fs.fstatSync(fd).size,
      header = Buffer.alloc(12);
    if (
      size < 44 ||
      size > 1024 * 1024 * 1024 ||
      fs.readSync(fd, header, 0, 12, 0) !== 12 ||
      header.toString("ascii", 0, 4) !== "RIFF" ||
      header.toString("ascii", 8, 12) !== "WAVE" ||
      header.readUInt32LE(4) + 8 !== size
    )
      throw Error("UPLOAD_PCM_REQUIRED");
    let format = false,
      byteRate = 0,
      alignment = 0,
      dataBytes = 0,
      offset = 12;
    for (let count = 0; offset + 8 <= size && count < 10000; count++) {
      const chunk = Buffer.alloc(8);
      fs.readSync(fd, chunk, 0, 8, offset);
      const length = chunk.readUInt32LE(4),
        kind = chunk.toString("ascii", 0, 4);
      offset += 8;
      if (offset + length > size) throw Error("UPLOAD_PCM_REQUIRED");
      if (kind === "fmt ") {
        if (format || length < 16 || length > 1000)
          throw Error("UPLOAD_PCM_REQUIRED");
        const fmt = Buffer.alloc(length);
        fs.readSync(fd, fmt, 0, length, offset);
        const tag = fmt.readUInt16LE(0),
          channels = fmt.readUInt16LE(2),
          rate = fmt.readUInt32LE(4),
          bits = fmt.readUInt16LE(14);
        alignment = fmt.readUInt16LE(12);
        byteRate = fmt.readUInt32LE(8);
        const pcm =
          tag === 1 ||
          (tag === 65534 &&
            length >= 40 &&
            fmt.subarray(24, 40).toString("hex") ===
              "0100000000001000800000aa00389b71");
        if (
          !pcm ||
          channels < 1 ||
          channels > 2 ||
          rate < 8000 ||
          rate > 192000 ||
          ![16, 24, 32].includes(bits) ||
          alignment !== (channels * bits) / 8 ||
          byteRate !== rate * alignment
        )
          throw Error("UPLOAD_PCM_REQUIRED");
        format = true;
      }
      if (kind === "data") {
        if (!format || !length || length % alignment !== 0)
          throw Error("UPLOAD_PCM_REQUIRED");
        dataBytes += length;
      }
      offset += length + (length % 2);
    }
    if (!format || !dataBytes || offset !== size)
      throw Error("UPLOAD_PCM_REQUIRED");
    const durationSeconds = dataBytes / byteRate,
      rounded = Math.round(durationSeconds);
    return {
      durationSeconds,
      displayDuration: `${Math.floor(rounded / 60)
        .toString()
        .padStart(2, "0")}:${(rounded % 60).toString().padStart(2, "0")}`,
    };
  } finally {
    fs.closeSync(fd);
  }
}
