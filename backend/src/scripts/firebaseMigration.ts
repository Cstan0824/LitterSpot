import { cert, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { chmod, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { archiveFirestore, archiveHash, archiveValue, emulatorUserForImport, migrationPasswordHashOptions, restoreValue, type ArchivedDocument } from "../services/firebaseMigrationArchive.js";

const mode = process.argv[2];
const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const runDir = process.env.MIGRATION_RUN_DIR;
if (!runDir || !["capture", "inspect", "backup", "apply", "verify"].includes(mode)) throw new Error("Set MIGRATION_RUN_DIR and choose capture, inspect, backup, apply, or verify.");
const directory = resolve(runDir);
await mkdir(directory, { recursive: true, mode: 0o700 }); await chmod(directory, 0o700);
const save = async (name: string, data: any) => writeFile(resolve(directory, name), JSON.stringify(data, null, 2), { mode: 0o600 });
const read = async (name: string) => JSON.parse(await readFile(resolve(directory, name), "utf8"));

if (mode === "capture") {
  if (process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8280" || process.env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9299") throw new Error("Capture requires the isolated migration emulator on 8280/9299.");
  const exportPath = process.env.MIGRATION_SOURCE_EXPORT; const mediaPath = process.env.MIGRATION_SOURCE_MEDIA;
  if (!exportPath || !mediaPath) throw new Error("Set MIGRATION_SOURCE_EXPORT and MIGRATION_SOURCE_MEDIA.");
  const app = initializeApp({ projectId: "demo-litterspot" }, "migration-source");
  const snapshot = await archiveFirestore(getFirestore(app));
  const auth = JSON.parse(await readFile(resolve(exportPath, "auth_export/accounts.json"), "utf8"));
  // Validate every password before any production mutation. Never log these records.
  auth.users.forEach(emulatorUserForImport);
  await save("source-firestore.json", snapshot); await save("source-auth.json", auth);
  await cp(resolve(exportPath), resolve(directory, "emulator-export"), { recursive: true, errorOnExist: true, force: false });
  await cp(resolve(mediaPath), resolve(directory, "media"), { recursive: true, errorOnExist: true, force: false });
  console.log(JSON.stringify({ mode, documentCount: snapshot.documents.length, authUserCount: auth.users.length, sha256: snapshot.sha256, topLevelCollections: Object.fromEntries(Object.entries(snapshot.collections).filter(([path]) => !path.includes("/"))) }, null, 2));
  process.exit(0);
}

if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST) throw new Error("Cloud migration must not inherit emulator hosts.");
if (process.env.MIGRATION_PROJECT_ID !== "litterspot" || process.env.EXPECTED_FIREBASE_PROJECT_ID !== "litterspot") throw new Error("Cloud migration is locked to the explicitly selected litterspot project.");
const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!keyPath) throw new Error("Set GOOGLE_APPLICATION_CREDENTIALS to the litterspot Admin key outside the repository.");
const key = JSON.parse(await readFile(keyPath, "utf8"));
if (key.project_id !== "litterspot") throw new Error("The Admin credential belongs to another project.");
const credential = cert(key); const app = initializeApp({ projectId: "litterspot", credential }, "migration-cloud");
async function api(path: string, method = "GET", body?: any) {
  const token = await credential.getAccessToken();
  const response = await fetch(`https://${path}`, { method, headers: { authorization: `Bearer ${token.access_token}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
  const data = await response.json();
  if (!response.ok) throw new Error(`Cloud API failed (${response.status}): ${data.error?.message ?? "Request failed"}`);
  return data;
}
const databases = async () => (await api("firestore.googleapis.com/v1/projects/litterspot/databases")).databases ?? [];
async function authUsers() {
  const users: any[] = []; let pageToken: string | undefined;
  do { const page = await getAuth(app).listUsers(1000, pageToken); users.push(...page.users.map(user => user.toJSON())); pageToken = page.pageToken; } while (pageToken);
  return users;
}
async function waitOperation(operation: any) {
  while (!operation.done) { await new Promise(done => setTimeout(done, 2000)); operation = await api(`firestore.googleapis.com/v1/${operation.name}`); }
  if (operation.error) throw new Error(`Database operation failed: ${operation.error.message}`);
}
async function databaseAdminCli(args: string[]) {
  const environment = { ...process.env }; delete environment.GOOGLE_APPLICATION_CREDENTIALS;
  const output = await promisify(execFile)(process.execPath, [resolve(repositoryRoot, "node_modules/firebase-tools/lib/bin/firebase.js"), ...args, "--project", "litterspot", "--non-interactive"], { cwd: repositoryRoot, env: environment });
  console.log(output.stdout.trim());
}
if (mode === "inspect") {
  const dbs = await databases(); const users = await authUsers();
  console.log(JSON.stringify({ mode, databases: dbs.map((db: any) => ({ name: db.name, locationId: db.locationId, type: db.type })), authUserCount: users.length }, null, 2)); process.exit(0);
}
if (mode === "backup") {
  const dbs = await databases();
  if (dbs.length !== 1 || dbs[0].name !== "projects/litterspot/databases/litterspot") throw new Error("Backup expects only the resolved named V1 litterspot database. No reset is permitted.");
  const data = await archiveFirestore(getFirestore(app, "litterspot"));
  const users = await authUsers(); const authConfig = await api("identitytoolkit.googleapis.com/admin/v2/projects/litterspot/config");
  const indexes = await api("firestore.googleapis.com/v1/projects/litterspot/databases/litterspot/collectionGroups/-/indexes");
  const rules = await api("firebaserules.googleapis.com/v1/projects/litterspot/releases?pageSize=100");
  const rulesets = [];
  for (const release of rules.releases ?? []) if (release.rulesetName) rulesets.push(await api(`firebaserules.googleapis.com/v1/${release.rulesetName}`));
  await save("destination-firestore.json", data); await save("destination-auth.json", users); await save("destination-auth-config.json", authConfig); await save("destination-databases.json", dbs); await save("destination-rules.json", { rules, rulesets }); await save("destination-indexes.json", indexes);
  await save("checkpoint.json", { phase: "backed_up", sourceSha256: (await read("source-firestore.json")).sha256, destinationSha256: data.sha256, destinationAuthUids: users.map(user => user.uid), oldDatabase: "litterspot", newDatabase: "(default)", location: dbs[0].locationId });
  if (archiveHash((await read("destination-firestore.json")).documents) !== data.sha256) throw new Error("Destination backup checksum failed.");
  console.log(JSON.stringify({ mode, documentCount: data.documents.length, authUserCount: users.length, sha256: data.sha256, passwordHashBackupCount: users.filter(user => user.passwordHash).length, authConfigKeys: Object.keys(authConfig), signInKeys: Object.keys(authConfig.signIn ?? {}) }, null, 2)); process.exit(0);
}
const source = await read("source-firestore.json"); const sourceAuth = await read("source-auth.json"); const checkpoint = await read("checkpoint.json");
if (archiveHash(source.documents) !== source.sha256 || source.sha256 !== checkpoint.sourceSha256) throw new Error("The source archive changed after backup.");
const importedUsers = sourceAuth.users.map(emulatorUserForImport);
const target = getFirestore(app);
const desiredDocuments: ArchivedDocument[] = source.documents.map((document: ArchivedDocument) => {
  const data = restoreValue(document.data, target);
  if (document.path === "systemMetadata/schema") { data.firebaseProjectId = "litterspot"; data.firestoreDatabaseId = "(default)"; data.environment = "production-cloud"; }
  return { path: document.path, data: archiveValue(data) };
});
if (mode === "apply") {
  if (!process.argv.includes("--confirm=litterspot/litterspot-to-default")) throw new Error("Apply requires the exact resolved reset confirmation.");
  if (checkpoint.phase === "backed_up") {
    const backup = await read("destination-firestore.json");
    if (archiveHash(backup.documents) !== checkpoint.destinationSha256) throw new Error("Destination backup checksum failed.");
    const currentDbs = await databases();
    if (currentDbs.length !== 1 || currentDbs[0].name !== "projects/litterspot/databases/litterspot") throw new Error("Destination database inventory changed. Reset stopped.");
    const currentUsers = await authUsers();
    if (JSON.stringify(currentUsers.map(user => user.uid).sort()) !== JSON.stringify([...checkpoint.destinationAuthUids].sort())) throw new Error("Destination accounts changed. Reset stopped.");
    const liveBackup = await archiveFirestore(getFirestore(app, "litterspot"));
    if (liveBackup.sha256 !== checkpoint.destinationSha256) throw new Error("V1 data changed after backup. Reset stopped.");
    if (process.argv.includes("--database-admin=cli")) {
      await databaseAdminCli(["firestore:databases:delete", "litterspot", "--force"]);
      checkpoint.phase = "old_database_deleted"; await save("checkpoint.json", checkpoint);
    } else {
      checkpoint.databaseOperation = await api("firestore.googleapis.com/v1/projects/litterspot/databases/litterspot", "DELETE");
      checkpoint.phase = "old_database_deleting"; await save("checkpoint.json", checkpoint);
    }
  }
  if (checkpoint.phase === "old_database_deleting") {
    await waitOperation(checkpoint.databaseOperation);
    checkpoint.phase = "old_database_deleted"; await save("checkpoint.json", checkpoint); console.log("Named V1 database deleted; verified backup retained.");
  }
  if (checkpoint.phase === "old_database_deleted") {
    const result = await getAuth(app).deleteUsers(checkpoint.destinationAuthUids);
    if (result.failureCount) throw new Error("Some V1 accounts could not be removed. Resume required.");
    if (process.argv.includes("--database-admin=cli")) {
      await databaseAdminCli(["firestore:databases:create", "(default)", "--location", checkpoint.location]);
      checkpoint.phase = "default_database_created"; await save("checkpoint.json", checkpoint);
    } else {
      checkpoint.databaseOperation = await api("firestore.googleapis.com/v1/projects/litterspot/databases?databaseId=%28default%29", "POST", { locationId: checkpoint.location, type: "FIRESTORE_NATIVE" });
      checkpoint.phase = "default_database_creating"; await save("checkpoint.json", checkpoint);
    }
  }
  if (checkpoint.phase === "default_database_creating") {
    await waitOperation(checkpoint.databaseOperation);
    checkpoint.phase = "default_database_created"; await save("checkpoint.json", checkpoint); console.log("Default database created in the original region.");
  }
  if (process.argv.includes("--prepare-only") && checkpoint.phase === "default_database_created") process.exit(0);
  if (checkpoint.phase === "default_database_created" || checkpoint.phase === "documents_importing") {
    checkpoint.phase = "documents_importing";
    for (let offset = checkpoint.documentOffset ?? 0; offset < desiredDocuments.length; offset += 200) {
      const batch = target.batch();
      for (const document of desiredDocuments.slice(offset, offset + 200)) batch.set(target.doc(document.path), restoreValue(document.data, target));
      await batch.commit(); checkpoint.documentOffset = Math.min(offset + 200, desiredDocuments.length); await save("checkpoint.json", checkpoint);
      console.log(`Firestore copied ${checkpoint.documentOffset}/${desiredDocuments.length}.`);
    }
    checkpoint.phase = "documents_imported"; await save("checkpoint.json", checkpoint);
  }
  if (checkpoint.phase === "documents_imported") {
    const result = await getAuth(app).importUsers(importedUsers, migrationPasswordHashOptions);
    if (result.failureCount) throw new Error(`Auth import failed for ${result.failureCount} records. Checkpoint retained.`);
    checkpoint.phase = "auth_imported"; await save("checkpoint.json", checkpoint); console.log(`Auth copied ${result.successCount} identities with preserved UIDs.`);
  }
}
let mismatchCount = 0;
for (let offset = 0; offset < desiredDocuments.length; offset += 100) {
  const expected = desiredDocuments.slice(offset, offset + 100); const actual = await target.getAll(...expected.map(document => target.doc(document.path)));
  actual.forEach((document, index) => { if (!document.exists || JSON.stringify(archiveValue(document.data())) !== JSON.stringify(expected[index].data)) mismatchCount++; });
}
const users = await authUsers();
const authProjection = (user: any) => ({ uid: user.uid, email: user.email ?? null, emailVerified: Boolean(user.emailVerified), displayName: user.displayName ?? null, disabled: Boolean(user.disabled), phoneNumber: user.phoneNumber ?? null, photoURL: user.photoURL ?? null, customClaims: user.customClaims ?? {}, providerData: (user.providerData ?? []).filter((provider: any) => provider.providerId !== "password").map((provider: any) => ({ uid: provider.uid, providerId: provider.providerId, email: provider.email ?? null, displayName: provider.displayName ?? null, photoURL: provider.photoURL ?? null })) });
const expectedAuth = importedUsers.map(authProjection).sort((a: any, b: any) => a.uid.localeCompare(b.uid));
const actualAuth = users.map(authProjection).sort((a, b) => a.uid.localeCompare(b.uid));
if (mismatchCount || JSON.stringify(actualAuth) !== JSON.stringify(expectedAuth)) throw new Error(`Migration parity failed: ${mismatchCount} Firestore mismatches or Auth profile mismatch.`);
await save("verification.json", { projectId: "litterspot", databaseId: "(default)", documentCount: desiredDocuments.length, sourceSha256: source.sha256, destinationSha256: archiveHash(desiredDocuments), authUserCount: users.length, mismatchCount, environmentMarkerAdapted: true, verifiedAt: new Date().toISOString() });
checkpoint.phase = "verified"; await save("checkpoint.json", checkpoint);
console.log(JSON.stringify({ mode, status: "verified", documentCount: desiredDocuments.length, authUserCount: users.length, mismatchCount }, null, 2));
process.exit(0);
