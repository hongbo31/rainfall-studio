export function cleanLyricText(raw: string) {
  const removed: { line: number; text: string }[] = [],
    warnings: string[] = [];
  const section =
    "(?:verse(?:\\s+\\d+)?|(?:final\\s+)?chorus(?:\\s+\\d+)?|pre[- ]?chorus(?:\\s+\\d+)?|bridge|intro|outro|instrumental|interlude|solo|brief\\s+instrumental\\s+pause|主歌(?:\\s*\\d+)?|副歌(?:\\s*\\d+)?|预副歌|桥段|前奏|尾奏|间奏)";
  const direction =
    "(?:male|female|duet|soft duet|piano only|call and response|soaring|full band|男声|女声|对唱|合唱)";
  const known = new RegExp(
    "^\\s*\\[(?:" +
      section +
      "(?:\\s*-\\s*" +
      direction +
      "(?:\\s*,\\s*" +
      direction +
      ")*)?|" +
      direction +
      ")\\]\\s*$",
    "i",
  );
  const cleaned = raw
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((text, i) => {
      if (known.test(text)) {
        removed.push({ line: i + 1, text });
        return false;
      }
      if (/[\[\]]/.test(text))
        warnings.push("第" + (i + 1) + "行含保留的括号内容，请复核");
      return true;
    })
    .join("\n");
  return { raw, cleaned, removed, warnings };
}
