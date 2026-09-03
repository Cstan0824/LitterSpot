# LitterSpot current frontend design system

Status: current implementation reference for frontend integration.

Source audited: `/Users/jeremychin/CodingProjects/LitterSpot-Melissa/frontend` on 2026-09-02. This directory is the current main-branch frontend before V2 integration work. Its code and assets are the visual authority for LitterSpot until the frontend team supplies a newer design.

This replaces the former first-version product brief. It is a frontend styling and interaction reference, not a product requirements document.

## Design intent

LitterSpot is a field-operations control room for tourist-attraction cleanliness. The interface should feel like an operational site system, not a generic SaaS dashboard or an AI model-training tool.

The design uses a deliberate contrast:

- dark forest-green navigation and system context;
- pale paper and mist workspaces for decisions, evidence review, and administration;
- blue/cyan inspection surfaces for Camera and Work detail;
- coral, saffron, lime, and muted slate for operational state, not decoration.

The result should feel like a managed attraction field station: physical, map-led, alert-aware, and precise.

## Source authority

Use these in priority order when extending or integrating the frontend.

1. `/Users/jeremychin/CodingProjects/LitterSpot-Melissa/frontend/src/field-station.css`
2. `/Users/jeremychin/CodingProjects/LitterSpot-Melissa/frontend/src/features/operations/`
3. `/Users/jeremychin/CodingProjects/LitterSpot-Melissa/frontend/src/components/FieldStationNavigation.tsx`
4. `/Users/jeremychin/CodingProjects/LitterSpot-Melissa/frontend/src/features/cleaner/`
5. `/Users/jeremychin/CodingProjects/LitterSpot-Melissa/frontend/public/fonts/`
6. `/Users/jeremychin/CodingProjects/LitterSpot-Melissa/frontend/public/maps/batu-caves-site-plan.png`

`frontend/src/styles.css` contains older standalone analysis-tool styling and earlier visual experiments. It is not the authority for authenticated Supervisor pages. Do not use its dark `Space Grotesk` card system as the source for V2 operational pages.

The CSS contains older styles followed by later Prototype 6 overrides. Where they conflict, the later source-order rules are the intended current appearance. In particular, the horizontal Field Station navigation overrides the former sidebar shell.

## Core tokens

### Field Station base

| Token | Value | Use |
|---|---:|---|
| Canopy | `#11251f` | command navigation and dark panels |
| Field | `#163d37` | selected navigation and deep operational surfaces |
| Raised field | `#1f5147` | elevated green state |
| Mist | `#edf3ed` | page ground |
| Paper | `#fffef8` | readable content surfaces |
| Ink | `#15241f` | primary text and structural rules |
| Muted | `#5c6f67` | secondary labels and explanatory copy |
| Line | `#c6d3cb` | thin dividers, tables, and inputs |
| Jade | `#35b7a1` | active navigation, selected controls, and focus |
| Coral | `#f05e4f` | critical conditions and destructive operations |
| Lime | `#b5d83b` | available, clear, complete, and successful progress |
| Saffron | `#e8b638` | warning and attention |

The workspace may use a quiet 32px cartographic grid over mist. It is a site-operations surface, not generic decoration.

### Operational states

| State | Treatment |
|---|---|
| Critical/action | coral, with clear high-contrast text |
| Warning/watch | saffron |
| Clear/available/resolved | lime or jade |
| Review | cyan or blue |
| Offline/stale/dismissed | desaturated slate |

Colour must be paired with readable text, a badge, dot, icon, or status label.

## Typography

Use the bundled font files. Do not replace them with system defaults or the older `Space Grotesk`/`DM Mono` tool styling.

| Role | Font | Use |
|---|---|---|
| Field Display | Barlow Condensed, 700/900 | operational titles, large zone names, prominent counts |
| Field Text | Figtree, 400/800 | body copy, buttons, form controls, navigation |
| Field Mono | Roboto Mono | IDs, timestamps, state metadata, compact labels |
| Prototype Display | Bricolage Grotesque | Prototype 6 headings and current horizontal navigation |
| Prototype Text | Host Grotesk | Prototype 6 navigation, Camera Operations, Camera/Work detail |

Large display titles are condensed and compact. Supporting text is sentence case. Metadata is small and mono only where precision matters.

## Shared application shell

The active Supervisor shell uses a horizontal sticky navigation bar, not the old left sidebar.

- Dark canopy header with a restrained jade radial glow.
- LitterSpot wordmark on the left in Prototype Display.
- Horizontal route navigation with icon and label.
- Active route uses a jade underline and white text.
- Site context and account action sit at the edge.
- Mobile collapses navigation into a menu while keeping the same information architecture.

The content workspace is wide, light, map-oriented, and uses thin structural lines rather than generic rounded-card stacks.

## Supervisor page families

