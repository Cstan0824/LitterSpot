import { describe, expect, it } from "vitest";
import { assertDatabaseInspectionTarget, assertMigrationTarget, requiredApplyConfirmation, validateSchemaMarker } from "./databaseSafety.js";

describe("migration safety", () => {
  it("allows only the isolated cloud target and the demo emulator target", () => {
    expect(() => assertMigrationTarget({ appEnvironment: "development-cloud", firebaseProjectId: "litterspot", expectedFirebaseProjectId: "litterspot", firestoreDatabaseId: "(default)", emulator: false })).not.toThrow();
    expect(() => assertMigrationTarget({ appEnvironment: "local-emulator", firebaseProjectId: "demo-litterspot", expectedFirebaseProjectId: "demo-litterspot", firestoreDatabaseId: "(default)", emulator: true })).not.toThrow();
    expect(() => assertMigrationTarget({ appEnvironment: "development-cloud", firebaseProjectId: "unexpected", expectedFirebaseProjectId: "litterspot", firestoreDatabaseId: "(default)", emulator: false })).toThrow(/exact/i);
    expect(() => assertMigrationTarget({ appEnvironment: "development-cloud", firebaseProjectId: "litterspot", expectedFirebaseProjectId: "litterspot", firestoreDatabaseId: "(default)", emulator: true })).toThrow(/exact/i);
    expect(() => assertMigrationTarget({ appEnvironment: "production-cloud", firebaseProjectId: "litterspot", expectedFirebaseProjectId: "litterspot", firestoreDatabaseId: "(default)", emulator: false })).toThrow(/development database/i);
  });

  it("allows exact production inspection without allowing production mutation", () => {
    expect(() => assertDatabaseInspectionTarget({ appEnvironment: "production-cloud", firebaseProjectId: "litterspot", expectedFirebaseProjectId: "litterspot", firestoreDatabaseId: "(default)", emulator: false })).not.toThrow();
    expect(() => assertDatabaseInspectionTarget({ appEnvironment: "production-cloud", firebaseProjectId: "another-project", expectedFirebaseProjectId: "litterspot", firestoreDatabaseId: "(default)", emulator: false })).toThrow(/exact/i);
  });

  it("requires an exact human-readable apply confirmation", () => {
    expect(requiredApplyConfirmation({ firebaseProjectId: "litterspot", firestoreDatabaseId: "(default)" })).toBe("litterspot/(default)");
  });

  it("rejects a missing, incomplete, or mismatched schema marker", () => {
    const target = { appEnvironment: "development-cloud" as const, firebaseProjectId: "litterspot", expectedFirebaseProjectId: "litterspot", firestoreDatabaseId: "(default)", emulator: false };
    expect(validateSchemaMarker(false, undefined, target)).toEqual(["systemMetadata/schema is missing"]);
    expect(validateSchemaMarker(true, { schemaVersion: 2, databaseModel: "litterspot-firestore", migrationState: "ready", firebaseProjectId: "litterspot", firestoreDatabaseId: "(default)", environment: "development-cloud" }, target)).toEqual([]);
    expect(validateSchemaMarker(true, { schemaVersion: 1, databaseModel: "legacy", migrationState: "initializing", firebaseProjectId: "another-project", firestoreDatabaseId: "litterspot", environment: "production-cloud" }, target)).toHaveLength(6);
  });
});
