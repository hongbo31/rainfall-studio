import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { hasPendingFanqieCleanup } from "../../core/fanqie-download-cleanup";
import type { FanqieDownloadArchive, FanqieDownloadScope } from "../../core/fanqie-downloads";
import {
  defaultFanqieAccountId,
  PlatformAccountIdSchema,
} from "../../shared/platform-accounts";
import { accountBrowserDirectory, scopedDirectory } from "../browser-accounts";
import { FanqieCatalogSession } from "./catalog-session";
import { FanqieUploadBroker } from "./upload-broker";

const accountKey = z.string().regex(/^[a-f0-9]{64}$/);
const pinsSchema = z.record(z.uuid(), accountKey);

export function splitFanqieAccountInput(input: unknown = {}) {
  const { accountId, ...actionInput } = z
    .record(z.string(), z.unknown())
    .parse(input);
  return {
    accountId:
      accountId === undefined
        ? undefined
        : PlatformAccountIdSchema.parse({ accountId }).accountId,
    actionInput,
  };
}

type CatalogOptions = ConstructorParameters<typeof FanqieCatalogSession>[0];
type UploadOptions = ConstructorParameters<typeof FanqieUploadBroker>[0];
type AccountSessionOptions = Pick<
  UploadOptions,
  "root" | "available" | "generation" | "work" | "pickBundle" | "trashDownload" | "openDiagnostics"
> &
  Pick<CatalogOptions, "launch" | "account" | "catalog" | "artists"> & {
    downloads?: (accountId: string, scope?: FanqieDownloadScope) => Promise<FanqieDownloadArchive>;
  };

/** The original browser/profile/config paths remain the default slot. Other slots
 * are isolated before the browser opens and pinned to their first verified UID. */
export class FanqieAccountSessions {
  private readonly sessions = new Map<
    string,
    { catalog: FanqieCatalogSession; upload: FanqieUploadBroker }
  >();
  private cleaning = false;

  constructor(private readonly options: AccountSessionOptions) {}

  private pin(id: string, key: string) {
    const folder = path.join(this.options.root, "production", "fanqie");
    const file = path.join(folder, "account-pins.json");
    const stored = fs.existsSync(file);
    const pins = stored
      ? pinsSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")))
      : {};
    let migrated = false;
    if (!pins[defaultFanqieAccountId]) {
      for (const name of ["profile.json", "catalog.json"]) {
        const legacy = path.join(folder, name);
        if (!fs.existsSync(legacy)) continue;
        const parsed = accountKey.safeParse(
          JSON.parse(fs.readFileSync(legacy, "utf8")).accountKey,
        );
        if (parsed.success) {
          pins[defaultFanqieAccountId] = parsed.data;
          migrated = true;
          break;
        }
      }
    }
    if (pins[id] && pins[id] !== key)
      throw Error("FANQIE_ACCOUNT_IDENTITY_MISMATCH");
    if (
      Object.entries(pins).some(
        ([other, value]) => other !== id && value === key,
      )
    )
      throw Error("FANQIE_ACCOUNT_ALREADY_BOUND");
    if (pins[id] === key && stored && !migrated) return;
    // Protect an old in-flight upload even if a legacy profile cache had been cleared.
    if (id !== defaultFanqieAccountId && !pins[id]) {
      const uploads = path.join(folder, "uploads");
      if (
        fs.existsSync(uploads) &&
        fs
          .readdirSync(uploads)
          .some(
            (name) =>
              /^[a-f0-9]{64}\.json$/.test(name) &&
              JSON.parse(fs.readFileSync(path.join(uploads, name), "utf8"))
                .accountKey === key,
          )
      )
        throw Error("FANQIE_ACCOUNT_ALREADY_BOUND");
    }
    pins[id] = key;
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(file + ".tmp", JSON.stringify(pins, null, 2));
    fs.renameSync(file + ".tmp", file);
  }

  get(accountId = defaultFanqieAccountId) {
    PlatformAccountIdSchema.parse({ accountId });
    const existing = this.sessions.get(accountId);
    if (existing) return existing;
    const legacy = accountId === defaultFanqieAccountId;
    const { root, downloads } = this.options;
    const stateDirectory = legacy
      ? path.join(root, "production", "fanqie")
      : scopedDirectory(root, "production", "fanqie", "accounts", accountId);
    const browserDirectory = legacy
      ? path.join(root, "browser-sessions", "fanqie")
      : accountBrowserDirectory(root, accountId);
    const catalog = new FanqieCatalogSession({
      ...this.options,
      stateDirectory,
      browserDirectory,
      verifyAccount: (key) => this.pin(accountId, key),
    });
    const upload = new FanqieUploadBroker({
      ...this.options,
      session: catalog,
      stateDirectory,
      downloads: downloads ? scope => downloads(accountId, scope) : undefined,
    });
    const session = { catalog, upload };
    this.sessions.set(accountId, session);
    return session;
  }

  async close() {
    await Promise.allSettled(
      [...this.sessions.values()].map(({ catalog }) => catalog.close()),
    );
  }

  async pumpDownloadCleanup() {
    if (this.cleaning || !this.options.available()) return;
    this.cleaning = true;
    try {
      const legacy = scopedDirectory(this.options.root, "production", "fanqie");
      const accounts = scopedDirectory(legacy, "accounts");
      const accountIds = fs.existsSync(accounts) ? fs.readdirSync(accounts, { withFileTypes: true })
        .filter(entry => entry.isDirectory() && PlatformAccountIdSchema.safeParse({ accountId: entry.name }).success)
        .map(entry => entry.name) : [];
      await Promise.allSettled([defaultFanqieAccountId, ...accountIds].map(async accountId => {
        const directory = accountId === defaultFanqieAccountId ? legacy : scopedDirectory(accounts, accountId);
        if (hasPendingFanqieCleanup(directory))
          await this.get(accountId).upload.pumpDownloadCleanup();
      }));
    } finally { this.cleaning = false; }
  }
}
