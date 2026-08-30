import { describe, expect, it } from "vitest";
import { assertSafeFirebaseTarget } from "./firebaseTargetSafety.js";

describe("Firebase target safety", () => {
  it("accepts an explicitly matched development cloud target", () => {
    expect(() => assertSafeFirebaseTarget({
      appEnvironment: "development-cloud",
      firebaseProjectId: "litterspot-dev-jeremy",
      expectedFirebaseProjectId: "litterspot-dev-jeremy",
      credentialProjectId: "litterspot-dev-jeremy",
      emulatorMode: false,
    })).not.toThrow();
  });

  it("rejects a configured or credential project mismatch", () => {
    expect(() => assertSafeFirebaseTarget({
      appEnvironment: "development-cloud",
      firebaseProjectId: "litterspot",
      expectedFirebaseProjectId: "litterspot-dev-jeremy",
      credentialProjectId: "litterspot",
      emulatorMode: false,
    })).toThrow(/target mismatch/i);
    expect(() => assertSafeFirebaseTarget({
      appEnvironment: "development-cloud",
      firebaseProjectId: "litterspot-dev-jeremy",
      expectedFirebaseProjectId: "litterspot-dev-jeremy",
      credentialProjectId: "litterspot",
      emulatorMode: false,
    })).toThrow(/credential project/i);
  });

  it("requires emulator hosts only in local-emulator mode", () => {
    expect(() => assertSafeFirebaseTarget({
      appEnvironment: "local-emulator",
      firebaseProjectId: "demo-litterspot",
      expectedFirebaseProjectId: "demo-litterspot",
      credentialProjectId: null,
      emulatorMode: true,
    })).not.toThrow();
    expect(() => assertSafeFirebaseTarget({
      appEnvironment: "local-emulator",
      firebaseProjectId: "demo-litterspot",
      expectedFirebaseProjectId: "demo-litterspot",
      credentialProjectId: null,
      emulatorMode: false,
    })).toThrow(/requires both/i);
  });
});
