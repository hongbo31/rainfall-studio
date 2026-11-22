import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { isBridgeChannel, type BridgeChannel } from "../shared/bridge";
import type { RpcResult } from "../shared/contracts";

const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};
const maxRequestBytes = 1024 * 1024;
const mediaTypes = /^(?:audio\/[a-z0-9.+-]+|video\/[a-z0-9.+-]+|image\/(?:jpeg|png|webp|gif|avif))$/i;

async function readPayload(request: IncomingMessage): Promise<{ channel: unknown; args: unknown[] }> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxRequestBytes) throw Error("REQUEST_TOO_LARGE");
    chunks.push(chunk);
  }
  const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!payload || Object.keys(payload).length !== 2 || !Array.isArray(payload.args) || payload.args.length > 3) {
    throw Error("INVALID_REQUEST");
  }
  return payload;
}

type StudioHost = {
  dispatch(channel: BridgeChannel, args: unknown[]): Promise<RpcResult>;
  media(request: Request): Promise<Response>;
};

export function startBrowserStudio(ui: string, host: StudioHost) {
  const key = randomBytes(32).toString("hex");
  const mediaKey = randomBytes(32).toString("hex");
  let origin: URL;
  const server = createServer(async (req, res) => {
    const fail = (status: number) => { res.writeHead(status).end(); };
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.setHeader("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'none'");
    try {
      if (!origin || req.headers.host !== origin.host || !req.url?.startsWith("/") || req.url.startsWith("//")) return fail(403);
      if (req.url === "/rpc" && req.method === "POST") {
        if (req.headers.origin !== origin.origin || req.headers.authorization !== "Bearer " + key) return fail(403);
        if (req.headers["content-type"] !== "application/json") return fail(415);
        if (Number(req.headers["content-length"]) > maxRequestBytes) return fail(413);
        const { channel, args } = await readPayload(req);
        if (!isBridgeChannel(channel)) return fail(403);
        const result = await host.dispatch(channel, args);
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        return res.end(JSON.stringify(result));
      }
      if (req.method !== "GET") return fail(405);
      const url = new URL(req.url, origin);
      if (url.pathname.startsWith("/studio-media/")) {
        const [, , token, scheme, namespace, ...segments] = url.pathname.split("/");
        if (token !== mediaKey || (req.headers["sec-fetch-site"] && req.headers["sec-fetch-site"] !== "same-origin")) return fail(403);
        if (!((scheme === "media" && namespace === "asset") ||
          (scheme === "material-cover" && (namespace === "cover" || namespace === "preview")))) return fail(404);
        const range = req.headers.range;
        const response = await host.media(new Request(scheme + "://" + namespace + "/" + segments.join("/") + url.search,
          { headers: range ? { range } : {} }));
        const mime = response.headers.get("content-type") ?? "";
        if (response.ok && !mediaTypes.test(mime)) {
          await response.body?.cancel();
          return fail(404);
        }
        for (const header of ["Content-Type", "Content-Length", "Content-Range", "Accept-Ranges"]) {
          const value = response.headers.get(header);
          if (value !== null) res.setHeader(header, value);
        }
        res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox; frame-ancestors 'none'");
        res.writeHead(response.status);
        if (response.body) await pipeline(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]), res);
        else res.end();
        return;
      }
      if (req.url === "/favicon.ico") return fail(204);
      const name = req.url === "/" ? "index.html" : req.url.slice(1);
      if (!/^(?:index\.html|assets\/[a-zA-Z0-9_-]+\.(?:js|css|svg|png|webp|woff2))$/.test(name)) return fail(404);
      const contents = await fs.readFile(path.join(ui, name));
      res.setHeader("Content-Type", types[path.extname(name)]);
      if (name === "index.html") {
        const html = contents.toString("utf8")
          .replace("connect-src 'none'", "connect-src 'self'")
          .replace("media-src media:", "media-src 'self' media:")
          .replace("</head>", '<meta name="rainfall-browser-studio" content="1" />\n</head>');
        return res.end(html);
      }
      res.end(contents);
    } catch (error) {
      if (!res.headersSent && !res.destroyed) fail((error as NodeJS.ErrnoException).code === "ENOENT" ? 404 : 400);
      else res.destroy();
    }
  });
  server.requestTimeout = 30_000;

  const ready = new Promise<string>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(Error("BROWSER_STUDIO_LISTEN_FAILED"));
      origin = new URL("http://127.0.0.1:" + address.port);
      resolve(origin.href + "#" + key + "." + mediaKey);
    });
  });
  return { ready, close: () => server.close() };
}
