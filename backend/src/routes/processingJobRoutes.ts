import { Router } from "express";
import { jobListQuerySchema } from "../schemas/media.js";
import { getProcessingJob, listProcessingJobs } from "../services/mediaService.js";
import { processImageJob, retryImageJob } from "../services/jobProcessingService.js";
import { enqueueVideoJob, retryVideoJob } from "../services/videoJobProcessingService.js";
import { env } from "../config/env.js";
import { rateLimit } from "../middleware/rateLimit.js";

export const processingJobRoutes = Router();
const processingMutationRateLimit = rateLimit({
  namespace: "processing-mutation",
  maximum: env.processingMutationRateLimitPerMinute,
});

processingJobRoutes.get("/", async (req, res) => {
  const query = jobListQuerySchema.parse(req.query);
  const page = await listProcessingJobs(query);
  return res.json({ processingJobs: page.items, nextCursor: page.nextCursor });
});

processingJobRoutes.post("/:jobId/process", processingMutationRateLimit, async (req, res) => {
  const jobId = String(req.params.jobId);
  const job = await getProcessingJob(jobId);
  if (job.type === "video") {
    if (job.status === "completed") {
      return res.json({ processingJob: job, enqueued: false });
    }
    if (job.status === "uploading") {
      return res.status(409).json({ error: "The source video is still being stored.", requestId: req.requestId });
    }
    if (job.status === "failed") {
      return res.status(409).json({ error: "Failed video jobs must use the retry endpoint.", requestId: req.requestId });
    }
    if (job.status === "cancelled") {
      return res.status(409).json({ error: "Cancelled video jobs cannot be processed.", requestId: req.requestId });
    }
    const enqueued = enqueueVideoJob(jobId);
    return res.status(202).json({ processingJob: job, enqueued });
  }
  return res.json(await processImageJob(jobId));
});

processingJobRoutes.post("/:jobId/retry", processingMutationRateLimit, async (req, res) => {
  const jobId = String(req.params.jobId);
  const job = await getProcessingJob(jobId);
  if (job.type === "video") {
    const retried = await retryVideoJob(jobId);
    return res.status(202).json({ processingJob: retried.job, enqueued: retried.enqueued });
  }
  return res.json(await retryImageJob(jobId));
});

processingJobRoutes.get("/:jobId", async (req, res) => {
  return res.json({ processingJob: await getProcessingJob(String(req.params.jobId)) });
});
