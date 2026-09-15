import { describe, expect, it } from "vitest";
import { deriveSupervisorCapabilities } from "../../services/api/session";
import { supervisorCameraPageAccess } from "./OperationsConsole";

describe("Supervisor Camera controls", () => {
  it.each(["root", "regular"] as const)("keeps Camera enable and disable controls available to a %s Supervisor", (authority) => {
    expect(supervisorCameraPageAccess(deriveSupervisorCapabilities(authority))).toMatchObject({
      readOnly: false,
      allowWorkActions: true,
      canManageCameraPlacement: authority === "root",
    });
  });
});
