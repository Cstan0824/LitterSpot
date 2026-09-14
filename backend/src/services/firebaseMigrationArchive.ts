import { createHash, randomBytes, scryptSync } from "node:crypto";
import { DocumentReference, GeoPoint, Timestamp, type Firestore } from "firebase-admin/firestore";
import type { UserImportOptions, UserImportRecord } from "firebase-admin/auth";

export type ArchivedValue = null | boolean | string | number | { kind: string; [key: string]: any };
export function archiveValue(value: any): ArchivedValue {
  if (value instanceof Timestamp) return { kind: "timestamp", seconds: value.seconds, nanoseconds: value.nanoseconds };
  if (value instanceof GeoPoint) return { kind: "geopoint", latitude: value.latitude, longitude: value.longitude };
  if (value instanceof DocumentReference) return { kind: "reference", path: value.path };
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return { kind: "bytes", base64: Buffer.from(value).toString("base64") };
  if (typeof value === "number" && !Number.isFinite(value)) return { kind: "number", value: String(value) };
  if (Array.isArray(value)) return { kind: "array", values: value.map(archiveValue) };
  if (value && typeof value === "object") return { kind: "map", entries: Object.fromEntries(Object.keys(value).sort().map(key => [key, archiveValue(value[key])])) };
  if (value === null || ["boolean", "string", "number"].includes(typeof value)) return value;
  throw new Error("Unsupported value in Firestore migration archive.");
}
export function restoreValue(value: ArchivedValue, firestore: Firestore): any {
  if (value === null || typeof value !== "object") return value;
  switch (value.kind) {
    case "timestamp": return new Timestamp(value.seconds, value.nanoseconds);
    case "geopoint": return new GeoPoint(value.latitude, value.longitude);
    case "reference": return firestore.doc(value.path);
    case "bytes": return Buffer.from(value.base64, "base64");
    case "number": return Number(value.value);
    case "array": return value.values.map((item: ArchivedValue) => restoreValue(item, firestore));
    case "map": return Object.fromEntries(Object.entries(value.entries).map(([key, item]) => [key, restoreValue(item as ArchivedValue, firestore)]));
    default: throw new Error("Unknown archive value type.");
  }
}
export type ArchivedDocument = { path: string; data: ArchivedValue };
export const archiveHash = (documents: ArchivedDocument[]) => createHash("sha256").update(JSON.stringify([...documents].sort((a, b) => a.path.localeCompare(b.path)))).digest("hex");
export async function archiveFirestore(firestore: Firestore) {
  const documents: ArchivedDocument[] = [];
  const collections: Record<string, number> = {};
  const queue = await firestore.listCollections();
  let offset = 0;
  while (offset < queue.length) {
    const slice = queue.slice(offset, offset + 8); offset += slice.length;
    await Promise.all(slice.map(async collection => {
      const refs = await collection.listDocuments();
      let count = 0;
      for (let start = 0; start < refs.length; start += 100) {
        const snapshots = await firestore.getAll(...refs.slice(start, start + 100));
        for (const document of snapshots) if (document.exists) { documents.push({ path: document.ref.path, data: archiveValue(document.data()) }); count++; }
        for (let child = start; child < Math.min(refs.length, start + 100); child += 8) {
          const nested = await Promise.all(refs.slice(child, Math.min(start + 100, child + 8)).map(ref => ref.listCollections()));
          queue.push(...nested.flat());
        }
      }
      collections[collection.path] = count;
    }));
  }
  documents.sort((a, b) => a.path.localeCompare(b.path));
  return { version: 1, documents, collections, sha256: archiveHash(documents) };
}

export const migrationPasswordHashOptions: UserImportOptions = { hash: { algorithm: "STANDARD_SCRYPT", memoryCost: 16384, blockSize: 8, parallelization: 1, derivedKeyLength: 32 } };
export function emulatorUserForImport(user: Record<string, any>): UserImportRecord {
  const output: UserImportRecord = {
    uid: user.localId, email: user.email, emailVerified: Boolean(user.emailVerified), displayName: user.displayName,
    disabled: Boolean(user.disabled), phoneNumber: user.phoneNumber, photoURL: user.photoUrl,
    metadata: { creationTime: user.createdAt ? new Date(Number(user.createdAt)).toISOString() : undefined, lastSignInTime: user.lastLoginAt ? new Date(Number(user.lastLoginAt)).toISOString() : undefined },
    providerData: (user.providerUserInfo ?? []).filter((provider: any) => provider.providerId !== "password").map((provider: any) => ({ uid: provider.rawId ?? provider.federatedId, providerId: provider.providerId, email: provider.email, displayName: provider.displayName, photoURL: provider.photoUrl })),
    customClaims: user.customAttributes ? JSON.parse(user.customAttributes) : undefined,
  };
  if (user.passwordHash) {
    const prefix = `fakeHash:salt=${user.salt}:password=`;
    if (!user.salt || !String(user.passwordHash).startsWith(prefix)) throw new Error("A source Auth password uses an unsupported format. No passwords were imported.");
    const salt = randomBytes(32);
    output.passwordSalt = salt;
    output.passwordHash = scryptSync(user.passwordHash.slice(prefix.length), salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  }
  return output;
}
