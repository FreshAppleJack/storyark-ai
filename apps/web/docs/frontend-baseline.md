# Frontend preservation baseline

## Verified reference

Use commit `8b2a4097392ace8e4bc529c23fe1456851c3ff92`
(`refactor: enable strict types and establish frontend quality checks`) as the
layout and interaction baseline during backend localization. It is the direct
parent of `672ba3473d610592411d14dd23dbc9afb59103c7`, the first Tauri shell commit.
This is the React-refactored interface immediately before Tauri, not the earlier
course prototype.

Do not restore the baseline's remote providers, authentication requirements or old
save implementation. This reference is verified from Git history; it does not mean
every current screen has already passed a visual comparison.

## Rules during localization

- Preserve page composition, spacing, typography, controls and normal navigation
  as closely as possible while replacing storage and services.
- Do not invent onboarding screens, initialization pages, extra dialogs or steps
  to expose implementation details. Initialize internally within the existing flow,
  while distinguishing load failure from valid empty data.
- Defer discretionary UI optimization and redesign until backend localization is
  complete. A beneficial-looking change is not authorization to introduce it.
- Retain data-loss protection and honest loading/save-failure feedback. Prefer
  existing feedback patterns and the smallest necessary visible change.
- Compare touched UI with this baseline before completing a localization unit.
  Explain necessary visible differences and their authorization.
- Use temporary `.mjs` CDP scripts for UI interaction tests against the desktop
  WebView with isolated data, not the computer-use skill. Match viewport, theme
  and sample content for visual comparisons; label untested screens honestly.

## Explicit exceptions and corrections

- Start directly at the local Dashboard without login. Keep login/register source
  files without making authentication a prerequisite for local writing.
- Local-save status and unavailable model capabilities may be described accurately
  without redesigning the surrounding page.
- The user prefers retaining the existing character-save feedback dialog. This
  specific exception does not authorize additional dialogs elsewhere.
- Commit `c3f782b5e7e323c6565953dc71d1b0a37601d652` removes the added relationship-map
  initialization screen. Preserve direct canvas entry and idempotent initialization;
  do not reintroduce that screen or reseed saved empty graphs.
- After local settings functionality is restored, add the explicitly requested
  API configuration entry during model integration. This does not authorize an
  unrelated settings redesign.

## Review commands

From the repository root, inspect history without reverting current functionality:

```powershell
git show 8b2a4097392ace8e4bc529c23fe1456851c3ff92:apps/web/pages/RelationshipMap.tsx
git diff 8b2a4097392ace8e4bc529c23fe1456851c3ff92 -- apps/web/pages apps/web/components apps/web/features apps/web/src
```

A changed UI file is a review candidate, not proof of visual drift. Data adapters,
save guards and lifecycle fixes can change these files without changing layout.
