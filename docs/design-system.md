# LitterSpot design system

## 1. Design direction

LitterSpot uses a field-operations register style. The interface combines ruled paper-like work areas, exact map geometry, compact operational records, and a dark Site navigation field. State and next action take priority over decoration.

The implemented system uses three local type families:

- **Field Display**, Barlow Condensed 700 and 900, for page and section headings;
- **Field Text**, Figtree 400 and 800, for body text and controls;
- **Field Mono**, Roboto Mono 400 to 700, for measurements, states, IDs, labels, and timestamps.

## 2. Core tokens

| Token | Value | Use |
| --- | --- | --- |
| `--fs-canopy` | `#11251f` | Main navigation field |
| `--fs-field` | `#163d37` | Raised dark operational areas |
| `--fs-field-raised` | `#1f5147` | Elevated dark state |
| `--fs-mist` | `#edf3ed` | Application background |
| `--fs-paper` | `#fffef8` | Panels and working surfaces |
| `--fs-ink` | `#15241f` | Primary text |
| `--fs-muted` | `#5c6f67` | Supporting text |
| `--fs-line` | `#c6d3cb` | Rules and boundaries |
| `--fs-jade` | `#35b7a1` | Healthy state and identity |
| `--fs-coral` | `#f05e4f` | Primary or protected action |
| `--fs-lime` | `#b5d83b` | Enabled and assigned states |
| `--fs-saffron` | `#e8b638` | Warning and attention |
| `--fs-rail` | `224px` | Desktop navigation width |
| `--fs-ease` | `cubic-bezier(.22, 1, .36, 1)` | Shared transition curve |

Camera pages extend the palette with navy, cyan, coral, and lime variables for dark evidence frames and live status. Those variables remain scoped to Camera surfaces.

## 3. Layout

### Site and spatial administration

- Desktop operational pages use a 224-pixel sticky rail and a fluid content pane.
- Maps occupy the primary working area and keep controls outside the geometry where practical.
- Map viewers expose fit, zoom, pan, measurements, selected Zone, Camera markers, and point popovers.
- Structural workflows use full-page or large-modal staged forms and explicit publish actions.

### Camera monitoring and AI

- Camera grids prioritize evidence area over metadata.
- Camera Detail uses a 16:9 monitoring frame, status header, source controls, and adjacent operational history.
- Buffering, rebuffering, disabled, offline, and unavailable states replace the media area rather than appearing as unrelated toasts.
- Detection geometry uses type-specific colors and labels while Original Video removes overlays without changing playback.

### Alert and evidence management

- Alert list and detail read as an evidence case file.
- Severity, status, Camera, Zone, time, confidence, and assignment are visible before secondary history.
- Destructive dismissal requires a reason and a deliberate action area.

### Cleaner and Work operations

- Work uses a queue plus a detail drawer or modal.
- The detail groups location, evidence, assignee, lifecycle, and Supervisor action.
- Cleaner mobile remains constrained to a phone-width content column on large screens and uses fixed bottom navigation.
- Mobile actions use large full-width targets and confirmation dialogs for irreversible transitions.

### Orchestration and operational intelligence

- Dashboard leads with Site Map context and current action counts.
- System separates concise operational status from expandable Run details.
- Analytics and bin-placement tables expose coverage and comparison context instead of decorative scores alone.

## 4. Components

### Buttons

- One primary action per decision area.
- Coral or dark navy marks the current committed action, depending on page family.
- Outline buttons represent navigation, retry, secondary control, or reversible actions.
- Danger styling is reserved for dismissal, deactivation, removal, or discard.
- Disabled state must remain visibly distinct and non-interactive.

### Status indicators

- Jade or lime: ready, online, active, assigned, or passed.
- Saffron: warning, buffering, awaiting review, or partial coverage.
- Coral or red: critical, offline, failed, dismissed, or destructive action.
- Status must include text. Color alone is insufficient.

### Forms

- Labels remain visible and use plain operational terms.
- Validation appears next to the field and at the action boundary when needed.
- Browser-native selection controls may be used for ordinary forms. Product-specific action menus use custom keyboard-accessible menus.
- Reasons are required for protected operational decisions.

### Tables and ledgers

- Headers use compact mono labels.
- Rows expose identity, state, ownership, location, and next action.
- Row activation must support mouse and keyboard.
- Pagination uses explicit Load more controls and reported totals.

### Dialogs and drawers

- Use `role="dialog"` or `alertdialog`, `aria-modal`, a named title, predictable close control, and focus restoration.
- Confirmation copy names the exact record and effect.
- Backdrop clicks do not close while a mutation is pending.

## 5. Responsive behavior

- Desktop Supervisor navigation collapses before mobile layouts take over.
- Camera grids reduce columns as width decreases.
- Multi-column forms and evidence layouts become one column.
- Cleaner mobile uses a maximum content width near 390 to 480 pixels and stays usable at 320 pixels.
- Maps retain a usable minimum height and keep toolbar actions reachable.
- Large tables may scroll horizontally rather than compressing critical columns beyond readability.

## 6. Accessibility

- Interactive elements have visible focus outlines.
- Maps and custom menus expose keyboard controls and accessible names.
- Status changes use `role="status"` when they do not require interruption and `role="alert"` for action-blocking errors.
- Reduced-motion media queries disable nonessential animation.
- Icons supplement text and never replace the only label for a critical action.
- State and severity never rely on color alone.

## 7. Content rules

- Use canonical capitalized domain terms from `CONTEXT.md`: Site, Site Map, Zone, Camera, Alert, Cleaner, Work Order, Verification, and Orchestrator.
- Describe the next operational action directly.
- Do not describe model output as certainty.
- Do not expose implementation version labels, raw provider reasoning, or internal exception text.
- Empty states explain whether the cause is no data, filtering, disabled monitoring, unavailable evidence, or missing permission.

## 8. Source ownership

The primary implementation is `frontend/src/field-station.css`, supplemented by component and feature styles. This document describes that implementation; it does not authorize a separate visual language. New components should reuse the tokens and page-family patterns above.
