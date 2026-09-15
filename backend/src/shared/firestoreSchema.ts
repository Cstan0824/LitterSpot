export const SCHEMA_VERSION = 2 as const;
export const DATABASE_MODEL = "litterspot-firestore" as const;

export const COLLECTIONS = [
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
  "phase11MaintenanceStates",
  "binPlacementSnapshots",
  "binPlacementInterventions",
] as const;

export type CollectionName = (typeof COLLECTIONS)[number];

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

export const RESET_COLLECTIONS = [...COLLECTIONS, ...RETIRED_V1_COLLECTIONS] as const;

export function isCollectionName(value: string): value is CollectionName {
  return (COLLECTIONS as readonly string[]).includes(value);
}
