import { describe, expect, it } from "vitest";
import { assertV2MigrationTarget, requiredApplyConfirmation, validateV2SchemaMarker } from "./v2MigrationSafety.js";

describe("V2 migration safety", () => {
  it("allows only the isolated cloud target and the demo emulator target", () => {
    expect(() => assertV2MigrationTarget({ appEnvironment: "development-cloud", firebaseProjectId: "litterspot-dev-jeremy", firestoreDatabaseId: "(default)", emulator: false })).not.toThrow();
    expect(() => assertV2MigrationTarget({ appEnvironment: "local-emulator", firebaseProjectId: "demo-litterspot", firestoreDatabaseId: "litterspot", emulator: true })).not.toThrow();
    expect(() => assertV2MigrationTarget({ appEnvironment: "development-cloud", firebaseProjectId: "litterspot", firestoreDatabaseId: "litterspot", emulator: false })).toThrow(/limited/i);
    expect(() => assertV2MigrationTarget({ appEnvironment: "development-cloud", firebaseProjectId: "litterspot-dev-jeremy", firestoreDatabaseId: "(default)", emulator: true })).toThrow(/limited/i);
  });

  it("requires an exact human-readable apply confirmation", () => {
    expect(requiredApplyConfirmation({ firebaseProjectId: "litterspot-dev-jeremy", firestoreDatabaseId: "(default)" })).toBe("litterspot-dev-jeremy/(default)");
  });

  it("rejects a missing, incomplete, or mismatched schema marker", () => {
    const target = { appEnvironment: "development-cloud" as const, firebaseProjectId: "litterspot-dev-jeremy", firestoreDatabaseId: "(default)", emulator: false };
    expect(validateV2SchemaMarker(false, undefined, target)).toEqual(["systemMetadata/schema is missing"]);
    expect(validateV2SchemaMarker(true, { schemaVersion: 2, databaseModel: "litterspot-firestore-v2", migrationState: "ready", firebaseProjectId: "litterspot-dev-jeremy", firestoreDatabaseId: "(default)", environment: "development-cloud" }, target)).toEqual([]);
    expect(validateV2SchemaMarker(true, { schemaVersion: 1, databaseModel: "legacy", migrationState: "initializing", firebaseProjectId: "litterspot", firestoreDatabaseId: "litterspot", environment: "production-cloud" }, target)).toHaveLength(6);
  });
});
