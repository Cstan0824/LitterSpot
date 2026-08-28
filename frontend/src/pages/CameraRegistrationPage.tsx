import { useEffect, useMemo, useState, type FormEvent } from "react";
import { CameraRegistrationPrototype } from "../features/operations/camera-registration-prototype/CameraRegistrationPrototype";
import { createCamera, getCameras, getSites, getZones, type CameraRecord, type Site, type Zone } from "../services/locationAPI";

function requestedCameraId() {
  return new URLSearchParams(location.hash.split("?")[1] ?? "").get("cameraId") ?? "";
}

export function CameraRegistrationPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [cameras, setCameras] = useState<CameraRecord[]>([]);
  const [cameraId, setCameraId] = useState(requestedCameraId);
  const [zoneId, setZoneId] = useState("");
  const [code, setCode] = useState("CAMERA-1");
  const [name, setName] = useState("Entrance camera");
  const [loading, setLoading] = useState(true);
  const [savingCamera, setSavingCamera] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    void Promise.all([getSites(), getZones(), getCameras()])
      .then(([nextSites, nextZones, nextCameras]) => {
        setSites(nextSites); setZones(nextZones); setCameras(nextCameras);
        const requested = requestedCameraId();
        if (requested && nextCameras.some((camera) => camera.id === requested)) setCameraId(requested);
        const available = nextZones.find((zone) => zone.status === "active");
        if (available) setZoneId((value) => value || available.id);
        const nextNumber = Math.max(0, ...nextCameras.map((camera) => Number(camera.code.match(/\d+$/)?.[0] ?? 0))) + 1;
        setCode((value) => value === "CAMERA-1" ? `CAMERA-${nextNumber}` : value);
        setName((value) => value === "Entrance camera" ? `Camera ${nextNumber}` : value);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Camera setup data could not be loaded."))
      .finally(() => setLoading(false));
  }, []);

  const activeZones = useMemo(() => zones.filter((zone) => zone.status === "active" && sites.some((site) => site.id === zone.siteId && site.status === "active")), [sites, zones]);
  const selected = cameras.find((camera) => camera.id === cameraId);

  async function startRegistration(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    if (selected) return;
    if (!zoneId || !/^CAMERA-[1-9][0-9]*$/.test(code.trim()) || name.trim().length < 2) {
      setError("Choose an active zone, use a unique CAMERA- number, and enter a display name.");
      return;
    }
    try {
      setSavingCamera(true);
      const camera = await createCamera({ zoneId, code: code.trim().toUpperCase(), name: name.trim() });
      setCameras((items) => [...items, camera]);
      setCameraId(camera.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The camera could not be created.");
    } finally {
      setSavingCamera(false);
    }
  }

  if (loading) return <main className="ops-loading">Loading camera registration…</main>;
  if (selected) return <main className="app-shell camera-registration-page"><header className="hero camera-registration-page-header"><div><p className="eyebrow">LITTERSPOT / CAMERA ENROLLMENT</p><h1>Camera registration</h1><p className="lede">Set the reference frame, draw the walkable floor and any optional bins, then validate the complete pipeline before publishing.</p></div><button className="quiet nav-button" onClick={() => { location.hash = "/cameras"; }}>Sites & cameras</button></header><CameraRegistrationPrototype camera={selected} onClose={() => { location.hash = "/cameras"; }} onPublished={(revision) => setCameras((items) => items.map((camera) => camera.id === selected.id ? { ...camera, registrationStatus: "ready", registrationRevision: revision } : camera))} /></main>;

  return <main className="app-shell camera-registration-page"><header className="hero"><div><p className="eyebrow">LITTERSPOT / CAMERA ENROLLMENT</p><h1>Start a camera<br /><em>registration.</em></h1><p className="lede">Choose an existing camera or create one before selecting its clean reference frame and plotting its detection regions.</p></div><button className="quiet nav-button" onClick={() => { location.hash = "/cameras"; }}>Sites & cameras</button></header><section className="camera-registration-start"><form className="camera-register-card" onSubmit={(event) => void startRegistration(event)}><div><span className="step">01</span><h2>Camera details</h2></div><label>Existing camera<select value={cameraId} onChange={(event) => setCameraId(event.target.value)}><option value="">Create a new camera</option>{cameras.filter((camera) => camera.status === "active").map((camera) => <option value={camera.id} key={camera.id}>{camera.code} · {camera.name} · {camera.zoneName}</option>)}</select><small>Choose an existing camera to adjust its registration without changing its location details.</small></label>{!cameraId && <><label>Cleaning zone<select value={zoneId} onChange={(event) => setZoneId(event.target.value)} required><option value="">Select an active zone</option>{activeZones.map((zone) => <option value={zone.id} key={zone.id}>{zone.siteName} · {zone.name}</option>)}</select></label><label>Camera ID<input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} pattern="CAMERA-[1-9][0-9]*" required /></label><label>Display name<input value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={80} required /></label></>}<button className="primary" type="submit" disabled={savingCamera || (!cameraId && !activeZones.length)}>{cameraId ? "Open registration" : savingCamera ? "Creating camera…" : "Create and register"}<span>→</span></button>{error && <p className="field-error">{error}</p>}</form><aside className="registration-start-note"><span className="eyebrow">WHAT HAPPENS NEXT</span><ol><li>Upload a clean image or capture a reference frame from video.</li><li>Plot the walkable floor and only the physical bins visible in this view.</li><li>Validate one image or synchronized one-second video samples.</li><li>Save registration only when the result is correct.</li></ol></aside></section></main>;
}
