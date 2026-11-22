import { useEffect, useState } from "react";
import type { ApiProfile, CredentialStatus } from "../shared/api-profiles";
import { credentialFailureText } from "../shared/credential-errors";
import { imageCredentialProfiles, type ImageApiProviderId } from "../shared/platform-image";
import { useStudio } from "./context";

export function useImageCredential(providerId: ImageApiProviderId | undefined, includeMaskedKey = false) {
  const { data, runtime } = useStudio();
  const disabled = data.mode !== "production" || runtime.mode === "simulation" || !!runtime.offlineAcceptance;
  const defaultProfileId: string | null = data.platformWorkflow?.defaults?.image ?? null;
  const profiles: ApiProfile[] = data.platformWorkflow?.profiles ?? [];
  const candidates = providerId ? imageCredentialProfiles(profiles, providerId, defaultProfileId) : [];
  const [attempt, setAttempt] = useState(0);
  const key = JSON.stringify([providerId, disabled, includeMaskedKey, attempt, candidates.map(({ id, revision }) => [id, revision])]);
  const [result, setResult] = useState<{ key: string; status?: CredentialStatus; error?: string }>();

  useEffect(() => {
    if (disabled || !candidates.length) return;
    let active = true;
    async function read() {
      let first: CredentialStatus | undefined;
      try {
        for (const profile of candidates) {
          const response = await window.rainfall.apiCredentialStatus({
            profileId: profile.id,
            ...(includeMaskedKey ? { includeMaskedKey: true } : {}),
          });
          if (!active) return;
          if (!response.ok) throw Error(response.error.code);
          first ??= response.value;
          if (response.value.configured) {
            setResult({ key, status: response.value });
            return;
          }
        }
        if (active) setResult({ key, status: first });
      } catch (error) {
        if (active) setResult({ key, error: credentialFailureText(error) });
      }
    }
    void read();
    return () => { active = false; };
  }, [key]);

  const current = result?.key === key ? result : undefined;
  return {
    disabled, defaultProfileId,
    profile: candidates.find(profile => profile.id === current?.status?.profileId) ?? candidates[0],
    status: current?.status,
    error: current?.error,
    checking: !disabled && candidates.length > 0 && !current,
    reload: () => setAttempt(value => value + 1),
  };
}
