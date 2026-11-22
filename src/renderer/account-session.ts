import type { PuleSessionState } from "../shared/pule-browser";
import type { QishuiSessionState } from "../shared/qishui";
import type { AccountLoginState } from "../shared/platform-accounts";

export type AccountSessionStatus = {
  opened: boolean;
  savedProfile: boolean;
  loginState?: AccountLoginState;
  profileVerified?: boolean;
  qishuiState?: QishuiSessionState;
  puleState?: PuleSessionState;
  profile?: {
    accountKey: string;
    maskedAccount: string;
    artists: { artistId: string; name: string }[];
  } | null;
};

const puleLabels: Record<PuleSessionState, string> = {
  closed: "窗口未打开",
  unverified: "登录待核对",
  login_required: "请在窗口登录",
  signed_in: "登录有效",
};
const qishuiLabels: Record<QishuiSessionState, string> = {
  closed: "窗口未打开",
  login_required: "请在窗口登录",
  release_page: "已进入发布后台",
  release_form: "已打开全曲发布表单",
  unverified: "发布页待核对",
};

export const accountLoginLabels: Record<AccountLoginState, string> = {
  valid: "登录有效",
  expired: "需要重新登录",
  unknown: "登录待核对",
};

export function accountLoginState(status?: AccountSessionStatus, authStatus?: string): AccountLoginState {
  if (status?.loginState) return status.loginState;
  if (status?.puleState === "login_required" || status?.qishuiState === "login_required") return "expired";
  if (status?.puleState === "signed_in" ||
      status?.qishuiState === "release_page" || status?.qishuiState === "release_form" || status?.profileVerified) return "valid";
  return authStatus === "reauth_required" ? "expired" : "unknown";
}

export function accountLoginText(status?: AccountSessionStatus) {
  if (status?.puleState) return puleLabels[status.puleState];
  if (status?.qishuiState) return qishuiLabels[status.qishuiState];
  if (status?.loginState === "unknown" && !status.opened) return "专属窗口未打开";
  if (status?.loginState) return accountLoginLabels[status.loginState];
  if (status?.profileVerified) return "登录已核对";
  return status?.savedProfile ? "登录待核对" : "待登录";
}
