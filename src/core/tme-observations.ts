import { randomUUID } from "node:crypto";
import type { Studio } from "./studio";
import { hash } from "./database";
import {
  TmeObservationInputSchema,
  TmeObservationListSchema,
  type TmeObservation,
} from "../shared/tme-observations";

const kind = "tme-official-observation";
export function listTmeObservations(
  s: Studio,
  raw: unknown = {},
): TmeObservation[] {
  const input = TmeObservationListSchema.parse(raw);
  return s
    .all("settings")
    .filter((row) => row.kind === kind)
    .map((row) => row.observation as TmeObservation)
    .filter((row) => !input.workId || row.workId === input.workId)
    .sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt));
}

// Evidence is explicitly reported by the operator, never promoted to provider/API verification.
// This operation only appends local observations; it cannot authorize, upload or commit a release.
export function recordTmeObservation(s: Studio, raw: unknown): TmeObservation {
  const input = TmeObservationInputSchema.parse(raw);
  if (s.mode !== "production") throw Error("PRODUCTION_REQUIRED");
  if (Date.parse(input.observedAt) > s.now().getTime())
    throw Error("OBSERVATION_TIME_IN_FUTURE");
  const work = s.get("works", input.workId);
  const account = s.get("accounts", input.accountId);
  if (!["tme", "qqmusic", "kugou"].includes(account.provider))
    throw Error("TME_ACCOUNT_REQUIRED");
  if (input.remoteId?.startsWith("sim:"))
    throw Error("SIMULATION_RECEIPT_REJECTED");
  const sourceRecordingSha256 = work.assets.audio_A
    ? s.get("assets", work.assets.audio_A).sha256
    : null;
  if (
    input.audioEvidence &&
    input.audioEvidence.sourceASha256 !== sourceRecordingSha256
  )
    throw Error("SOURCE_A_HASH_MISMATCH");
  const { observedAt: _time, ...content } = input;
  const evidenceKey = input.evidence.sha256;
  const contentHash = hash(content);
  return s.repo.transaction(() => {
    const existing = s
      .all("settings")
      .find((row) => row.kind === kind && row.evidenceKey === evidenceKey);
    if (existing) {
      if (existing.contentHash !== contentHash)
        throw Error("OBSERVATION_EVIDENCE_CONFLICT");
      return existing.observation as TmeObservation;
    }
    const observation: TmeObservation = {
      ...input,
      id: randomUUID(),
      workRevision: work.revision,
      title: work.title,
      sourceRecordingSha256,
      source: "official_page_observation",
      verification: "user_report",
      identityBasis: "visible_account_user_report",
      recordingMatch: "not_verified",
      submissionByClient: false,
      recordedAt: s.now().toISOString(),
    };
    s.save("settings", {
      id: "tme-observation:" + observation.id,
      kind,
      evidenceKey,
      contentHash,
      observation,
    });
    s.repo.audit("tme.observation_recorded", observation.id, {
      workId: input.workId,
      status: input.status,
      evidenceSha256: input.evidence.sha256,
      submissionByClient: false,
      verification: "user_report",
    });
    return observation;
  });
}
