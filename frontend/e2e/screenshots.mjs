// Capture README screenshots from a running UI: node e2e/screenshots.mjs [baseUrl]
import { chromium } from "@playwright/test";
import { fileURLToPath } from "node:url";

const base = process.argv[2] ?? "http://localhost:5173";
const out = fileURLToPath(new URL("../../docs/screenshots/", import.meta.url));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });

async function stepUntil(pred, max = 15) {
  for (let i = 0; i < max && !(await pred()); i++) {
    const ans = page.getByRole("button", { name: /Record the technician's answer/ });
    if (await ans.isVisible()) { await ans.click(); await page.waitForTimeout(250); continue; }
    const run = page.getByTestId("run-next");
    if (await run.isEnabled()) { await run.click(); await page.waitForTimeout(250); continue; }
    break;
  }
}

await page.goto(base + "/");
await page.waitForTimeout(3000);
await page.screenshot({ path: out + "landing.png" });

await page.goto(base + "/#/case/demo-a-line-speed");
await page.waitForTimeout(600);
await stepUntil(() => page.getByTestId("apply-O-PACE-FAIR").isVisible());
await page.getByTestId("interventions").screenshot({ path: out + "demo-a-options.png" });
await page.getByTestId("apply-O-PACE-FAIR").click();
await page.waitForTimeout(600);
await page.getByTestId("interventions").screenshot({ path: out + "demo-a-verification.png" });

await page.goto(base + "/#/case/demo-b-replacement");
await page.waitForTimeout(600);
await stepUntil(async () => (await page.locator("[data-testid^=apply-]").count()) > 0);
await page.getByTestId("path-cam3-ctrl").click();
await page.locator("#topo-h").scrollIntoViewIfNeeded();
await page.locator("section[aria-labelledby=topo-h]").screenshot({ path: out + "demo-b-topology.png" });

await page.goto(base + "/#/case/demo-c-heartbeat");
await page.waitForTimeout(600);
await stepUntil(async () => (await page.getByTestId("disposition").textContent()).includes("escalation"));
await page.screenshot({ path: out + "demo-c-escalation.png" });
await page.locator("section[aria-labelledby=dg-h]").screenshot({ path: out + "demo-c-graph.png" });
await page.getByRole("tab", { name: "Engineering handoff" }).click();
await page.getByTestId("outputs").screenshot({ path: out + "demo-c-handoff.png" });

const run = async (n) => {
  for (let i = 0; i < n; i++) { await page.getByTestId("hold").focus(); await page.keyboard.press("Enter"); await page.waitForTimeout(300); }
};
await page.evaluate(() => localStorage.setItem("ls-lens", "story"));
await page.goto(base + "/#/journey/demo-a-line-speed");
await page.waitForTimeout(800);
await run(2);
await page.waitForTimeout(3500);
await page.screenshot({ path: out + "journey-story.png" });
await run(6);
await page.getByTestId("opt-O-PACE-LOW").click();
await page.waitForTimeout(7000);
await page.screenshot({ path: out + "journey-fork.png" });
await page.getByTestId("lens-lead").click();
await run(2);
await page.waitForTimeout(6000);
await page.screenshot({ path: out + "journey-lead-verdict.png" });
await page.getByTestId("lens-engineer").click();
await page.goto(base + "/#/journey/demo-c-heartbeat");
await page.waitForTimeout(600);
await page.getByTestId("open-all").click();
await page.waitForTimeout(14500);
await page.screenshot({ path: out + "journey-engineer-escalation.png" });
await page.evaluate(() => localStorage.setItem("ls-lens", "story"));
await page.goto(base + "/#/journey/demo-b-replacement");
await page.waitForTimeout(600);
await run(3);
await page.waitForTimeout(3000);
await page.screenshot({ path: out + "journey-dark-camera.png" });

await page.goto(base + "/#/eval");
await page.waitForTimeout(600);
await page.screenshot({ path: out + "evaluation.png", fullPage: false });
await browser.close();
console.log("screenshots in", out);
