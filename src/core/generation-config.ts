import type { Repository } from "./database";
import {
  GenerationConfigSaveSchema,
  type GenerationRole,
  type FrozenRoute,
  type RouteSnapshot,
} from "../shared/generation-config";
import { listApiProfiles } from "./api-profiles";
import type { PlanCenterPlan } from "../shared/plan-center";
const key = "generation-config:v1";
export type GenerationDefaults = {
  revision: number;
  roles: Record<GenerationRole, string | null>;
};
export function readGenerationConfig(repo: Repository): GenerationDefaults {
  return (
    repo.maybe("settings", key)?.value ?? {
      revision: 0,
      roles: { text: null, image: null, music: null },
    }
  );
}
export function saveGenerationConfig(repo: Repository, raw: unknown) {
  const input = GenerationConfigSaveSchema.parse(raw);
  return repo.transaction(() => {
    const old = readGenerationConfig(repo);
    if (old.revision !== input.expectedRevision)
      throw Error("REVISION_CONFLICT");
    if (input.profileId) {
      const p = listApiProfiles(repo).find((p) => p.id === input.profileId);
      if (!p) throw Error("GENERATION_PROFILE_MISSING");
      if (p.kind !== input.role) throw Error("GENERATION_ROLE_MISMATCH");
    }
    const value = {
      revision: old.revision + 1,
      roles: { ...old.roles, [input.role]: input.profileId },
    };
    repo.save("settings", { id: key, value });
    repo.audit("generationConfig.save", input.role, {
      profileId: input.profileId,
      revision: value.revision,
    });
    return value;
  });
}
export function freezeRoute(
  repo: Repository,
  role: GenerationRole,
  selection: { source: "default" | "override"; profileId?: string },
): FrozenRoute {
  const id =
    selection.source === "default"
      ? readGenerationConfig(repo).roles[role]
      : (selection.profileId ?? null);
  const profile = id ? listApiProfiles(repo).find((p) => p.id === id) : null;
  const base: FrozenRoute = {
    role,
    source: selection.source,
    profileId: id,
    profileRevision: profile?.revision ?? null,
    providerId: profile?.providerId ?? null,
    channel: profile?.providerId ?? "unconfigured",
    modelId: profile?.modelId ?? null,
    credentialRef: profile?.id ?? null,
    capability: "unavailable",
    reason: role.toUpperCase() + "_ROUTE_REQUIRED",
  };
  if (!profile) return base;
  if (profile.kind !== role) throw Error("GENERATION_ROLE_MISMATCH");
  if (role === "text" && ["deepseek", "doubao"].includes(profile.providerId))
    return {
      ...base,
      capability: profile.modelId ? "text_api" : "unavailable",
      reason: profile.modelId ? null : "TEXT_MODEL_REQUIRED",
    };
  if (
    role === "image" &&
    profile.providerId === "openai_image"
  )
    return { ...base, capability: "image_api", reason: null };
  if (
    role === "image" &&
    ["local_image", "dot_image"].includes(profile.providerId)
  )
    return {
      ...base,
      credentialRef: null,
      channel:
        profile.providerId === "dot_image"
          ? "dot_external_import"
          : "local_import",
      capability: "external_import",
      reason: null,
    };
  if (role === "music" && profile.providerId === "yourmusic")
    return {
      ...base,
      channel: "pule",
      capability: profile.modelId ? "music_api" : "unavailable",
      reason: profile.modelId ? null : "MUSIC_MODEL_REQUIRED",
    };
  return {
    ...base,
    reason:
      role === "image"
        ? "IMAGE_ADAPTER_UNAVAILABLE"
        : role === "music"
          ? "MUSIC_ADAPTER_UNAVAILABLE"
          : "TEXT_ADAPTER_UNAVAILABLE",
  };
}
export function freezePlanRoutes(
  repo: Repository,
  plan: PlanCenterPlan,
): PlanCenterPlan {
  if (!plan.routing) return plan;
  const snapshot: RouteSnapshot = {
    defaultsRevision: readGenerationConfig(repo).revision,
    text: freezeRoute(repo, "text", plan.routing.text),
    image: freezeRoute(repo, "image", plan.routing.image),
    music: freezeRoute(repo, "music", plan.routing.music),
  };
  const text = snapshot.text,
    music = snapshot.music;
  if (
    plan.outputs.music &&
    plan.music.consent &&
    plan.authorization.music &&
    (plan.music.profileId !== music.profileId ||
      plan.music.profileRevision !== music.profileRevision ||
      plan.music.modelId !== music.modelId ||
      (!(
        ["pule", "yourmusic"].includes(plan.music.route) &&
        music.channel === "pule"
      ) &&
        plan.music.route !== music.channel))
  )
    throw Error("MUSIC_ROUTE_CONFIRMATION_MISMATCH");
  return {
    ...plan,
    routeSnapshot: snapshot,
    text: {
      ...plan.text,
      profileId: text.profileId ?? undefined,
      profileRevision: text.profileRevision ?? undefined,
      modelId: text.modelId ?? undefined,
      maxOutputTokens: plan.text.maxOutputTokens ?? 2048,
    },
    music: plan.outputs.music
      ? {
          ...plan.music,
          route:
            music.channel === "pule"
              ? "pule"
              : music.providerId === "suno"
                ? "suno_official"
                : "manual",
          profileId: music.profileId ?? undefined,
          profileRevision: music.profileRevision ?? undefined,
          modelId: music.modelId ?? undefined,
        }
      : plan.music,
  };
}
export function planRouteIssue(
  repo: Repository,
  plan: PlanCenterPlan,
): string | undefined {
  if (!plan.routing || !plan.routeSnapshot) return;
  const roles: GenerationRole[] = [
    ...(plan.material.source === "provider" && plan.songType !== "instrumental" ? ["text" as const] : []),
    ...(plan.outputs.cover && plan.material.source !== "pule_prompt" ? ["image" as const] : []),
    ...(plan.outputs.music ? ["music" as const] : []),
  ];
  for (const role of roles) {
    const frozen = plan.routeSnapshot[role];
    if (
      frozen.source === "default" &&
      readGenerationConfig(repo).roles[role] !== frozen.profileId
    )
      return "ROUTE_DEFAULT_CHANGED";
    if (frozen.capability === "unavailable")
      return frozen.reason ?? "GENERATION_ROUTE_UNAVAILABLE";
    const p = listApiProfiles(repo).find((p) => p.id === frozen.profileId);
    if (!p || p.kind !== role) return "ROUTE_PROFILE_MISSING";
    if (p.revision !== frozen.profileRevision || p.modelId !== frozen.modelId)
      return "ROUTE_PROFILE_CHANGED";
  }
  return;
}

