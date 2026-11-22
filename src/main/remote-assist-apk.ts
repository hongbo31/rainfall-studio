import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";

const fileName = "Rainfall-Remote-Assist.apk";
const checksumName = `${fileName}.sha256`;
const maxApkSize = 32 * 1024 * 1024;

async function readVerifiedApk(directory: string) {
  const file = path.join(directory, fileName);
  try {
    const stats = await fs.stat(file);
    if (!stats.isFile() || stats.size < 4 || stats.size > maxApkSize) return null;
    const checksum = await fs.readFile(path.join(directory, checksumName), "utf8");
    const sha256 = /^([a-f0-9]{64})[ \t]+Rainfall-Remote-Assist\.apk\s*$/iu.exec(checksum)?.[1].toLowerCase();
    if (!sha256) return null;
    const bytes = await fs.readFile(file);
    if (bytes.subarray(0, 4).toString("hex") !== "504b0304" || bytes.length > maxApkSize ||
        createHash("sha256").update(bytes).digest("hex") !== sha256) return null;
    return { bytes, sha256 };
  } catch {
    return null;
  }
}

export async function stageRemoteAssistApk(source: string, output: string) {
  const apk = await readVerifiedApk(source);
  if (!apk) return;
  await fs.writeFile(path.join(output, fileName), apk.bytes);
  await fs.writeFile(path.join(output, checksumName), `${apk.sha256}  ${fileName}\n`);
}

export async function startRemoteAssistApkDownload(directory: string, address: string, available: () => boolean) {
  const apk = await readVerifiedApk(directory);
  if (!apk) return null;

  let authority = "";
  const server = createServer({ headersTimeout: 5000, requestTimeout: 8000, connectionsCheckingInterval: 1000 }, (request, response) => {
    response.setHeader("Connection", "close");
    const fail = (status: number) => response.writeHead(status).end();
    if (!available()) return fail(503);
    if (request.headers.host !== authority) return fail(403);
    if (request.url !== `/${fileName}`) return fail(404);
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.setHeader("Allow", "GET, HEAD");
      return fail(405);
    }
    response.writeHead(200, {
      "Content-Type": "application/vnd.android.package-archive",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Content-Length": apk.bytes.length,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    });
    return response.end(request.method === "HEAD" ? undefined : apk.bytes);
  });
  server.maxConnections = 16;
  server.setTimeout(8000, socket => socket.destroy());
  const close = () => new Promise<void>(resolve => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, address, () => { server.off("error", reject); resolve(); });
    });
    server.on("error", () => void close());
    const bound = server.address();
    if (!bound || typeof bound === "string") {
      await close();
      return null;
    }
    authority = `${address}:${bound.port}`;
    return {
      get url() { return server.listening ? `http://${authority}/${fileName}` : null; },
      close,
    };
  } catch {
    await close();
    return null;
  }
}
