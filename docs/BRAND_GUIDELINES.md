# CERBERUS Workspace — Brand Guidelines

**Version:** 2.0.0 (Pure 2D Monochromatic Gothic Identity)  
**Domain:** Private Engineering Collaboration & Sentinel Provenance Platform  
**Master Artwork Reference:** `public/cerberus.jpeg`  
**Motto:** *Evidence before approval.*

---

## 1. Brand Identity & The Guardian

The **CERBERUS** brand identity is anchored by the **Six-Headed Guardian**, derived directly from the official graphite/charcoal master artwork ([`public/cerberus.jpeg`](file:///c:/Users/mosta/Desktop/proj/cerberus-workspace/public/cerberus.jpeg)).

The visual language is defined as **Monochromatic Gothic × Dark Engraved Metal × Mythological Security**.

### Core Philosophy
In the CERBERUS engineering workspace, progress is not declared; it is proven. The guardian stands as an immutable sentinel over the convergence of all technical disciplines, demanding reproducible proof, checklist compliance, and independent administrative review.

### Strict Identity Rule
> **MANDATORY BRAND DIRECTIVE:**  
> The six heads represent the unified, vigilant posture of the collective sentinel. **Never assign individual meanings, roles, team members, or engineering specializations to individual heads.** The guardian functions as a single, indivisible entity.

---

## 2. Master Brand Assets (Pure 2D)

All 3D models and WebGL implementations have been removed in favor of a pure 2D identity centered on the original master artwork:

| Asset | Format | Purpose & Description |
|---|---|---|
| [`public/cerberus.jpeg`](file:///c:/Users/mosta/Desktop/proj/cerberus-workspace/public/cerberus.jpeg) | Master Artwork | High-contrast graphite/charcoal chiaroscuro artwork depicting the six-headed guardian in an aggressive sentinel stance with spiked muscle anatomy, gothic cathedral arches, and forged iron collar chains. |
| [`public/favicon.svg`](file:///c:/Users/mosta/Desktop/proj/cerberus-workspace/public/favicon.svg) | SVG Vector | Official 64x64 six-headed guardian crest rendered in sculpted graphite, burnished silver, and chiseled shield borders. |
| [`src/components/cerberus-logo.tsx`](file:///c:/Users/mosta/Desktop/proj/cerberus-workspace/src/components/cerberus-logo.tsx) | React Component | Reusable SVG vector components (`CerberusMark`, `CerberusLogo`, `CerberusSentinelStatus`) styled with monochromatic intaglio line-work. |

---

## 3. Color Palette & Design Tokens

The color system is derived strictly from the graphite pencil, charcoal dust, cold iron, and silver chalk tones of `cerberus.jpeg`:

```
+-------------------------------------------------------------------------+
| SHADOW VOID     CHARCOAL DEEP    GRAPHITE SURFACE   SLATE STEEL  SILVER |
| #050608         #090B0E          #0F1217            #2A323F      #E2E8F0|
+-------------------------------------------------------------------------+
```

### Palette Specifications

| Token Name | Hex | RGB | Semantic Usage |
|---|---|---|---|
| `--color-shadow-void` | `#050608` | `5, 6, 8` | Deepest shadow layer, outer viewport background |
| `--color-charcoal-deep` | `#090b0e` | `9, 11, 14` | Primary page background, form backgrounds |
| `--color-surface-graphite` | `#0f1217` | `15, 18, 23` | Cards, panels, sidebar, modal backing |
| `--color-surface-elevated` | `#151820` | `21, 24, 32` | Elevated cards, input fields, active rows |
| `--color-surface-hover` | `#1c212a` | `28, 33, 42` | Row hover states, interactive feedback |
| `--color-border-subtle` | `#1e232d` | `30, 35, 45` | Subtle panel dividers, hairline borders |
| `--color-border-armor` | `#2a323f` | `42, 50, 63` | Forged metal card borders, container outlines |
| `--color-border-chiseled` | `#3e485a` | `62, 72, 90` | Focus outlines, active tab borders |
| `--color-platinum-pure` | `#f8fafc` | `248, 250, 252` | Master headings, primary brand wordmark |
| `--color-silver-light` | `#e2e8f0` | `226, 232, 240` | High-contrast readable body text, buttons |
| `--color-silver-mid` | `#cbd5e1` | `203, 213, 225` | Secondary text, active icons, optic rings |
| `--color-pewter` | `#94a3b8` | `148, 163, 184` | Subtitles, field labels, metadata |
| `--color-graphite-muted` | `#64748b` | `100, 116, 139` | Captions, timestamps, disabled hints |

### Restrained Classical Status Colors

In keeping with the monochromatic and dark metal tone, status badges use muted patinas rather than saturated neons:
- **Approved / Verified:** Cold Silver Steel (`#e2e8f0` on `#141a20`, border `#3b4656`).
- **Ready for Review / Pending:** Slate Pewter (`#cbd5e1` on `#131720`, border `#333d4e`).
- **Blocked / Critical / Changes Requested:** Deep Iron Oxblood (`#f87171` on `#221216`, border `#4d242c`).
- **In Progress / High:** Antique Muted Bronze (`#e2b36e` on `#201910`, border `#4a3821`).

---

## 4. Typography

Typography reinforces industrial precision and classical authority:

- **Display Headings:** `Space Grotesk` (500, 600, 700) with tight tracking (`-0.035em`) for titles and loose tracking (`0.06em` to `0.1em`) for uppercase telemetry.
- **Interface & Content:** `Inter` (300, 400, 500, 600) for clean reading.
- **Telemetry & Hashes:** `JetBrains Mono` for task IDs, commit hashes, versions, and audit logs.

---

## 5. Architectural Presentation (2D Engraving Showcase)

The authentication hero and key application sections feature `public/cerberus.jpeg` mounted in an **Engraved Steel & Chiaroscuro Arch**:
1. Radial vignette shading framing the six heads.
2. Hairline silver top-light bevel (`linear-gradient(to bottom, rgba(255, 255, 255, 0.12), transparent)`).
3. Etched metadata banner ("MASTER ARTWORK // SIX-HEADED SENTINEL").
4. No WebGL, no 3D canvas, no orbit controls.
