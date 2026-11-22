export async function openCreationWork(page, workId) {
  await page.getByRole("navigation").getByRole("button", { name: "创作中心", exact: true }).click();
  const works = page.getByRole("region", { name: "作品列表", exact: true });
  const rows = workId ? works.locator(`[data-work-id=${JSON.stringify(workId)}]`) : works;
  await rows.locator("button.creation-work-row").first().click();
  const detail = page.getByRole("region", { name: "作品详情", exact: true });
  const workDetails = detail.getByRole("button", { name: "作品资料", exact: true });
  if (await workDetails.isVisible()) await workDetails.click();
  return detail;
}
