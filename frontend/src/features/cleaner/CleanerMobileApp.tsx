import { useState } from "react";
import "./cleaner-mobile-flow.css";
import "./cleaner-working-hours.css";
import "./cleaner-schedule-table.css";
import "./cleaner-week-calendar.css";
import "./cleaner-standard-calendar.css";
import "./cleaner-horizontal-hours.css";
import {
  demoCleaner,
  demoCurrentWork,
  demoManualWork,
  demoNotifications,
  demoRecentWork,
  type CleanerWorkOrder,
  type CleanerWorkStatus,
} from "../../mocks/cleanerMobileMock";

type Page = "home" | "work" | "schedule" | "notifications" | "profile";

const formatTime = (value: string) => new Date(value).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const statusLabel = (status: CleanerWorkStatus) => status.replaceAll("_", " ");
const weekDates = ["25", "26", "27", "28", "29", "30", "31"];
const shortDay = (day: string) => day.slice(0, 3);
const calendarTimes = ["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00"];
const hoursTotal = (hours: string) => {
  if (hours === "Off") return 0;
  const [start, end] = hours.split(" – ").map((value) => Number(value.slice(0, 2)));
  return end - start;
};
const calendarRange = (hours: string) => {
  const [start, end] = hours.split(" – ").map((value) => Number(value.slice(0, 2)));
  return { start: start - 8, end: end - 8 };
};

function StationMap({ x, y }: { x: number; y: number }) {
  return <div className="cleaner-map" aria-label="Site map"><div /><i style={{ left: `${x}%`, top: `${y}%` }} /><span>Station Point</span></div>;
}

function Status({ work }: { work: CleanerWorkOrder }) {
  return <div className="cleaner-work-badges"><b className={work.severity}>{work.severity}</b><span className={work.status}>{statusLabel(work.status)}</span></div>;
}

function WorkType({ work }: { work: CleanerWorkOrder }) {
  return <span className={`cleaner-work-type ${work.target.type}`}>{work.target.type === "camera" ? "Camera-linked work" : "Coordinate-targeted manual work"}</span>;
}

