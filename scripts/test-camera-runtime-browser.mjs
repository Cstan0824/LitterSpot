import { chromium } from "../.local/camera-browser/node_modules/playwright/index.mjs";

const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [];
const samples = [];
const baseUrl = process.env.CAMERA_BROWSER_BASE_URL ?? "http://127.0.0.1:5193";
const playbackCheckSeconds = Number(process.env.CAMERA_PLAYBACK_CHECK_SECONDS ?? 12);

async function login() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", async (response) => {
    if (response.url().endsWith("/samples") && response.ok()) samples.push((await response.json()).observation);
  });
  await page.goto(`${baseUrl}/#/cameras`);
  await page.locator("input[type=email]").fill("camera-browser@example.test");
  await page.locator("input[type=password]").fill("Camera-test-123!");
  await page.locator("button[type=submit]").click();
  await page.getByText("See every zone. Open the evidence.").waitFor({ timeout: 15_000 });
  return { context, page };
}

async function assertNonBlank(canvas, second) {
  const pixels = await canvas.evaluate((element) => {
    const context = element.getContext("2d");
    if (!context || !element.width || !element.height) return { width: element.width, height: element.height, mean: 0 };
    const data = context.getImageData(0, 0, element.width, element.height).data;
    const stride = Math.max(4, Math.floor(data.length / 20_000 / 4) * 4);
    let sum = 0, count = 0;
    for (let offset = 0; offset < data.length; offset += stride) { sum += (data[offset] + data[offset + 1] + data[offset + 2]) / 3; count += 1; }
    return { width: element.width, height: element.height, mean: sum / count };
  });
  if (pixels.mean < 3) throw new Error(`Delayed Camera Detail became blank at ${second} seconds.`);
  if (pixels.width > 1_280 || pixels.height > 720) throw new Error(`Delayed playback exceeded the 720p cap at ${pixels.width}x${pixels.height}.`);
  return pixels;
}

