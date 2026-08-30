import { pythonAssignmentSelector } from "../../services/v2OrchestratorProvider.js";

const context = {
  siteId: "smoke-site", activeMapRevisionId: "map", policyVersion: "assignment-v2", calculatedAt: new Date().toISOString(),
  alerts: [{ alertId: "SMOKE-ALERT", severity: "critical", priorityScore: 90, ageMinutes: 10, issueType: "floor_litter", targetPoint: { xMeters: 10, yMeters: 10 } }],
  cleaners: [{ cleanerId: "SMOKE-CLEANER", availability: "available", stationPoint: { xMeters: 11, yMeters: 10 }, recentWorkLocation: null }],
  eligiblePairs: [{ alertId: "SMOKE-ALERT", cleanerId: "SMOKE-CLEANER", stationDistanceMeters: 1, recentWorkDistanceMeters: null, recentWorkStrength: null, locationUncertainty: null }],
};
const result = await pythonAssignmentSelector.select(context, { provider: "ollama", model: process.env.OLLAMA_MODEL ?? "qwen3.5:4b", requestTimeoutMs: 60000 }, "node-python-smoke");
if (result.alertId !== "SMOKE-ALERT" || result.cleanerId !== "SMOKE-CLEANER") throw new Error("Unexpected provider selection.");
console.log(JSON.stringify({ status: "passed", provider: result.provider, model: result.model, alertId: result.alertId, cleanerId: result.cleanerId }));
