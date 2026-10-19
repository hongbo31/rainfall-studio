import { randomUUID } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { Repository } from "../database";
import { InboxSetupSchema, type InboxChannel } from "../../shared/inbox";
import { InboxService, inboxHash } from "./service";
import { InboxReceiver } from "./receiver";
import { DotDeliveryReceiver } from "./dot-delivery-receiver";
import { DotDeliveryStore } from "./dot-delivery-store";
import { inboxEvaluationStatus } from "../production-flow-inbox";
import {
  DotDeliveryBridge,
  validateBridgeProject,
} from "./dot-delivery-bridge";
// One configured channel per mode/workspace. Paths/identities never come from incoming JSON.
export class InboxController {
  private receiver?: InboxReceiver;
  private deliveryReceiver?: DotDeliveryReceiver;
  private bridge?: DotDeliveryBridge;
  private stopped = false;
  private scanEpoch = 0;
  private cancelScans() {
    this.scanEpoch++;
    this.receiver?.stop();
    this.deliveryReceiver?.stop();
    this.bridge?.stop();
    this.receiver = undefined;
    this.deliveryReceiver = undefined;
    this.bridge = undefined;
  }
  /** Cancellation is synchronous before Core's serialized execution queue. No setting is mutated here. */
  interruptRequest(method: string, raw: unknown) {
    if (method === "inbox.pause") {
      z.strictObject({}).parse(raw);
      this.cancelScans();
    }
    if (method === "inbox.bridge.pause") {
      const input = z
        .strictObject({ expectedRevision: z.number().int().nonnegative() })
        .parse(raw);
      if (
        this.repo.get("settings", "inbox-bridge").revision !==
        input.expectedRevision
      )
        throw Error("REVISION_CONFLICT");
      this.cancelScans();
    }
    if (method === "internal.inboxBridge.configure") {
      const input = z
        .strictObject({
          projectRoot: z.string().min(1).max(4096),
          expectedRevision: z.number().int().nonnegative(),
        })
        .parse(raw);
      if (
        (this.repo.maybe("settings", "inbox-bridge")?.revision ?? 0) !==
        input.expectedRevision
      )
        throw Error("REVISION_CONFLICT");
      validateBridgeProject(input.projectRoot, this.root);
      this.cancelScans();
    }
  }
  constructor(
    readonly repo: Repository,
    readonly root: string,
  ) {}
  private makeDeliveryReceiver(channel: InboxChannel) {
    return new DotDeliveryReceiver({
      store: new DotDeliveryStore(this.repo, channel),
      deliveriesRoot: path.join(this.root, "deliveries"),
      receiptsRoot: path.join(this.root, "delivery-receipts"),
      mediaRoot: path.join(path.dirname(path.dirname(this.root)), "media"),
    });
  }
  private makeBridge(channel: InboxChannel, projectRoot: string) {
    return new DotDeliveryBridge({
      store: new DotDeliveryStore(this.repo, channel),
      projectRoot,
      inboxRoot: this.root,
    });
  }
  configureBridge(
    raw: unknown,
    source:
      | "native-directory-picker"
      | "authorized-local-setup" = "native-directory-picker",
  ) {
    const input = z
      .strictObject({
        projectRoot: z.string().min(1).max(4096),
        expectedRevision: z.number().int().nonnegative(),
      })
      .parse(raw);
    const channel = this.repo.maybe("settings", "inbox-channel")?.channel;
    if (!channel) throw Error("INBOX_CHANNEL_REQUIRED");
    const old = this.repo.maybe("settings", "inbox-bridge");
    if ((old?.revision ?? 0) !== input.expectedRevision)
      throw Error("REVISION_CONFLICT");
    const { projectRoot } = validateBridgeProject(input.projectRoot, this.root);
    this.cancelScans();
    this.repo.save("settings", {
      id: "inbox-bridge",
      projectRoot,
      enabled: true,
      revision: input.expectedRevision + 1,
      source,
    });
    return this.status();
  }
  setBridgeEnabled(enabled: boolean, expectedRevision: number) {
    const saved = this.repo.get("settings", "inbox-bridge");
    if (saved.revision !== expectedRevision) throw Error("REVISION_CONFLICT");
    if (enabled) validateBridgeProject(saved.projectRoot, this.root);
    this.cancelScans();
    this.repo.save("settings", {
      ...saved,
      enabled,
      revision: expectedRevision + 1,
    });
    return this.status();
  }
  status() {
    const saved = this.repo.maybe("settings", "inbox-channel");
    const bridgeConfig = this.repo.maybe("settings", "inbox-bridge");
    const evaluation = inboxEvaluationStatus(this.repo);
    return {
      configured: !!saved,
      active: !!saved?.enabled,
      revision: saved?.revision ?? 0,
      root: this.root,
      channel: saved?.channel ?? null,
      lastScanAt: this.receiver?.lastScanAt ?? null,
      lastError: this.receiver?.lastError ?? null,
      modelEvaluation: evaluation.state,
      inboxEvaluationStatus: evaluation,
      delivery: "local_receiver_only",
      bridge: {
        configured: !!bridgeConfig,
        enabled: !!bridgeConfig?.enabled,
        revision: bridgeConfig?.revision ?? 0,
        ...(bridgeConfig && saved
          ? (
              this.bridge ??
              this.makeBridge(saved.channel, bridgeConfig.projectRoot)
            ).status()
          : {
              projectRoot: null,
              incomingRoot: null,
              receiptsRoot: null,
              cloudTransportVerified: false,
              lastError: null,
              states: [],
            }),
      },
      packageDelivery:
        this.deliveryReceiver?.status() ??
        (saved
          ? this.makeDeliveryReceiver(saved.channel).status()
          : {
              root: path.join(this.root, "deliveries"),
              receiptsRoot: path.join(this.root, "delivery-receipts"),
              transport: "local-files-only",
              cloudTransportVerified: false,
              lastScanAt: null,
              lastError: null,
              states: [],
            }),
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
    this.cancelScans();
    this.receiver?.stop();
    this.receiver = undefined;
    this.deliveryReceiver?.stop();
    this.deliveryReceiver = undefined;
    this.bridge?.stop();
    this.bridge = undefined;
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
    const epoch = this.scanEpoch;
    const saved = this.repo.maybe("settings", "inbox-channel");
    if (!saved?.enabled) return;
    const bridgeConfig = this.repo.maybe("settings", "inbox-bridge");
    if (bridgeConfig?.enabled) {
      if (!this.bridge)
        this.bridge = this.makeBridge(saved.channel, bridgeConfig.projectRoot);
      await this.bridge.scanOnce();
    }
    if (
      this.stopped ||
      epoch !== this.scanEpoch ||
      !this.repo.maybe("settings", "inbox-channel")?.enabled
    )
      return;
    if (!this.receiver)
      this.receiver = new InboxReceiver(
        new InboxService(this.repo, saved.channel),
        this.root,
      );
    await this.receiver.scanOnce();
    if (
      this.stopped ||
      epoch !== this.scanEpoch ||
      !this.repo.maybe("settings", "inbox-channel")?.enabled
    )
      return;
    if (!this.deliveryReceiver)
      this.deliveryReceiver = this.makeDeliveryReceiver(saved.channel);
    await this.deliveryReceiver.scanOnce();
    if (
      !this.stopped &&
      epoch === this.scanEpoch &&
      this.repo.maybe("settings", "inbox-channel")?.enabled &&
      this.repo.maybe("settings", "inbox-bridge")?.enabled
    )
      await this.bridge?.flushReceipts();
  }
  stop() {
    this.stopped = true;
    this.receiver?.stop();
    this.deliveryReceiver?.stop();
    this.bridge?.stop();
  }
}
