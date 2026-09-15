import "dotenv/config";
import { getApps } from "firebase-admin/app";
import { firestore, firebaseAuth } from "../config/firebase.js";
import { env } from "../config/env.js";
import { RESET_COLLECTIONS } from "../shared/firestoreSchema.js";
import { assertMigrationTarget } from "../services/databaseSafety.js";

const app = getApps()[0];
const target = {
  appEnvironment: env.appEnvironment,
  firebaseProjectId: env.firebaseProjectId,
  expectedFirebaseProjectId: env.expectedFirebaseProjectId,
  firestoreDatabaseId: env.firebaseDatabaseId,
  emulator: Boolean(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST),
};
assertMigrationTarget(target);
let authUserCount = 0;
let pageToken: string | undefined;
do {
  const page = await firebaseAuth.listUsers(1000, pageToken);
  authUserCount += page.users.length;
  pageToken = page.pageToken;
} while (pageToken);
const counts: Record<string, number> = {};
for (const collectionName of RESET_COLLECTIONS) {
  counts[collectionName] = (await firestore.collection(collectionName).count().get()).data().count;
}

console.log(JSON.stringify({
  firebaseProjectId: env.firebaseProjectId,
  firestoreDatabaseId: env.firebaseDatabaseId,
  appEnvironment: env.appEnvironment,
  emulator: Boolean(process.env.FIRESTORE_EMULATOR_HOST),
  firebaseAppName: app?.name ?? null,
  authUserCount,
  collectionCounts: counts,
  mediaStorageRoot: env.mediaStorageRoot,
}, null, 2));
