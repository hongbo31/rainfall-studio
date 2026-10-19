type Report = {
  id: string;
  platform: string;
  date: string;
  plays?: number | null;
  favorites?: number | null;
  comments?: number | null;
  [key: string]: unknown;
};
type Scope = { platform: string; date: string; basisConfirmed?: boolean };
const fields = ["plays", "favorites", "comments"] as const;
function selected(rows: Report[], scope: Scope) {
  return rows.filter(
    (r) =>
      (!scope.platform || r.platform === scope.platform) &&
      (!scope.date || r.date === scope.date),
  );
}
export function reportScopeKey(rows: Report[], scope: Scope) {
  return JSON.stringify([
    scope.platform,
    scope.date,
    selected(rows, scope)
      .map((r) => [
        r.id,
        r.fileHash,
        r.importedAt,
        r.timezone,
        r.account,
        r.work,
        ...fields.map((f) => r[f]),
      ])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  ]);
}
export function summarizeReports(rows: Report[], scope: Scope) {
  const filtered = selected(rows, scope);
  const status = !scope.date
    ? "choose_date"
    : !scope.platform
      ? "choose_platform"
      : !filtered.length
        ? "no_reports"
        : !scope.basisConfirmed
          ? "confirm_basis"
          : "ready";
  const metric = (field: (typeof fields)[number]) => {
    const values = filtered
      .map((r) => r[field])
      .filter(
        (v): v is number =>
          typeof v === "number" && Number.isSafeInteger(v) && v >= 0,
      );
    const sum = values.reduce((n, v) => n + v, 0),
      overflow = !Number.isSafeInteger(sum);
    return {
      value: status === "ready" && values.length && !overflow ? sum : null,
      known: values.length,
      total: filtered.length,
      overflow,
    };
  };
  return {
    rows: filtered,
    status,
    metrics: {
      plays: metric("plays"),
      favorites: metric("favorites"),
      comments: metric("comments"),
    },
  };
}
