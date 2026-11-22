import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { chromium, expect } from "@playwright/test";
import { build } from "esbuild";
import sharp from "sharp";
import { launchHeadlessChromium } from "../scripts/lib/headless-chromium.mjs";

let rendererBuild;

async function openRemote(t, handle) {
  const renderer = await (rendererBuild ??= build({
    absWorkingDir: path.resolve(import.meta.dirname, ".."),
    entryPoints: ["src/renderer/main.tsx"],
    bundle: true,
    outdir: "build",
    write: false,
  }));
  const browser = await launchHeadlessChromium(chromium);
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1320, height: 950 } });
  page.setDefaultTimeout(6000);
  await page.clock.install();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));

  const origin = "http://127.0.0.1";
  const key = "a".repeat(64);
  await page.route(`${origin}/**`, async route => {
    const request = route.request();
    if (request.url() === origin + "/") return route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html lang="zh-CN"><meta name="rainfall-browser-studio" content="1"><div id="root"></div></html>',
    });
    if (request.url() !== origin + "/rpc" || request.headers().authorization !== `Bearer ${key}`) return route.abort();
    const { channel, args: [action, input] } = request.postDataJSON();
    let value;
    if (channel === "rainfall:call" && action === "snapshot") value = {
      mode: "production", works: [], accounts: [], artists: [], series: [], exceptions: [],
      resources: { finished: 0, cost: { available: 0, reserved: 0 }, candidate: { available: 0, spent: 0, reserved: 0 } },
    };
    else if (channel === "rainfall:call" && action === "runtime") value = {};
    else value = handle(channel, action, input);
    if (value === undefined) return route.fulfill({ json: { ok: false, error: { code: "UNEXPECTED_FIXTURE_CALL", message: channel } } });
    return route.fulfill({ json: { ok: true, value } });
  });
  await page.goto(`${origin}/#${key}.${"c".repeat(64)}`);
  await page.addStyleTag({ content: renderer.outputFiles.find(file => file.path.endsWith(".css")).text });
  await page.addScriptTag({ content: renderer.outputFiles.find(file => file.path.endsWith(".js")).text });

  const navigation = page.getByRole("navigation");
  const remotePage = navigation.getByRole("button", { name: "远控", exact: true });
  await expect(remotePage).toBeVisible();
  await expect(navigation.getByRole("button", { name: "短信接收", exact: true })).toHaveCount(0);
  await remotePage.click();
  await expect(page.getByRole("heading", { name: "远控", exact: true })).toBeVisible();
  return { page, navigation, errors };
}

