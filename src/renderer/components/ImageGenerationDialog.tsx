import React, { useRef, useState } from "react";
import { imageApiModels, manualCoverPrices, paidCoverModelId, supportsImageApiModel } from "../../shared/api-profiles";
import { coverResolutionSchema } from "../../shared/cover-handoff";
import { accountSupportsTarget, type PlatformAccount } from "../../shared/platform-accounts";
import { publicationPlatforms, type PlatformTarget } from "../../shared/platform-config";
import { imagePromptLimit, platformImageFailure, type ImageApiProvider, type PlatformImageResult } from "../../shared/platform-image";
import { localMusicians, useStudio } from "../context";
import { useImageCredential } from "../image-credential";
import PlatformAutomationPanel from "./PlatformAutomationPanel";

export default function ImageGenerationDialog({ provider, onClose }: {
  provider: ImageApiProvider;
  onClose: () => void;
}) {
  const { data, refresh } = useStudio();
  const credential = useImageCredential(provider.id);
  const [requestedModelId, setModelId] = useState("");
  const [platform, setPlatform] = useState<PlatformTarget | "">("");
  const [artistId, setArtistId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [image, setImage] = useState<PlatformImageResult>();
  const [busy, setBusy] = useState<"generate" | "default">();
  const [error, setError] = useState("");
  const flight = useRef(false);

  const { profile, status } = credential;
  const models = imageApiModels(provider.id);
  const modelId = requestedModelId || (supportsImageApiModel(provider.id, profile?.modelId) ? profile.modelId : models[0].id);
  const accounts: PlatformAccount[] = data.accounts ?? [];
  const platformAccounts = new Map(accounts.filter(account => platform && accountSupportsTarget(account.provider, platform))
    .map(account => [account.id, account.name]));
  const artists = localMusicians(data).filter(artist => platformAccounts.has(artist.accountId));
  const artist = artists.find(item => item.id === artistId);
  const resolution = coverResolutionSchema.safeParse(artist?.defaults?.coverResolution);
  const price = paidCoverModelId(modelId);
  const canUseCredential = !!profile && !!status?.configured && !credential.disabled;
  const isDefault = profile?.id === credential.defaultProfileId && profile?.modelId === modelId;
  const imageSrc = image && "data:image/jpeg;base64," + image.base64;

  function edit(update: () => void) {
    update();
    setImage(undefined);
    setError("");
  }

  async function run(action: "generate" | "default") {
    if (!canUseCredential || !profile || flight.current) return;
    if (action === "generate" && (!artist || !platform || !resolution.success || !prompt.trim())) return;
    if (action === "default" && isDefault) return;
    flight.current = true;
    setBusy(action);
    setError("");
    const selection = { profileId: profile.id, expectedRevision: profile.revision, providerId: provider.id, modelId };
    try {
      if (action === "default") {
        const result = await window.rainfall.call("platformImage.setDefault", selection);
        if (!result.ok) throw Error(result.error.code);
        await refresh();
      } else {
        setImage(undefined);
        const result = await window.rainfall.call("platformImage.generate", {
          ...selection, platform, artistId: artist.id, resolution: resolution.data, prompt: prompt.trim(),
        });
        if (!result.ok) throw Error(result.error.code);
        setImage(result.value as PlatformImageResult);
      }
    } catch (cause) {
      const failure = platformImageFailure(cause);
      setError(failure.message + "（" + failure.code.replace(/^IMAGE_HTTP_/u, "HTTP ") + "）");
      if (failure.code === "CREDENTIAL_NOT_CONFIGURED") credential.reload();
    } finally {
      flight.current = false;
      setBusy(undefined);
    }
  }

  return <PlatformAutomationPanel title={provider.name + " · 账号信息"} onClose={onClose}
    closeDisabled={busy === "generate"}>
    <form className="platform-image-form" onSubmit={event => {
      event.preventDefault();
      void run("generate");
    }}>
      <label>图像模型
        <select aria-label="图像模型" value={modelId} disabled={!!busy} onChange={event => edit(() => setModelId(event.target.value))}>
          {models.map(model => <option key={model.id} value={model.id}>{model.label}</option>)}
        </select>
      </label>
      <label>发布平台
        <select aria-label="发布平台" value={platform} disabled={!!busy} onChange={event => edit(() => {
          setPlatform(event.target.value as PlatformTarget | "");
          setArtistId("");
        })}>
          <option value="">选择发布平台</option>
          {publicationPlatforms.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </label>
      <label>艺人
        <select aria-label="艺人" value={artist?.id ?? ""} disabled={!!busy || !artists.length}
          onChange={event => edit(() => setArtistId(event.target.value))}>
          <option value="">{!platform ? "请先选择发布平台" : artists.length ? "选择艺人" : "该平台暂无已关联艺人"}</option>
          {artists.map(artist => <option key={artist.id} value={artist.id}>
            {artist.name} · {platformAccounts.get(artist.accountId)}
          </option>)}
        </select>
      </label>
      {artist && <small className="muted platform-image-resolution" role="status">
        {resolution.success ? <>封面分辨率 <strong>{resolution.data} × {resolution.data}</strong></>
          : "请在账号管理设置艺人的封面分辨率"}
      </small>}
      <label>创意描述
        <textarea value={prompt} rows={5} maxLength={imagePromptLimit} disabled={!!busy}
          onChange={event => edit(() => setPrompt(event.target.value))} />
      </label>
      {credential.disabled ? <p className="muted">请在真实本地库出图</p>
        : credential.checking ? <p className="muted" role="status">正在读取 Key 状态…</p>
        : !canUseCredential && <p className="muted">
          {credential.error ?? (status?.failureCode ? platformImageFailure(status.failureCode).message
            : "请在配置中心保存该提供商的 API Key")}
        </p>}
      <div className="row actions platform-image-actions">
        <button type="submit" className="primary"
          disabled={!!busy || !canUseCredential || !resolution.success || !prompt.trim()}>
          {busy === "generate" ? "正在生成…" : "生成图片"}
        </button>
        <button type="button" disabled={!!busy || !canUseCredential || isDefault} onClick={() => void run("default")}>
          {isDefault ? "已设为工作流默认" : "设为工作流默认"}
        </button>
        {price ? <small className="muted">{manualCoverPrices[price]}</small>
          : provider.id === "openai_image" && <small className="muted">使用所选模型的 API 额度</small>}
      </div>
    </form>
    {error && <p role="alert" className="notice">{error}</p>}
    {image && imageSrc && <section className="platform-image-result" aria-label="出图结果">
      <img src={imageSrc} alt="生成的封面" />
      <a href={imageSrc} download={image.filename}>下载图片</a>
    </section>}
  </PlatformAutomationPanel>;
}
