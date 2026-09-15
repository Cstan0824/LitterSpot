export type NotificationRecord = {
  schemaVersion: 2; notificationId: string; siteId: string; recipientUid: string; recipientRole: "supervisor" | "cleaner";
  type: string; title: string; body: string; entityType: "alert" | "work_order" | "camera" | "orchestrator_run" | "site"; entityId: string;
  cameraId: string | null; alertId: string | null; workOrderId: string | null; severity: "warning" | "critical" | null; isSimulation: boolean;
};

export function canReadNotification(notification: Pick<NotificationRecord, "recipientUid">, authUid: string | null) { return Boolean(authUid && notification.recipientUid === authUid); }

