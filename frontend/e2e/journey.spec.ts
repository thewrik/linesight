import { expect, test, type Page } from "@playwright/test";

// Open gates one at a time, waiting for each to render as open before the next.
async function passAll(page: Page) {
  await expect(page.locator(".gate.k-verdict")).toHaveCount(1); // replay loaded
  const total = await page.locator(".trail > .gate").count();
  for (let i = 0; i < total; i++) {
    const gate = page.getByTestId(`gate-${i}`);
    if (/\bopen\b/.test((await gate.getAttribute("class")) ?? "")) continue;
    await expect(gate).toHaveClass(/ready/);
    await gate.getByTestId("hold").focus();
    await page.keyboard.press("Enter");
    await expect(gate).toHaveClass(/open/);
  }
}

test("Demo A journey: gates open in order and the tree converges", async ({ page }) => {
  await page.goto("/#/journey/demo-a-line-speed");
  await expect(page.getByTestId("gate-1")).toHaveClass(/ready/);
  await expect(page.getByTestId("gate-2")).toHaveClass(/locked/);
  // press-and-hold opens a gate
  // press-and-hold: a short press does nothing, a long press opens the gate
  const hold = page.getByTestId("hold");
  await hold.dispatchEvent("pointerdown", { pointerType: "touch" });
  await page.waitForTimeout(150);
  await hold.dispatchEvent("pointerup", { pointerType: "touch" });
  await expect(page.getByTestId("gate-1")).toHaveClass(/ready/);
  await hold.dispatchEvent("pointerdown", { pointerType: "touch" });
  await page.waitForTimeout(900);
  await hold.dispatchEvent("pointerup", { pointerType: "touch" });
  await expect(page.getByTestId("gate-1")).toHaveClass(/open/);
  await expect(page.getByTestId("gate-1")).toContainText("usable");
  await passAll(page);
  await expect(page.locator(".verdict-stamp")).toContainText("Known fix");
  await expect(page.locator(".t-node.leaf.lit")).toHaveCount(1);
  await expect(page.locator(".t-node.leaf.lit")).toContainText("bursts");
});

test("lenses change what a gate says", async ({ page }) => {
  await page.goto("/#/journey/demo-a-line-speed");
  await page.getByTestId("open-all").click();
  await page.getByTestId("lens-engineer").click();
  await expect(page.locator(".gate").nth(1)).toContainText("stream.production");
  await expect(page.locator(".t-leaf").filter({ hasText: "H-BURST" })).toHaveCount(1);
  await page.getByTestId("lens-lead").click();
  await expect(page.locator(".k-verdict")).toContainText("Decision ledger");
  await expect(page.locator(".k-verdict")).toContainText("needless camera shipment");
  await page.getByTestId("lens-story").click();
  await expect(page.locator(".k-verdict")).toContainText("Nobody shipped a camera");
});

test("Demo C journey ends in a handoff, not a guess", async ({ page }) => {
  await page.goto("/#/journey/demo-c-heartbeat");
  await passAll(page);
  await expect(page.locator(".verdict-stamp")).toContainText("Hand to engineering");
  await page.getByTestId("lens-engineer").click();
  await expect(page.locator(".k-verdict")).toContainText("Reproduction request");
});

test("journey deep-links into the console at the same step", async ({ page }) => {
  await page.goto("/#/journey/demo-b-replacement");
  await passAll(page);
  await page.getByRole("link", { name: /engineering console at this point/ }).click();
  await expect(page.getByTestId("disposition")).toContainText("resolved — verified");
});

test("journey has no horizontal page scroll", async ({ page }) => {
  await page.goto("/#/journey/demo-a-line-speed");
  await page.getByTestId("open-all").click();
  await page.waitForTimeout(400);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
