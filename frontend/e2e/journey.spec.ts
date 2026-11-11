import { expect, test, type Page } from "@playwright/test";

const card = (page: Page) => page.getByTestId("card");
const stage = (page: Page) => page.getByTestId("stage");

// Run steps one at a time, waiting for each card to render before the next.
async function runAll(page: Page) {
  await expect(card(page)).toBeVisible(); // replay loaded
  const total = await page.locator(".pip").count();
  for (let i = Number(await card(page).getAttribute("data-step")); i < total - 1; i++) {
    await page.getByTestId("hold").focus();
    await page.keyboard.press("Enter");
    await expect(card(page)).toHaveAttribute("data-step", String(i + 1));
  }
}

test("Demo A: the line reacts to each check and ends fixed", async ({ page }) => {
  await page.goto("/#/journey/demo-a-line-speed");
  await expect(card(page)).toHaveAttribute("data-kind", "call");
  await expect(page.getByTestId("pip-1")).toHaveClass(/locked/);
  await expect(stage(page)).toHaveAttribute("data-mode", "production");
  await expect(page.getByTestId("caption")).toContainText("pushed off");
  await expect(page.getByTestId("part-switch")).toHaveAttribute("data-state", "suspect");
  // press-and-hold: a short press does nothing, a long press runs the check
  const hold = page.getByTestId("hold");
  await hold.dispatchEvent("pointerdown", { pointerType: "touch" });
  await page.waitForTimeout(150);
  await hold.dispatchEvent("pointerup", { pointerType: "touch" });
  await expect(card(page)).toHaveAttribute("data-step", "0");
  await hold.dispatchEvent("pointerdown", { pointerType: "touch" });
  await expect(card(page)).toHaveAttribute("data-step", "1");
  await expect(page.getByTestId("caption")).toContainText("36%");
  await expect(card(page)).toContainText("usable");
  await runAll(page);
  await expect(page.locator(".verdict-stamp")).toContainText("Known fix");
  await expect(stage(page)).toHaveAttribute("data-mode", "fixed");
  await expect(stage(page)).toHaveAttribute("data-late", "0.00");
  await expect(page.getByTestId("part-switch")).toHaveAttribute("data-state", "fixed");
  await expect(page.getByTestId("part-cams")).toHaveAttribute("data-state", "cleared");
});

test("test runs and candidate fixes play out on the line", async ({ page }) => {
  await page.goto("/#/journey/demo-a-line-speed");
  await page.getByTestId("open-all").click();
  await page.getByTestId("pip-4").getByRole("button").click();
  await expect(stage(page)).toHaveAttribute("data-mode", "low-speed");
  await expect(stage(page)).toHaveAttribute("data-rate", "4");
  await page.getByTestId("pip-7").getByRole("button").click();
  await expect(stage(page)).toHaveAttribute("data-mode", "single");
  await page.getByTestId("pip-8").getByRole("button").click();
  await expect(card(page)).toHaveAttribute("data-kind", "choose");
  await page.getByTestId("opt-O-PACE-LOW").click();
  await expect(stage(page)).toHaveAttribute("data-late", "1.00");
  await expect(page.getByTestId("caption")).toContainText("misses the gate");
  await page.getByTestId("opt-O-SLOW-LINE").click();
  await expect(stage(page)).toHaveAttribute("data-rate", "7");
  await expect(stage(page)).toHaveAttribute("data-late", "0.00");
  await page.getByTestId("opt-O-PACE-FAIR").click();
  await expect(page.getByTestId("caption")).toContainText("at full speed");
});

test("lenses change depth, not the story", async ({ page }) => {
  await page.goto("/#/journey/demo-a-line-speed");
  await page.getByTestId("open-all").click();
  await page.getByTestId("lens-lead").click();
  await expect(card(page)).toContainText("Decision ledger");
  await expect(card(page)).toContainText("needless camera shipment");
  await expect(page.getByTestId("lead-meter")).toBeVisible();
  await page.getByTestId("lens-story").click();
  await expect(card(page)).toContainText("Nobody shipped a camera");
  await page.getByTestId("part-switch").getByRole("button").click();
  await expect(page.getByTestId("part-switch")).toContainText("Cameras talk over each other in bursts");
  await page.getByTestId("lens-engineer").click();
  await expect(page.getByTestId("part-switch")).toContainText("H-BURST");
});

test("Demo B: the dark camera comes back", async ({ page }) => {
  await page.goto("/#/journey/demo-b-replacement");
  await expect(page.getByTestId("caption")).toContainText("Camera 3 is dark");
  await runAll(page);
  await expect(page.locator(".verdict-stamp")).toContainText("Known fix");
  await expect(page.getByTestId("part-pc")).toHaveAttribute("data-state", "fixed");
  await expect(page.getByTestId("caption")).toContainText("inspecting again");
});

test("Demo C ends in a handoff, not a guess", async ({ page }) => {
  await page.goto("/#/journey/demo-c-heartbeat");
  await runAll(page);
  await expect(page.locator(".verdict-stamp")).toContainText("Hand to engineering");
  await expect(page.getByTestId("part-pc")).toHaveAttribute("data-state", "culprit");
  await page.getByTestId("lens-engineer").click();
  await expect(card(page)).toContainText("Reproduction request");
});

test("journey deep-links into the console at the same step", async ({ page }) => {
  await page.goto("/#/journey/demo-b-replacement");
  await runAll(page);
  await page.getByRole("link", { name: /Open the engineering console/ }).click();
  await expect(page.getByTestId("disposition")).toBeVisible();
  await page.goto("/#/journey/demo-b-replacement");
  await page.getByTestId("open-all").click();
  await page.getByRole("link", { name: /Engineering console at this point/ }).click();
  await expect(page.getByTestId("disposition")).toContainText("resolved — verified");
});

test("landing: the hero line slows down on request", async ({ page }) => {
  await page.goto("/");
  await expect(stage(page)).toHaveAttribute("data-rate", "10");
  await page.getByTestId("speed-low").click();
  await expect(stage(page)).toHaveAttribute("data-rate", "4");
  await expect(page.getByTestId("hero-caption")).toContainText("nothing is pushed off");
});

test("journey has no horizontal page scroll", async ({ page }) => {
  await page.goto("/#/journey/demo-a-line-speed");
  await page.getByTestId("open-all").click();
  await page.waitForTimeout(400);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
