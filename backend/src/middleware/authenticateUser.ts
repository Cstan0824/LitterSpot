import type { NextFunction, Request, Response } from "express";
import { FieldValue } from "firebase-admin/firestore";
import { firebaseAuth, firestore } from "../config/firebase.js";

export type AuthenticatedUser = {
  uid: string;
  role: "superadmin" | "supervisor" | "cleaner";
  profileId: string;
  siteId: string | null;
  authority: "root" | "regular" | null;
  email: string;
  displayName: string;
};

export type AuthenticatedSupervisor = {
  uid: string;
  siteId?: string;
  authority?: "root" | "regular";
  email: string;
  displayName: string;
};

export type AuthenticatedSuperadmin = {
  uid: string;
  email: string;
  displayName: string;
};

export type AuthenticatedCleaner = {
  uid: string;
  cleanerId: string;
  email: string;
  displayName: string;
  assignedSiteId: string;
  assignedZoneId: string;
  permittedSiteIds: string[];
  permittedZoneIds: string[];
  capabilities: string[];
};

async function legacySupervisorAccount(uid: string) {
  const supervisorReference = firestore.collection("supervisors").doc(uid);
  const accountReference = firestore.collection("userAccounts").doc(uid);
  return firestore.runTransaction(async (transaction) => {
    const [account, supervisor] = await Promise.all([
      transaction.get(accountReference),
      transaction.get(supervisorReference),
    ]);
    if (account.exists) return account.data()!;
    if (!supervisor.exists || supervisor.data()?.role !== "supervisor") return null;
    const status = supervisor.data()?.status === "active" ? "active" : "inactive";
    const data = {
      role: "supervisor",
      profileId: uid,
      status,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      migrationSource: "legacy_supervisor_profile",
    };
    transaction.create(accountReference, data);
    return data;
  });
}

export async function authenticateUser(req: Request, res: Response, next: NextFunction) {
  const authorization = req.header("authorization");
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  if (!match) return res.status(401).json({ error: "Authentication required.", requestId: req.requestId });

  try {
    const decoded = await firebaseAuth.verifyIdToken(match[1], true);
    const accountReference = firestore.collection("userAccounts").doc(decoded.uid);
    let accountSnapshot = await accountReference.get();
    let account = accountSnapshot.exists ? accountSnapshot.data()! : await legacySupervisorAccount(decoded.uid);
    if (!account) return res.status(403).json({ error: "Application account is not provisioned.", requestId: req.requestId });
    if (account.status !== "active") return res.status(403).json({ error: "Application access is inactive.", requestId: req.requestId });

    const accountData = account as Record<string, unknown>;
    if (account.role === "superadmin") {
      const authenticated = {
        uid: decoded.uid,
        email: decoded.email ?? String(accountData.emailNormalized ?? ""),
        displayName: String(accountData.displayName ?? decoded.name ?? decoded.email ?? "Superadmin"),
      };
      req.authUser = { ...authenticated, role: "superadmin", profileId: String(account.profileId ?? decoded.uid), siteId: null, authority: null };
      return next();
    }

    if (account.role === "supervisor") {
      const profile = await firestore.collection("supervisors").doc(String(account.profileId)).get();
      const profileData = profile.data();
      const v2Profile = profileData?.schemaVersion === 2;
      if (!profile.exists || profileData?.status !== "active" || !v2Profile && profileData?.role !== "supervisor") {
        return res.status(403).json({ error: "Supervisor access is inactive.", requestId: req.requestId });
      }
      const siteId = String(accountData.siteId ?? profileData?.siteId ?? "");
      const authority = accountData.authority === "root" || profileData?.authority === "root" ? "root" : "regular";
      if (!siteId && accountData.schemaVersion === 2) return res.status(403).json({ error: "Supervisor Site is not configured.", requestId: req.requestId });
      if (siteId) {
        const site = await firestore.collection("sites").doc(siteId).get();
        if (!site.exists || site.data()?.status !== "active") return res.status(403).json({ error: "Site access is inactive.", requestId: req.requestId });
      }
      const authenticated = {
        uid: decoded.uid,
        email: decoded.email ?? String(profileData?.email ?? ""),
        displayName: String(profileData?.fullName ?? profileData?.displayName ?? decoded.name ?? decoded.email ?? "Supervisor"),
      };
      req.authUser = { ...authenticated, role: "supervisor", profileId: profile.id, siteId, authority };
      req.supervisor = { ...authenticated, siteId, authority };
      return next();
    }

    if (account.role === "cleaner") {
      const cleanerId = String(account.profileId ?? "");
      const profileReference = firestore.collection("cleaners").doc(cleanerId);
      const profile = await profileReference.get();
      const data = profile.data();
      const v2Profile = data?.schemaVersion === 2;
      if (!profile.exists || data?.status !== "active" || data.authUid !== decoded.uid
        || !v2Profile && !["invited", "active"].includes(String(data.accountStatus))) {
        return res.status(403).json({ error: "Cleaner access is inactive.", requestId: req.requestId });
      }
      const email = decoded.email ?? String(data.email ?? "");
      const displayName = String(data.fullName ?? decoded.name ?? email ?? "Cleaner");
      const siteId = String(data.siteId ?? data.assignedSiteId ?? "");
      if (siteId) {
        const site = await firestore.collection("sites").doc(siteId).get();
        if (!site.exists || site.data()?.status !== "active") return res.status(403).json({ error: "Site access is inactive.", requestId: req.requestId });
      }
      req.authUser = { uid: decoded.uid, role: "cleaner", profileId: cleanerId, siteId: siteId || null, authority: null, email, displayName };
      req.cleaner = {
        uid: decoded.uid,
        cleanerId,
        email,
        displayName,
        assignedSiteId: siteId,
        assignedZoneId: String(data.assignedZoneId ?? ""),
        permittedSiteIds: Array.isArray(data.permittedSiteIds) ? data.permittedSiteIds.map(String) : [String(data.assignedSiteId)],
        permittedZoneIds: Array.isArray(data.permittedZoneIds) ? data.permittedZoneIds.map(String) : [String(data.assignedZoneId)],
        capabilities: Array.isArray(data.capabilities) ? data.capabilities.map(String) : ["general_cleaning"],
      };
      if (!v2Profile && data.accountStatus === "invited") {
        await profileReference.update({
          accountStatus: "active",
          authLinkedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
      return next();
    }

    return res.status(403).json({ error: "Application role is not supported.", requestId: req.requestId });
  } catch {
    return res.status(401).json({ error: "Invalid or expired authentication token.", requestId: req.requestId });
  }
}
