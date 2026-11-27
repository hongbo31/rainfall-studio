import { DateTime } from "luxon";
import { productionDefaultTimezone as zone } from "../shared/production-schedule";
import { PlatformTargetSchema, type PlatformTarget } from "../shared/platform-config";
import { workRecordingSinger } from "../shared/local-artist";
import { TmeAiSubmissionReceiptSchema } from "../shared/tme-ai-submission";
import { workVersionTitle } from "../shared/work-versions";
import type { PublicationHistoryPage, PublicationHistoryQuery, PublicationHistoryRow } from "../shared/publication-history";
import { defaultFanqieAccountId } from "../shared/platform-accounts";
import { hash } from "./database";
import { workArchivePromptEngine } from "./download-archive";
import { externalTmeReceipts } from "./external-tme-receipt";
import { fanqieHistoryRecordSchema, fanqieUploadHistory } from "./fanqie-publication-history";
import { listWorkflowPublications } from "./plan-workflow-publication";
import type { Studio } from "./studio";

const pageSize = 50;
const label = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : undefined;
const normalized = (value: unknown) => label(value)?.normalize("NFKC").toLowerCase() ?? "";
type Timestamp = { day: string; time: string | null; order: number; source: "official" | "recorded" };
type Entry = Omit<PublicationHistoryRow, "day" | "time" | "timeSource"> & {
  uploaded: Timestamp | undefined;
  observed: number;
};

