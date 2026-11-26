import { z } from "zod";
import type { ArtistMusicType, ArtistSongAttribute } from "./local-artist";
import type { FanqieAuthorizationPreference } from "./fanqie";

export const fanqieDownloadBatchLimit = 100;
export const fanqieOriginalSingerSchema = z.string().trim().min(1).max(40);
export const fanqieOriginalWorkIdSchema = z.string().trim().regex(/^[1-9]\d{4,24}$/u);
export const fanqieDirectoryPreferencesSchema = z.strictObject({
  limit: z.number().int().min(1).max(fanqieDownloadBatchLimit),
  signContract: z.boolean(),
});
export type FanqieDirectoryPreferences = z.infer<typeof fanqieDirectoryPreferencesSchema>;
export const defaultFanqieDirectoryPreferences: FanqieDirectoryPreferences = { limit: fanqieDownloadBatchLimit, signContract: true };

export type FanqieDirectoryRelease = {
  musicType: ArtistMusicType;
  songAttribute: ArtistSongAttribute;
  ai: boolean;
  proofRequired: boolean;
  contractMode?: FanqieAuthorizationPreference["mode"];
  originalSinger?: string;
  originalWorkId?: string;
};
export const defaultFanqieDirectoryRelease: FanqieDirectoryRelease = {
  musicType: "original", songAttribute: "original", ai: true, proofRequired: false,
};

