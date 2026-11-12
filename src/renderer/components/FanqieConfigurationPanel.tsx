import React, { useEffect, useState } from "react";
import { useStudio } from "../context";
import {
  fanqieChoices,
  defaultFanqieChoice,
  fanqieScope,
} from "../fanqie-accounts";
import ChoiceButtons from "./ChoiceButtons";
import type { FanqieAuthorizationPreference } from "../../shared/fanqie";

const blank = { lyricist: "", composer: "", singer: "" };
type Authors = typeof blank;
const defaultPreference: FanqieAuthorizationPreference = {
  mode: "exclusive",
  platforms: ["fanqie_music", "fanqie_audio"],
  confirmContractManually: true,
};

function FanqieSettings({ accountId }: { accountId: string }) {
  const { data } = useStudio();
  const [profile, setProfile] = useState<{
    artists: { artistId: string; name: string }[];
  } | null>(null);
  const [authors, setAuthors] = useState<Authors>(blank);
  const [artistAuthors, setArtistAuthors] = useState<Record<string, Authors>>(
    {},
  );
  const [artistId, setArtistId] = useState("");
  const [preference, setPreference] = useState(defaultPreference);
  const [consent, setConsent] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const scope = fanqieScope(accountId);
  const linkedArtists = data.artists.filter(
    (artist: { id: string }) =>
      data.bindings?.some(
        (binding: any) =>
          binding.accountId === accountId &&
          binding.artistId === artist.id &&
          binding.status !== "revoked",
      ) || artist.id in artistAuthors,
  );
  const selectedArtist = linkedArtists.find(
    (artist: { id: string }) => artist.id === artistId,
  );
  const editingAuthors = selectedArtist
    ? (artistAuthors[artistId] ?? authors)
    : authors;
  useEffect(() => {
    let active = true;
    void Promise.all([
      window.rainfall.fanqieUpload("configuration", scope),
      window.rainfall.fanqieCatalog("status", scope),
    ])
      .then(([config, catalog]) => {
        if (!active) return;
        if (!config.ok) throw Error(config.error.message);
        const value = config.value.configuration;
        setAuthors(value?.authors ?? config.value.suggestedAuthors ?? blank);
        setArtistAuthors(value?.artistAuthors ?? {});
        setPreference(value?.authorizationPreference ?? defaultPreference);
        setConsent(!!value?.publicationConsent);
        setProfile(catalog.ok ? catalog.value.profile : null);
      })
      .catch((error) => {
        if (active) setError(error.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [accountId]);
  const updateAuthors = (value: Authors) => {
    setMessage("");
    if (selectedArtist)
      setArtistAuthors((previous) => ({ ...previous, [artistId]: value }));
    else setAuthors(value);
  };
  const validAuthors = (value: Authors) =>
    Object.values(value).every((name) => name.trim());
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || loading) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await window.rainfall.fanqieUpload("saveConfiguration", {
        ...scope,
        version: 1,
        authors,
        ...(Object.keys(artistAuthors).length ? { artistAuthors } : {}),
        useWorkMaterials: true,
        publicationConsent: consent,
        authorizationPreference: preference,
      });
      if (!result.ok) throw Error(result.error.message);
      setMessage("已保存署名和签约偏好");
    } catch (error) {
      setError(error instanceof Error ? error.message : "保存未完成");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <form onSubmit={(event) => void save(event)}>
        <fieldset className="platform-fields" disabled={busy || loading}>
          {!!linkedArtists.length && (
            <ChoiceButtons
              label="署名适用音乐人"
              value={artistId}
              onChange={setArtistId}
              choices={[
                { value: "", label: "账号默认署名" },
                ...linkedArtists.map(
                  (artist: { id: string; name: string }) => ({
                    value: artist.id,
                    label: artist.name,
                  }),
                ),
              ]}
            />
          )}
          <div className="form-grid">
            {(["lyricist", "composer", "singer"] as const).map((role) => (
              <label key={role}>
                {
                  {
                    lyricist: "默认词作者",
                    composer: "默认曲作者",
                    singer: "默认歌手",
                  }[role]
                }
                <input
                  required
                  maxLength={40}
                  value={editingAuthors[role]}
                  onChange={(event) =>
                    updateAuthors({
                      ...editingAuthors,
                      [role]: event.target.value,
                    })
                  }
                />
              </label>
            ))}
          </div>
          {!!profile?.artists.length && (
            <details>
              <summary>使用官网艺名</summary>
              <ChoiceButtons
                label="官网艺名"
                value=""
                choices={profile.artists.map((artist) => ({
                  value: artist.artistId,
                  label: artist.name,
                }))}
                onChange={(id) => {
                  const name = profile.artists.find(
                    (artist) => artist.artistId === id,
                  )!.name;
                  updateAuthors({
                    lyricist: name,
                    composer: name,
                    singer: name,
                  });
                }}
              />
            </details>
          )}
          {selectedArtist && artistAuthors[artistId] && (
            <button
              type="button"
              onClick={() => {
                setArtistAuthors((previous) => {
                  const next = { ...previous };
                  delete next[artistId];
                  return next;
                });
                setMessage("");
              }}
            >
              使用账号默认署名
            </button>
          )}
          <div>
            <span>签约模式</span>
            <ChoiceButtons
              label="签约模式"
              value={preference.mode}
              choices={[
                { value: "exclusive", label: "独家签约" },
                { value: "nonexclusive", label: "非独家签约" },
              ]}
              onChange={(mode) =>
                setPreference({
                  ...preference,
                  mode: mode as FanqieAuthorizationPreference["mode"],
                })
              }
            />
          </div>
          <fieldset>
            <legend>发布平台</legend>
            <label className="inline-check">
              <input type="checkbox" checked disabled />
              番茄音乐
            </label>
            <label className="inline-check">
              <input
                type="checkbox"
                checked={preference.platforms.includes("fanqie_audio")}
                onChange={(event) =>
                  setPreference({
                    ...preference,
                    platforms: event.target.checked
                      ? ["fanqie_music", "fanqie_audio"]
                      : ["fanqie_music"],
                  })
                }
              />
              番茄畅听
            </label>
          </fieldset>
          <label className="inline-check">
            <input
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
            />
            允许自动上传已核对且有权发布的作品。合同签署时由你确认。
          </label>
          <button
            className="primary"
            disabled={
              !consent ||
              !validAuthors(authors) ||
              !Object.values(artistAuthors).every(validAuthors)
            }
          >
            保存配置
          </button>
        </fieldset>
      </form>
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
    </>
  );
}

export default function FanqieConfigurationPanel({
  initialAccountId = "",
}: {
  initialAccountId?: string;
}) {
  const { data } = useStudio();
  const [selected, setSelected] = useState(initialAccountId);
  const choices = fanqieChoices(data.accounts ?? []);
  const accountId = choices.some((choice) => choice.value === selected)
    ? selected
    : defaultFanqieChoice(choices, data.platformConfigurations) || choices[0]?.value || "";
  if (data.mode !== "production") return <p>请在真实本地库中配置番茄音乐。</p>;
  return (
    <section className="panel platform-configuration" aria-label="番茄音乐配置">
      <h2>番茄发布规则</h2>
      {choices.length > 1 && (
        <ChoiceButtons
          label="规则适用账号"
          choices={choices}
          value={accountId}
          onChange={setSelected}
        />
      )}
      {accountId
        ? <FanqieSettings key={accountId} accountId={accountId} />
        : <p className="muted">请在账号管理添加番茄账号。</p>}
    </section>
  );
}
