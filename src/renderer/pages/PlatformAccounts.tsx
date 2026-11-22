import React, { useEffect, useRef, useState } from "react";
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
import FanqieUploadAuthorization from "../components/FanqieUploadAuthorization";
import LocalArtistCreator, { type LocalArtist } from "../components/LocalArtistCreator";
import { accountLoginLabels, accountLoginState, accountLoginText, type AccountSessionStatus } from "../account-session";

function AccountDetails({ account, artists, status, onStatus }: {
  account: PlatformAccount;
  artists: LocalArtist[];
  status?: AccountSessionStatus;
  onStatus: (status?: AccountSessionStatus) => void;
}) {
  const { data, call } = useStudio();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [identityArtist, setIdentityArtist] = useState("");
  const [uploadAuthorizationOpen, setUploadAuthorizationOpen] = useState(false);
  const scoped = { accountId: account.id };
  const fanqie = account.provider === "fanqie";
  const qishui = account.provider === "qishui";
  const production = data.mode === "production";
  const supportedTargets = platformTargets.filter((target) => accountSupportsTarget(account.provider, target));
  const configurations: PlatformConfiguration[] = data.platformConfigurations ?? [];

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
      const next = await call("accountSession.open", scoped);
      onStatus(next);
    });
  const sync = () =>
    act(async () => {
      const result = await window.rainfall.fanqieCatalog("syncProfile", scoped);
      if (!result.ok) {
        onStatus(undefined);
        throw Error(result.error.message);
      }
      onStatus({ ...result.value, opened: result.value.connected });
    }, "官网资料已同步");
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
    artists.find((artist) => artist.id === identityArtist) ?? artists[0];
  return (
      <section className="panel" aria-label="账号会话">
        <div className="section-title">
          <h2>{account.name}</h2>
          <Badge>{accountLoginText(status)}</Badge>
        </div>
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
          {qishui && (
            <button type="button" disabled={!production || busy} onClick={() => void act(async () => {
              onStatus(await call("accountSession.status", scoped));
            })}>核对发布后台</button>
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
        {message && <p role="status">{message}</p>}
        {error && <p role="alert">{error}</p>}
        {fanqie && production && <details onToggle={event => setUploadAuthorizationOpen(event.currentTarget.open)}>
          <summary>番茄上传授权</summary>
          {uploadAuthorizationOpen && <FanqieUploadAuthorization accountId={account.id}
            artistCredits={artists.length === 1 ? artists[0].profile : undefined} />}
        </details>}
        {account.provider === "tme" && identity && (
          <details>
            <summary>腾讯官网身份核对</summary>
            {artists.length > 1 && (
              <ChoiceButtons
                label="核对音乐人"
                value={identity.id}
                choices={artists.map((artist) => ({
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
  const [deleting, setDeleting] = useState<PlatformAccount>();
  const [sessions, setSessions] = useState<Record<string, AccountSessionStatus | undefined>>({});
  const sessionReads = useRef(new Map<string, number>());
  const accounts: PlatformAccount[] = data.accounts.filter(
    (account: PlatformAccount) => account.provider === provider,
  );
  const visible = accounts.filter((account) =>
    account.name.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const selected =
    visible.find((account) => account.id === selectedId) ?? visible[0];
  const artists: LocalArtist[] = data.accountLocalArtists ?? [];
  const accountArtists = selected ? artists.filter(artist => artist.accountId === selected.id) : [];
  const unassignedArtists = artists.filter(artist => !artist.accountId);
  const accountIds = accounts.map(account => account.id).join(",");
  const production = data.mode === "production";
  const setSession = (accountId: string, status?: AccountSessionStatus) => {
    sessionReads.current.set(accountId, (sessionReads.current.get(accountId) ?? 0) + 1);
    setSessions(current => ({ ...current, [accountId]: status }));
  };
  useEffect(() => {
    if (!production || !accountIds) return;
    const ids = accountIds.split(",");
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      await Promise.all(ids.map(async accountId => {
        const read = sessionReads.current.get(accountId);
        const result = await window.rainfall.call("accountSession.status", { accountId }).catch(() => undefined);
        if (active && sessionReads.current.get(accountId) === read) {
          setSessions(current => ({ ...current, [accountId]: result?.ok ? result.value : undefined }));
        }
      }));
      if (active) timer = setTimeout(check, 3_000);
    };
    void check();
    return () => { active = false; clearTimeout(timer); };
  }, [production, accountIds]);
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
  const remove = async (account: PlatformAccount) => {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      await call("account.delete", { accountId: account.id, confirmed: true });
      setSession(account.id, undefined);
      setDeleting(undefined);
      if (selectedId === account.id) setSelectedId("");
    } catch (error) {
      setError(error instanceof Error ? error.message : "删除账号未完成");
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <PageHead title="账号管理" />
      <div className="platform-account-filters">
        <label>
          平台
          <select
            aria-label="账号平台"
            value={provider}
            disabled={saving}
            onChange={(event) => {
              setProvider(AccountProviderSchema.parse(event.target.value));
              setSelectedId("");
              setSearch("");
              setError("");
            }}
          >
            {accountProviders.map((value) => (
              <option key={value} value={value}>{names[value]}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="platform-account-grid">
        <section
          className="panel platform-account-list"
          aria-label="平台账号列表"
        >
          <div className="section-title platform-account-list-heading">
            <h2>平台账号</h2>
            <button type="button" className="primary" disabled={saving} aria-expanded={adding} onClick={() => {
              setError("");
              setAdding(value => !value);
            }}>{adding ? "取消添加" : "＋ 添加账号"}</button>
          </div>
          <span className="muted platform-account-count">{accounts.length} 个账号</span>
          {adding && <form className="account-rename" onSubmit={event => void create(event)}>
            <label>{names[provider]}账号备注
              <input aria-label="新账号备注" placeholder="例如：个人发行" value={name} required maxLength={100}
                onChange={event => setName(event.target.value)} />
            </label>
            <button type="submit" disabled={saving || !name.trim()}>保存账号</button>
            {error && !deleting && <p role="alert">{error}</p>}
          </form>}
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
            <ul className="platform-account-rows" aria-label="当前账号">
              {visible.map(account => {
                const status = production ? sessions[account.id] : undefined;
                const login = accountLoginState(status, account.authStatus);
                const loginLabel = login === "unknown" && status?.opened === false ? "专属窗口未打开" : accountLoginLabels[login];
                return <li key={account.id}>
                  <button type="button" className="choice-button" aria-pressed={account.id === selected?.id}
                    aria-description={loginLabel} onClick={() => setSelectedId(account.id)}>
                    <span className="account-login-dot" data-state={login} title={loginLabel} aria-hidden="true" />
                    <span className="platform-account-name" title={account.name}>{account.name}</span>
                  </button>
                  <button type="button" aria-label={`删除账号 ${account.name}`} disabled={saving} onClick={() => {
                    setError("");
                    setDeleting(account);
                  }}>删除</button>
                </li>;
              })}
            </ul>
          ) : (
            <p className="muted">{search ? "没有匹配的账号" : "暂无账号"}</p>
          )}
        </section>
        <div className="platform-account-content">
          {selected && <React.Fragment key={data.mode + ":" + selected.id}>
            <AccountDetails account={selected} artists={accountArtists} status={production ? sessions[selected.id] : undefined}
              onStatus={status => setSession(selected.id, status)} />
            {selected.provider !== "yourmusic" && (
              <LocalArtistCreator account={selected} artists={accountArtists} unassigned={unassignedArtists} />
            )}
          </React.Fragment>}
        </div>
      </div>
      {deleting && <div className="plan-modal-backdrop">
        <section className="plan-confirm" role="dialog" aria-modal="true" aria-label="删除平台账号" onKeyDown={event => {
          if (event.key === "Escape" && !saving) setDeleting(undefined);
        }}>
          <h2>删除平台账号</h2>
          <p>删除「{deleting.name}」？关联艺人将转为未关联。</p>
          {error && <p role="alert">{error}</p>}
          <div className="plan-editor-footer">
            <button type="button" autoFocus disabled={saving} onClick={() => { setDeleting(undefined); setError(""); }}>取消</button>
            <button type="button" disabled={saving} onClick={() => void remove(deleting)}>确认删除</button>
          </div>
        </section>
      </div>}
    </>
  );
}
