import type { CleanerSession, SuperadminSession } from "../services/v2/session";

type PendingSession = CleanerSession | SuperadminSession;

export function RoleIntegrationPendingPage({ session, onLogout }: { session: PendingSession; onLogout: () => void }) {
  const cleaner = session.role === "cleaner";
  const profile = cleaner ? session.cleaner : session.superadmin;
  return <main className="role-pending-page">
    <section className="role-pending-panel">
      <div className="login-brand"><b>LS</b><div><strong>LitterSpot</strong><span>{cleaner ? "Cleaner mobile" : "Superadmin"}</span></div></div>
      <p className="role-pending-status">Authenticated</p>
      <h1>{cleaner ? "Cleaner integration pending" : "Superadmin integration pending"}</h1>
      <p>{cleaner
        ? "Your Cleaner account is valid. Real Work, schedule, notification, and evidence data will be connected in Phase 12.4. Mock Cleaner data is not shown in an authenticated session."
        : "Your LitterSpot Superadmin account is valid. The separate Superadmin application area remains a Phase 13 deliverable, so Site Supervisor pages are intentionally unavailable."}</p>
      <dl><div><dt>Signed in as</dt><dd>{profile.displayName}</dd></div><div><dt>Role</dt><dd>{cleaner ? "Cleaner" : "LitterSpot Superadmin"}</dd></div></dl>
      <button className="outline-button" type="button" onClick={onLogout}>Sign out</button>
    </section>
  </main>;
}
