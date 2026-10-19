export function clientVersionLabel(
  runtime: { appVersion?: unknown; packaged?: boolean },
  desktopBridge: boolean,
) {
  if (!desktopBridge) return "Web 预览 · 无客户端版本";
  const version =
    typeof runtime.appVersion === "string" ? runtime.appVersion.trim() : "";
  if (!version)
    return runtime.packaged === false ? "开发运行 · 版本未知" : "版本未知";
  return "v" + version + (runtime.packaged === false ? " · 开发运行" : "");
}
