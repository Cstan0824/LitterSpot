import { applicationDefault, getApps, initializeApp, type AppOptions } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { env } from "./env.js";
import { assertSafeFirebaseTarget, credentialProjectId } from "./firebaseTargetSafety.js";

const firestoreEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const authEmulator = Boolean(process.env.FIREBASE_AUTH_EMULATOR_HOST);
if (firestoreEmulator !== authEmulator) throw new Error("Firebase Auth and Firestore emulator hosts must be configured together.");
const emulatorMode = firestoreEmulator && authEmulator;
assertSafeFirebaseTarget({
  appEnvironment: env.appEnvironment,
  firebaseProjectId: env.firebaseProjectId,
  expectedFirebaseProjectId: env.expectedFirebaseProjectId,
  emulatorMode,
  credentialProjectId: emulatorMode ? null : credentialProjectId(process.env.GOOGLE_APPLICATION_CREDENTIALS),
});
const firebaseOptions: AppOptions = {
  projectId: env.firebaseProjectId,
  ...(!emulatorMode ? { credential: applicationDefault() } : {}),
};
const firebaseApp = getApps()[0] ?? initializeApp(firebaseOptions);

export const firebaseAuth = getAuth(firebaseApp);
export const firebaseMessaging = getMessaging(firebaseApp);
export const firestore = env.firebaseDatabaseId === "(default)"
  ? getFirestore(firebaseApp)
  : getFirestore(firebaseApp, env.firebaseDatabaseId);

firestore.settings({ ignoreUndefinedProperties: true });
