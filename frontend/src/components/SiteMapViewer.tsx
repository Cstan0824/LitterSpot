import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import type { SiteBackgroundTransform, SiteMapBackground, SiteMapCameraPlacement, SiteMapCleanerStation } from "../services/v2/siteMap";
import type { SiteMapPoint, SiteMapPolygon } from "../services/v2/mapGeometry";
import { loadAuthenticatedMedia, releaseAuthenticatedMedia } from "../services/v2/media";
import { completedSiteMapGesture, SITE_MAP_WHEEL_LISTENER_OPTIONS, siteMapButtonZoomFactor, siteMapCameraMarkerScale, siteMapDrawingPoints, siteMapGestureShouldPan, siteMapWheelZoomFactor } from "./siteMapInteraction";
import { siteMapZoneColour } from "./siteMapZonePalette";
import "./site-map-viewer.css";

type ZoneLayer = { id: string; name: string; polygon: SiteMapPolygon };
type MapView = { x: number; y: number; width: number; height: number };

export type SiteMapViewerProps = {
  boundary: { widthMeters: number; heightMeters: number };
  gridSizeMeters: number;
  background: SiteMapBackground | null;
  backgroundContentUrl?: string | null;
  backgroundTransform: SiteBackgroundTransform | null;
  zones: ZoneLayer[];
  cameras?: SiteMapCameraPlacement[];
  stations?: SiteMapCleanerStation[];
  selectedZoneId?: string | null;
  editableZoneId?: string | null;
  drawingZoneId?: string | null;
  conflictingZoneIds?: ReadonlySet<string>;
  onSelectZone?: (zoneId: string) => void;
  onAddZonePoint?: (point: SiteMapPoint) => void;
  onMoveZoneVertex?: (zoneId: string, vertexIndex: number, point: SiteMapPoint) => void;
  onSelectCamera?: (cameraId: string) => void;
  pointMarker?: { point: SiteMapPoint; label: string; tone?: "work" | "station" | "camera" } | null;
  onPlacePoint?: (point: SiteMapPoint) => void;
  compact?: boolean;
};

const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));
const points = (polygon: SiteMapPolygon) => polygon.map((point) => `${point.xMeters},${point.yMeters}`).join(" ");
const average = (polygon: SiteMapPolygon) => polygon.length ? polygon.reduce((sum, point) => ({ xMeters: sum.xMeters + point.xMeters / polygon.length, yMeters: sum.yMeters + point.yMeters / polygon.length }), { xMeters: 0, yMeters: 0 }) : null;
const distance = (left: { x: number; y: number }, right: { x: number; y: number }) => Math.hypot(left.x - right.x, left.y - right.y);

function niceScale(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  return (normalized >= 5 ? 5 : normalized >= 2 ? 2 : 1) * magnitude;
}

