import { V2CameraCreationPage } from "./V2CameraCreationPage";

export function CameraRegistrationPage({ canCreateCamera = true, canRegisterCamera = true }: { canCreateCamera?: boolean; canRegisterCamera?: boolean }) {
  if (!canRegisterCamera) return <main className="ops-loading">Camera registration access is not available for this account.</main>;
  return <V2CameraCreationPage canCreateCamera={canCreateCamera} onClose={() => { location.hash = "/cameras"; }} />;
}
