import React, { useEffect, useState } from "react";
import {
  AccountProviderSchema,
  accountProviders,
  accountSupportsTarget,
  type AccountProvider,
  type PlatformAccount,
} from "../../shared/platform-accounts";
import { platformTargets, type PlatformConfiguration, type PlatformTarget } from "../../shared/platform-config";
import { Badge, names, PageHead, useStudio } from "../context";
import AccountBinding from "../components/AccountBinding";
import ChoiceButtons from "../components/ChoiceButtons";

type LocalArtist = { id: string; name: string };
type LocalBinding = {
  id: string;
  accountId: string;
  artistId: string;
  status: string;
};
type SessionStatus = {
  opened: boolean;
  savedProfile: boolean;
  workWindow?: {artistId?:string}|null;
  profileVerified?: boolean;
  profile?: {
    accountKey: string;
    maskedAccount: string;
    artists: { artistId: string; name: string }[];
  } | null;
};

function AccountDetails({ account }: { account: PlatformAccount }) {
  const { data, call, go } = useStudio();
  const [status, setStatus] = useState<SessionStatus>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [name, setName] = useState(account.name);
  const [limit, setLimit] = useState(account.dailyLimit);
  const [identityArtist, setIdentityArtist] = useState("");
  const linked = (data.bindings as LocalBinding[]).filter(
    (binding) =>
      binding.accountId === account.id && binding.status !== "revoked",
  );
  const artists: LocalArtist[] = data.artists;
  const linkedArtists = artists.filter((artist) =>
    linked.some((binding) => binding.artistId === artist.id),
  );
  const scoped = { accountId: account.id };
  const fanqie = account.provider === "fanqie";
  const production = data.mode === "production";
  const supportedTargets = platformTargets.filter((target) => accountSupportsTarget(account.provider, target));
  const configurations: PlatformConfiguration[] = data.platformConfigurations ?? [];

  useEffect(() => {
    if (!production) return;
    let active = true;
    void window.rainfall
      .call("accountSession.status", scoped)
      .then((result) => {
        if (!active) return;
        if (result.ok) {
          setStatus(result.value);
          setIdentityArtist(result.value.workWindow?.artistId??"");
        }
        else setError(result.error.message);
      })
      .catch(() => {
        if (active) setError("无法读取会话状态");
      });
    return () => {
      active = false;
    };
  }, [account.id, production]);

  const act = async (run: () => Promise<unknown>, success?: string) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await run();
      if (success) setMessage(success);
    } catch (error) {
      setError(error instanceof Error ? error.message : "操作未完成");
    } finally {
      setBusy(false);
    }
  };
  const open = () =>
    act(async () => {
      const artistId=linkedArtists.find(artist=>artist.id===identityArtist)?.id??linkedArtists[0]?.id;
      const next = await call("accountSession.open", {...scoped,artistId});
      setStatus(next);
    });
  const sync = () =>
    act(async () => {
      const result = await window.rainfall.fanqieCatalog("syncProfile", scoped);
      if (!result.ok) {
        setStatus((old) => old && { ...old, profileVerified: false });
        throw Error(result.error.message);
      }
      setStatus({ ...result.value, opened: result.value.connected });
    }, "官网资料已同步");
  const toggleArtist = (artist: LocalArtist) =>
    act(async () => {
      const previous = linked.filter(
        (binding) => binding.artistId === artist.id,
      );
      if (previous.length) {
        for (const binding of previous)
          await call("binding.revoke", { id: binding.id });
      } else {
        await call("binding.save", {
          accountId: account.id,
          artistId: artist.id,
          targets:
            account.provider === "tme"
              ? ["qqmusic", "kugou"]
              : [account.provider],
        });
      }
    });
  const toggleDefaultAccount = (target: PlatformTarget, config?: PlatformConfiguration) =>
    act(
      () => call("platformConfig.setAccount", {
        target,
        accountId: config?.accountId === account.id ? null : account.id,
        expectedRevision: config?.revision ?? 0,
      }),
      "默认发布账号已更新",
    );
  const profile = status?.profile;
  const identity =
    linkedArtists.find((artist) => artist.id === identityArtist) ??
    linkedArtists[0];
  return (
    <div className="platform-account-content">
      <section className="panel" aria-label="账号会话">
        <div className="section-title">
          <h2>{account.name}</h2>
          <Badge>
            {status?.profileVerified
              ? "登录已核对"
              : status?.savedProfile
                ? "登录待核对"
                : "待登录"}
          </Badge>
        </div>
        {!!linkedArtists.length&&<label>
          窗口艺人
          <select value={identity?.id??""} disabled={busy} onChange={e=>setIdentityArtist(e.target.value)}>
            {linkedArtists.map(artist=><option key={artist.id} value={artist.id}>{artist.name}</option>)}
          </select>
        </label>}
        <div className="account-actions">
          <button
            type="button"
            className="primary"
            disabled={!production || busy}
            onClick={() => void open()}
          >
            打开专属登录窗口
          </button>
          {fanqie && (
            <button
              type="button"
              disabled={!production || busy}
              onClick={() => void sync()}
            >
              同步官网资料
            </button>
          )}
          {account.provider !== "suno" && account.provider !== "yourmusic" && (
            <button
              type="button"
              onClick={() =>
                go(
                  "accounts",
                  account.provider === "tme" ? "qqmusic" : account.provider,
                  fanqie ? account.id : undefined,
                )
              }
            >
              平台配置
            </button>
          )}
        </div>
        {!!supportedTargets.length && (
          <fieldset className="artist-links" disabled={busy}>
            <legend>默认发布账号</legend>
            <div className="choice-buttons">
              {supportedTargets.map((target) => {
                const config = configurations.find((item) => item.target === target);
                return (
                  <button
                    key={target}
                    type="button"
                    className="choice-button"
                    aria-label={names[target] + "默认账号"}
                    aria-pressed={config?.accountId === account.id}
                    onClick={() => void toggleDefaultAccount(target, config)}
                  >
                    {names[target]}
                  </button>
                );
              })}
            </div>
          </fieldset>
        )}
        {profile && (
          <>
            <p className="muted">
              账号 {profile.maskedAccount} · {profile.artists.length}{" "}
              位官网音乐人
            </p>
            <div className="account-roster" aria-label="官网音乐人">
              {profile.artists.map((artist) => (
                <span key={artist.artistId}>{artist.name}</span>
              ))}
            </div>
          </>
        )}
        <details className="account-rename">
          <summary>账号资料</summary>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void act(
                () =>
                  call("account.save", {
                    id: account.id,
                    provider: account.provider,
                    name: name.trim(),
                    dailyLimit: limit,
                  }),
                "账号资料已保存",
              );
            }}
          >
            <label>
              账号备注
              <input
                value={name}
                required
                maxLength={100}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            {!fanqie && (
              <label>
                每日提交本地上限
                <input
                  type="number"
                  min={0}
                  max={10000}
                  required
                  value={limit}
                  onChange={(event) => setLimit(Number(event.target.value))}
                />
              </label>
            )}
            <button type="submit" disabled={busy || !name.trim()}>
              保存账号资料
            </button>
          </form>
        </details>
        {message && <p role="status">{message}</p>}
        {error && <p role="alert">{error}</p>}
      </section>
      <section className="panel" aria-label="本地音乐人">
        <div className="section-title">
          <h2>本地音乐人</h2>
          <button type="button" onClick={() => go("accounts", "artists")}>
            管理本地艺人
          </button>
        </div>
        <fieldset className="artist-links" disabled={busy}>
          <legend>已关联 {linkedArtists.length} 位</legend>
          <div className="choice-buttons">
            {artists.map((artist) => (
              <button
                key={artist.id}
                type="button"
                className="choice-button"
                aria-pressed={linkedArtists.some(
                  (item) => item.id === artist.id,
                )}
                onClick={() => void toggleArtist(artist)}
              >
                {artist.name}
              </button>
            ))}
          </div>
        </fieldset>
        {account.provider === "tme" && identity && (
          <details>
            <summary>腾讯官网身份核对</summary>
            {linkedArtists.length > 1 && (
              <ChoiceButtons
                label="核对音乐人"
                value={identity.id}
                choices={linkedArtists.map((artist) => ({
                  value: artist.id,
                  label: artist.name,
                }))}
                onChange={setIdentityArtist}
              />
            )}
            <AccountBinding
              key={identity.id}
              accountId={account.id}
              artistId={identity.id}
            />
          </details>
        )}
      </section>
    </div>
  );
}

