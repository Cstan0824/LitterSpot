import { Router } from "express";

export const supervisorRoutes = Router();

supervisorRoutes.get("/", (req, res) => {
  if (req.authUser.role === "superadmin") return res.json({ role: "superadmin", superadmin: { uid: req.authUser.uid, email: req.authUser.email, displayName: req.authUser.displayName } });
  if (req.authUser.role === "supervisor") return res.json({ role: "supervisor", supervisor: req.supervisor });
  return res.json({ role: "cleaner", cleaner: req.cleaner });
});
