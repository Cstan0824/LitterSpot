import { v2Request } from "./http";

export type SuperadminSession = {
  role: "superadmin";
  superadmin: { uid: string; email: string; displayName: string };
};

export type SupervisorAuthority = "root" | "regular";

export type SupervisorSession = {
  role: "supervisor";
  supervisor: {
    uid: string;
    email: string;
    displayName: string;
    siteId: string;
    authority: SupervisorAuthority;
  };
};

export type CleanerSession = {
  role: "cleaner";
  cleaner: {
    uid: string;
    cleanerId: string;
    email: string;
    displayName: string;
    assignedSiteId: string;
    assignedZoneId?: string;
    permittedSiteIds?: string[];
    permittedZoneIds?: string[];
    capabilities?: string[];
  };
};

export type ApplicationSession = SuperadminSession | SupervisorSession | CleanerSession;

export type SupervisorCapabilities = {
  manageSupervisors: boolean;
  configureSiteMap: boolean;
  manageCameraPlacement: boolean;
  registerCameras: boolean;
  manageCleaners: boolean;
  manageAlertsAndWork: boolean;
  manageOrchestrator: boolean;
};

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is missing from the session response.`);
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is missing from the session response.`);
  return value;
}

function optionalStrings(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined;
}

export function parseSessionResponse(value: unknown): ApplicationSession {
  const body = record(value, "Session");
  if (body.role === "superadmin") {
    const profile = record(body.superadmin, "Superadmin");
    return { role: "superadmin", superadmin: { uid: string(profile.uid, "Superadmin UID"), email: string(profile.email, "Superadmin email"), displayName: string(profile.displayName, "Superadmin display name") } };
  }
  if (body.role === "supervisor") {
    const profile = record(body.supervisor, "Supervisor");
    const authority = profile.authority;
    if (authority !== "root" && authority !== "regular") throw new Error("Supervisor authority is missing from the session response.");
    return { role: "supervisor", supervisor: { uid: string(profile.uid, "Supervisor UID"), email: string(profile.email, "Supervisor email"), displayName: string(profile.displayName, "Supervisor display name"), siteId: string(profile.siteId, "Supervisor Site"), authority } };
  }
  if (body.role === "cleaner") {
    const profile = record(body.cleaner, "Cleaner");
    return {
      role: "cleaner",
      cleaner: {
        uid: string(profile.uid, "Cleaner UID"),
        cleanerId: string(profile.cleanerId, "Cleaner ID"),
        email: string(profile.email, "Cleaner email"),
        displayName: string(profile.displayName, "Cleaner display name"),
        assignedSiteId: string(profile.assignedSiteId, "Cleaner Site"),
        assignedZoneId: typeof profile.assignedZoneId === "string" ? profile.assignedZoneId : undefined,
        permittedSiteIds: optionalStrings(profile.permittedSiteIds),
        permittedZoneIds: optionalStrings(profile.permittedZoneIds),
        capabilities: optionalStrings(profile.capabilities),
      },
    };
  }
  throw new Error("The application role returned by /api/me is not supported.");
}

export async function getApplicationSession(signal?: AbortSignal) {
  return parseSessionResponse(await v2Request<unknown>("/api/me", { signal }));
}

export function deriveSupervisorCapabilities(authority: SupervisorAuthority): SupervisorCapabilities {
  const root = authority === "root";
  return {
    manageSupervisors: root,
    configureSiteMap: root,
    manageCameraPlacement: root,
    registerCameras: true,
    manageCleaners: true,
    manageAlertsAndWork: true,
    manageOrchestrator: true,
  };
}
