const open = require("./mock.cjs");
(async () => {
  const w = Number(process.argv[2] || 360);
  const tag = process.argv[3] || "";
  const { browser, page, BASE } = await open({ width: w });
  await page.goto(BASE + "/#/smack");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `list${tag}_${w}.png`, fullPage: true });
  await page.goto(BASE + "/#/smack/" + encodeURIComponent("마을모금함"));
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `arena${tag}_${w}.png`, fullPage: true });
  const st = page.locator(".smk-stage");
  const b = await st.boundingBox();
  for (let i = 0; i < 12; i++) { await page.mouse.click(b.x + b.width / 2 + (i % 3) * 10, b.y + b.height * 0.5); await page.waitForTimeout(90); }
  await page.waitForTimeout(120);
  await page.screenshot({ path: `arena${tag}_hit_${w}.png`, fullPage: true });
  await browser.close();
})();
