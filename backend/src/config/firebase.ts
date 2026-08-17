import { applicationDefault, getApps, initializeApp, type AppOptions } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { env } from "./env.js";

const emulatorMode = Boolean(process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST);
const firebaseOptions: AppOptions = {
  projectId: env.firebaseProjectId,
  ...(!emulatorMode ? { credential: applicationDefault() } : {}),
};
const firebaseApp = getApps()[0] ?? initializeApp(firebaseOptions);

export const firebaseAuth = getAuth(firebaseApp);
export const firebaseMessaging = getMessaging(firebaseApp);
export const firestore = getFirestore(firebaseApp, env.firebaseDatabaseId);

firestore.settings({ ignoreUndefinedProperties: true });
