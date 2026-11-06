// Capture README screenshots from a running UI: node e2e/screenshots.mjs [baseUrl]
import { chromium } from "@playwright/test";
import { fileURLToPath } from "node:url";

const base = process.argv[2] ?? "http://localhost:5173";
const out = fileURLToPath(new URL("../../docs/screenshots/", import.meta.url));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1360, height: 900 }, colorScheme: "light", deviceScaleFactor: 1 });

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
await page.waitForTimeout(600);
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

await page.goto(base + "/#/eval");
await page.waitForTimeout(600);
await page.screenshot({ path: out + "evaluation.png", fullPage: false });
await browser.close();
console.log("screenshots in", out);
