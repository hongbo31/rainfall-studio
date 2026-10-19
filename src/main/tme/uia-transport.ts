import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { TmeDraft } from "../../shared/tme";
import {
  agreementHash,
  type LiveTransport,
  type LiveSnapshot,
  type WindowBinding,
} from "./live";
export class WindowsUiaTransport implements LiveTransport {
  // Nickname+window cannot distinguish two Tencent accounts with the same visible name.
  // No renderer flag or user-entered ID can unlock unverified native writes.
  writeBlockReason() {
    return "ACCOUNT_UNIQUE_ID_REQUIRED";
  }
  private requireWritable() {
    throw Error(this.writeBlockReason());
  }
  private active = new Set<ReturnType<typeof spawn>>();
  private closed = false;
  constructor(
    private script: string,
    private executable = "pwsh.exe",
  ) {}
  dispose() {
    this.closed = true;
    this.interrupt();
  }
  interrupt() {
    for (const child of this.active) child.kill();
  }
  preflight(d: TmeDraft, b: WindowBinding) {
    if (d.metadata.coverPolicy !== "preserve_album" || !d.metadata.albumId)
      return "EXISTING_ALBUM_REQUIRED";
    if (!d.metadata.ownLyricist || !d.metadata.ownComposer)
      return "EXTERNAL_AUTHORS_REQUIRE_OFFICIAL_FORM";
    if (d.metadata.lyricist !== b.account || d.metadata.composer !== b.account)
      return "AUTHOR_ACCOUNT_READBACK_MISMATCH";
    return null;
  }
  private request(
    action: string,
    input: Record<string, unknown>,
  ): Promise<LiveSnapshot> {
    if (this.closed) return Promise.reject(Error("UIA_CLOSED"));
    if (process.platform !== "win32")
      return Promise.reject(Error("WINDOWS_REQUIRED"));
    return new Promise((resolve, reject) => {
      const child = spawn(
        this.executable,
        ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", this.script],
        { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
      );
      this.active.add(child);
      let output = "",
        finished = false;
      const end = (e?: Error, s?: LiveSnapshot) => {
        if (finished) return;
        finished = true;
        this.active.delete(child);
        clearTimeout(timer);
        if (e) reject(e);
        else resolve(s!);
      };
      const timer = setTimeout(
        () => {
          child.kill();
          end(Error("UIA_TIMEOUT"));
        },
        action === "stage" ? 120000 : 25000,
      );
      child.on("error", () => end(Error("POWERSHELL_UNAVAILABLE")));
      child.stdout.on("data", (b) => {
        output += b.toString("utf8");
        if (output.length > 2_000_000) {
          child.kill();
          end(Error("UIA_RESPONSE_TOO_LARGE"));
        }
      });
      child.stderr.on("data", () => {});
      child.on("close", () => {
        try {
          const result = JSON.parse(output.replace(/^\uFEFF/, ""));
          if (!result.ok)
            throw Error(
              /^[A-Z0-9_]+$/.test(result.error)
                ? result.error
                : "UIA_OPERATION_FAILED",
            );
          end(undefined, result.value);
        } catch (e) {
          end(e instanceof Error ? e : Error("UIA_RESPONSE_INVALID"));
        }
      });
      child.stdin.on("error", () => {});
      child.stdin.end(JSON.stringify({ action, ...input }));
    });
  }
  async observe(binding?: WindowBinding, expectedAccount?: string) {
    return this.request("observe", { binding, expectedAccount });
  }
  async stage(d: TmeDraft, b: WindowBinding) {
    this.requireWritable();
    if (
      !d.assets.audio?.file ||
      d.metadata.coverPolicy !== "preserve_album" ||
      !d.metadata.albumId
    )
      throw Error("EXISTING_ALBUM_REQUIRED");
    if (!d.metadata.ownLyricist || !d.metadata.ownComposer)
      throw Error("EXTERNAL_AUTHORS_REQUIRE_OFFICIAL_FORM");
    const file = path.resolve(d.assets.audio.file);
    if (!fs.statSync(file).isFile()) throw Error("ASSET_INVALID");
    const s = await this.request("stage", {
      binding: b,
      draft: {
        title: d.title,
        metadata: d.metadata,
        audio: { file, sha256: d.assets.audio.sha256 },
      },
    });
    if (s.form?.title !== d.title || s.form.lyrics !== d.metadata.lyrics)
      throw Error("FORM_READBACK_REQUIRED");
    return s;
  }
  async accept(d: TmeDraft, b: WindowBinding, hash: string) {
    this.requireWritable();
    const s = await this.observe(b);
    if (!s.form || s.form.title !== d.title || agreementHash(s) !== hash)
      throw Error("AGREEMENT_CHANGED");
    return this.request("accept", {
      binding: b,
      albumId: d.metadata.albumId,
      agreement: s.agreement,
    });
  }
  async submit(d: TmeDraft, b: WindowBinding, hash: string) {
    this.requireWritable();
    const s = await this.observe(b);
    if (!s.form || s.form.title !== d.title || agreementHash(s) !== hash)
      throw Error("AGREEMENT_CHANGED");
    const r = await this.request("submit", {
      binding: b,
      albumId: d.metadata.albumId,
      agreement: s.agreement,
      title: d.title,
    });
    return r;
  }
}
