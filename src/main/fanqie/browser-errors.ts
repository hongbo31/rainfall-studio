/** Playwright emits this when a tab or browser closes while an operation is pending. */
export function isFanqieBrowserPageClosed(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /(?:target page, context or browser|page|context|browser)\s+(?:has been\s+|was\s+)?closed/i.test(message)
    || /target closed/i.test(message);
}

/** Turn Chromium/Playwright navigation failures into stable, actionable codes. */
export function fanqieBrowserFailureCode(error: unknown): string {
  if (isFanqieBrowserPageClosed(error)) return 'FANQIE_BROWSER_PAGE_CLOSED';
  if (!(error instanceof Error)) return 'FANQIE_BROWSER_OPERATION_FAILED';
  if (error.name === 'TimeoutError') {
    const message=error.cause instanceof Error?`${error.message}; ${error.cause.message}`:error.message;
    if (/\b(?:page|frame)\.(?:goto|waitForNavigation|waitForURL|waitForLoadState)\b/u.test(message))
      return 'FANQIE_BROWSER_NAVIGATION_TIMEOUT';
    if (/\b(?:page\.)?waitFor(?:Response|Request)\b/u.test(message))
      return 'FANQIE_BROWSER_RESPONSE_TIMEOUT';
    if (/\b(?:locator|frameLocator|page\.getBy\w+|getBy\w+)\b/u.test(message))
      return 'FANQIE_BROWSER_LOCATOR_TIMEOUT';
    return 'FANQIE_BROWSER_TIMEOUT';
  }
  if (/strict mode violation/.test(error.message)) return 'FANQIE_CONTROL_AMBIGUOUS';

  const message = error.cause instanceof Error ? `${error.message}; ${error.cause.message}` : error.message;
  const browserCode = /\bnet::(ERR_[A-Z0-9_]+)\b/u.exec(message)?.[1];
  switch (browserCode) {
    case 'ERR_HTTP_RESPONSE_CODE_FAILURE': return 'FANQIE_BROWSER_HTTP_RESPONSE_FAILED';
    case 'ERR_NETWORK_CHANGED': return 'FANQIE_BROWSER_NETWORK_CHANGED';
    case 'ERR_INTERNET_DISCONNECTED':
    case 'ERR_NETWORK_IO_SUSPENDED': return 'FANQIE_BROWSER_NETWORK_DISCONNECTED';
    case 'ERR_NAME_NOT_RESOLVED': return 'FANQIE_BROWSER_DNS_FAILED';
    case 'ERR_CERT_AUTHORITY_INVALID':
    case 'ERR_CERT_COMMON_NAME_INVALID':
    case 'ERR_CERT_DATE_INVALID':
    case 'ERR_SSL_PROTOCOL_ERROR': return 'FANQIE_BROWSER_CERTIFICATE_FAILED';
    case 'ERR_PROXY_CONNECTION_FAILED':
    case 'ERR_TUNNEL_CONNECTION_FAILED': return 'FANQIE_BROWSER_PROXY_FAILED';
    case 'ERR_ABORTED': return 'FANQIE_BROWSER_NAVIGATION_ABORTED';
    case 'ERR_CONNECTION_RESET':
    case 'ERR_CONNECTION_CLOSED':
    case 'ERR_CONNECTION_TIMED_OUT':
    case 'ERR_TIMED_OUT': return 'FANQIE_BROWSER_NETWORK_FAILED';
    default: return 'FANQIE_BROWSER_OPERATION_FAILED';
  }
}
