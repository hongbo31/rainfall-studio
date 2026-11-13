import fs from "node:fs";
import path from "node:path";
import {randomUUID} from "node:crypto";
import { chromium, type BrowserContext } from "playwright-core";
import {
  PlatformAccountIdSchema,
  AccountWorkWindowSchema,
  AccountProviderSchema,
  type PlatformAccount,
} from "../shared/platform-accounts";
import { fanqieChromeLaunchOptions } from "./fanqie/chrome-executable";

export function scopedDirectory(root: string, ...parts: string[]) {
  let directory = root;
  for (const part of parts) {
    directory = path.join(directory, part);
    if (fs.existsSync(directory) && fs.lstatSync(directory).isSymbolicLink())
      throw Error("ACCOUNT_DIRECTORY_LINK");
  }
  return directory;
}

export function accountBrowserDirectory(root: string, accountId: string) {
  PlatformAccountIdSchema.parse({ accountId });
  return scopedDirectory(root, "browser-sessions", "accounts", accountId);
}

export function launchAccountBrowser(profile: string) {
  fs.mkdirSync(profile, { recursive: true });
  return chromium.launchPersistentContext(profile, {
    ...fanqieChromeLaunchOptions(),
    headless: false,
    chromiumSandbox: true,
    acceptDownloads: false,
    viewport: null,
    timeout: 30_000,
  });
}

/** Browser-owned storage stays in the account directory, outside the library and backups. */
export class PlatformBrowserSessions {
  private readonly contexts = new Map<string, Promise<BrowserContext>>();

  constructor(private readonly root: string,private readonly launch=launchAccountBrowser) {}

  workWindow(account:PlatformAccount,artistId?:string,save=false){
    const file=path.join(scopedDirectory(this.root,'runtime','work-windows'),account.id+'.json');
    const schema=AccountWorkWindowSchema.extend({provider:AccountProviderSchema});
    if(!save){
      if(!fs.existsSync(file))return null;
      try{
        const parsed=schema.safeParse(JSON.parse(fs.readFileSync(file,'utf8')));
        return parsed.success&&parsed.data.accountId===account.id&&parsed.data.provider===account.provider?parsed.data:null;
      }catch{return null;}
    }
    const scope=schema.parse({accountId:account.id,provider:account.provider,artistId});
    fs.mkdirSync(path.dirname(file),{recursive:true});
    const temporary=file+'.'+randomUUID()+'.tmp';
    fs.writeFileSync(temporary,JSON.stringify(scope),{flag:'wx'});
    fs.renameSync(temporary,file);
    return scope;
  }

  status(accountId: string) {
    return {
      opened: this.contexts.has(accountId),
      savedProfile: fs.existsSync(
        accountBrowserDirectory(this.root, accountId),
      ),
    };
  }

  async open(account: PlatformAccount, url: string, guard: () => void,artistId?:string) {
    guard();
    let pending = this.contexts.get(account.id);
    if (!pending) {
      const profile = accountBrowserDirectory(this.root, account.id);
      const started = this.launch(profile)
        .then((context) => {
          context.on("close", () => {
            if (this.contexts.get(account.id) === started)
              this.contexts.delete(account.id);
          });
          return context;
        })
        .catch((error) => {
          if (this.contexts.get(account.id) === started)
            this.contexts.delete(account.id);
          throw error;
        });
      pending = started;
      this.contexts.set(account.id, pending);
    }
    const context = await pending;
    guard();
    const page =
      context.pages().find((tab) => !tab.isClosed()) ??
      (await context.newPage());
    guard();
    if (page.url() === "about:blank")
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
    guard();
    await page.bringToFront();
    return {...this.status(account.id),workWindow:this.workWindow(account,artistId,true)};
  }

  async close() {
    await Promise.allSettled(
      [...this.contexts.values()].map(async (pending) => {
        await (await pending).close();
      }),
    );
  }
}