export default function PlatformAccounts({
  initialProvider,
}: {
  initialProvider?: string;
}) {
  const { data, call } = useStudio();
  const [provider, setProvider] = useState<AccountProvider>(
    () => AccountProviderSchema.safeParse(initialProvider).data ?? "fanqie",
  );
  const [selectedId, setSelectedId] = useState("");
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const accounts: PlatformAccount[] = data.accounts.filter(
    (account: PlatformAccount) => account.provider === provider,
  );
  const visible = accounts.filter((account) =>
    account.name.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const selected =
    visible.find((account) => account.id === selectedId) ?? visible[0];
  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving || !name.trim()) return;
    setSaving(true);
    setError("");
    try {
      const account = await call("account.save", {
        provider,
        name: name.trim(),
        dailyLimit: 3,
      });
      setSelectedId(account.id);
      setSearch("");
      setName("");
      setAdding(false);
    } catch (error) {
      setError(error instanceof Error ? error.message : "保存未完成");
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <PageHead
        title="账号管理"
        action={
          <button
            type="button"
            className="primary"
            disabled={saving}
            onClick={() => setAdding((value) => !value)}
          >
            {adding ? "取消添加" : "＋ 添加账号"}
          </button>
        }
      />
      <div className="platform-account-filters">
        <ChoiceButtons
          label="账号平台"
          value={provider}
          disabled={saving}
          choices={[
            "fanqie",
            ...accountProviders.filter((value) => value !== "fanqie"),
          ].map((value) => ({ value, label: names[value] }))}
          onChange={(value) => {
            setProvider(AccountProviderSchema.parse(value));
            setSelectedId("");
            setSearch("");
            setError("");
          }}
        />
      </div>
      {adding && (
        <form
          className="panel account-rename"
          onSubmit={(event) => void create(event)}
        >
          <label>
            {names[provider]}账号备注
            <input
              aria-label="新账号备注"
              placeholder="例如：个人发行"
              value={name}
              required
              maxLength={100}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <button type="submit" disabled={saving || !name.trim()}>
            保存账号
          </button>
          {error && <p role="alert">{error}</p>}
        </form>
      )}
      <div className="platform-account-grid">
        <section
          className="panel platform-account-list"
          aria-label="平台账号列表"
        >
          <div className="section-title">
            <h2>{names[provider]}</h2>
            <Badge>{accounts.length} 个账号</Badge>
          </div>
          {accounts.length >= 5 && (
            <input
              className="account-search"
              aria-label="搜索账号"
              placeholder="搜索账号"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          )}
          {visible.length ? (
            <ChoiceButtons
              label="当前账号"
              value={selected?.id ?? ""}
              choices={visible.map((account) => ({
                value: account.id,
                label: account.name,
              }))}
              onChange={setSelectedId}
            />
          ) : (
            <p className="muted">{search ? "没有匹配的账号" : "暂无账号"}</p>
          )}
        </section>
        {selected && (
          <AccountDetails
            key={data.mode + ":" + selected.id}
            account={selected}
          />
        )}
      </div>
    </>
  );
}
