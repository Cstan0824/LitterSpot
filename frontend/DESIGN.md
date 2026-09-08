---
name: LitterSpot
description: A precise field-operations interface for cleanliness monitoring and response.
colors:
  canopy-navy: "#091c31"
  operational-ink: "#12243d"
  paper: "#ffffff"
  mist: "#f2f5f7"
  line: "#b9c9d5"
  coral-action: "#f05e4f"
  jade-signal: "#31b7a1"
  lime-active: "#79b929"
typography:
  display:
    fontFamily: "Field Display, sans-serif"
    fontSize: "clamp(42px, 5vw, 68px)"
    fontWeight: 900
    lineHeight: 0.9
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Field Text, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Field Mono, monospace"
    fontSize: "10px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.1em"
rounded:
  square: "0"
  status: "1px"
  avatar: "50%"
spacing:
  xs: "8px"
  sm: "12px"
  md: "18px"
  lg: "24px"
  xl: "48px"
components:
  button-primary:
    backgroundColor: "{colors.coral-action}"
    textColor: "{colors.operational-ink}"
    rounded: "{rounded.square}"
    padding: "0 19px"
    height: "46px"
  field:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.operational-ink}"
    rounded: "{rounded.square}"
    padding: "0 12px"
    height: "45px"
  panel:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.operational-ink}"
    rounded: "{rounded.square}"
    padding: "22px"
---

# Design System: LitterSpot

## Overview

**Creative North Star: "The Field Operations Register"**

LitterSpot looks like an operational register laid over a live site map. Dense records, exact boundaries, and explicit states matter more than decorative depth. The interface uses cool paper fields under a dark navy navigation band, with coral reserved for the current protected action and jade or lime used for healthy state signals.

Melissa's Supervisor and Cleaner interfaces remain the visual authority. New administrative pages extend their condensed headings, square controls, ruled sections, and compact operational data without introducing a separate corporate dashboard style.

**Key Characteristics:**

- Flat, bordered working surfaces.
- Condensed display headings paired with plain body copy.
- Monospaced labels only for status, measurements, IDs, and compact metadata.
- Color communicates action or state, never decoration.

## Colors

The palette is restrained: navy and paper own most of the screen, while coral, jade, and lime carry specific operational meaning.

- **Canopy navy** is the navigation field and dark operational frame.
- **Operational ink** carries headings and primary content.
- **Paper** holds forms, registers, dialogs, and ledgers.
- **Mist** separates the working area from white panels.
- **Line** divides records and establishes hierarchy without shadow.
- **Coral action** marks one primary or risky action.
- **Jade signal** identifies LitterSpot and healthy live context.
- **Lime active** marks enabled Site and account states.

**The One Coral Action Rule.** Coral belongs to the single action that needs immediate attention. Healthy recovery controls remain secondary.

**The State Is Literal Rule.** Do not assign alert, health, or authority meaning to decorative color.

## Typography

**Display Font:** Field Display, using the bundled Barlow Condensed weights 700 and 900.

**Body Font:** Field Text, using the bundled Figtree weights.

**Label Font:** Field Mono, using the bundled Roboto Mono face.

The condensed display face gives pages a strong operational hierarchy. Figtree keeps forms and explanations readable. Mono appears only where fixed-width scanning helps.

- **Display:** 900 weight, tight line height, used for page titles and major values.
- **Title:** 700 or 900 weight at 20 to 29px, used for register and dialog headings.
- **Body:** 400 weight at 11 to 15px, with longer copy near 1.5 line height.
- **Label:** 700 weight at 9 to 11px with tracked uppercase, never below 9px.

**The Measurement Font Rule.** Use mono for IDs, status, timestamps, coordinates, and measurements. Use Field Text for sentences and action labels.

## Layout

Desktop pages use a centered container up to 1510px with 24px outer gutters. Full-width ruled ledgers handle lists. Selected records open into a three-column workbench, then collapse into two columns and finally one column as space narrows.

The global navigation stays at the top on desktop. Below 650px, primary navigation becomes a fixed two-action bottom bar and content gains enough bottom padding to clear it. Dialogs fill the viewport on small screens. Tables may scroll horizontally when their column relationships matter more than stacking.

Spacing follows an 8 to 24px working rhythm, with 48px reserved for page arrivals and major separation.

## Elevation & Depth

The system is flat by default. Background tone, one-pixel borders, and nested ruled fields create depth. A diffuse shadow appears only on modal dialogs above a dark scrim.

**The Ruled Surface Rule.** Prefer a border or a tonal shift for resting hierarchy. Do not add shadows to ordinary cards, ledgers, or form sections.

## Shapes

Working controls, panels, dialogs, filters, and status chips are square or nearly square. Circular geometry is limited to people and live-point identity, such as account avatars and map markers. Borders are consistently one pixel.

## Components

### Buttons

- Primary buttons use coral for creation or attention and navy for protected confirmation inside dialogs.
- Secondary buttons use white with a navy one-pixel border.
- Destructive confirmation uses coral or red with explicit action copy.
- Every button has a visible aqua focus ring and a disabled state that reduces opacity without hiding the label.

### Status chips

Status chips use a one-pixel colored border, a lightly tinted field, mono uppercase text, and enough text contrast to remain readable without relying on hue.

### Cards and containers

Panels are white, square, and separated by one-pixel cool-gray rules. Adjacent register panels share borders so they read as one workbench rather than unrelated cards.

### Inputs and fields

Fields use a white background, square corners, a one-pixel cool-gray border, and 45px desktop height. Labels sit above the field. Measurement units sit inside the right edge of numeric fields, while optional annotations remain in the label row. Errors name the problem and recovery in a bordered pale-red message.

### Navigation

The dark navy navigation band carries the LitterSpot identity, two or more plain action labels, and the account avatar. The active route uses a blue rule instead of a filled tab. Mobile navigation moves to the bottom edge.

### Ledgers

Ledgers preserve repeated column alignment, use a tinted label row, and reveal the complete row as the click target. Expanded audit records expose exact resource, actor, and before or after data below the row.

## Do's and Don'ts

### Do:

- **Do** make Site, Camera, Alert, Work, and account state visible before offering an action.
- **Do** use full-row targets for dense operational lists.
- **Do** reserve the strongest color for the action that actually needs attention.
- **Do** keep dialogs keyboard-contained and restore focus to their trigger.
- **Do** show metres, timestamps, IDs, and revision numbers in compact mono text.

### Don't:

- **Don't** build pages from disconnected same-size metric cards.
- **Don't** use rounded soft-shadow containers in the operational product.
- **Don't** color Zones or records in ways that imply untrue alert state.
- **Don't** shrink operational labels below 9px or use low-contrast gray on paper.
- **Don't** expose unavailable actions and explain them with repeated read-only banners.

The build still uses small uppercase context labels above some headings. They are not canonized as decorative eyebrows; future work should keep only labels that communicate real status, sequence, or measurement context.