export function CleanerMobileApp({ onLogout }: { onLogout: () => void }) {
  const [page, setPage] = useState<Page>("home");
  const [work, setWork] = useState<CleanerWorkOrder>(demoCurrentWork);
  const [photo, setPhoto] = useState<string>();
  const [detail, setDetail] = useState(false);
  const [scheduleDay, setScheduleDay] = useState(2);
  const [scheduleDetail, setScheduleDetail] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState("May");
  const [calendarYear, setCalendarYear] = useState("2026");
  const isCoordinate = work.target.type === "coordinate";
  const active = work.status === "assigned" || work.status === "in_progress" || work.status === "awaiting_review";

  const updateStatus = (status: CleanerWorkStatus) => setWork((current) => ({ ...current, status }));
  const openWork = (item = work) => { setWork(item); setPhoto(undefined); setPage("work"); setDetail(true); };
  const submitForReview = () => {
    if (isCoordinate && !photo) return;
    updateStatus("awaiting_review");
  };

  const evidencePanel = work.target.type === "camera"
    ? <>
        {(work.status === "assigned" || work.status === "in_progress") && <section className="cleaner-evidence-section"><span>PRE-CLEANING CAMERA EVIDENCE</span><div className="cleaner-evidence"><img src="/mock/spill.jpg" alt="Camera evidence of reported litter" /><b>{work.issueType} · captured before work</b></div></section>}
        {work.status === "in_progress" && <section className="cleaner-camera-verification"><i>◉</i><div><span>POST-CLEANING VERIFICATION</span><strong>Fresh camera verification will be captured after submission.</strong><small>You do not need to take or upload cleaning proof for this Camera-linked Work.</small></div></section>}
        {work.status === "awaiting_review" && <section className="cleaner-camera-verification pending"><i>◌</i><div><span>CAMERA VERIFICATION PENDING</span><strong>Your Work was submitted. A fresh camera frame is being checked.</strong><small>The Supervisor will resolve the Work Order or request rework after verification.</small></div></section>}
      </>
    : <>
        {work.status === "assigned" && <section className="cleaner-evidence-rule"><span>COMPLETION EVIDENCE</span><strong>Exactly 1 photo is required after you start work.</strong><small>This Station Point does not have Camera coverage, so your completion photo is the review evidence.</small></section>}
        {work.status === "in_progress" && <section className="cleaner-completion-evidence"><header><span>COMPLETION EVIDENCE</span><b>{photo ? "1 of 1 photo supplied" : "1 required photo"}</b></header>{photo ? <div className="cleaner-photo-preview"><img src={photo} alt="Completion evidence" /><button onClick={() => setPhoto(undefined)}>Replace photo</button></div> : <label className="cleaner-upload">Take or upload 1 completion photo<input type="file" accept="image/*" onChange={(event) => { const file = event.target.files?.[0]; if (file) setPhoto(URL.createObjectURL(file)); }} /></label>}<small>Show the cleaned location clearly. Only one photo can be submitted.</small></section>}
        {work.status === "awaiting_review" && <section className="cleaner-evidence-rule received"><span>COMPLETION EVIDENCE RECEIVED</span><strong>1 completion photo was submitted for Supervisor review.</strong><small>No Camera verification is expected for this Coordinate-targeted Manual Work.</small></section>}
      </>;

  const workDetail = <section className="cleaner-work-detail">
    <button className="cleaner-back" onClick={() => setDetail(false)}>← Back to Work</button>
    <WorkType work={work} />
    <Status work={work} />
    <h1>{work.title}</h1>
    <p className="cleaner-work-code">{work.workOrderId} · assigned {formatTime(work.createdAt)}</p>
    {work.reworkRequired && <div className="cleaner-rework"><b>Rework required</b><span>The submitted result needs more attention. Return to the location, complete the work, then submit again.</span></div>}
    <section><span>WHAT TO DO</span><p>{work.instructions}</p></section>
    <section><span>WHERE</span><strong>{work.zoneName}</strong><small>{work.target.type === "camera" ? work.target.cameraName : "Pinned Station Point"}</small><StationMap x={work.target.x} y={work.target.y} /></section>
    {evidencePanel}
    {work.status === "resolved" && <section className="cleaner-evidence-rule received"><span>VERIFICATION RESULT</span><strong>Work resolved</strong><small>The submitted result passed review.</small></section>}
    {work.status === "dismissed" && <section className="cleaner-rework"><b>Work dismissed</b><span>No further action is required for this Work Order.</span></section>}
    <footer>
      {work.status === "assigned" && <button onClick={() => updateStatus("in_progress")}>Start work</button>}
      {work.status === "in_progress" && <button disabled={isCoordinate && !photo} onClick={submitForReview}>{isCoordinate && !photo ? "Add 1 completion photo" : "Submit for review"}</button>}
    </footer>
  </section>;

  const historyItem = (item: CleanerWorkOrder) => <button key={item.workOrderId} onClick={() => openWork(item)}><b>{item.title}</b><span>{statusLabel(item.status)} · {item.zoneName}</span></button>;
  const workCard = (item: CleanerWorkOrder) => <button className="cleaner-work-list" onClick={() => openWork(item)}><WorkType work={item} /><Status work={item} /><h2>{item.title}</h2><p>{item.zoneName} · {item.target.type === "camera" ? item.target.cameraName : "Station Point"}</p><strong>Open Work →</strong></button>;

  const home = <>
    <header className="cleaner-hero"><div><span>GOOD MORNING</span><h1>{demoCleaner.name.split(" ")[0]}</h1><p>{demoCleaner.siteName} · Cleaner</p></div><i>AR</i></header>
    <section className="cleaner-availability"><span>AVAILABILITY</span><b><i />{demoCleaner.availability}</b><small>Working today · 09:00 – 18:00</small></section>
    <section className="cleaner-current"><header><span>YOUR CURRENT WORK</span>{active && <Status work={work} />}</header>{active ? <button onClick={() => openWork()}><WorkType work={work} /><h2>{work.title}</h2><p>{work.zoneName} · {work.target.type === "camera" ? work.target.cameraName : "Station Point"}</p><strong>View Work →</strong></button> : <div><h2>No active Work Order</h2><p>Your next assignment will appear here.</p></div>}</section>
    <section className="cleaner-info-grid"><article><span>TODAY’S SCHEDULE</span><strong>09:00 – 18:00</strong><small>Friday</small></article><article><span>STATION POINT</span><strong>{demoCleaner.stationPoint.zoneName}</strong><small>View on map →</small></article></section>
    <section className="cleaner-recent"><header><span>RECENT WORK</span><button onClick={() => setPage("work")}>View all</button></header>{demoRecentWork.map(historyItem)}</section>
  </>;

  const workPage = detail ? workDetail : <>
    <header className="cleaner-section-head"><span>WORK</span><h1>My Work</h1><p>Open a Work Order to see its required evidence path.</p></header>
    {workCard(work)}
    <section className="cleaner-other-work"><header><span>OTHER ASSIGNED WORK</span><small>Manual Work</small></header>{workCard(demoManualWork)}</section>
    <section className="cleaner-recent"><header><span>WORK HISTORY</span></header>{demoRecentWork.map(historyItem)}</section>
  </>;

  const selectedSchedule = demoCleaner.schedule[scheduleDay];
  const weeklyHours = demoCleaner.schedule.reduce((total, day) => total + hoursTotal(day.hours), 0);
  const hasWorkingHours = calendarMonth === "May" && calendarYear === "2026";
  const schedule = scheduleDetail ? <section className="cleaner-working-day-detail"><button className="cleaner-back" onClick={() => setScheduleDetail(false)}>← Working hours</button><header className="cleaner-section-head"><span>DAY DETAIL</span><h1>Working hours</h1></header><div className="cleaner-date-picker"><button type="button" onClick={() => setScheduleDay((scheduleDay + 6) % 7)}>‹</button><strong>{selectedSchedule.day} · {weekDates[scheduleDay]} May 2026</strong><button type="button" onClick={() => setScheduleDay((scheduleDay + 1) % 7)}>›</button></div>{selectedSchedule.hours === "Off" ? <section className="cleaner-hours-card off"><span>WORKING HOURS</span><strong>Off duty</strong><small>You are not scheduled for working hours on this day.</small></section> : <section className="cleaner-hours-card"><span>WORKING HOURS</span><strong>{selectedSchedule.hours}</strong><div><b>{hoursTotal(selectedSchedule.hours)} hours</b><small>Available to receive Work Orders</small></div></section>}<section className="cleaner-hours-station"><div><span>STATION POINT</span><strong>{demoCleaner.stationPoint.zoneName}</strong><small>Default working location</small></div><StationMap x={demoCleaner.stationPoint.x} y={demoCleaner.stationPoint.y} /></section><section className="cleaner-hours-note"><i>i</i><p>{selectedSchedule.hours === "Off" ? "No Work Orders will be assigned during this off-duty period." : "You may receive Work Orders during these listed working hours."}</p></section></section> : <section className="cleaner-working-hours"><header className="cleaner-calendar-heading"><button type="button" aria-label="Open navigation">☰</button><div><span>SCHEDULE</span><h1>Working hours</h1></div><button type="button" aria-label="Choose week">▦</button></header><div className="cleaner-calendar-filters"><label>MONTH<select value={calendarMonth} onChange={(event) => setCalendarMonth(event.target.value)}><option>May</option><option>June</option><option>July</option></select></label><label>YEAR<select value={calendarYear} onChange={(event) => setCalendarYear(event.target.value)}><option>2026</option><option>2027</option></select></label></div><div className="cleaner-week-range"><button type="button" aria-label="Previous week">‹</button><strong>{hasWorkingHours ? "25–31 May 2026" : `${calendarMonth} ${calendarYear}`}</strong><button type="button" aria-label="Next week">›</button></div><section className="cleaner-standard-calendar"><div className="cleaner-calendar-time-head"><span>DATE</span>{calendarTimes.map((time) => <b key={time}>{time}</b>)}</div><div className="cleaner-calendar-date-rows">{demoCleaner.schedule.map((day, index) => { const range = day.hours === "Off" ? undefined : calendarRange(day.hours); return <div className={index === scheduleDay ? "active" : ""} key={day.day}><button type="button" className="cleaner-calendar-date-label" onClick={() => setScheduleDay(index)}><b>{shortDay(day.day)}</b><span>{weekDates[index]}</span></button><div className="cleaner-calendar-day-track">{hasWorkingHours && range ? <button type="button" className="cleaner-working-band" style={{ gridColumn: `${range.start} / ${range.end}` }} onClick={() => { setScheduleDay(index); setScheduleDetail(true); }}><span>{day.hours.split(" – ")[0]}</span><b>{index === scheduleDay ? "Working hours" : ""}</b><small>{day.hours.split(" – ")[1]}</small></button> : hasWorkingHours ? <span className="cleaner-off-duty">Off duty</span> : null}</div></div>; })}{!hasWorkingHours && <div className="cleaner-calendar-empty"><i>◷</i><strong>No upcoming working hours</strong><span>There are no schedule changes for this period.</span></div>}</div></section><section className="cleaner-week-total"><i>◷</i><div><span>{hasWorkingHours ? "THIS WEEK" : "SCHEDULE"}</span><strong>{hasWorkingHours ? `${weeklyHours} working hours` : "No upcoming working hours"}</strong><p>{hasWorkingHours ? "Tap a working-hours band to view its details." : "Choose another month or year to view its timetable."}</p></div></section></section>;
  const notifications = <><header className="cleaner-section-head"><span>NOTIFICATIONS</span><h1>Updates</h1></header><section className="cleaner-notifications">{demoNotifications.map((item) => <button key={item.notificationId} onClick={() => item.workOrderId && openWork()}><i className={item.type} /><div><b>{item.title}</b><p>{item.message}</p><small>{formatTime(item.createdAt)}</small></div></button>)}</section></>;
  const profile = <><header className="cleaner-hero profile"><div><span>CLEANER PROFILE</span><h1>{demoCleaner.name}</h1><p>{demoCleaner.email}</p></div><i>AR</i></header><section className="cleaner-availability"><span>CURRENT AVAILABILITY</span><b><i />{demoCleaner.availability}</b></section><section className="cleaner-profile-details"><span>MY DETAILS</span><p><b>Staff ID</b><small>{demoCleaner.staffCode}</small></p><p><b>Contact</b><small>{demoCleaner.phone}</small></p><p><b>Site</b><small>{demoCleaner.siteName}</small></p></section><section className="cleaner-schedule"><header><span>WEEKLY WORKING HOURS</span><button type="button" onClick={() => setPage("schedule")}>View schedule</button></header>{demoCleaner.schedule.map((day) => <p key={day.day}><b>{day.day}</b><span>{day.hours}</span></p>)}</section><section className="cleaner-station"><span>STATION POINT</span><strong>Station Zone · {demoCleaner.stationPoint.zoneName}</strong><StationMap x={demoCleaner.stationPoint.x} y={demoCleaner.stationPoint.y} /></section><button className="cleaner-signout" onClick={onLogout}>Sign out</button></>;

  return <main className="cleaner-mobile"><div className="cleaner-mobile-content">{page === "home" ? home : page === "work" ? workPage : page === "schedule" ? schedule : page === "notifications" ? notifications : profile}</div><nav>{([ ["home", "⌂", "Home"], ["work", "▣", "Work"], ["schedule", "▦", "Schedule"], ["notifications", "◉", "Updates"], ["profile", "◌", "Profile"] ] as const).map(([id, icon, label]) => <button className={page === id ? "active" : ""} onClick={() => { setPage(id); setDetail(false); setScheduleDetail(false); }} key={id}><i>{icon}</i><span>{label}</span></button>)}</nav></main>;
}
