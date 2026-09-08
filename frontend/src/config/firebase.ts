import { getApps, initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

for (const [name, value] of Object.entries(firebaseConfig)) {
  if (!value) throw new Error(`Missing Firebase web configuration: ${name}`);
}

const firebaseApp = getApps()[0] ?? initializeApp(firebaseConfig);

export const firebaseAuth = getAuth(firebaseApp);
export const firebaseDb = import.meta.env.VITE_FIREBASE_DATABASE_ID
  ? getFirestore(firebaseApp, import.meta.env.VITE_FIREBASE_DATABASE_ID)
  : getFirestore(firebaseApp);

// Local development stays opt-in: production still requires the complete web
// config, while an explicit emulator URL lets the registration playground run
// end-to-end against the bundled Firebase emulators.
const authEmulatorUrl = import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_URL;
if (authEmulatorUrl) connectAuthEmulator(firebaseAuth, authEmulatorUrl, { disableWarnings: true });
const firestoreEmulatorHost = import.meta.env.VITE_FIRESTORE_EMULATOR_HOST;
const firestoreEmulatorPort = Number(import.meta.env.VITE_FIRESTORE_EMULATOR_PORT);
if (firestoreEmulatorHost && Number.isInteger(firestoreEmulatorPort) && firestoreEmulatorPort > 0) connectFirestoreEmulator(firebaseDb, firestoreEmulatorHost, firestoreEmulatorPort);
