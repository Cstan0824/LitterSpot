import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { firestore } from "./config/firebase.js";
import { HttpError } from "./shared/httpError.js";
import { getSiteScopedDocument } from "./services/v2Persistence.js";
import { writeV2AuditEvent } from "./services/v2AuditService.js";

const run = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

run("V2 persistence foundation", () => {
  const suffix = randomUUID();
  const siteA = `site-a-${suffix}`;
  const siteB = `site-b-${suffix}`;
  const cameraId = `camera-${suffix}`;

  beforeAll(async () => {
    await Promise.all([
      firestore.collection("sites").doc(siteA).set({ schemaVersion: 2, siteId: siteA, status: "active" }),
      firestore.collection("sites").doc(siteB).set({ schemaVersion: 2, siteId: siteB, status: "active" }),
      firestore.collection("cameras").doc(cameraId).set({ schemaVersion: 2, cameraId, siteId: siteA, revision: 1 }),
    ]);
  });

  it("loads only a resource in the caller Site", async () => {
    await expect(getSiteScopedDocument("cameras", cameraId, siteA)).resolves.toMatchObject({ id: cameraId });
    await expect(getSiteScopedDocument("cameras", cameraId, siteB)).rejects.toMatchObject({ status: 404 } satisfies Partial<HttpError>);
  });

  it("writes an immutable safe audit summary", async () => {
    const eventId = await writeV2AuditEvent({
      actor: { uid: `root-${suffix}`, role: "supervisor", authority: "root", displayName: "Root" },
      siteId: siteA,
      siteNameSnapshot: "Site A",
      action: "camera_updated",
      resourceType: "Camera",
      resourceId: cameraId,
      outcome: "succeeded",
      before: { status: "inactive" },
      after: { status: "active" },
      requestId: `request-${suffix}`,
    });
    const event = await firestore.collection("auditEvents").doc(eventId).get();
    expect(event.data()).toMatchObject({ siteId: siteA, actorAuthority: "root", before: { status: "inactive" }, after: { status: "active" }, ipHash: null });
  });
});
