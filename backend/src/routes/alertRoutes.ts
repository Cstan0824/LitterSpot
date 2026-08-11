import { Router } from "express";
import { z } from "zod";
import {
  alerts,
  type AlertStatus
} from "../data/alertStore.js";

export const alertRoutes = Router();

const statusSchema = z.object({
  status: z.enum([
    "NEW",
    "ACKNOWLEDGED",
    "IN_PROGRESS",
    "RESOLVED"
  ])
});

// Retrieve all alerts
alertRoutes.get("/", (_req, res) => {
  res.json(alerts);
});

// Retrieve one alert
alertRoutes.get("/:alertId", (req, res) => {
  const alert = alerts.find(
    (item) => item.id === req.params.alertId
  );

  if (!alert) {
    return res.status(404).json({
      error: "Alert not found."
    });
  }

  return res.json(alert);
});

// Update alert status
alertRoutes.patch("/:alertId/status", (req, res) => {
  const parsed = statusSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid alert status."
    });
  }

  const alert = alerts.find(
    (item) => item.id === req.params.alertId
  );

  if (!alert) {
    return res.status(404).json({
      error: "Alert not found."
    });
  }

  const nextStatus: AlertStatus = parsed.data.status;

  alert.status = nextStatus;
  alert.updatedAt = new Date().toISOString();

  return res.json(alert);
});