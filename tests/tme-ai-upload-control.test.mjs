import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
const dir = path.resolve("output/author-defaults-qq");
fs.mkdirSync(dir, { recursive: true });
// Extract only the production pure resolver; never execute the UIA host entrypoint.
const ps = String.raw`$ErrorActionPreference='Stop'
[Console]::InputEncoding=[Text.UTF8Encoding]::new();[Console]::OutputEncoding=[Text.UTF8Encoding]::new()
$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PWD 'src/main/tme/ai-uia-host.ps1'),[ref]$null,[ref]$null)
$f=$ast.Find({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Resolve-AudioUploadControl'},$true)
if(-not $f){throw 'UPLOAD_CONTROL_RESOLVER_MISSING'}
Invoke-Expression $f.Extent.Text
$rows=[Console]::In.ReadToEnd()|ConvertFrom-Json
$nodes=@($rows|ForEach-Object {[pscustomobject]@{Current=[pscustomobject]@{ControlType=[pscustomobject]@{ProgrammaticName=$_.type};Name=$_.name;IsEnabled=$_.enabled;IsOffscreen=$_.offscreen}}})
try{$chosen=Resolve-AudioUploadControl $nodes;@{ok=$true;name=$chosen.Current.Name;type=$chosen.Current.ControlType.ProgrammaticName}|ConvertTo-Json -Compress}catch{@{ok=$false;error=$_.Exception.Message}|ConvertTo-Json -Compress}
`;
const script = path.join(dir, "test-upload-resolver.ps1");
fs.writeFileSync(script, ps);
function resolve(rows) {
  const r = spawnSync(
    "pwsh.exe",
    ["-NoProfile", "-NonInteractive", "-File", script],
    { input: JSON.stringify(rows), encoding: "utf8", windowsHide: true },
  );
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout.replace(/^\uFEFF/, ""));
}
const row = (type, name, extra = {}) => ({
  type: "ControlType." + type,
  name,
  enabled: true,
  offscreen: false,
  ...extra,
});
test("saved current intake resolves its exact native file button, not decorative upload text", () => {
  const rows = [
    row("Text", "上传AI歌曲"),
    row("Text", " 点击 / 将歌曲拖动到此处上传"),
    row("Button", "选择文件: 未选择任何文件"),
  ];
  assert.deepEqual(resolve(rows), {
    ok: true,
    name: "选择文件: 未选择任何文件",
    type: "ControlType.Button",
  });
});
test("legacy exact upload text remains supported and ambiguous/disabled/hidden controls fail closed", () => {
  const legacy = row("Text", "点击此处上传");
  assert.equal(resolve([legacy]).ok, true);
  for (const rows of [
    [legacy, { ...legacy }],
    [row("Button", "选择文件: 未选择任何文件", { enabled: false })],
    [row("Button", "选择文件: 未选择任何文件", { offscreen: true })],
    [row("Text", "上传AI歌曲")],
  ])
    assert.equal(resolve(rows).ok, false);
});