function timestamp(raw: unknown, source: Timestamp["source"]): Timestamp | undefined {
  const text = label(raw);
  if (!text) return;
  const calendar = /^(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/u.exec(text);
  let date: DateTime;
  if (calendar) {
    const [, year, month, day, hour, minute, second] = calendar;
    date = DateTime.fromObject({
      year: Number(year), month: Number(month), day: Number(day),
      hour: Number(hour ?? 0), minute: Number(minute ?? 0), second: Number(second ?? 0),
    }, { zone });
  } else if (/^\d{10}(?:\d{3})?$/u.test(text)) {
    date = DateTime.fromMillis(Number(text) * (text.length === 10 ? 1000 : 1), { zone });
  } else if (/^\d{4}-\d{2}-\d{2}T/u.test(text)) {
    date = DateTime.fromISO(text, { zone });
  } else return;
  if (!date.isValid) return;
  return { day: date.toISODate()!, time: calendar && !calendar[4] ? null : date.toFormat("HH:mm"), order: date.toMillis(), source };
}

function mergeEntry(rows: Map<string, Entry>, entry: Entry) {
  const previous = rows.get(entry.id);
  if (!previous) {
    rows.set(entry.id, entry);
    return;
  }
  const incomingIsCurrent = entry.source === previous.source ? entry.observed >= previous.observed : entry.source === "platform";
  const [latest, other] = incomingIsCurrent ? [entry, previous] : [previous, entry];
  const a = latest.uploaded, b = other.uploaded;
  const useEarlier = b && (a?.source === b.source ? b.order < a.order : b.source === "official");
  const uploaded = !a || useEarlier ? b : a;
  rows.set(entry.id, {
    ...latest, uploaded,
    singer: latest.singer ?? other.singer, promptEngine: latest.promptEngine ?? other.promptEngine,
    accountName: latest.accountName ?? other.accountName,
    destinations: [...new Set([...(latest.destinations ?? []), ...(other.destinations ?? [])])],
  });
}

export function readPublicationHistory(studio: Studio, query: PublicationHistoryQuery): PublicationHistoryPage {
  const today = DateTime.fromJSDate(studio.now(), { zone }).toISODate()!;
  if (studio.mode !== "production") return { today, pageSize, total: 0, rows: [] };
  const { repo } = studio;
  const accounts = repo.all("accounts");
  const accountNames = new Map(accounts.flatMap(row => label(row.name) ? [[String(row.id), label(row.name)!]] : []));
  const accountName = (id: string | undefined) => id ? accountNames.get(id) : undefined;
  const promptByRun = new Map(repo.settingsByPrefix("plan-center:run:").map(row =>
    [row.value?.id, label(row.value?.snapshot?.workflowSnapshot?.template?.name)]));
  const promptsByWork = new Map<string, Set<string>>();
  for (const { value: item } of repo.settingsByPrefix("plan-center:item:")) {
    const prompt = promptByRun.get(item?.runId);
    if (!prompt || !item?.workId) continue;
    const prompts = promptsByWork.get(item.workId) ?? new Set<string>();
    prompts.add(prompt);
    promptsByWork.set(item.workId, prompts);
  }
  const promptEngine = (workId: string, runId?: string, accountId?: string, singer?: string) => {
    const prompts = promptsByWork.get(workId);
    const recorded = (runId ? promptByRun.get(runId) : undefined) ?? (prompts?.size === 1 ? [...prompts][0] : undefined);
    const account = accountName(accountId);
    return recorded ?? (accountId && account && singer ? workArchivePromptEngine(repo, workId, accountId, account, singer) : undefined);
  };
  const rows = new Map<string, Entry>();
  const record = (platform: Entry["platform"], remoteId: string,
    details: Omit<Entry, "id" | "platform" | "observed">, observedAt?: unknown) => {
    mergeEntry(rows, { ...details, platform, id: hash([platform, remoteId]), observed: timestamp(observedAt, "recorded")?.order ?? 0 });
  };

  if (!query.platform || query.platform === "fanqie") {
    for (const { accountId, job, promptEngine: directoryPrompt } of fanqieUploadHistory(repo, studio.root, accountNames)) {
      const receipt = job.officialRecord;
      const singer = label(job.input.authors.singer);
      record("fanqie", receipt.id, {
        title: receipt.title, status: receipt.stage, source: "platform", singer, accountName: accountName(accountId),
        promptEngine: label(directoryPrompt) ?? promptEngine(job.input.workId, undefined, accountId, singer),
        uploaded: timestamp(receipt.createdAtText, "official") ??
          timestamp(job.uploadedAt ?? job.archiveObservedAt ?? job.updatedAt, "recorded"),
      }, job.updatedAt);
    }
    for (const { value: job } of repo.settingsByPrefix("plan-fanqie:")) {
      // A batch error can coexist with a verified receipt for an individual song.
      if (job?.state !== "uploaded" && job?.state !== "unknown") continue;
      const result = fanqieHistoryRecordSchema.safeParse(job.record);
      if (!result.success) continue;
      const receipt = result.data;
      const accountId = job.accountId ?? defaultFanqieAccountId;
      const work = repo.maybe("works", job.workId);
      const artist = work && repo.maybe("artists", work.artistId);
      const singer = label(job.singer) ?? (work && workRecordingSinger(work, artist as Parameters<typeof workRecordingSinger>[1], job.variant));
      record("fanqie", receipt.id, {
        title: receipt.title, status: receipt.stage, source: "platform", accountName: accountName(accountId), singer,
        promptEngine: promptEngine(job.workId, job.runId, accountId, singer),
        uploaded: timestamp(receipt.createdAtText, "official") ?? timestamp(job.uploadedAt ?? job.updatedAt, "recorded"),
      }, job.updatedAt);
    }
  }

  if (!query.platform || ["tme", "qqmusic", "kugou"].includes(query.platform)) {
    const tasks = repo.settingsByPrefix("unified-publication:v1:").map(row => row.value);
    const tencentDestinations = (targets: unknown): PlatformTarget[] => Array.isArray(targets)
      ? targets.filter(target => target === "qqmusic" || target === "kugou") : [];
    const tencentAccount = (subject: string | undefined, accountId?: string) => {
      if (!subject) return;
      const matches = accounts.filter(account => account.provider === "tme" && account.remoteSubject === subject);
      return accountName(matches.find(account => account.id === accountId)?.id ?? (matches.length === 1 ? matches[0].id : undefined));
    };
    for (const { value: job } of repo.settingsByPrefix("tme-ai-submission:")) {
      if (job?.submissionByClient !== true) continue;
      const result = TmeAiSubmissionReceiptSchema.safeParse(job.receipt);
      if (!result.success || result.data.remoteId === result.data.albumId) continue;
      const receipt = result.data;
      const linked = tasks.filter(task => task?.submissionJobId === job.id && task.workId === job.workId);
      record("tme", receipt.remoteId, {
        title: receipt.title, singer: receipt.artistName, status: receipt.status, source: "platform",
        accountName: tencentAccount(receipt.subjectHash, linked[0]?.accountId),
        promptEngine: promptEngine(job.workId, undefined, linked[0]?.accountId, receipt.artistName),
        destinations: linked.flatMap(task => tencentDestinations(task.targets)),
        uploaded: timestamp(receipt.submittedAt, receipt.submittedAtSource === "dispatch-intent" ? "recorded" : "official"),
      }, receipt.observedAt);
    }
    for (const receipt of externalTmeReceipts(repo)) {
      if (receipt.externalSongRecordId === receipt.albumId) continue;
      const channels = normalized(receipt.platformStatusText).replace(/\s+/gu, "");
      record("tme", receipt.externalSongRecordId, {
        title: receipt.title, singer: receipt.artistName, status: receipt.state, source: "platform",
        accountName: tencentAccount(receipt.subjectHash), promptEngine: promptEngine(receipt.workId),
        destinations: [
          ...(channels.includes("qq音乐") ? ["qqmusic" as const] : []),
          ...(channels.includes("酷狗音乐") ? ["kugou" as const] : []),
        ],
        uploaded: timestamp(receipt.submittedAt, receipt.submittedAtSource === "official" ? "official" : "recorded"),
      }, receipt.observedAt);
    }
  }

  if (!query.platform || query.platform === "qishui") {
    for (const run of listWorkflowPublications(repo)) for (const job of run?.qishui ?? []) {
      if (job.submitted !== true) continue;
      const work = repo.maybe("works", job.workId);
      const title = label(job.submittedTitle) ?? (work?.title
        ? workVersionTitle({ title: work.title, alternateTitle: work.alternateTitle }, job.variant === "B" ? "audio_B" : "audio_A") : undefined);
      if (!title) continue;
      record("qishui", job.accountId + ":" + job.workId + ":" + job.variant, {
        title,
        singer: label(job.credits?.performer), accountName: accountName(job.accountId), status: "submitted", source: "user",
        promptEngine: promptEngine(job.workId, run.runId, job.accountId, label(job.credits?.performer)),
        uploaded: timestamp(job.submittedAt, "recorded"),
      }, job.submittedAt);
    }
  }

  // Older individually recorded results are still part of the upload history.
  for (const unit of repo.all("units")) {
    const receipt = unit.receipt;
    if (unit.remoteOutcome !== "submitted" || receipt?.source !== "user_report" ||
      !label(receipt.remoteId) || receipt.remoteId.startsWith("sim:")) continue;
    const work = unit.snapshot ?? repo.maybe("works", unit.workId);
    const artist = work && repo.maybe("artists", work.artistId);
    const title = label(work?.title);
    if (!title) continue;
    for (const destination of unit.destinations ?? []) {
      const platform = PlatformTargetSchema.safeParse(destination.target);
      if (!platform.success) continue;
      const status = unit.publication === "live" ? "published" : unit.publication === "taken_down" || unit.review === "removed"
        ? "withdrawn" : unit.review === "rejected" ? "rejected" : unit.review === "pending" ? "reviewing" : "submitted";
      const channel = accounts.some(account => account.id === unit.accountId && account.provider === "tme") ? "tme" : platform.data;
      const remoteId = channel === "tme" || channel === "fanqie" ? receipt.remoteId : unit.accountId + ":" + receipt.remoteId;
      const singer = workRecordingSinger(work, artist as Parameters<typeof workRecordingSinger>[1], unit.recordingSlot === "audio_B" ? "B" : "A");
      record(channel, remoteId, {
        title, status, source: "user", accountName: accountName(unit.accountId), singer,
        promptEngine: promptEngine(unit.workId, undefined, unit.accountId, singer),
        ...(channel === "tme" ? { destinations: [platform.data] } : {}),
        uploaded: timestamp(receipt.acceptedAt, "recorded"),
      }, unit.statusObservedAt ?? receipt.acceptedAt);
    }
  }

  const { day, platform, status, page = 1 } = query;
  const singer = normalized(query.singer), engine = normalized(query.promptEngine), title = normalized(query.title);
  const selected = [...rows.values()].filter(row =>
    (!day || row.uploaded?.day === day) && (!platform || row.platform === platform ||
      row.destinations?.some(destination => destination === platform)) &&
    (!status || row.status === status) &&
    normalized(row.singer).includes(singer) && normalized(row.promptEngine).includes(engine) && normalized(row.title).includes(title));
  selected.sort((a, b) => (b.uploaded?.order ?? 0) - (a.uploaded?.order ?? 0) || b.observed - a.observed || a.id.localeCompare(b.id));
  return {
    today, total: selected.length, pageSize,
    rows: selected.slice((page - 1) * pageSize, page * pageSize).map(({ uploaded, observed: _observed, ...row }) => ({
      ...row, day: uploaded?.day ?? null, time: uploaded?.time ?? null, timeSource: uploaded?.source ?? "unknown",
    })),
  };
}