export const fanqieDownloadIssues: Record<string, string> = {
  FANQIE_BROWSER_HTTP_RESPONSE_FAILED: "番茄页面返回了异常 HTTP 响应，已暂停操作；请查看日志中的 browserCode 和 httpStatus（平台未提供状态码时会留空）。",
  FANQIE_BROWSER_NETWORK_CHANGED: "操作期间网络发生切换，番茄页面请求中断；请检查网络后核对官网状态再继续。",
  FANQIE_BROWSER_NETWORK_DISCONNECTED: "设备网络已断开或浏览器网络暂不可用；请恢复网络并核对官网状态。",
  FANQIE_BROWSER_DNS_FAILED: "无法解析番茄域名；请检查网络、DNS 或代理设置。",
  FANQIE_BROWSER_CERTIFICATE_FAILED: "番茄页面的 HTTPS 证书校验失败；请检查系统时间、网络代理或证书配置。",
  FANQIE_BROWSER_PROXY_FAILED: "无法通过当前代理连接番茄；请检查代理设置后核对官网状态。",
  FANQIE_BROWSER_NAVIGATION_ABORTED: "番茄页面导航被中断；请查看执行日志中的失败步骤和 browserCode。",
  FANQIE_BROWSER_NETWORK_FAILED: "番茄页面网络连接失败或超时；请查看执行日志中的 browserCode 并核对官网状态。",
  FANQIE_BROWSER_OPERATION_FAILED: "番茄浏览器操作失败；请查看执行日志中的步骤、browserCode 和脱敏错误信息。",
  FANQIE_BROWSER_NAVIGATION_TIMEOUT: "番茄页面导航超时；请查看执行日志中的导航操作和超时预算，并核对页面是否正常打开。",
  FANQIE_BROWSER_LOCATOR_TIMEOUT: "番茄页面等待控件超时；请查看执行日志中的等待控件类型、步骤和超时预算。",
  FANQIE_BROWSER_RESPONSE_TIMEOUT: "番茄页面等待网络响应超时；请查看执行日志中的请求等待步骤，并核对官网状态后再继续。",
  FANQIE_BROWSER_TIMEOUT: "番茄页面操作超时；请查看执行日志中的失败步骤并核对官网状态。",
  FANQIE_BROWSER_PAGE_CLOSED: "番茄工作页面已关闭，自动化已暂停；请重新打开工作窗口并核对官网状态。",
  DOWNLOAD_ROOT_REQUIRED: "请先在配置中心设置下载目录。",
  DOWNLOAD_ROOT_INVALID: "下载目录不可用，请在配置中心重新选择本地文件夹。",
  DOWNLOAD_ROOT_UNAVAILABLE: "读不到下载目录，请检查磁盘连接和目录权限。",
  DOWNLOAD_ROOT_CHANGED: "下载目录已变化，请在配置中心重新选择。",
  DOWNLOAD_FOLDER_UNAVAILABLE: "无法读取歌手目录，请检查目录权限。",
  FANQIE_DOWNLOAD_ACCOUNT_REQUIRED: "请选择一个番茄音乐发布账号。",
  FANQIE_DOWNLOAD_ACCOUNT_AMBIGUOUS: "多个番茄账号使用相同的目录前缀，请先区分账号名称。",
  FANQIE_DOWNLOAD_ACCOUNT_FOLDER_NOT_FOUND: "下载根目录下没有当前番茄账号对应的歌曲文件夹；请确认下载目录选的是账号/歌手文件夹的上一级目录。",
  FANQIE_DOWNLOAD_ARTIST_FOLDER_NOT_RECOGNIZED: "找到了当前番茄账号的目录，但没有匹配到本地艺人目录；请核对账号艺人设置和歌手文件夹名称。",
  FANQIE_DOWNLOAD_AUDIO_NOT_FOUND: "找到了账号/歌手目录，但其中没有可扫描的 WAV 或 MP3；请检查音频是否放在歌手目录内及文件扩展名。",
  FANQIE_DOWNLOAD_SCAN_FAILED: "下载目录扫描没有完成，请打开扫描日志查看停在哪个步骤。",
  FANQIE_DOWNLOAD_FILE_INVALID: "材料文件不可读取，请检查目录中的实际文件。",
  FANQIE_DOWNLOAD_MATERIALS_AMBIGUOUS: "同一首歌匹配到多个材料文件，请核对目录。",
  FANQIE_DOWNLOAD_SINGER_AMBIGUOUS: "目录可能对应多位同名歌手，请核对账号的艺人信息。",
  FANQIE_DOWNLOAD_SAME_TITLE: "目录中已有同名候选，请核对两份音频的歌名。",
  FANQIE_DOWNLOAD_COVER_REQUIRED: "缺少对应的 JPG 或 PNG 封面。",
  FANQIE_DOWNLOAD_LYRICS_REQUIRED: "缺少对应的 TXT 歌词。纯音乐请核对艺人创作类型。",
  FANQIE_DOWNLOAD_PROOF_REQUIRED: "缺少该歌曲的版权证明。请放入同目录，使用「歌曲名_版权证明」命名。",
  FANQIE_DOWNLOAD_PROOF_INVALID: "版权证明支持 ZIP、JPG、JPEG、PNG、BMP、PDF，且须为不超过 200 MB 的非空文件。",
  FANQIE_DOWNLOAD_ORIGINAL_SINGER_REQUIRED: "请在账号管理为翻唱配置原唱。",
  FANQIE_DOWNLOAD_ORIGINAL_WORK_REQUIRED: "请在账号管理为多版本歌曲配置关联原作品 ID。",
  FANQIE_ORIGINAL_SINGER_UNVERIFIED: "番茄未确认当前歌曲的原唱，请查看执行日志。",
  FANQIE_ORIGINAL_WORK_UNVERIFIED: "番茄未确认关联原作品，请核对作品 ID 和多版本发布权限。",
  FANQIE_DOWNLOADS_CHANGED: "目录材料或账号设置已变化，请重新扫描并确认。",
  FANQIE_DOWNLOADS_EMPTY: "下载目录中没有找到可扫描的 WAV 或 MP3；请检查账号歌手目录及音频位置。",
  FANQIE_DOWNLOADS_NONE_READY: "扫描到歌曲，但全部未通过上传检查。请看歌曲预览中的原因；执行日志也会统计各阻断原因。",
  FANQIE_DOWNLOAD_UPLOAD_NOT_CONFIRMED: "上次上传未走到确认，已核对为未上传。可以重新扫描后执行。",
  FANQIE_TITLE_INVALID: "歌名不能为空，且须在 40 字以内。",
  FANQIE_CONFIGURATION_REQUIRED: "请在账号管理为该账号保存番茄上传授权。",
  FANQIE_CONFIGURATION_CHANGED: "账号的署名或签约配置已变化，请先核对已上传作品，再重新扫描剩余歌曲。",
  FANQIE_LYRICS_INVALID: "歌词须为非空 UTF-8 文本。",
  FANQIE_AUDIO_FORMAT: "音频须为 WAV 或 MP3，且不超过 200 MB。",
  FANQIE_AUDIO_PROPERTIES: "请检查音频时长、双声道和采样率。",
  FANQIE_COVER_FORMAT: "封面须为 JPG 或 PNG，且不超过 10 MB。",
  FANQIE_COVER_DIMENSIONS: "请使用正方形封面。",
  FANQIE_ARTIST_NAME_NOT_FOUND: "番茄合作艺人列表中找不到对应署名。",
  FANQIE_ARTIST_NAME_AMBIGUOUS: "番茄合作艺人中有多个同名署名，请先在官网核对。",
  FANQIE_ARTIST_SEARCH_UNVERIFIED: "番茄合作艺人搜索未能核对，请检查账号登录后重试。",
  FANQIE_AUTHOR_NOT_FOUND: "番茄上传表单未返回匹配的艺人，请查看日志中的歌曲序号和署名字段。",
  FANQIE_AUTHOR_SEARCH_TIMEOUT: "番茄艺人搜索结果未及时加载，系统已停止本批次；歌手仍需按艺人 ID 核对后才能继续。",
  FANQIE_AUTHOR_AMBIGUOUS: "番茄上传表单返回了多个同名艺人，请核对该署名。",
  FANQIE_AUTHOR_RETRY_CONTROL_UNVERIFIED: "番茄艺人加载失败提示未能安全点击，已暂停该歌曲，请在页面核对下拉框。",
  FANQIE_AUTHOR_LOAD_RETRIES_EXHAUSTED: "番茄艺人下拉框加载失败，已重试 3 次仍未恢复，请查看执行日志。",
  FANQIE_SINGER_ID_UNVERIFIED: "番茄上传表单未能核对歌手 ID，请查看该歌曲的署名。",
  FANQIE_OFFICIAL_RECORD_ALREADY_EXISTS: "官网存在同名作品，请先核对其归档状态。",
  FANQIE_RECONCILIATION_REQUIRED: "请先在番茄账号窗口核对表单和投稿状态。",
  FANQIE_AUTHORIZATION_RECONCILIATION_REQUIRED: "请在番茄账号窗口核对已有合同。",
  FANQIE_AUTHORIZATION_WORK_MISMATCH: "合同作品与本批回执不一致，请在番茄账号窗口核对。",
  FANQIE_CATALOG_INCOMPLETE: "番茄作品列表未读全，请核对登录状态后再读。",
  FANQIE_CATALOG_LOOKUP_LOGIN_REQUIRED: "番茄登录已失效，请在该账号的专属窗口重新登录。",
  FANQIE_CATALOG_LOOKUP_FAILED: "本批作品查询失败，请检查番茄账号连接后重试。",
  FANQIE_CATALOG_LOOKUP_UNVERIFIED: "番茄未返回可核对的本批作品结果，请查看执行日志。",
  FANQIE_CATALOG_LOOKUP_TOO_BROAD: "官网返回的同名或相近作品过多，请使用更具体的歌名后重新扫描。",
  FANQIE_DIRECTORY_TAB_NOT_READY: "请先核对当前番茄页面，并将工作标签页切换到创作首页。",
  FANQIE_ACCOUNT_FRAME_UNAVAILABLE: "无法在当前番茄标签页核对账号，请重新打开创作首页。",
  FANQIE_FINISHED_RELEASE_UNVERIFIED: "未找到成品发行卡片中的发布作品入口，请查看执行日志。",
  FANQIE_PAGE_SCOPE_CHANGED: "番茄页面已发生变化，请在工作标签页核对当前步骤。",
  FANQIE_CATALOG_STATUS_UNVERIFIED: "本批作品的官网状态待核对，请核对投稿或签约状态。",
  FANQIE_INTERRUPTED: "上次上传已中断。",
  FANQIE_DOWNLOAD_CLEANUP_PENDING: "已确认上传，下载文件将在后台重试回收。",
  FANQIE_DOWNLOAD_CLEANUP_FAILED: "有下载文件未能移入回收站，请查看执行日志。",
  FANQIE_DOWNLOAD_CLEANUP_RECOVERED: "下载文件已补回收。",
  FANQIE_DIRECTORY_CONTRACT_GENERATION_PENDING: "等待番茄生成待签合同。",
  FANQIE_DIRECTORY_CONTRACT_PENDING: "等待在番茄完成签署。",
  FANQIE_AUTHORIZATION_SYNC_PROMPT: "官网弹出了番茄畅听同步确认，请在番茄核对同步设置。",
  FANQIE_CONTRACT_PREVIEW_UNVERIFIED: "未能核对番茄的合同预览或确认按钮，请查看执行日志。",
  FANQIE_CONTRACT_GENERATION_FAILED: "官网已回到合同预览，请查看番茄页面提示或执行日志。",
  FANQIE_CONTRACT_GENERATION_TIMEOUT: "15 分钟内未核对到签约验证页。请在番茄「成品发行 → 待授权」核对本批作品。",
  FANQIE_CONTRACT_VERIFICATION_REQUIRED: "新开的签约页缺少「数据安全验证」，请核对当前签约页面。",
  FANQIE_CONTRACT_VERIFICATION_AMBIGUOUS: "当前批次打开了多个验证页，请在番茄核对签约窗口。",
  FANQIE_CONTRACT_LINK_NOT_READY: "官网签约链接尚未生成。请稍后在番茄页面查看签约状态。",
  FANQIE_CONTRACT_PREVIEW_LEFT: "已离开合同预览。请到番茄「成品发行 → 待授权」找到本批作品继续签约。",
  FANQIE_EXISTING_CONTRACT_UNVERIFIED: "无法核对本批作品对应的合同，请查看执行日志。",
  FANQIE_EXISTING_CONTRACT_UNAVAILABLE: "官网暂未提供本批合同的签约入口，请查看番茄的授权合同页面。",
  FANQIE_DIAGNOSTICS_OPEN_FAILED: "无法打开执行日志目录。",
  FANQIE_TRACE_WRITE_FAILED: "无法保存执行日志，批次已暂停。",
  FANQIE_SONG_COUNT_UNVERIFIED: "官网表单的歌曲数量与本批不一致，请查看报错截图。",
  FANQIE_SONG_CARD_UNVERIFIED: "无法定位当前歌曲卡片，请查看报错截图。",
  FANQIE_CHOICE_CONTROL_UNVERIFIED: "官网的音乐类型、歌曲属性或 AI 选项需要核对。",
  FANQIE_UPLOAD_CONTROL_UNVERIFIED: "找不到当前歌曲的文件上传入口，请查看报错截图。",
  FANQIE_FILE_CHOOSER_TIMEOUT: "点击上传入口后未打开文件选择器，请查看报错截图。",
  FANQIE_FILE_CHOOSER_SCOPE_CHANGED: "文件选择器与当前歌曲或上传字段不匹配，请查看报错截图。",
  FANQIE_FILE_TRANSFER_FAILED: "浏览器未能载入本地文件，请查看该歌曲的执行日志。",
  FANQIE_UPLOAD_READBACK_REQUIRED: "上传失败或回执与选中的文件不符，请查看报错截图。",
  FANQIE_UPLOAD_READBACK_TIMEOUT: "等待上传确认超时，请查看该歌曲的执行日志。",
  FANQIE_UPLOAD_RETRIES_EXHAUSTED: "歌曲或歌词上传失败，自动重试 3 次仍未成功；该歌曲已暂停，请检查文件和番茄页面。",
  FANQIE_UPLOAD_RETRY_CONTROL_UNVERIFIED: "上传失败后未能核对唯一的重试按钮，已暂停该歌曲，请查看番茄页面和执行日志。",
  FANQIE_COVER_UPLOAD_FAILED: "官网报告封面上传失败，请查看报错截图。",
  FANQIE_COVER_UPLOAD_RETRIES_EXHAUSTED: "封面裁剪或上传超时/失败，自动关闭裁剪框并重传 3 次仍未成功；该歌曲已暂停，请查看执行日志和番茄页面。",
  FANQIE_COVER_RETRY_CONTROL_UNVERIFIED: "封面上传失败后未能核对“重新上传”按钮，已暂停该歌曲，请查看执行日志和截图。",
  FANQIE_COVER_CROP_CLOSE_UNVERIFIED: "封面裁剪等待超时，但未能核对裁剪框的关闭按钮；已暂停该歌曲，请检查页面和执行日志。",
  FANQIE_COVER_READBACK_REQUIRED: "未能核对歌曲封面预览，请查看执行日志中的歌名、歌曲序号和截图。",
  FANQIE_COPYRIGHT_PROOF_CONTROL_UNVERIFIED: "官网未显示可核对的版权证明上传控件。",
  FANQIE_COPYRIGHT_PROOF_READBACK_REQUIRED: "官网未返回版权证明的上传确认。",
  FANQIE_UPLOAD_CONFIRMATION_UNVERIFIED: "未找到官网确认上传按钮，请核对上传表单。",
  FANQIE_DIRECTORY_FIELD_VALIDATION: "番茄歌曲表单校验失败，请在执行日志中查看歌曲序号、字段和截图。",
  FANQIE_LYRICS_CONTENT_REJECTED: "番茄提示这首歌的歌词内容不符合规范；执行日志已记录歌名和序号。请用修订后的真实歌词替换歌词附件，再重新核对。",
  FANQIE_LYRICS_CONTENT_REJECTED_UNMAPPED: "番茄提示歌词内容不符合规范，但未能唯一匹配歌曲；已暂停上传，请查看执行日志和页面提示。",
  FANQIE_SUBMISSION_REJECTION_UNMAPPED: "番茄提示作品信息提交失败，但歌名无法唯一匹配到本批歌曲；已暂停并保留页面，请查看执行日志。",
  FANQIE_SUBMISSION_REJECTION_RETRIES_EXHAUSTED: "番茄连续拒绝了多首作品，自动剔除和复核已达到 7 次上限；已暂停并保留页面，请人工检查剩余歌曲。",
  FANQIE_ALL_SONGS_REJECTED: "本批歌曲都被番茄拒绝，未进入签约或归档；已回收拒绝歌曲的本地音频、歌词和封面。",
  FANQIE_SUBMISSION_VALIDATION_REJECTED: "番茄拒绝了这首作品；对应的本地音频、歌词和封面已移入系统回收站。",
  FANQIE_REJECTED_MATERIALS_CLEANUP_FAILED: "番茄已拒绝这首作品，但本地素材未能全部安全移入回收站；批次已暂停，请查看执行日志后处理。",
  FANQIE_DIRECTORY_REPAIR_LIMIT: "这首歌重试后仍有字段报错，请查看执行日志中的歌曲序号和截图。",
  FANQIE_DIRECTORY_DELETE_UNVERIFIED: "未能核对出错歌曲卡片的删除入口，请查看截图。",
  FANQIE_UPLOAD_PAGE_ERROR: "番茄上传页面报错，请在执行日志中查看截图。",
  FANQIE_AUTHORIZATION_STEP_UNVERIFIED: "确认上传后，官网未进入可核对的签约步骤。",
  FANQIE_ARCHIVE_MARKER_UNVERIFIED: "官网归档标记未出现；本首歌曲尚未归档，可在核对后重试。",
  FANQIE_SAVED_WORK_READBACK_REQUIRED: "官网回执未读全，请先核对本批作品和上传窗口。",
};

