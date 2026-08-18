import type { AuthenticatedCleaner, AuthenticatedSupervisor, AuthenticatedUser } from "../middleware/authenticateUser.js";
import type { AuthenticatedOrchestrator } from "../middleware/authenticateOrchestrator.js";

declare global {
  namespace Express {
    interface Request {
      supervisor: AuthenticatedSupervisor;
      authUser: AuthenticatedUser;
    cleaner?: AuthenticatedCleaner;
    orchestrator?: AuthenticatedOrchestrator;
      requestId: string;
    }
  }
}

export {};