export function SiteMapViewer({ boundary, gridSizeMeters, background, backgroundContentUrl, backgroundTransform, zones, cameras = [], stations = [], selectedZoneId, editableZoneId, drawingZoneId, conflictingZoneIds = new Set(), onSelectZone, onAddZonePoint, onMoveZoneVertex, onSelectCamera, pointMarker, onPlacePoint, compact = false }: SiteMapViewerProps) {
  const patternId = `site-grid-${useId().replaceAll(":", "")}`;
  const mediaKey = `site-map-background-${useId().replaceAll(":", "")}`;
  const viewerRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<MapView>({ x: 0, y: 0, width: boundary.widthMeters, height: boundary.heightMeters });
  const [viewerSize, setViewerSize] = useState({ width: 1, height: 1 });
  const [cursor, setCursor] = useState<SiteMapPoint | null>(null);
  const [backgroundUrl, setBackgroundUrl] = useState<string | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ view: MapView; start: { x: number; y: number }; moved: boolean; pressedZoneId?: string; pinchDistance?: number; pinchCentre?: { x: number; y: number } } | null>(null);
  const draggingVertex = useRef<{ pointerId: number; zoneId: string; vertexIndex: number } | null>(null);
  const sourceUrl = backgroundContentUrl ?? background?.contentUrl ?? null;

  useEffect(() => { setView({ x: 0, y: 0, width: boundary.widthMeters, height: boundary.heightMeters }); }, [boundary.heightMeters, boundary.widthMeters]);
  useEffect(() => {
    setBackgroundUrl(null);
    if (!sourceUrl) return;
    const controller = new AbortController();
    void loadAuthenticatedMedia(mediaKey, sourceUrl, controller.signal).then(setBackgroundUrl).catch(() => setBackgroundUrl(null));
    return () => { controller.abort(); releaseAuthenticatedMedia(mediaKey); };
  }, [background?.mediaId, mediaKey, sourceUrl]);
  useEffect(() => {
    const node = viewerRef.current;
    if (!node) return;
    const update = () => { const box = node.getBoundingClientRect(); setViewerSize({ width: Math.max(1, box.width), height: Math.max(1, box.height) }); };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const zoomPercent = Math.round(boundary.widthMeters / view.width * 100);
  const screenScale = Math.min(viewerSize.width / view.width, viewerSize.height / view.height);
  const scaleMeters = niceScale(100 / screenScale);
  const scalePixels = scaleMeters * screenScale;
  const editableZone = zones.find((zone) => zone.id === editableZoneId);
  const modeLabel = drawingZoneId ? "Plot Zone boundary" : editableZoneId ? "Move boundary points" : onPlacePoint ? `Place ${pointMarker?.label ?? "point"}` : "Pan map";

  const clampView = (candidate: MapView): MapView => ({ ...candidate, x: clamp(candidate.x, 0, Math.max(0, boundary.widthMeters - candidate.width)), y: clamp(candidate.y, 0, Math.max(0, boundary.heightMeters - candidate.height)) });

  const clientToMap = (clientX: number, clientY: number, sourceView = view) => {
    const box = viewerRef.current?.getBoundingClientRect();
    if (!box) return { xMeters: 0, yMeters: 0 };
    const scale = Math.min(box.width / sourceView.width, box.height / sourceView.height);
    const left = box.left + (box.width - sourceView.width * scale) / 2;
    const top = box.top + (box.height - sourceView.height * scale) / 2;
    return { xMeters: clamp(sourceView.x + (clientX - left) / scale, 0, boundary.widthMeters), yMeters: clamp(sourceView.y + (clientY - top) / scale, 0, boundary.heightMeters) };
  };

  const zoomAt = (factor: number, clientX?: number, clientY?: number) => {
    setView((current) => {
      const minimumWidth = boundary.widthMeters / 16;
      const width = clamp(current.width / factor, minimumWidth, boundary.widthMeters);
      const height = width / boundary.widthMeters * boundary.heightMeters;
      const anchor = clientX === undefined || clientY === undefined ? { xMeters: current.x + current.width / 2, yMeters: current.y + current.height / 2 } : clientToMap(clientX, clientY, current);
      const ratioX = (anchor.xMeters - current.x) / current.width;
      const ratioY = (anchor.yMeters - current.y) / current.height;
      return clampView({ x: anchor.xMeters - width * ratioX, y: anchor.yMeters - height * ratioY, width, height });
    });
  };

  useEffect(() => {
    const node = viewerRef.current;
    if (!node) return;
    const containWheel = (event: globalThis.WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      zoomAt(siteMapWheelZoomFactor(event.deltaY, event.deltaMode), event.clientX, event.clientY);
    };
    node.addEventListener("wheel", containWheel, SITE_MAP_WHEEL_LISTENER_OPTIONS);
    return () => node.removeEventListener("wheel", containWheel);
  }, [boundary.heightMeters, boundary.widthMeters]);

  const pointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const active = [...pointers.current.values()];
    const zoneTarget = event.target instanceof Element ? event.target.closest<SVGPolygonElement>("[data-site-map-zone-id]") : null;
    gesture.current = { view, start: { x: event.clientX, y: event.clientY }, moved: false, pressedZoneId: zoneTarget?.dataset.siteMapZoneId, ...(active.length === 2 ? { pinchDistance: distance(active[0], active[1]), pinchCentre: { x: (active[0].x + active[1].x) / 2, y: (active[0].y + active[1].y) / 2 } } : {}) };
  };

  const pointerMove = (event: PointerEvent<HTMLDivElement>) => {
    setCursor(clientToMap(event.clientX, event.clientY));
    const vertex = draggingVertex.current;
    if (vertex?.pointerId === event.pointerId) {
      onMoveZoneVertex?.(vertex.zoneId, vertex.vertexIndex, clientToMap(event.clientX, event.clientY));
      return;
    }
    if (!pointers.current.has(event.pointerId) || !gesture.current) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const active = [...pointers.current.values()];
    if (active.length === 2 && gesture.current.pinchDistance && gesture.current.pinchCentre) {
      const factor = distance(active[0], active[1]) / gesture.current.pinchDistance;
      const startView = gesture.current.view;
      const width = clamp(startView.width / factor, boundary.widthMeters / 16, boundary.widthMeters);
      const height = width / boundary.widthMeters * boundary.heightMeters;
      const anchor = clientToMap(gesture.current.pinchCentre.x, gesture.current.pinchCentre.y, startView);
      setView(clampView({ x: anchor.xMeters - width / 2, y: anchor.yMeters - height / 2, width, height }));
      gesture.current.moved = true;
      return;
    }
    const scale = Math.min(viewerSize.width / gesture.current.view.width, viewerSize.height / gesture.current.view.height);
    const dx = (event.clientX - gesture.current.start.x) / scale;
    const dy = (event.clientY - gesture.current.start.y) / scale;
    gesture.current.moved ||= siteMapGestureShouldPan({ drawingZone: Boolean(drawingZoneId), placingPoint: Boolean(onPlacePoint), screenDistance: distance(gesture.current.start, { x: event.clientX, y: event.clientY }), mapDistance: Math.abs(dx) + Math.abs(dy) });
    if (!gesture.current.moved) return;
    setView(clampView({ ...gesture.current.view, x: gesture.current.view.x - dx, y: gesture.current.view.y - dy }));
  };

  const pointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const gestureValue = gesture.current;
    const completion = gestureValue ? completedSiteMapGesture({ moved: gestureValue.moved, pointerCount: pointers.current.size, pressedZoneId: gestureValue.pressedZoneId, drawingZone: Boolean(drawingZoneId), placingPoint: Boolean(onPlacePoint) }) : null;
    if (completion?.type === "add-zone-point") onAddZonePoint?.(clientToMap(event.clientX, event.clientY));
    else if (completion?.type === "place-point") onPlacePoint?.(clientToMap(event.clientX, event.clientY));
    else if (completion?.type === "select-zone") onSelectZone?.(completion.zoneId);
    pointers.current.delete(event.pointerId);
    if (draggingVertex.current?.pointerId === event.pointerId) draggingVertex.current = null;
    if (!pointers.current.size) gesture.current = null;
  };

  const moveVertexWithKeyboard = (event: KeyboardEvent<SVGCircleElement>, zoneId: string, vertexIndex: number, current: SiteMapPoint) => {
    const directions: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const direction = directions[event.key];
    if (!direction) return;
    event.preventDefault();
    const step = Math.max(.01, gridSizeMeters / (event.shiftKey ? 1 : 10));
    onMoveZoneVertex?.(zoneId, vertexIndex, { xMeters: clamp(current.xMeters + direction[0] * step, 0, boundary.widthMeters), yMeters: clamp(current.yMeters + direction[1] * step, 0, boundary.heightMeters) });
  };

  const movePointWithKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!onPlacePoint || !pointMarker || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const step = Math.max(.01, gridSizeMeters / (event.shiftKey ? 1 : 10));
    onPlacePoint({
      xMeters: clamp(pointMarker.point.xMeters + (event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0), 0, boundary.widthMeters),
      yMeters: clamp(pointMarker.point.yMeters + (event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0), 0, boundary.heightMeters),
    });
  };

  const labels = useMemo(() => zones.map((zone) => ({ ...zone, centre: average(zone.polygon) })), [zones]);
  const drawingPoints = siteMapDrawingPoints(zones, drawingZoneId);
  const zoneSelectionEnabled = Boolean(onSelectZone && !drawingZoneId && !editableZoneId && !onPlacePoint);
  const zoneLabelSize = Math.max(view.width / 58, 4.5);
  const zoneLabelStroke = Math.max(view.width / 360, .8);
  const drawingPointRadius = Math.max(view.width / 145, .55);
  const cameraMarkerScale = siteMapCameraMarkerScale(screenScale);

  return <section className={`site-map-viewer ${compact ? "compact" : ""} ${drawingZoneId ? "drawing" : editableZoneId ? "editing" : onPlacePoint ? "placing" : "viewing"}`}>
    <header className="site-map-viewer-toolbar"><div><strong>{modeLabel}</strong><span>{zoomPercent}%</span></div><div role="group" aria-label="Map view controls"><button type="button" onClick={() => zoomAt(siteMapButtonZoomFactor("in"))} aria-label="Zoom in">+</button><button type="button" onClick={() => zoomAt(siteMapButtonZoomFactor("out"))} aria-label="Zoom out">−</button><button type="button" onClick={() => setView({ x: 0, y: 0, width: boundary.widthMeters, height: boundary.heightMeters })}>Fit to Site</button></div></header>
    <div ref={viewerRef} className="site-map-viewer-window" role={onPlacePoint ? "application" : undefined} tabIndex={onPlacePoint ? 0 : undefined} aria-label={onPlacePoint ? `Site Map. Click or use arrow keys to place ${pointMarker?.label ?? "the point"}.` : undefined} onKeyDown={movePointWithKeyboard} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} onPointerLeave={() => setCursor(null)}>
      <svg viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`} preserveAspectRatio="xMidYMid meet" aria-label={`Site Map, ${boundary.widthMeters} by ${boundary.heightMeters} metres`}>
        <defs><pattern id={patternId} width={gridSizeMeters} height={gridSizeMeters} patternUnits="userSpaceOnUse"><path d={`M ${gridSizeMeters} 0 L 0 0 0 ${gridSizeMeters}`} /></pattern></defs>
        <rect className="site-map-ground" width={boundary.widthMeters} height={boundary.heightMeters} />
        {backgroundUrl && backgroundTransform && <image className="site-map-background" href={backgroundUrl} x={backgroundTransform.xMeters} y={backgroundTransform.yMeters} width={backgroundTransform.widthMeters} height={backgroundTransform.heightMeters} opacity={backgroundTransform.opacity} preserveAspectRatio="xMidYMid meet" />}
        <rect className="site-map-grid" width={boundary.widthMeters} height={boundary.heightMeters} fill={`url(#${patternId})`} />
        {zones.map((zone) => { const colour = siteMapZoneColour(zone.id); return <polygon key={zone.id} points={points(zone.polygon)} data-site-map-zone-id={zoneSelectionEnabled ? zone.id : undefined} className={`site-map-zone ${selectedZoneId === zone.id ? "selected" : ""} ${conflictingZoneIds.has(zone.id) ? "conflict" : ""} ${drawingZoneId === zone.id ? "draft" : ""}`} style={{ "--zone-fill": colour.fill, "--zone-stroke": colour.stroke, "--zone-selected-stroke": colour.selectedStroke } as CSSProperties} role={zoneSelectionEnabled ? "button" : undefined} tabIndex={zoneSelectionEnabled ? 0 : undefined} aria-label={zoneSelectionEnabled ? `Select ${zone.name} Zone` : undefined} onKeyDown={zoneSelectionEnabled ? (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelectZone?.(zone.id); } } : undefined} />; })}
        {drawingPoints.length > 1 && <polyline className="site-map-drawing-line" points={points(drawingPoints)} />}
        {drawingPoints.map((point, index) => <g className="site-map-drawing-point" key={`drawing-point-${index}`} transform={`translate(${point.xMeters} ${point.yMeters})`}><circle r={drawingPointRadius} /><circle r={drawingPointRadius * .34} /></g>)}
        {labels.map((zone) => zone.centre && zone.polygon.length >= 3 ? <text key={`${zone.id}-label`} x={zone.centre.xMeters} y={zone.centre.yMeters} className={conflictingZoneIds.has(zone.id) ? "conflict" : ""} style={{ fontSize: zoneLabelSize, strokeWidth: zoneLabelStroke }}>{zone.name}</text> : null)}
        {editableZone?.polygon.map((point, index) => <circle key={`${editableZone.id}-${index}`} cx={point.xMeters} cy={point.yMeters} r={Math.max(view.width / 180, .4)} className="site-map-vertex" role="button" tabIndex={0} aria-label={`Move ${editableZone.name} boundary point ${index + 1}`} onKeyDown={(event) => moveVertexWithKeyboard(event, editableZone.id, index, point)} onPointerDown={(event) => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); draggingVertex.current = { pointerId: event.pointerId, zoneId: editableZone.id, vertexIndex: index }; }} />)}
        {cameras.map((camera) => { const interactive = Boolean(onSelectCamera); return <g key={camera.id} className={`site-map-camera-marker ${interactive ? "interactive" : "static"}`} role={interactive ? "button" : undefined} tabIndex={interactive ? 0 : undefined} aria-label={interactive ? `${camera.cameraNameSnapshot ?? "Camera"}, X ${camera.point.xMeters.toFixed(1)}, Y ${camera.point.yMeters.toFixed(1)} metres` : undefined} transform={`translate(${camera.point.xMeters} ${camera.point.yMeters}) scale(${cameraMarkerScale})`} onPointerDown={interactive ? (event) => event.stopPropagation() : undefined} onPointerUp={interactive ? (event) => event.stopPropagation() : undefined} onClick={interactive ? () => onSelectCamera?.(camera.cameraId) : undefined} onKeyDown={interactive ? (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelectCamera?.(camera.cameraId); } } : undefined}><path className="site-map-camera-pin" d="M 0 1 C -3 -4 -14 -13 -14 -24 A 14 14 0 1 1 14 -24 C 14 -13 3 -4 0 1 Z" /><circle className="site-map-camera-face" cy="-24" r="10" /><g className="site-map-camera-glyph" transform="translate(0 -24)"><rect x="-5.5" y="-3.5" width="11" height="7" rx="1" /><circle r="2.1" /><path d="M -3.5 -3.5 -2 -5.2 H 2 L 3.5 -3.5" /></g></g>; })}
        {stations.map((station) => <g key={station.id} className="site-map-station-marker" transform={`translate(${station.point.xMeters} ${station.point.yMeters})`}><rect x={-view.width / 220} y={-view.width / 220} width={view.width / 110} height={view.width / 110} /><path d={`M 0 ${-view.width / 300} v ${view.width / 150} M ${-view.width / 300} 0 h ${view.width / 150}`} /></g>)}
        {pointMarker && <g className={`site-map-point-marker ${pointMarker.tone ?? "work"}`} transform={`translate(${pointMarker.point.xMeters} ${pointMarker.point.yMeters})`} aria-label={`${pointMarker.label}, X ${pointMarker.point.xMeters.toFixed(1)}, Y ${pointMarker.point.yMeters.toFixed(1)} metres`}><circle r={Math.max(view.width / 100, .8)} /><circle r={Math.max(view.width / 260, .28)} /><path d={`M 0 ${view.width / 105} v ${view.width / 70}`} /></g>}
      </svg>
      {!sourceUrl && <div className="site-map-empty-background"><strong>No Site background</strong><span>Coordinates and Zones still remain operational.</span></div>}
      {sourceUrl && !backgroundUrl && <div className="site-map-empty-background"><strong>Loading Site background</strong><span>The coordinate layers remain available.</span></div>}
    </div>
    <footer className="site-map-viewer-status"><span><i style={{ width: `${Math.min(150, Math.max(35, scalePixels))}px` }} />{scaleMeters >= 1000 ? `${Number((scaleMeters / 1000).toFixed(1))} km` : `${Number(scaleMeters.toFixed(2))} m`}</span><span>{cursor ? `X ${cursor.xMeters.toFixed(2)} m · Y ${cursor.yMeters.toFixed(2)} m` : `Boundary ${boundary.widthMeters} × ${boundary.heightMeters} m`}</span></footer>
  </section>;
}
