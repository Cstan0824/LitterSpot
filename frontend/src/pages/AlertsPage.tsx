import { useEffect, useMemo, useState } from "react";
import {
  getAlerts,
  updateAlertStatus
} from "../services/alertAPI";
import {
  issueTypeLabels,
  statusLabels,
  type AlertSeverity,
  type AlertStatus,
  type CleanlinessAlert,
  type IssueType
} from "../types/alert";

type StatusFilter = "ALL" | AlertStatus;
type SeverityFilter = "ALL" | AlertSeverity;
type IssueTypeFilter = "ALL" | IssueType;
type ZoneFilter = "ALL" | string;

function getNextStatus(
  currentStatus: AlertStatus
): AlertStatus | null {
  switch (currentStatus) {
    case "NEW":
      return "ACKNOWLEDGED";

    case "ACKNOWLEDGED":
      return "IN_PROGRESS";

    case "IN_PROGRESS":
      return "RESOLVED";

    case "RESOLVED":
      return null;
  }
}

function getActionLabel(status: AlertStatus): string {
  switch (status) {
    case "NEW":
      return "Acknowledge";

    case "ACKNOWLEDGED":
      return "Start Work";

    case "IN_PROGRESS":
      return "Mark Resolved";

    case "RESOLVED":
      return "Resolved";
  }
}

