import "dotenv/config";
import { firestore } from "../../config/firebase.js";
import { env } from "../../config/env.js";
import { assertV2MigrationTarget, validateV2SchemaMarker } from "../../services/v2MigrationSafety.js";

const schema = await firestore.collection("systemMetadata").doc("schema").get();
const data = schema.data();
const target = {
  appEnvironment: env.appEnvironment,
  firebaseProjectId: env.firebaseProjectId,
  firestoreDatabaseId: env.firebaseDatabaseId,
  emulator: Boolean(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST),
};
assertV2MigrationTarget(target);
const errors = validateV2SchemaMarker(schema.exists, data, target);
console.log(JSON.stringify({ valid: errors.length === 0, schemaExists: schema.exists, errors }, null, 2));
if (errors.length > 0) process.exitCode = 1;
