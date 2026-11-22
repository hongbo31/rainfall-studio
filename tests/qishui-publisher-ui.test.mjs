import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { chromium, expect } from "@playwright/test";
import { build } from "esbuild";
import { launchHeadlessChromium } from "../scripts/lib/headless-chromium.mjs";

test("the plan publisher scopes the current contract and requires user confirmation to record submission", async t => {
  const plan = {
    runId: "fixture-run", accountId: "qishui-account", workId: "fixture-work", variant: "B",
    credits: { performer: "计划表演者", composer: "计划曲作者", lyricist: "计划词作者" },
  };
  const data = {
    mode: "production", artists: [],
    accounts: [{ id: plan.accountId, provider: "qishui", name: "计划汽水账号" }, { id: "other", provider: "qishui", name: "其他账号" }],
    works: [{ id: plan.workId, title: "计划作品", alternateTitle: "计划作品 B" }, { id: "other", title: "其他作品" }],
  };
  const { outputFiles } = await build({
    stdin: { resolveDir: path.resolve(import.meta.dirname, ".."), loader: "tsx", contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { Context } from './src/renderer/context';
      import QishuiPublisher from './src/renderer/components/QishuiPublisher';
      const root = createRoot(document.getElementById('root'));
      const value = { data: ${JSON.stringify(data)}, call: window.fixtureCall };
      window.fixturePlan = plan => root.render(<Context.Provider value={value}><QishuiPublisher plan={plan} /></Context.Provider>);
      window.fixturePlan(${JSON.stringify(plan)});
    ` },
    bundle: true, write: false,
  });
  const calls = [];
  const contract = { stage: "contract_review", contractText: "计划作品发行合同", contractHash: "a".repeat(64), reviewToken: "review-token" };
  let storedStage = null;
  const browser = await launchHeadlessChromium(chromium);
  t.after(() => browser.close());
  const page = await browser.newPage();
  page.setDefaultTimeout(2000);
  await page.exposeFunction("fixtureCall", (method, input) => {
    calls.push({ method, input });
    switch (method) {
      case "publish.qishui.status": return storedStage;
      case "publish.qishui.fill": return storedStage = { stage: "form_ready" };
      case "publish.qishui.authorization": return storedStage = { stage: "authorization" };
      case "publish.qishui.contract": return contract;
      case "publish.qishui.accept": return storedStage = { stage: "verification_required" };
      case "planCenter.qishuiSubmitted": return { recorded: true };
      default: throw Error(`Unexpected fixture request ${method}`);
    }
  });
  const url = "http://127.0.0.1/";
  await page.route("**/*", route => route.request().url() === url
    ? route.fulfill({ contentType: "text/html; charset=utf-8", body: '<html lang="zh-CN"><div id="root"></div></html>' })
    : route.abort());
  await page.goto(url);
  await page.addScriptTag({ content: outputFiles[0].text });
  const disclosure = page.locator("summary");
  const open = async () => {
    if (await disclosure.evaluate(el => !el.parentElement.open)) await disclosure.click();
  };
  await open();
  await expect(page.getByText("计划汽水账号", { exact: true })).toBeVisible();
  await expect(page.getByText("计划作品 B", { exact: true })).toBeVisible();
  await expect(page.getByText("其他账号", { exact: true })).toHaveCount(0);
  await expect(page.getByText("其他作品", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("表演者", { exact: true })).toHaveValue("计划表演者");
  await expect(page.getByLabel("曲作者", { exact: true })).toHaveValue("计划曲作者");
  await expect(page.getByLabel("词作者", { exact: true })).toHaveValue("计划词作者");
  assert.equal(await page.getByLabel("表演者", { exact: true }).isEditable(), false);
  await expect(page.getByRole("checkbox", { name: "AI 创作", exact: true })).toHaveCount(0);

  const upload = page.getByRole("button", { name: "填写并上传到官网" });
  const record = page.getByRole("button", { name: "记录官网已提交" });
  await expect(record).toHaveCount(0);
  await page.getByRole("button", { name: "读取任务记录" }).click();
  await upload.click();
  await page.getByRole("button", { name: "进入授权作品并选择模式" }).click();
  const readContract = page.getByRole("button", { name: "读取当次合同" });
  await readContract.click();
  await expect(page.getByText(contract.contractText, { exact: true })).toBeVisible();
  await expect(record).toHaveCount(0);
  const accept = page.getByRole("button", { name: "接受本次合同并等待验证码" });
  await expect(accept).toBeDisabled();
  await page.getByRole("checkbox", { name: /我已核对本次作品/ }).check();
  await accept.click();
  await expect(record).toBeDisabled();
  await page.getByRole("checkbox", { name: /我已在官网完成验证码验证并提交/ }).check();
  await record.click();
  await expect(page.getByRole("status")).toHaveText("用户已记录官网提交");
  await expect(upload).toHaveCount(0);

  const scope = { accountId: "qishui-account", workId: "fixture-work", planRunId: "fixture-run" };
  assert.deepEqual(calls, [
    { method: "publish.qishui.status", input: scope },
    { method: "publish.qishui.fill", input: { ...scope, variant: "B", performer: "计划表演者", composer: "计划曲作者", lyricist: "计划词作者", ai: true, aiTool: "其他" } },
    { method: "publish.qishui.authorization", input: { ...scope, mode: "exclusive_agency" } },
    { method: "publish.qishui.contract", input: scope },
    { method: "publish.qishui.accept", input: { ...scope, contractHash: contract.contractHash, reviewToken: contract.reviewToken, confirmed: true } },
    { method: "planCenter.qishuiSubmitted", input: { accountId: "qishui-account", workId: "fixture-work", runId: "fixture-run", confirmed: true } },
  ]);

  await page.evaluate(plan => window.fixturePlan({ ...plan, runId: "next-run" }), plan);
  await expect(page.getByRole("status")).toHaveText("待处理");
  await open();
  await expect(upload).toBeVisible();
  await expect(record).toHaveCount(0);
  await page.evaluate(plan => window.fixturePlan({ ...plan, runId: "next-run", submitted: true }), plan);
  await expect(page.getByRole("status")).toHaveText("用户已记录官网提交");
  await expect(upload).toHaveCount(0);
});
