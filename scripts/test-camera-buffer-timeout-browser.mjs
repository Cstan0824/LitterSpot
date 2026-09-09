import { chromium } from "../.local/camera-browser/node_modules/playwright/index.mjs";

const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const baseUrl = process.env.CAMERA_BROWSER_BASE_URL ?? "http://127.0.0.1:5193";

try {
  await page.goto(`${baseUrl}/#/cameras`);
  await page.locator("input[type=email]").fill("camera-browser@example.test");
  await page.locator("input[type=password]").fill("Camera-test-123!");
  await page.locator("button[type=submit]").click();
  const card = page.locator(".camera-wall-card").first();
  await card.locator(".camera-live-stage img").waitFor({ timeout: 30_000 });
  await page.route("**/samples", (route) => route.abort());
  await card.click();
  await page.getByText("Connecting to Camera...", { exact: true }).first().waitFor({ timeout: 10_000 });
  await page.screenshot({ path: ".local/camera-buffering-state.png", fullPage: true });
  await page.getByText("Camera analysis unavailable", { exact: true }).first().waitFor({ timeout: 35_000 });
  await page.screenshot({ path: ".local/camera-unavailable-state.png", fullPage: true });
  const retry = page.getByRole("button", { name: "Retry", exact: true });
  await retry.waitFor();
  await page.unroute("**/samples");
  await retry.click();
  await page.getByText("Rebuffering analysis", { exact: true }).first().waitFor({ timeout: 5_000 });
  await page.locator(".camera-reference-visual .camera-live-stage canvas").waitFor({ timeout: 15_000 });
  console.log(JSON.stringify({ thirtySecondFailurePassed: true, retryRecoveryPassed: true }));
} finally {
  await context.close();
  await browser.close();
}
