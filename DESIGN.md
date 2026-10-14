---
version: alpha
name: Little Clarity
description: A calm, reading-first identity, derived from EZ and shared across native and browser surfaces.
colors:
  primary: '#296e59'
  primary-dark: '#6ec2a1'
  primary-hover: '#205642'
  primary-hover-dark: '#84d1b1'
  on-primary: '#ffffff'
  on-primary-dark: '#14251d'
  canvas: '#fafaf7'
  canvas-dark: '#20211f'
  surface: '#ffffff'
  surface-dark: '#292b27'
  subtle: '#f0f1eb'
  subtle-dark: '#30332e'
  ink: '#242722'
  ink-dark: '#e8e9e2'
  muted: '#62685d'
  muted-dark: '#b3b9ae'
  line: '#d7dcd1'
  line-dark: '#454b40'
  wash: '#eaf2ec'
  wash-dark: '#253d31'
  danger: '#a3312a'
  danger-dark: '#f3a79e'
  danger-wash: '#fff0ed'
  danger-wash-dark: '#472a28'
  warning: '#805417'
  warning-dark: '#e2bd83'
  warning-wash: '#f7efdf'
  warning-wash-dark: '#403425'
typography:
  subject:
    fontFamily: 'ui-serif, Georgia, serif'
    fontSize: 24px
    fontWeight: 500
    lineHeight: '1.3'
  body:
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif'
    fontSize: 15px
    fontWeight: 400
    lineHeight: '1.65'
  control:
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif'
    fontSize: 14px
    fontWeight: 500
    lineHeight: '1.5'
  caption:
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif'
    fontSize: 12px
    fontWeight: 400
    lineHeight: '1.5'
rounded:
  control: 8px
  panel: 12px
  composer: 14px
  pill: 9999px
spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  reading: 32px
components:
  button-primary:
    backgroundColor: '{colors.primary}'
    textColor: '{colors.on-primary}'
    rounded: '{rounded.control}'
  button-primary-dark:
    backgroundColor: '{colors.primary-dark}'
    textColor: '{colors.on-primary-dark}'
  reading:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink}'
    typography: '{typography.body}'
  reading-dark:
    backgroundColor: '{colors.surface-dark}'
    textColor: '{colors.ink-dark}'
  caption:
    backgroundColor: '{colors.canvas}'
    textColor: '{colors.muted}'
  caption-dark:
    backgroundColor: '{colors.canvas-dark}'
    textColor: '{colors.muted-dark}'
---

## Overview

Quiet, personal, and useful: a small space for finding clarity. EZ is the initial
visual reference. Carry this identity into other products through the roles and
rules below; keep each product's vocabulary, workflows, and platform conventions.
Tokens are authoritative values. This document is the one authored design source;
platform files are generated. The format is Google Labs DESIGN.md alpha, with
paired `-dark` colors as this contract's explicit appearance convention.

## Colors

Use the green primary for actions, selection, and meaningful emphasis. Neutral
canvas, surface, and subtle layers separate content without competing with it.
Muted text stays readable. Danger and warning always accompany a text explanation.
Pair each color with its `-dark` value in dark appearance. Native controls may use
system semantic surfaces; preserve the shared accent and content hierarchy.

## Typography

Use serif subject headings for a query or passage, and system sans for answers,
navigation, and controls. Captions carry secondary information without becoming
faint fine print. Map `ui-serif` to SwiftUI's system serif; use available system
fonts on the web. Allow content wrapping, text selection, zoom, and platform scaling.

## Layout

Give reading content a comfortable measure and generous breathing room. Compact
popups and lookup panels use tighter spacing; tab boards use dense, scannable rows.
Preserve the same hierarchy across these densities. Reveal advanced options when
needed, keep the primary action reachable, and avoid horizontal scrolling at narrow widths.

## Elevation & Depth

Use tonal layers and quiet dividers for persistent surfaces. Reserve restrained
shadows for overlays that need separation from the page. Keep host-page styling
outside extension overlays, and keep overlays within the viewport.

## Shapes

Soft rectangular controls and panels follow the rounded scale. Pills are for small
status cues or floating entry points. Use existing platform icons consistently.

## Components

Use a clear primary action per task, quiet secondary actions, and explicit destructive
labels. Search, lists, selection, focus, tooltips, notices, and loading feedback must
share the palette and hierarchy. Keep keyboard access and honest persisted/error states.

## Do's and Don'ts

- Keep brand roles consistent while adapting native controls and task density.
- Validate normal text contrast at 4.5:1 and meaningful control/focus contrast at 3:1.
- Show content before model details; preserve important status and provenance access.
- Avoid unrelated accent colors, nested decorative cards, and oversized branding.
- Compare real light/dark, compact/wide, populated, loading, and error states after applying.

## Motion

Motion explains a state change or spatial relationship. Favor brief, subtle feedback;
preserve readability and input responsiveness. Honor reduced-motion preferences,
including streaming indicators. Future VFX (particles, glow, distortion) are optional
accent treatments, kept away from reading text and never required to understand status.
Add concrete motion/effect tokens and platform mappings when an actual effect is adopted.
