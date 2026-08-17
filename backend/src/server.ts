import { app } from "./app.js";
import { env } from "./config/env.js";
import { recoverVideoJobs, waitForVideoJobsToFinish } from "./services/videoJobProcessingService.js";

const server = app.listen(env.port, async () => {
  console.log(`LitterSpot backend listening on port ${env.port}`);
  try {
    const recovered = await recoverVideoJobs();
    if (recovered > 0) console.log(`Recovered ${recovered} queued or expired video job(s).`);
  } catch (error) {
    console.error("Video job recovery failed:", error);
  }
});

let shuttingDown = false;
async function shutdown(signal: "SIGINT" | "SIGTERM") {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), level: "info", event: "shutdown_started", signal }));
  server.close();
  const timeout = new Promise<"timeout">((resolve) => {
    const timer = setTimeout(() => resolve("timeout"), 20_000);
    timer.unref();
  });
  const outcome = await Promise.race([waitForVideoJobsToFinish().then(() => "idle" as const), timeout]);
  if (outcome === "timeout") {
    console.error(JSON.stringify({ timestamp: new Date().toISOString(), level: "warn", event: "shutdown_queue_timeout" }));
  }
  process.exit(0);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => { void shutdown(signal); });
}
