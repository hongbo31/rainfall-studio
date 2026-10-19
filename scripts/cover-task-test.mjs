import { _electron as electron } from "@playwright/test";
import ep from "electron";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
const packaged = process.argv.includes("--packaged"),
  root = path.resolve("output/cover-edit-" + Date.now()),
  file = path.join(root, "cover-task.txt");
let app;
try {
  app = await electron.launch({
    executablePath: packaged
      ? path.resolve("out/RainfallStudio-win32-x64/RainfallStudio.exe")
      : ep,
    args: packaged ? [] : ["."],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: undefined,
      RAINFALL_DATA_ROOT: root,
      RAINFALL_MODE: "simulation",
    },
  });
  const p = await app.firstWindow();
  await p.getByRole("button", { name: "封面工作室", exact: true }).click();
  await p
    .getByRole("button", { name: "生成封面提示词 · 本地", exact: true })
    .click();
  const area = p.getByLabel("封面任务文本");
  await area.fill((await area.inputValue()) + "\nQA编辑文字必须原样保留");
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
  }, file);
  await p
    .getByRole("button", { name: "导出 Codex 任务 ↗", exact: true })
    .click();
  await p.evaluate(() => window.rainfall.call("snapshot"));
  assert.ok(fs.readFileSync(file, "utf8").endsWith("QA编辑文字必须原样保留"));
  await p.getByRole("button", { name: "总览", exact: true }).click();
  await p.getByRole("button", { name: "封面工作室", exact: true }).click();
  assert.ok(
    (await p.getByLabel("封面任务文本").inputValue()).endsWith(
      "QA编辑文字必须原样保留",
    ),
  );
  console.log(
    JSON.stringify({ packaged, coverEditedExportAndPersistence: "passed" }),
  );
} finally {
  await app?.close();
}
