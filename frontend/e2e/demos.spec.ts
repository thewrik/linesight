import { expect, test, type Page } from "@playwright/test";

async function advanceUntil(page: Page, done: () => Promise<boolean>, max = 15) {
  for (let i = 0; i < max && !(await done()); i++) {
    const answer = page.getByRole("button", { name: /Record the technician's answer/ });
    if (await answer.isVisible()) { await answer.click(); continue; }
    const run = page.getByTestId("run-next");
    if (await run.isEnabled()) { await run.click(); continue; }
    break;
  }
}

test("landing explains the incident and offers three demos", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Camera 3 keeps going offline").first()).toBeVisible();
  await expect(page.locator(".demo-card")).toHaveCount(3);
  await page.getByTestId("journey-demo-a-line-speed").click();
  await expect(page.locator(".pip")).toHaveCount(11);
  await expect(page.getByText("static replay · no backend")).toBeAttached(); // the pill is hidden on phones
});

test("Demo A: burst contention resolved by pacing and verified", async ({ page }) => {
  await page.goto("/#/case/demo-a-line-speed");
  await expect(page.getByTestId("disposition")).toContainText("Investigating");
  await page.getByTestId("run-next").click();
  await expect(page.getByTestId("what-changed")).toContainText("stream.production");
  await advanceUntil(page, () => page.getByTestId("apply-O-PACE-FAIR").isVisible());
  await expect(page.getByText("Mitigation only").first()).toBeVisible();
  await page.getByTestId("apply-O-PACE-FAIR").click();
  await expect(page.getByTestId("verification")).toContainText("Verification passed");
  await expect(page.getByTestId("disposition")).toContainText("Known playbook");
  await expect(page.getByTestId("disposition")).toContainText("resolved — verified");
  await expect(page.getByTestId("customer-text")).toContainText("replacement camera would not address");
});

test("Demo B: discovery ok, control failing, adapter playbook", async ({ page }) => {
  await page.goto("/#/case/demo-b-replacement");
  await advanceUntil(page, async () => (await page.locator("[data-testid^=apply-]").count()) > 0);
  await page.getByTestId("path-cam3-ctrl").click();
  await expect(page.getByTestId("path-detail")).toContainText("requires vireo-adapter-5.0");
  await expect(page.getByTestId("path-cam3-strm")).toHaveAttribute("aria-label", /unknown/);
  await page.locator("[data-testid^=apply-O-INSTALL]").click();
  await expect(page.getByTestId("disposition")).toContainText("resolved — verified");
  // simpler problem, fewer checks than Demo A
  await expect(page.getByTestId("path-cam3-disc")).toHaveAttribute("aria-label", /ok/);
  await expect(page.locator(".stepper")).toContainText("/ 6");
});

test("Demo C: escalation with a reproduction request and exportable handoff", async ({ page }) => {
  await page.goto("/#/case/demo-c-heartbeat");
  await advanceUntil(page, async () => (await page.getByTestId("disposition").textContent())!.includes("escalation"));
  await expect(page.getByTestId("disposition")).toContainText("Engineering escalation");
  await page.getByRole("tab", { name: "Engineering handoff" }).click();
  await expect(page.getByTestId("outputs")).toContainText("Requested engineering help");
  await expect(page.getByTestId("outputs")).toContainText("Reproduction request");
  const dl = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export Markdown" }).click();
  expect((await dl).suggestedFilename()).toMatch(/handoff\.md$/);
});

test("evidence opens on demand", async ({ page }) => {
  await page.goto("/#/case/demo-b-replacement");
  await page.getByRole("button", { name: /Jump to end/ }).click();
  await page.locator(".evref").first().click();
  await expect(page.getByTestId("evidence-drawer")).toContainText("Provenance");
});

test("evaluation page shows measured runs and the skipped live mode", async ({ page }) => {
  await page.goto("/#/eval");
  await expect(page.getByTestId("eval-rules")).toBeVisible();
  await expect(page.getByTestId("eval-checklist")).toBeVisible();
  await expect(page.getByText(/live model was not evaluated/)).toBeVisible();
});

test("no horizontal page scroll", async ({ page }) => {
  for (const url of ["/", "/#/case/demo-a-line-speed", "/#/eval"]) {
    await page.goto(url);
    await page.waitForTimeout(300);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, url).toBeLessThanOrEqual(1);
  }
});
