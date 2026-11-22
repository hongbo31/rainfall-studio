import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
await build({
  entryPoints: ["tests/fixtures/ui-copy.tsx"],
  outfile: "output/ui-consistency/copy-ui.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
});
const { renderPage, renderTrack, helpNoteInteraction } = createRequire(import.meta.url)(
  "../output/ui-consistency/copy-ui.cjs",
);

test("work details remove the coaching card and preserve concrete audio, import and publication actions",()=>{
  const html=renderTrack();
  for(const old of ['work-next-step','这首作品，下一步','试听并核对歌词与音频','当前发布用音频：A。'])assert(!html.includes(old),old);
  for(const action of ['保存版本','试听 A','试听 B','导入音频 A','导入音频 B','准备发布材料','发布版本 A'])assert(html.includes(action),action);
  assert(html.includes('A/B 试听说明'));
  assert(html.includes('授权依据'));
  assert(!html.includes('来源说明不替代平台权利核验'));
});

test("page names are concise and the overview keeps series management", () => {
  for (const [page, title] of Object.entries({
    overview: "总览",
    insights: "数据看板",
    cover: "封面工作室",
  })) {
    assert.ok(renderPage(page).includes(`<h1>${title}</h1>`), page);
  }
  const home = renderPage("overview");
  assert.ok(home.includes("用户写下的系列故事"));
  for (const label of ["管理系列", "按当前选择顺序建立系列", "查看全部"])
    assert.ok(home.includes(label), label);
  assert.ok(
    !/STORIES THAT BECOME SONGS|EVERY STORY HAS A SOUND|YOUR MUSIC, YOUR STORY/.test(
      home,
    ),
  );
});
test("optional CSV instructions start closed", () => {
  assert.match(
    renderPage("insights"),
    /<details class="panel"><summary>CSV 导入格式<\/summary>/,
  );
  assert.equal((renderPage('insights').match(/请选择统计日期/g)||[]).length,1);
});
test("help labels use a native focusable button with tooltip association and Escape dismissal", () => {
  const result = helpNoteInteraction();
  assert.deepEqual(result.initial, {
    tag: "button",
    type: "button",
    label: "收件方式",
    describedBy: "help-test",
    tooltipId: "help-test",
    role: "tooltip",
  });
  assert.equal(result.escaped, true);
  assert.equal(result.refocused, true);
  assert.equal(result.hovered, true);
});
