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
  canvas-dark: '#1e1e1e'
  surface: '#ffffff'
  surface-dark: '#262626'
  subtle: '#f0f1eb'
  subtle-dark: '#303030'
  ink: '#242722'
  ink-dark: '#e8e8e8'
  muted: '#62685d'
  muted-dark: '#b5b5b5'
  line: '#d7dcd1'
  line-dark: '#484848'
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
  window-blue: '#356a99'
  window-blue-dark: '#8ebde5'
  window-violet: '#78539a'
  window-violet-dark: '#c4a3e2'
  window-rose: '#a34f69'
  window-rose-dark: '#e4a0b6'
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