test("远控页面提供扫码下载、手机配对与解除配对", async t => {
  const address = "192.168.1.10";
  const endpoint = `https://${address}:39215/#${"b".repeat(64)}`;
  const apkDownloadUrl = `http://${address}:39216/Rainfall-Remote-Assist.apk`;
  const deviceId = "65c841eb-9944-4cb7-9e0b-000000000011";
  const earlierId = "65c841eb-9944-4cb7-9e0b-000000000012";
  const calls = [];
  let connectionStatusCalls = 0;
  let earlierLastContact = null;
  const connection = {
    running: false,
    interfaces: [{ address: "10.0.0.2", label: "以太网" }, { address, label: "Wi-Fi" }],
    endpoint: null, apkDownloadUrl: null, pairExpiresAt: null, devices: [],
  };
  const { page, navigation, errors } = await openRemote(t, (channel, action, input) => {
    if (channel === "rainfall:remote-assist-connection") {
      if (action === "status") connectionStatusCalls++;
      else calls.push({ action, input });
      if (action === "start") Object.assign(connection, { running: true, endpoint, apkDownloadUrl });
      if (action === "pair") connection.pairExpiresAt = Date.now() + 300_000;
      if (action === "cancelPairing") connection.pairExpiresAt = null;
      if (action === "removeDevice") connection.devices = connection.devices.filter(device => device.id !== input.id);
      if (action === "stop") Object.assign(connection, { running: false, endpoint: null, apkDownloadUrl: null, pairExpiresAt: null });
      return connection;
    }
    if (channel === "rainfall:remote-assist") return {
      running: connection.running,
      devices: connection.devices.map(device => ({ ...device, lastRemoteContactAt: device.id === earlierId ? earlierLastContact : null })),
      session: null,
    };
  });

  const start = page.getByRole("button", { name: "启动连接", exact: true });
  const connect = page.getByRole("button", { name: "请求连接", exact: true });
  const qr = page.getByRole("img", { name: "安卓 APK 下载二维码", exact: true });
  const pairCode = page.getByLabel("配对口令", { exact: true });
  const startPairing = page.getByRole("button", { name: "开始配对", exact: true });
  const cancelPairing = page.getByRole("button", { name: "取消配对", exact: true });
  const phones = page.getByRole("region", { name: "已配对设备", exact: true });
  await expect(page.getByRole("heading", { name: "连接与配对", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: /短信到达记录|业务通知/u })).toHaveCount(0);
  await expect(start).toBeEnabled({ timeout: 2500 });
  await expect(connect).toBeDisabled();
  await expect(qr).toHaveCount(0);
  assert.deepEqual(calls, []);

  await page.getByLabel("连接网卡", { exact: true }).selectOption(address);
  await start.click();
  await expect(page.getByLabel("配对地址", { exact: true })).toHaveValue(endpoint);
  await expect(qr).toBeVisible();
  await expect(qr).toHaveAttribute("src", /^data:image\//u);
  await expect(connect).toBeDisabled();
  assert.deepEqual(calls, [{ action: "start", input: { address } }]);

  await pairCode.fill("4820");
  await expect(page.getByText("4/6 位", { exact: true })).toBeVisible();
  await startPairing.click();
  const codeError = page.getByRole("alert").filter({ hasText: "请输入 6 位数字口令。" });
  await expect(codeError).toBeVisible();
  await expect(pairCode).toBeFocused();
  assert.equal(calls.length, 1);
  await pairCode.fill("４８２０３７");
  await expect(pairCode).toHaveValue("482037");
  await expect(codeError).toHaveCount(0);
  await startPairing.click();
  await expect(cancelPairing).toBeVisible();
  assert.deepEqual(calls[1], { action: "pair", input: { code: "482037" } });
  await expect(connect).toBeDisabled();

  await cancelPairing.click();
  await expect(startPairing).toBeEnabled();
  assert.deepEqual(calls[2], { action: "cancelPairing", input: {} });
  await pairCode.fill("482037");
  await startPairing.click();
  await expect(cancelPairing).toBeVisible();

  const pairedAt = Date.now();
  const earlierPairedAt = pairedAt - 300_000;
  connection.pairExpiresAt = null;
  connection.devices = [
    { id: earlierId, name: "创作手机", pairedAt: earlierPairedAt },
    { id: deviceId, name: "创作手机", pairedAt },
  ];
  await expect(page.getByLabel("手机设备", { exact: true })).toHaveValue(deviceId);
  const options = await page.getByLabel("手机设备", { exact: true }).locator("option").allTextContents();
  assert.equal(new Set(options).size, 2);
  earlierLastContact = Date.now();
  await expect(page.getByLabel("手机设备", { exact: true })).toHaveValue(earlierId);
  await expect(connect).toBeEnabled();
  await expect(qr).toBeVisible();

  await expect(phones.getByRole("listitem")).toHaveCount(2);
  await expect(phones.getByText(/监听/u)).toHaveCount(0);
  const earlierPhone = phones.getByRole("listitem").filter({
    has: page.locator(`time[datetime="${new Date(earlierPairedAt).toISOString()}"]`),
  });
  const unpair = earlierPhone.getByRole("button", { name: "解除配对", exact: true });
  await unpair.click();
  await expect(earlierPhone.getByText("解除「创作手机」的配对？", { exact: true })).toBeVisible();
  await earlierPhone.getByRole("button", { name: "取消", exact: true }).click();
  await expect(unpair).toBeVisible();
  assert.equal(calls.length, 4);
  await unpair.click();
  await earlierPhone.getByRole("button", { name: "确认解除", exact: true }).click();
  await expect(earlierPhone).toHaveCount(0);
  await expect(phones.getByRole("listitem")).toHaveCount(1);
  await expect(page.getByLabel("手机设备", { exact: true })).toHaveValue(deviceId);
  assert.deepEqual(calls[4], { action: "removeDevice", input: { id: earlierId } });

  await page.getByRole("button", { name: "停止连接", exact: true }).click();
  await expect(start).toBeEnabled();
  await expect(connect).toBeDisabled();
  await expect(page.getByLabel("配对地址", { exact: true })).toHaveCount(0);
  await expect(qr).toHaveCount(0);
  await expect(phones.getByRole("listitem")).toHaveCount(1);
  assert.deepEqual(calls[5], { action: "stop", input: {} });

  await navigation.getByRole("button", { name: "总览", exact: true }).click();
  await expect(phones).toHaveCount(0);
  const beforeFastForward = connectionStatusCalls;
  await page.clock.fastForward(5000);
  assert.equal(connectionStatusCalls, beforeFastForward);
  assert.deepEqual(errors, []);
});

test("远控在手机确认后显示画面，仅在 Rainfall 会话中接受操作", async t => {
  const jpeg = (await sharp({ create: { width: 100, height: 200, channels: 3, background: "#213a51" } })
    .jpeg().toBuffer()).toString("base64");
  const calls = [];
  const deviceId = "65c841eb-9944-4cb7-9e0b-000000000001";
  const sessionId = "65c841eb-9944-4cb7-9e0b-000000000002";
  const devices = [{ id: deviceId, name: "创作手机", pairedAt: Date.now(), lastRemoteContactAt: null }];
  let session = null;
  let afterSeq;
  let statusCalls = 0;
  const { page, navigation, errors } = await openRemote(t, (channel, action, input) => {
    if (channel === "rainfall:remote-assist-connection") return {
      running: true, interfaces: [], endpoint: null, apkDownloadUrl: null, pairExpiresAt: null,
      devices: [{ id: deviceId, name: devices[0].name, pairedAt: devices[0].pairedAt }],
    };
    if (channel !== "rainfall:remote-assist") return undefined;
    if (action === "status") {
      afterSeq = input.afterSeq;
      statusCalls++;
    } else calls.push({ action, input });
    if (action === "request") session = {
      id: sessionId, deviceId, mode: input.mode, phase: "pending", expiresAt: Date.now() + 60_000, frame: null, phoneContactAt: null,
    };
    if (action === "stop") session = null;
    return {
      running: true, devices,
      session: session && { ...session, frame: session.frame?.seq === input?.afterSeq ? null : session.frame },
    };
  });
  await expect(page.getByLabel("手机设备", { exact: true })).toHaveValue(deviceId);

  const connect = page.getByRole("button", { name: "请求连接", exact: true });
  const disconnect = page.getByRole("button", { name: "断开会话", exact: true });
  const frame = page.getByRole("img", { name: "实时手机画面", exact: true });
  const back = page.getByRole("button", { name: "返回", exact: true });
  await connect.click();
  await expect(page.getByText("等待手机连接", { exact: true })).toBeVisible();
  session.phoneContactAt = Date.now();
  await expect(page.getByText("等待手机确认", { exact: true })).toBeVisible();
  await expect(frame).toHaveCount(0);
  assert.deepEqual(calls[0], { action: "request", input: { deviceId, mode: "rainfall" } });

  Object.assign(session, { phase: "active", frame: { seq: 1, jpeg } });
  await expect(frame).toBeVisible();
  await expect(back).toBeEnabled();
  const screen = await frame.boundingBox();
  await page.mouse.click(screen.x + screen.width * 0.25, screen.y + screen.height * 0.5);
  await expect.poll(() => calls.filter(call => call.action === "input").length).toBe(1);
  const tap = calls[1];
  assert.equal(tap.input.id, sessionId);
  assert.equal(tap.input.command.seq, 1);
  assert.equal(tap.input.command.kind, "tap");
  assert.ok(Math.abs(tap.input.command.x - 0.25) < 0.02);
  assert.ok(Math.abs(tap.input.command.y - 0.5) < 0.02);

  await page.mouse.move(screen.x + screen.width * 0.5, screen.y + screen.height * 0.7);
  await page.mouse.down();
  session.frame = { seq: 2, jpeg };
  await expect.poll(() => afterSeq).toBe(2);
  await page.mouse.move(screen.x + screen.width * 0.5, screen.y + screen.height * 0.2);
  await page.mouse.up();
  await expect.poll(() => calls.at(-1)?.input?.command?.kind).toBe("swipe");
  const swipe = calls.at(-1).input.command;
  assert.equal(swipe.seq, 2);
  assert.ok(Math.abs(swipe.y - 0.7) < 0.02);
  assert.ok(Math.abs(swipe.endY - 0.2) < 0.02);

  await page.clock.fastForward(3500);
  await expect(frame).toHaveCount(0);
  await expect(back).toBeDisabled();
  session.frame = { seq: 3, jpeg };
  await expect(back).toBeEnabled();
  await back.click();
  await expect.poll(() => calls.at(-1)).toEqual({ action: "input", input: { id: sessionId, command: { kind: "back", seq: 3 } } });

  const dock = page.getByRole("region", { name: "手机画面浮窗" });
  const beforeNavigation = calls.length;
  await navigation.getByRole("button", { name: "总览", exact: true }).click();
  await expect(dock.getByRole("img", { name: "实时手机画面" })).toBeVisible();
  assert.equal(calls.length, beforeNavigation);

  session.frame = { seq: 4, jpeg };
  await expect.poll(() => afterSeq).toBe(4);
  const floatingImage = dock.getByRole("img", { name: "实时手机画面" });
  await floatingImage.hover();
  await page.mouse.wheel(0, 140);
  await expect.poll(() => calls.at(-1)?.input?.command).toMatchObject({ kind: "swipe", seq: 4 });
  const scroll = calls.at(-1).input.command;
  assert.ok(scroll.y > scroll.endY);
  await expect(floatingImage).toHaveAttribute("tabindex", "0");
  await floatingImage.press("Backspace");
  await expect.poll(() => calls.at(-1)?.input?.command).toEqual({ kind: "back", seq: 4 });
  await dock.getByRole("button", { name: "打开远控", exact: true }).click();
  await expect(page.getByRole("heading", { name: "远控", exact: true })).toBeVisible();
  await expect(dock).toHaveCount(0);
  await expect(frame).toBeVisible();

  await disconnect.click();
  await expect(connect).toBeEnabled();
  await page.getByLabel("会话方式", { exact: true }).selectOption("view");
  await connect.click();
  await expect(page.getByText("等待手机连接", { exact: true })).toBeVisible();
  session.phoneContactAt = Date.now();
  await expect(page.getByText("等待手机确认", { exact: true })).toBeVisible();
  Object.assign(session, { phase: "active", frame: { seq: 1, jpeg } });
  await expect(frame).toBeVisible();
  await expect(back).toHaveCount(0);
  const callCount = calls.length;
  await frame.click();
  assert.equal(calls.length, callCount);

  await navigation.getByRole("button", { name: "总览", exact: true }).click();
  await expect(dock).toBeVisible();
  await expect(floatingImage).toBeVisible();
  await expect(dock.getByRole("button", { name: "返回", exact: true })).toHaveCount(0);
  await floatingImage.click();
  assert.equal(calls.length, callCount);
  await dock.getByRole("button", { name: "断开会话", exact: true }).click();
  await expect(dock).toHaveCount(0);
  await expect.poll(() => calls.at(-1)).toEqual({ action: "stop", input: { id: sessionId } });

  const idleStatusCalls = statusCalls;
  await page.clock.runFor(1_600);
  assert.equal(statusCalls, idleStatusCalls);
  await navigation.getByRole("button", { name: "远控", exact: true }).click();
  await connect.click();
  await expect(page.getByText("等待手机连接", { exact: true })).toBeVisible();
  Object.assign(session, { phase: "active", frame: { seq: 1, jpeg } });
  await expect(frame).toBeVisible();
  await navigation.getByRole("button", { name: "总览", exact: true }).click();
  await expect(dock).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(dock).toHaveCount(0);
  await expect.poll(() => calls.at(-1)).toEqual({ action: "stop", input: { id: sessionId } });
  assert.deepEqual(errors, []);
});