try {
  const owner = await login();
  const cards = owner.page.locator(".camera-wall-card");
  await cards.first().locator(".camera-live-stage img").waitFor({ timeout: 30_000 });
  if (await owner.page.locator(".camera-wall-card .camera-live-stage canvas").count()) throw new Error("The Camera grid started continuous delayed playback.");

  const detailStartedAt = Date.now();
  const detailSampleStart = samples.length;
  await cards.first().click();
  const detailCameraId = new URLSearchParams(new URL(owner.page.url()).hash.split("?")[1] ?? "").get("cameraId");
  await owner.page.getByText("Connecting to Camera...", { exact: true }).first().waitFor({ timeout: 10_000 });
  const canvas = owner.page.locator(".camera-reference-visual .camera-live-stage canvas");
  await canvas.waitFor({ timeout: 30_000 });
  const canvasReadyMs = Date.now() - detailStartedAt;
  if (canvasReadyMs < 4_500) throw new Error(`Delayed playback started without a real buffer after ${canvasReadyMs} ms.`);
  if (canvasReadyMs >= 30_000) throw new Error("Delayed playback exceeded the 30-second readiness boundary.");

  let dimensions;
  for (let second = 0; second < playbackCheckSeconds; second += 1) {
    dimensions = await assertNonBlank(canvas, second);
    await owner.page.waitForTimeout(1_000);
  }
  if (dimensions.width !== 1_280 || dimensions.height !== 720) throw new Error(`A 1080p source did not render through the 720p Detail cap: ${dimensions.width}x${dimensions.height}.`);
  const bufferMetrics = await owner.page.locator('body > video[data-delayed-camera-playback="true"]').evaluate((video) => ({
    currentTime: video.currentTime,
    bufferedStart: video.buffered.length ? video.buffered.start(0) : 0,
    bufferedEnd: video.buffered.length ? video.buffered.end(video.buffered.length - 1) : 0,
    encodedBytes: Number(video.dataset.encodedBytes ?? 0),
    queuedBytes: Number(video.dataset.queuedBytes ?? 0),
  }));
  if (bufferMetrics.bufferedEnd - bufferMetrics.bufferedStart > 30) throw new Error(`Compressed playback buffer grew beyond 30 seconds: ${JSON.stringify(bufferMetrics)}`);
  if (bufferMetrics.queuedBytes > 8 * 1024 * 1024) throw new Error(`Compressed chunk queue exceeded 8 MiB: ${JSON.stringify(bufferMetrics)}`);
  const statusTransitions = [];
  for (let second = 0; second < 10; second += 1) {
    const current = await owner.page.locator(".camera-monitoring-state strong").textContent();
    if (statusTransitions.at(-1) !== current) statusTransitions.push(current);
    await owner.page.waitForTimeout(1_000);
  }
  if (statusTransitions.some((status) => status !== "Live monitoring")) throw new Error(`Camera Detail left healthy monitoring: ${statusTransitions.join(" -> ")}`);

  await owner.page.route("**/samples", (route) => route.abort());
  await owner.page.getByText("Rebuffering analysis", { exact: true }).first().waitFor({ timeout: 12_000 });
  const frozenTime = await owner.page.locator('body > video[data-delayed-camera-playback="true"]').evaluate((video) => video.currentTime);
  await owner.page.waitForTimeout(2_500);
  await owner.page.unroute("**/samples");
  await owner.page.getByText("Live monitoring", { exact: true }).first().waitFor({ timeout: 15_000 });
  const recoveredTime = await owner.page.locator('body > video[data-delayed-camera-playback="true"]').evaluate((video) => video.currentTime);
  if (recoveredTime - frozenTime < 1) throw new Error("A long analysis interruption did not skip to newer safe delayed footage.");
  await assertNonBlank(canvas, "after rebuffer");

  const original = owner.page.getByRole("button", { name: "Original video", exact: true });
  await original.click();
  const showAnalysis = owner.page.getByRole("button", { name: "Show analysis", exact: true });
  await showAnalysis.waitFor();
  if (await showAnalysis.getAttribute("aria-pressed") !== "true") throw new Error("Original video did not hide overlays on the delayed timeline.");
  await owner.page.screenshot({ path: ".local/camera-acceptance-detail.png", fullPage: true });
  await owner.page.setViewportSize({ width: 760, height: 1000 });
  await owner.page.screenshot({ path: ".local/camera-acceptance-tablet.png", fullPage: true });
  const detailCounts = Object.groupBy(samples.slice(detailSampleStart), (sample) => sample.cameraId);
  const detailCount = detailCameraId ? detailCounts[detailCameraId]?.length ?? 0 : 0;
  const maximumBackgroundCount = Math.max(0, ...Object.entries(detailCounts).filter(([cameraId]) => cameraId !== detailCameraId).map(([, values]) => values?.length ?? 0));
  if (!detailCameraId || detailCount <= maximumBackgroundCount) throw new Error(`Adaptive sampling did not prioritize Camera Detail: ${JSON.stringify(Object.fromEntries(Object.entries(detailCounts).map(([key, values]) => [key, values?.length ?? 0])))}`);

  const viewer = await login();
  await viewer.page.locator(".camera-wall-card .camera-live-stage img").first().waitFor({ timeout: 20_000 });
  await viewer.page.locator(".camera-wall-card").first().click();
  await viewer.page.locator(".camera-reference-visual .camera-live-stage img").waitFor({ timeout: 10_000 });
  if (await viewer.page.locator(".camera-reference-visual .camera-live-stage canvas").count()) throw new Error("A secondary browser started delayed playback before ownership transfer.");
  await owner.context.close();
  const failoverStartedAt = Date.now();
  await viewer.page.getByText("Connecting to Camera...", { exact: true }).first().waitFor({ timeout: 45_000 });
  await viewer.page.locator(".camera-reference-visual .camera-live-stage canvas").waitFor({ timeout: 35_000 });
  const failoverReadyMs = Date.now() - failoverStartedAt;
  await viewer.context.close();

  const cameraIds = new Set(samples.map((sample) => sample.cameraId));
  if (!samples.length || !cameraIds.size) throw new Error("No Camera samples completed.");
  console.log(JSON.stringify({ processedCameraCount: cameraIds.size, totalSamples: samples.length, detailCount, maximumBackgroundCount, errors, canvasReadyMs, failoverReadyMs, dimensions, bufferMetrics, gridSnapshotsPassed: true, delayedPlaybackPassed: true, boundedBufferPassed: true, rebufferRecoveryPassed: true, adaptiveSamplingPassed: true, sourceResolutionCapPassed: true, stableStatusPassed: true, originalVideoPassed: true, secondarySnapshotPassed: true, failoverPassed: true }));
} finally {
  await browser.close();
}
if (errors.length) process.exitCode = 1;
