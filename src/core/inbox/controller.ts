import { randomUUID } from "node:crypto";
import { Repository } from "../database";
import { InboxSetupSchema, type InboxChannel } from "../../shared/inbox";
import { InboxService, inboxHash } from "./service";
import { InboxReceiver } from "./receiver";
// One configured channel per mode/workspace. Paths/identities never come from incoming JSON.
export class InboxController {
  private receiver?: InboxReceiver;
  private stopped = false;
  constructor(
    readonly repo: Repository,
    readonly root: string,
  ) {}
  status() {
    const saved = this.repo.maybe("settings", "inbox-channel");
    return {
      configured: !!saved,
      active: !!saved?.enabled,
      revision: saved?.revision ?? 0,
      root: this.root,
      channel: saved?.channel ?? null,
      lastScanAt: this.receiver?.lastScanAt ?? null,
      lastError: this.receiver?.lastError ?? null,
      modelEvaluation: "not_authorized",
      delivery: "local_receiver_only",
    };
  }
  configure(raw: unknown) {
    const i = InboxSetupSchema.parse(raw);
    this.repo.get("artists", i.artistId);
    if (
      i.seriesId &&
      this.repo.get("series", i.seriesId).artistId !== i.artistId
    )
      throw Error("INBOX_SCOPE_REJECTED");
    return this.repo.transaction(() => {
      const old = this.repo.maybe("settings", "inbox-channel");
      if ((old?.revision ?? 0) !== i.expectedRevision)
        throw Error("REVISION_CONFLICT");
      const mapping = {
        workspaceRef: i.workspaceRef,
        artistRefs: { [i.artistRef]: i.artistId },
        seriesRefs: i.seriesId ? { [i.seriesRef!]: i.seriesId } : {},
      };
      if (
        old &&
        inboxHash(mapping) !==
          inboxHash({
            workspaceRef: old.channel.workspaceRef,
            artistRefs: old.channel.artistRefs,
            seriesRefs: old.channel.seriesRefs,
          })
      )
        throw Error("INBOX_CHANNEL_IMMUTABLE");
      const channel: InboxChannel = old?.channel ?? {
        id: randomUUID(),
        workspaceId: randomUUID(),
        ...mapping,
      };
      this.repo.save("settings", {
        id: "inbox-channel",
        channel,
        enabled: true,
        revision: i.expectedRevision + 1,
      });
      return this.status();
    });
  }
  disable() {
    this.receiver?.stop();
    this.receiver = undefined;
    const saved = this.repo.maybe("settings", "inbox-channel");
    if (saved)
      this.repo.save("settings", {
        ...saved,
        enabled: false,
        revision: saved.revision + 1,
      });
    return this.status();
  }
  async scanOnce() {
    if (this.stopped) return;
    const saved = this.repo.maybe("settings", "inbox-channel");
    if (!saved?.enabled) return;
    if (!this.receiver)
      this.receiver = new InboxReceiver(
        new InboxService(this.repo, saved.channel),
        this.root,
      );
    await this.receiver.scanOnce();
  }
  stop() {
    this.stopped = true;
    this.receiver?.stop();
  }
}
