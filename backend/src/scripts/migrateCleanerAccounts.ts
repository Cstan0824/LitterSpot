import { FieldPath, FieldValue } from "firebase-admin/firestore";
import { firestore } from "../config/firebase.js";

const execute = process.argv.slice(2).includes("--execute");
if (process.argv.slice(2).includes("--execute") && process.argv.slice(2).includes("--dry-run")) {
  throw new Error("Choose one migration mode.");
}
if (process.argv.slice(2).some((item) => !["--execute", "--dry-run"].includes(item))) {
  throw new Error("Use --dry-run or --execute.");
}

async function migrateCollection(collectionName: "cleaners" | "supervisors") {
  let cursor: string | null = null;
  let scanned = 0;
  let changed = 0;
  do {
    let query = firestore.collection(collectionName).orderBy(FieldPath.documentId()).limit(100);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    for (const document of snapshot.docs) {
      scanned += 1;
      const data = document.data();
      if (collectionName === "cleaners") {
        const update: Record<string, unknown> = {};
        if (!("authUid" in data)) update.authUid = null;
        if (!("email" in data)) update.email = null;
        if (!("accountStatus" in data)) update.accountStatus = "not_provisioned";
        if (!Array.isArray(data.permittedSiteIds)) update.permittedSiteIds = [String(data.assignedSiteId)];
        if (!Array.isArray(data.permittedZoneIds)) update.permittedZoneIds = [String(data.assignedZoneId)];
        if (!Array.isArray(data.capabilities)) update.capabilities = ["general_cleaning"];
        if (!("authLinkedAt" in data)) update.authLinkedAt = null;
        if (Object.keys(update).length > 0) {
          changed += 1;
          if (execute) await document.ref.update({ ...update, updatedAt: FieldValue.serverTimestamp() });
        }
      } else {
        const accountReference = firestore.collection("userAccounts").doc(document.id);
        const account = await accountReference.get();
        if (!account.exists) {
          changed += 1;
          if (execute) await accountReference.create({
            role: "supervisor",
            profileId: document.id,
            status: data.status === "active" ? "active" : "inactive",
            migrationSource: "supervisor_profile_migration",
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
      }
    }
    cursor = snapshot.size === 100 ? snapshot.docs.at(-1)?.id ?? null : null;
  } while (cursor);
  return { scanned, changed };
}

const cleaners = await migrateCollection("cleaners");
const supervisors = await migrateCollection("supervisors");
console.log(JSON.stringify({ mode: execute ? "execute" : "dry_run", cleaners, supervisors }, null, 2));
if (!execute) console.log("Dry run only. Rerun with --execute after reviewing the counts.");
