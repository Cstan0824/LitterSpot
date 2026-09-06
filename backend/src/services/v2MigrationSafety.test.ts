import { describe, expect, it } from "vitest";
import { assertV2MigrationTarget, requiredApplyConfirmation, validateV2SchemaMarker } from "./v2MigrationSafety.js";

describe("V2 migration safety", () => {
  it("allows only the isolated cloud target and the demo emulator target", () => {
    expect(() => assertV2MigrationTarget({ appEnvironment: "development-cloud", firebaseProjectId: "litterspot-v2-database", expectedFirebaseProjectId: "litterspot-v2-database", firestoreDatabaseId: "(default)", emulator: false })).not.toThrow();
    expect(() => assertV2MigrationTarget({ appEnvironment: "local-emulator", firebaseProjectId: "demo-litterspot", expectedFirebaseProjectId: "demo-litterspot", firestoreDatabaseId: "(default)", emulator: true })).not.toThrow();
    expect(() => assertV2MigrationTarget({ appEnvironment: "development-cloud", firebaseProjectId: "unexpected", expectedFirebaseProjectId: "litterspot-v2-database", firestoreDatabaseId: "(default)", emulator: false })).toThrow(/exact/i);
    expect(() => assertV2MigrationTarget({ appEnvironment: "development-cloud", firebaseProjectId: "litterspot-v2-database", expectedFirebaseProjectId: "litterspot-v2-database", firestoreDatabaseId: "(default)", emulator: true })).toThrow(/exact/i);
  });

  it("requires an exact human-readable apply confirmation", () => {
    expect(requiredApplyConfirmation({ firebaseProjectId: "litterspot-v2-database", firestoreDatabaseId: "(default)" })).toBe("litterspot-v2-database/(default)");
  });

  it("rejects a missing, incomplete, or mismatched schema marker", () => {
    const target = { appEnvironment: "development-cloud" as const, firebaseProjectId: "litterspot-v2-database", expectedFirebaseProjectId: "litterspot-v2-database", firestoreDatabaseId: "(default)", emulator: false };
    expect(validateV2SchemaMarker(false, undefined, target)).toEqual(["systemMetadata/schema is missing"]);
    expect(validateV2SchemaMarker(true, { schemaVersion: 2, databaseModel: "litterspot-firestore-v2", migrationState: "ready", firebaseProjectId: "litterspot-v2-database", firestoreDatabaseId: "(default)", environment: "development-cloud" }, target)).toEqual([]);
    expect(validateV2SchemaMarker(true, { schemaVersion: 1, databaseModel: "legacy", migrationState: "initializing", firebaseProjectId: "litterspot", firestoreDatabaseId: "litterspot", environment: "production-cloud" }, target)).toHaveLength(6);
  });
});
