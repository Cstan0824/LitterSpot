export type IssueType =
  | "BIN_OVERFLOW"
  | "LIQUID_SPILL"
  | "DRY_LITTER";

export type AlertSeverity = "HIGH" | "LOW";

export type AlertStatus =
  | "NEW"
  | "ACKNOWLEDGED"
  | "IN_PROGRESS"
  | "RESOLVED";

export interface CleanlinessAlert {
  id: string;
  issueType: IssueType;
  zoneId: string;
  zoneName: string;
  severity: AlertSeverity;
  status: AlertStatus;
  confidence: number;
  snapshotUrl: string;
  detectedAt: string;
  updatedAt: string;
}

export const issueTypeLabels: Record<IssueType, string> = {
  BIN_OVERFLOW: "Bin Overflow",
  LIQUID_SPILL: "Liquid Spill",
  DRY_LITTER: "Dry Litter"
};

export const statusLabels: Record<AlertStatus, string> = {
  NEW: "New",
  ACKNOWLEDGED: "Acknowledged",
  IN_PROGRESS: "In Progress",
  RESOLVED: "Resolved"
};