### Dashboard: Atlas / cartographic control view

- Pale map canvas with Zone pins, map controls, a state legend, and optional activity animation.
- Selected Zone opens a deep blue inspector panel, not a floating generic modal.
- Pins encode action, review, watch, steady, and stale state.
- Lower overview panels show top Alerts, available Cleaners, busy Zones, evidence exceptions, and responsibility.
- The map becomes the true V2 Site Map when that renderer exists. Until then it is an explicitly visual overview, not a claim of physical geometry.

### Camera Operations: blue/cyan inspection wall

- Light blue-gray canvas, ink/navy structure, cyan interaction accent, coral action state, lime healthy state.
- Strong Bricolage/Host Grotesk headings.
- Filter rail, Camera-wall grid, live-state summary, selected Camera inspector, and Camera history.
- Camera cards are rectangular evidence tiles with a restrained hover lift.
- Add Camera is a high-contrast navy action, used only when the V2 Draft workflow exists.

### Alert Management: evidence case file

- Alert list uses wide evidence rows with thumbnail, severity, status, location, and action context.
- Alert detail is a two-column case file: evidence on the left and a narrow operational sidebar on the right.
- Evidence overlays use coral bounds and compact mono confidence markers.
- The response journey is a horizontal operational timeline.
- Alert controls live inside the sidebar and follow the existing assignee and evidence-section rhythm. Do not add bare selects or generic dark action cards.

### Work Management: assignment and review drawer

- Work list is a structured table with metric strip, filters, origin labels, staff identity, state, and priority.
- Manual Work opens the existing full modal. Work detail opens the existing right-hand drawer.
- The Work drawer uses a navy header, white evidence/metadata body, compact status chips, Cleaner-row selection, and clear Supervisor decision controls.
- Destructive actions require a reason. Keep the reason field inside the drawer action section with the same thin-rule layout.
- Camera-linked Work retains a direct route into Camera context.

### Cleaner Management

- A light operational roster with a staged creation/edit workflow.
- Reuse the existing Team modal, Station Point interaction, schedule editor, and roster rows.
- Station Point is a physical map concept. Do not restore assigned-zone restrictions in copy or controls.
- Account status and calculated availability are different concepts.

### Cleaner mobile web

- Mobile-only, focused on current Work, schedule, updates, and profile.
- Bottom navigation stays persistent and clear.
- Work detail is the primary surface. Camera-linked and coordinate Work have different evidence requirements.
- Do not expose Supervisor navigation, cross-site data, or analytics.

## Surface and component rules

- Use square or near-square corners, thin lines, and intentional contrast. Avoid generic large-radius cards.
- Jade is selected/active field controls. Coral is real action or destructive consequence. Lime is availability/completion. Saffron is warning.
- Field Station forms use pale paper with thin green-gray rules. Camera/Work Prototype 6 controls use their local blue-gray rules.
- Cleaner selection uses the existing identity-row pattern: initials block, name, staff/zone metadata, and selected/current marker.
- Use modal and drawer layers only for focused operational tasks. Preserve existing overlay behaviour, close controls, keyboard handling, and responsive layout.
- Human-facing states use sentence case. Raw database values may be converted for display but must not gain invented meaning.
- Loading, no-data, unavailable evidence, conflict, and permission states use the existing page family and its state palette.

## Motion and accessibility

- Motion communicates a live condition: map beacon, alert pulse, review scan, Zone arrival, or selected Camera state.
- Do not add decorative entrance animation to every card or form.
- Honour `prefers-reduced-motion` by disabling map and state animations.
- Keep visible focus outlines, sufficient contrast, keyboard access, and touch-sized controls.
- Mobile layouts collapse map/detail and table surfaces into one column without removing the core operational decision.

## V2 integration rules

1. Keep Melissa’s frontend component tree and visual classes as the presentation baseline.
2. Add data adapters and bindings before changing layout or copy.
3. Reuse an existing page’s modal, drawer, row, badge, filter, and error treatment before creating a new component.
4. If the backend needs data that the UI cannot collect accurately, do not fake it. Record the gap and wait for matching UI work.
5. Treat V2 state names, availability, coordinates, evidence, and revisions as backend truth.
6. Do not use the obsolete first-version brief or legacy dark tool CSS to make visual decisions for authenticated operational pages.

## Known design gaps

These require dedicated UI work rather than quiet integration substitutions.

- A true V2 Site Map renderer for real Zone polygons, metre coordinates, Camera placement, Cleaner stations, and optional plan imagery.
- Bin Analysis page design using V2 daily recommendations, factor coverage, interventions, and comparisons.
- System page design for Orchestrator state, pause/resume, structured runs, and safe system events.
- Superadmin product area and Root Supervisor account-management surfaces.

Until each is designed, preserve the current route or show a clear deferred state. Do not invent a generic dashboard as a stand-in.
