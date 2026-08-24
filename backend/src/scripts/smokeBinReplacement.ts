import { Timestamp } from "firebase-admin/firestore";
import { firestore } from "../config/firebase.js";
import { FirestoreBinReplacementRepository } from "../services/binReplacementRepository.js";
import { evaluateZoneBinReplacement } from "../services/binReplacementService.js";

const zoneId = "smoke-bin-replacement-zone";
const evaluatedAt = new Date("2026-08-25T12:09:00.000Z");
const runIds = Array.from({ length: 10 }, (_, index) => `${zoneId}-${index}`);

async function main() {
  const batch = firestore.batch();
  for (const [index, runId] of runIds.entries()) {
    const capturedAt = new Date(evaluatedAt.getTime() - (9 - index) * 60_000);
    batch.set(firestore.collection("analysisRuns").doc(runId), {
      siteId: "smoke-site",
      zoneId,
      capturedAt: Timestamp.fromDate(capturedAt),
      createdAt: Timestamp.fromDate(capturedAt),
      isTest: false,
      analyticsEligible: true,
      alertEvaluationStatus: "completed",
      peopleCount: 3,
      bins: [{ state: "full", stableState: "full", confirmed: true, stale: false }],
      issueCounts: {
        floorLitter: index === 0 || index === 3 || index === 6 ? 1 : 0,
        floorSpill: index === 2 ? 1 : 0,
      },
    });
  }
  await batch.commit();

  const repository = new FirestoreBinReplacementRepository(firestore);
  const first = await evaluateZoneBinReplacement(zoneId, { windowMinutes: 10, includeTestData: false, evaluatedAt: evaluatedAt.toISOString() }, repository);
  const second = await evaluateZoneBinReplacement(zoneId, { windowMinutes: 10, includeTestData: false, evaluatedAt: evaluatedAt.toISOString() }, repository);
  console.log(JSON.stringify({
    source: "firestore-emulator",
    first: { decision: first.decision, score: first.score, raiseStreak: first.raiseStreak },
    second: { decision: second.decision, score: second.score, recommended: second.recommended },
  }, null, 2));

  const cleanup = firestore.batch();
  for (const runId of runIds) cleanup.delete(firestore.collection("analysisRuns").doc(runId));
  cleanup.delete(firestore.collection("binReplacementRecommendations").doc(zoneId));
  await cleanup.commit();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
