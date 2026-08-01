export type AlertStatus =
    | 'NEW'
    | 'ACKNOWLEDGED'
    | 'IN_PROGRESS'
    | 'RESOLVED';

export type AlertSeverity = 'HIGH' | 'LOW';

export type CleanlinessAlert = {
    id: string;
    issueType: 'BIN_OVERFLOW' | 'DRY_LITTER' | 'LIQUID_SPILL';
    zoneId: string;
    zoneName: string;
    severity: AlertSeverity;
    status: AlertStatus;
    confidence_rate: number;
    snapshotUrl: string;
    detectedAt: string;
    updatedAt: string;
};

export const alerts: CleanlinessAlert[] = [
  {
    id: "ALT-001",
    issueType: "LIQUID_SPILL",
    zoneId: "ZONE-A",
    zoneName: "Main Entrance",
    severity: "HIGH",
    status: "NEW",
    confidence_rate: 0.93,
    snapshotUrl: "/mock/spill.jpg",
    detectedAt: "2026-07-16T10:30:00.000Z",
    updatedAt: "2026-07-16T10:30:00.000Z"
  },
  {
    id: "ALT-002",
    issueType: "DRY_LITTER",
    zoneId: "ZONE-B",
    zoneName: "Food Court",
    severity: "LOW",
    status: "ACKNOWLEDGED",
    confidence_rate: 0.86,
    snapshotUrl: "/mock/litter.jpg",
    detectedAt: "2026-07-16T10:35:00.000Z",
    updatedAt: "2026-07-16T10:40:00.000Z"
  },
  {
    id: "ALT-003",
    issueType: "BIN_OVERFLOW",
    zoneId: "ZONE-C",
    zoneName: "Theme Park Exit",
    severity: "HIGH",
    status: "IN_PROGRESS",
    confidence_rate: 0.91,
    snapshotUrl: "/mock/overflow.jpg",
    detectedAt: "2026-07-16T10:45:00.000Z",
    updatedAt: "2026-07-16T10:50:00.000Z"
  }
];