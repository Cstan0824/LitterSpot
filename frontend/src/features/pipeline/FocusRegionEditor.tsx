import type { MouseEvent } from "react";
import type { Point } from "./types";

type Props = {
  preview: string;
  points: Point[];
  drawing: boolean;
  onPointsChange: (points: Point[]) => void;
  onDrawingChange: (drawing: boolean) => void;
};

export function FocusRegionEditor({ preview, points, drawing, onPointsChange, onDrawingChange }: Props) {
  function plotPoint(event: MouseEvent<HTMLDivElement>) {
    if (!drawing) return;
    const rect = event.currentTarget.getBoundingClientRect();
    onPointsChange([...points, {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    }]);
  }

  return <>
    <div className="roi-stage">
      <div className={`roi-canvas ${drawing ? "drawing" : ""}`} onClick={plotPoint}>
        <img src={preview} alt="Plot a floor focus area" />
        <svg viewBox="0 0 1 1" preserveAspectRatio="none">
          {points.length > 1 && <polyline points={points.map((point) => `${point.x},${point.y}`).join(" ")} />}
          {points.length >= 3 && <polygon points={points.map((point) => `${point.x},${point.y}`).join(" ")} />}
          {points.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r=".008" />)}
        </svg>
      </div>
    </div>
    <div className="roi-actions">
      <button className="quiet" disabled={drawing && points.length < 3} onClick={() => onDrawingChange(!drawing)}>{drawing ? points.length < 3 ? `Add ${3 - points.length} more point${3 - points.length === 1 ? "" : "s"}` : "Finish focus area" : "Plot floor area"}</button>
      <button className="quiet" disabled={!points.length} onClick={() => { onPointsChange([]); onDrawingChange(false); }}>Clear area</button>
      <span>{points.length >= 3 ? `${points.length} points · ready — finish or run analysis` : drawing ? "Click around the floor area" : "Optional: limit litter detection to a floor area"}</span>
    </div>
  </>;
}
