export const V2_SCHEMA_VERSION = 2 as const;
export const V2_DATABASE_MODEL = "litterspot-firestore-v2" as const;

export const V2_COLLECTIONS = [
  "userAccounts",
  "userAccountEmails",
  "identityOperations",
  "supervisors",
  "cleaners",
  "cleanerStaffCodeKeys",
  "sites",
  "siteOperations",
  "zones",
  "siteMapDrafts",
  "siteMapRevisions",
  "cameraDrafts",
  "cameras",
  "cameraSourceRevisions",
  "cameraRegistrations",
  "cameraRegistrationRevisions",
  "cameraRuntimeStates",
  "monitoringSessions",
  "monitoringEpisodes",
  "mediaAssets",
  "processingJobs",
  "analysisRuns",
  "detections",
  "flags",
  "activeAlertKeys",
  "alerts",
  "activeWorkOrderKeys",
  "workOrders",
  "operationKeys",
  "orchestratorConfigs",
  "orchestratorOutbox",
  "orchestratorRuns",
  "notifications",
  "auditEvents",
  "systemEvents",
  "systemMetadata",
  "analyticsMinuteBuckets",
  "analyticsDailySummaries",
  "dashboardSummaries",
  "binPlacementSnapshots",
  "binPlacementInterventions",
] as const;

export type V2CollectionName = (typeof V2_COLLECTIONS)[number];

export const RETIRED_V1_COLLECTIONS = [
  "cleanerPresence",
  "locationHistory",
  "cleanerPushTokens",
  "alertConfirmationStates",
  "alertConfirmationResets",
  "reviewRequests",
  "reviews",
  "workOrderDecisions",
  "assignmentAttempts",
  "analyticsBuckets",
  "analyticsSites",
  "analyticsReconciliationLocks",
  "analyticsSampleApplications",
  "analyticsIncidentApplications",
  "analyticsPersistenceStates",
  "analyticsReports",
  "binReplacementRecommendations",
] as const;

export const V2_RESET_COLLECTIONS = [...V2_COLLECTIONS, ...RETIRED_V1_COLLECTIONS] as const;

export function isV2CollectionName(value: string): value is V2CollectionName {
  return (V2_COLLECTIONS as readonly string[]).includes(value);
}