/** Captured by Core on explicit save; caller supplied snapshots are never trusted. */
export function freezeArtist(
  repo: Repository,
  plan: PlanCenterPlan,
): PlanCenterPlan {
  if (!plan.routing) {
    const { artistSnapshot, ...legacy } = plan;
    return legacy;
  }
  const a = repo.maybe("artists", plan.artistId);
  if (!a) throw Error("ARTIST_REQUIRED");
  return {
    ...plan,
    artistSnapshot: {
      id: a.id,
      revision: a.revision,
      name: a.name,
      defaults: JSON.parse(JSON.stringify(a.defaults)),
    },
  };
}
export function planCreativeContext(plan: PlanCenterPlan, ordinal?: number) {
  const theme = [
    plan.theme,
    plan.artistSnapshot && plan.storyContext
      ? JSON.stringify({
          storyBeat: plan.storyContext.storyBeat,
          storyStage: plan.storyContext.storyStage,
        })
      : "",
  ].filter(Boolean).join("\n");
  const perspectives = ["一个决定", "一件随身物品", "一段对话", "一个反常动作", "一次视角转换"];
  const brief = plan.distinctLyrics && ordinal
    ? [
        `\n同批第 ${ordinal} 首，共 ${plan.count} 首。写一首有人声的原创歌曲。`,
        `用${perspectives[(ordinal - 1) % perspectives.length]}切入主题，自行构思具体时间、地点、动作和情绪转折。`,
        "storyBeat 写本首具体场景，副歌写本首独有的钩子，歌名不超过 40 字。",
        "用艺人语言和人声偏好，将用户选中的曲风融合到节奏、乐器和编曲中。若选择的是人声歌曲且艺人偏好纯音乐，按有声作品构思。",
      ].join("\n")
    : "";
  if (!plan.artistSnapshot)
    return { theme: theme + brief, styleTemplate: plan.styleTemplate };
  return {
    theme: theme + brief,
    styleTemplate: [
      plan.styleTemplate,
      JSON.stringify({
        artistId: plan.artistSnapshot.id,
        artistRevision: plan.artistSnapshot.revision,
        artistName: plan.artistSnapshot.name,
        longTermStyle: plan.artistSnapshot.defaults,
      }),
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

export function frozenRouteIssue(
  repo: Repository,
  plan: PlanCenterPlan,
): string | undefined {
  if (!plan.routeSnapshot) return;
  const roles: GenerationRole[] = [
    ...(plan.material.source === "provider" && plan.songType !== "instrumental" ? ["text" as const] : []),
    ...(plan.outputs.cover && plan.material.source !== "pule_prompt" ? ["image" as const] : []),
    ...(plan.outputs.music ? ["music" as const] : []),
  ];
  for (const role of roles) {
    const f = plan.routeSnapshot[role],
      p = f.profileId
        ? listApiProfiles(repo).find((p) => p.id === f.profileId)
        : undefined;
    if (f.capability === "unavailable")
      return f.reason ?? "GENERATION_ROUTE_UNAVAILABLE";
    if (!p || p.kind !== role) return "ROUTE_PROFILE_MISSING";
    if (
      p.revision !== f.profileRevision ||
      p.providerId !== f.providerId ||
      p.modelId !== f.modelId
    )
      return "ROUTE_PROFILE_CHANGED";
  }
  return;
}
