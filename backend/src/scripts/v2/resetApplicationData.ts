import "dotenv/config";
import { firestore } from "../../config/firebase.js";
import { env } from "../../config/env.js";
import { V2_RESET_COLLECTIONS } from "../../shared/v2Contracts.js";
import { assertV2MigrationTarget, requiredApplyConfirmation } from "../../services/v2MigrationSafety.js";

const apply = process.argv.includes("--apply");
const confirmation = process.argv.find((argument) => argument.startsWith("--confirm-target="))?.slice("--confirm-target=".length);
const target = {
  appEnvironment: env.appEnvironment,
  firebaseProjectId: env.firebaseProjectId,
  expectedFirebaseProjectId: env.expectedFirebaseProjectId,
  firestoreDatabaseId: env.firebaseDatabaseId,
  emulator: Boolean(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST),
};
assertV2MigrationTarget(target);
if (apply && confirmation !== requiredApplyConfirmation(target)) {
  throw new Error(`Apply requires --confirm-target=${requiredApplyConfirmation(target)}.`);
}

async function countCollectionTree(collection: FirebaseFirestore.CollectionReference): Promise<number> {
  const snapshot = await collection.get();
  let count = snapshot.size;
  for (const document of snapshot.docs) {
    for (const child of await document.ref.listCollections()) count += await countCollectionTree(child);
  }
  return count;
}

const counts: Record<string, number> = {};
for (const collectionName of V2_RESET_COLLECTIONS) {
  counts[collectionName] = await countCollectionTree(firestore.collection(collectionName));
}

console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", target: `${env.firebaseProjectId}/${env.firebaseDatabaseId}`, counts }, null, 2));
if (!apply) {
  console.log("Dry run complete. Re-run with --apply only after explicit approval.");
  process.exit(0);
}

for (const collectionName of V2_RESET_COLLECTIONS) {
  await firestore.recursiveDelete(firestore.collection(collectionName));
}
console.log("Application data reset complete. Local media was not touched.");