export type FanqieDownloadSong = {
  id: string;
  folder: string;
  audioName: string;
  title: string;
  singer: string;
  release?: FanqieDirectoryRelease;
  issue?: string;
};

export type FanqieDownloadBatchItem = FanqieDownloadSong & {
  state: "queued" | "uploading" | "uploaded" | "skipped" | "needs_review" | "failed";
  archiveObserved?: true;
  workId?: string;
  officialStatus?: string;
  round?: number;
};

export type FanqieSignatureStage = "manual_confirmation" | "generating" | "open_signing_page" | "open_existing_contract" | "verify_generated_contract" | "complete_signing";

export type FanqieDownloadBatch = {
  id: string;
  state: "uploading" | "awaiting_signature" | "complete" | "needs_review";
  items: FanqieDownloadBatchItem[];
  issue?: string;
  preferences?: FanqieDirectoryPreferences;
  round?: number;
  remaining?: number;
  hasDiagnostics?: boolean;
  cleanupPending?: true;
  signatureStage?: FanqieSignatureStage;
  prepareContracts?: true;
};

export type FanqieDownloadPreview = {
  fingerprint: string;
  configurationRequired: boolean;
  limit: number;
  signContract?: boolean;
  items: FanqieDownloadSong[];
  batch: FanqieDownloadBatch | null;
  rootIssue?: string;
  hasDiagnostics?: boolean;
};

export function isFanqieDownloadActive(batch?: FanqieDownloadBatch | null) {
  return batch?.state === "uploading" || (batch?.state === "awaiting_signature" && !!batch.signatureStage && !batch.issue);
}
