import type { AppEnvironment } from "../config/firebaseTargetSafety.js";
import { V2_DATABASE_MODEL, V2_SCHEMA_VERSION } from "../shared/v2Contracts.js";

export type MigrationTarget = {
  appEnvironment: AppEnvironment;
  firebaseProjectId: string;
  expectedFirebaseProjectId: string;
  firestoreDatabaseId: string;
  emulator: boolean;
};

export function assertV2MigrationTarget(target: MigrationTarget) {
  if (target.appEnvironment === "local-emulator") {
    if (!target.emulator || target.firebaseProjectId !== "demo-litterspot" || target.expectedFirebaseProjectId !== "demo-litterspot" || target.firestoreDatabaseId !== "litterspot") {
      throw new Error("V2 emulator migration commands require demo-litterspot/litterspot with Firebase emulators enabled.");
    }
    return;
  }
  if (target.appEnvironment !== "development-cloud"
    || target.emulator
    || !target.expectedFirebaseProjectId
    || target.firebaseProjectId !== target.expectedFirebaseProjectId
    || target.firestoreDatabaseId !== "(default)") {
    throw new Error("V2 cloud migration commands require an exact EXPECTED_FIREBASE_PROJECT_ID match and the (default) development database.");
  }
}

export function requiredApplyConfirmation(target: Pick<MigrationTarget, "firebaseProjectId" | "firestoreDatabaseId">) {
  return `${target.firebaseProjectId}/${target.firestoreDatabaseId}`;
}

export function validateV2SchemaMarker(exists: boolean, data: Record<string, unknown> | undefined, target: MigrationTarget) {
  const errors: string[] = [];
  if (!exists) return ["systemMetadata/schema is missing"];
  if (data?.schemaVersion !== V2_SCHEMA_VERSION) errors.push("systemMetadata/schema has an incompatible schemaVersion");
  if (data?.databaseModel !== V2_DATABASE_MODEL) errors.push("systemMetadata/schema has an incompatible databaseModel");
  if (data?.migrationState !== "ready") errors.push("systemMetadata/schema is not ready");
  if (data?.firebaseProjectId !== target.firebaseProjectId) errors.push("systemMetadata/schema targets another Firebase project");
  if (data?.firestoreDatabaseId !== target.firestoreDatabaseId) errors.push("systemMetadata/schema targets another Firestore database");
  if (data?.environment !== target.appEnvironment) errors.push("systemMetadata/schema targets another application environment");
  return errors;
}
