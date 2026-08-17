import { Router } from "express";

export const supervisorRoutes = Router();

supervisorRoutes.get("/", (req, res) => {
  if (req.authUser.role === "supervisor") return res.json({ role: "supervisor", supervisor: req.supervisor });
  return res.json({ role: "cleaner", cleaner: req.cleaner });
});