export function AlertsPage() {
  const [alerts, setAlerts] = useState<
    CleanlinessAlert[]
  >([]);

  const [statusFilter, setStatusFilter] =
    useState<StatusFilter>("ALL");

  const [severityFilter, setSeverityFilter] =
    useState<SeverityFilter>("ALL");

  const [issueTypeFilter, setIssueTypeFilter] =
    useState<IssueTypeFilter>("ALL");

  const [zoneFilter, setZoneFilter] =
    useState<ZoneFilter>("ALL");

  const [loading, setLoading] = useState(true);
  const [updatingAlertId, setUpdatingAlertId] =
    useState<string>();

  const [error, setError] = useState<string>();

  async function loadAlerts(): Promise<void> {
    setLoading(true);
    setError(undefined);

    try {
      const results = await getAlerts();
      setAlerts(results);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to retrieve alerts."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAlerts();
  }, []);

    const zoneOptions = useMemo(() => {
        return Array.from(
            new Set(alerts.map((alert) => alert.zoneName))
        ).sort();
        }, [alerts]);

  const displayedAlerts = useMemo(() => {
    return alerts.filter((alert) => {
        const matchesStatus =
        statusFilter === "ALL" || alert.status === statusFilter;

        const matchesSeverity =
        severityFilter === "ALL" || alert.severity === severityFilter;

        const matchesIssueType =
        issueTypeFilter === "ALL" || alert.issueType === issueTypeFilter;

        const matchesZone =
        zoneFilter === "ALL" || alert.zoneName === zoneFilter;

        return matchesStatus && matchesSeverity && matchesIssueType;
    }
    );
  }, [alerts, statusFilter,severityFilter, issueTypeFilter,zoneFilter]);

  const activeAlertCount = alerts.filter(
    (alert) => alert.status !== "RESOLVED"
  ).length;

  const highSeverityCount = alerts.filter(
    (alert) =>
      alert.status !== "RESOLVED" &&
      alert.severity === "HIGH"
  ).length;

  async function handleStatusUpdate(
    alert: CleanlinessAlert
  ): Promise<void> {
    const nextStatus = getNextStatus(alert.status);

    if (!nextStatus) {
      return;
    }

    setUpdatingAlertId(alert.id);
    setError(undefined);

    try {
      const updatedAlert = await updateAlertStatus(
        alert.id,
        nextStatus
      );

      setAlerts((currentAlerts) =>
        currentAlerts.map((currentAlert) =>
          currentAlert.id === updatedAlert.id
            ? updatedAlert
            : currentAlert
        )
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to update the alert."
      );
    } finally {
      setUpdatingAlertId(undefined);
    }
  }

  return (
    <main className="app-shell dashboard-shell">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">
            LITTERSPOT / FLAGGING MODULE
          </p>

          <h1>
            Cleanliness
            <br />
            <em>alerts.</em>
          </h1>
        </div>

        <div className="hero-actions">
          <button
            className="quiet nav-button"
            onClick={() => {
              location.hash = "/";
            }}
          >
            Dashboard
          </button>

          <button
            className="primary"
            onClick={() => void loadAlerts()}
            disabled={loading}
          >
            {loading ? "Refreshing…" : "Refresh Alerts"}
          </button>
        </div>
      </header>

      <section className="dashboard-grid">
        <article className="card status-card">
          <p className="eyebrow">Current workload</p>

          <div className="service-row">
            <span>Active alerts</span>
            <b>{activeAlertCount}</b>
          </div>

          <div className="service-row">
            <span>High-severity alerts</span>
            <b className={highSeverityCount > 0 ? "bad" : "good"}>
              {highSeverityCount}
            </b>
          </div>

          <div className="service-row">
            <span>Total alert records</span>
            <b>{alerts.length}</b>
          </div>
        </article>

        <article className="card status-card">
          <p className="eyebrow">Filter alerts</p>

          <label className="control">
            <span>Status</span>
            <select
              value={statusFilter}
              onChange={(event) => {
                setStatusFilter(event.target.value as StatusFilter);
              }}
            >
              <option value="ALL">All statuses</option>
              <option value="NEW">New</option>
              <option value="ACKNOWLEDGED">Acknowledged</option>
              <option value="IN_PROGRESS">In progress</option>
              <option value="RESOLVED">Resolved</option>
            </select>

            <span>Severity</span>

            <select
              value={severityFilter}
              onChange={(event) => {
                setSeverityFilter(event.target.value as SeverityFilter);
              }}
            >
              <option value="ALL">All severities</option>
              <option value="HIGH">High</option>
              <option value="LOW">Low</option>
            </select>
          </label>

            <label className="control">
            <span>Issue Type</span>

            <select
                value={issueTypeFilter}
                onChange={(event) => {
                setIssueTypeFilter(
                    event.target.value as IssueTypeFilter
                );
                }}
            >
                <option value="ALL">All issue types</option>
                <option value="BIN_OVERFLOW">
                Bin Overflow
                </option>
                <option value="LIQUID_SPILL">
                Liquid Spill
                </option>
                <option value="DRY_LITTER">
                Dry Litter
                </option>
            </select>
            </label>

            <label className="control">
            <span>Zone</span>

            <select
                value={zoneFilter}
                onChange={(event) => {
                setZoneFilter(event.target.value);
                }}
            >
                <option value="ALL">All zones</option>

                {zoneOptions.map((zone) => (
                <option value={zone} key={zone}>
                    {zone}
                </option>
                ))}
            </select>
            </label>
        </article>
      </section>

    <button
    className="quiet"
    onClick={() => {
        setStatusFilter("ALL");
        setSeverityFilter("ALL");
        setIssueTypeFilter("ALL");
        setZoneFilter("ALL");
    }}
    >
    Clear Filters
    </button>

      {error && (
        <section className="card results-card">
          <p className="error">{error}</p>

          <button
            className="primary"
            onClick={() => void loadAlerts()}
          >
            Try Again
          </button>
        </section>
      )}

      {loading ? (
        <section className="card results-card">
          <p className="muted">Loading alert records…</p>
        </section>
      ) : (
        <section className="dashboard-grid results-card">
          {displayedAlerts.map((alert) => {
            const nextStatus = getNextStatus(alert.status);
            const updating =
              updatingAlertId === alert.id;

            return (
              <article className="card" key={alert.id}>
                <div className="card-heading">
                  <div>
                    <span className="step">
                      {alert.id}
                    </span>

                    <h2>
                      {issueTypeLabels[alert.issueType]}
                    </h2>
                  </div>

                  <span
                    className={
                      alert.severity === "HIGH"
                        ? "tag"
                        : "tag ready-tag"
                    }
                  >
                    {alert.severity} severity
                  </span>
                </div>
                {alert.snapshotUrl && (
                    <img
                        src={alert.snapshotUrl}
                        alt={`${issueTypeLabels[alert.issueType]} evidence`}
                        className="alert-snapshot"
                    />
                )}

                <div className="service-row">
                  <span>Zone</span>
                  <b>{alert.zoneName}</b>
                </div>

                <div className="service-row">
                  <span>Status</span>
                  <b
                    className={
                      alert.status === "RESOLVED"
                        ? "good"
                        : alert.status === "NEW"
                          ? "bad"
                          : ""
                    }
                  >
                    {statusLabels[alert.status]}
                  </b>
                </div>

                <div className="service-row">
                  <span>Confidence</span>
                  <b>
                    {Math.round(alert.confidence * 100)}%
                  </b>
                </div>

                <div className="service-row">
                  <span>Detected</span>
                  <b>
                    {new Date(
                      alert.detectedAt
                    ).toLocaleString()}
                  </b>
                </div>

                <div className="action-row">
                  {nextStatus ? (
                    <button
                      className="primary"
                      disabled={updating}
                      onClick={() =>
                        void handleStatusUpdate(alert)
                      }
                    >
                      {updating
                        ? "Updating…"
                        : getActionLabel(alert.status)}
                    </button>
                  ) : (
                    <button className="primary" disabled>
                      Resolved
                    </button>
                  )}
                </div>
              </article>
            );
          })}

          {displayedAlerts.length === 0 && (
            <article className="card">
              <p className="eyebrow">No records</p>
              <h2>No alerts match this filter</h2>
              <p className="card-copy">
                Select another status or wait for a new
                cleanliness issue to be detected.
              </p>
            </article>
          )}
        </section>
      )}
    </main>
  );
}