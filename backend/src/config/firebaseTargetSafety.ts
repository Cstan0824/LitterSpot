import { readFileSync } from "node:fs";

export type AppEnvironment = "test" | "local-emulator" | "development-cloud" | "production-cloud";

export function credentialProjectId(credentialPath: string | undefined) {
  if (!credentialPath) return null;
  try {
    const value = JSON.parse(readFileSync(credentialPath, "utf8")) as { project_id?: unknown };
    return typeof value.project_id === "string" && value.project_id.trim() ? value.project_id.trim() : null;
  } catch {
    throw new Error("GOOGLE_APPLICATION_CREDENTIALS must reference a readable Firebase service-account JSON file.");
  }
}

export function assertSafeFirebaseTarget(options: {
  appEnvironment: AppEnvironment;
  firebaseProjectId: string;
  expectedFirebaseProjectId: string;
  emulatorMode: boolean;
  credentialProjectId: string | null;
}) {
  if (options.appEnvironment === "test") return;
  if (!options.expectedFirebaseProjectId) {
    throw new Error("EXPECTED_FIREBASE_PROJECT_ID is required.");
  }
  if (options.firebaseProjectId !== options.expectedFirebaseProjectId) {
    throw new Error(`Firebase target mismatch: configured project ${options.firebaseProjectId} does not match EXPECTED_FIREBASE_PROJECT_ID.`);
  }
  if (options.appEnvironment === "local-emulator") {
    if (!options.emulatorMode) throw new Error("APP_ENV=local-emulator requires both Firebase Auth and Firestore emulator hosts.");
    return;
  }
  if (options.emulatorMode) {
    throw new Error(`${options.appEnvironment} must not use Firebase emulator hosts.`);
  }
  if (!options.credentialProjectId) {
    throw new Error(`${options.appEnvironment} requires a service-account JSON with a project_id.`);
  }
  if (options.credentialProjectId !== options.expectedFirebaseProjectId) {
    throw new Error("Firebase credential project does not match EXPECTED_FIREBASE_PROJECT_ID.");
  }
}
