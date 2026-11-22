import assert from "node:assert/strict";

export async function scrollWithPinnedClose(content, close) {
  const anchor = await content.elementHandle();
  const positions = await close.evaluate((button, anchor) => {
    let scrollArea = anchor.parentElement;
    while (scrollArea && scrollArea !== document.body &&
      (!["auto", "scroll"].includes(getComputedStyle(scrollArea).overflowY) || scrollArea.scrollHeight <= scrollArea.clientHeight)) {
      scrollArea = scrollArea.parentElement;
    }
    if (!scrollArea || scrollArea === document.body) return [];
    const end = scrollArea.scrollHeight - scrollArea.clientHeight;
    return [0, end / 2, end].map(top => {
      scrollArea.scrollTop = top;
      const rect = button.getBoundingClientRect();
      const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
      return { x, y, top: scrollArea.scrollTop, hit: button.contains(document.elementFromPoint(x, y)) };
    });
  }, anchor);
  assert.ok(positions.at(-1)?.top > 16, "panel content can scroll");
  for (const position of positions) {
    assert.ok(Math.abs(position.y - positions[0].y) <= 1 && Math.abs(position.x - positions[0].x) <= 1,
      "the close button stays in place while scrolling");
    assert.ok(position.hit, "the close button stays reachable by the pointer");
  }
  return positions.at(-1);
}
