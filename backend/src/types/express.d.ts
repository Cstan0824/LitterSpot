import type { AuthenticatedCleaner, AuthenticatedSupervisor, AuthenticatedUser } from "../middleware/authenticateUser.js";

declare global {
  namespace Express {
    interface Request {
      supervisor: AuthenticatedSupervisor;
      authUser: AuthenticatedUser;
      cleaner?: AuthenticatedCleaner;
      requestId: string;
    }
  }
}

export {};
