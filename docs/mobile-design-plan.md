# Predictable — Mobile Design Plan

Plan to take the desktop-first React app to a polished 320px–767px experience.

## Table of Contents

1. [Breakpoints](#1-breakpoints)
2. [Global Nav Strategy](#2-global-nav-strategy)
3. [Per-Page Mobile Layouts](#3-per-page-mobile-layouts)
4. [Calendar Mobile](#4-calendar-mobile)
5. [CallDetail Mobile](#5-calldetail-mobile)
6. [Touch Targets](#6-touch-targets)
7. [Typography Scaling](#7-typography-scaling)
8. [Performance](#8-performance)
9. [PWA Decision](#9-pwa-decision)
10. [Implementation Order](#10-implementation-order)

---

## 1. Breakpoints

Tailwind v4 defaults (implicit via `@import "tailwindcss"` in `app/src/index.css`). Use only `sm` / `md` / `lg`; skip `xl`/`2xl` since the desktop max is `max-w-6xl` (1152px).

| Tier | Range | Tailwind | Used for |
|---|---|---|---|
| Mobile | 320–639px | (no prefix) | Single column, bottom tab bar, condensed type |
| Tablet | 640–767px | `sm:` | 2-col grids, inline filters on one row |
| Desktop | 768px+ | `md:` | Current 4-col stat grids, full top nav, calendar 7-col |
| Wide | 1024px+ | `lg:` | Optional side-by-side episode/transcript |

Mobile-first rule: every existing class without a prefix is the mobile state. Most components already use `grid-cols-2 md:grid-cols-4` correctly; the issue is the few with only desktop sizing and an undersized base.

---

## 2. Global Nav Strategy

**Pick: bottom tab bar (5 slots) + "More" drawer. Keep Substack ribbon.**

The 8-item bracketed nav in `app/src/App.tsx` is unusable at 320px. Horizontal scroll hides intent; segmented top tabs eat vertical space under the ribbon; hamburger-only kills discoverability. Bottom tab bar wins: thumb-zone, persistent, iOS-conventional.

| Slot | Label | Route |
|---|---|---|
| 1 | Scoreboard | `/` |
| 2 | Calls | `/calls` |
| 3 | Episodes | `/episodes` |
| 4 | Markets | `/markets` |
| 5 | More | drawer |

Drawer (bottom sheet, ~70vh, fat handle, backdrop): Principles, Calendar, Calculator, Guide, About, Admin.

**Substack ribbon stays** — shrink to `py-1.5` on mobile, allow one wrap.

**Header at mobile**: ribbon → `h-12` header with `Wordmark` only. Logo still returns to `/`.

In `App.tsx`: render existing `<nav>` `hidden md:flex`, new `<BottomTabBar />` `md:hidden`, add `pb-20` to `<main>` to clear it.

---

## 3. Per-Page Mobile Layouts

### Scoreboard (`app/src/pages/Scoreboard.tsx`)
- Stat grid: already `grid-cols-2 md:grid-cols-4` — 2x2 on mobile is right.
- By-tier grid: already `grid-cols-1 md:grid-cols-3` — keep.
- Top winners rows: set `min-w-0` on the left flex child and `flex-shrink-0` on the right return-pct cluster so long market hints don't push it off-screen.

### Calls (`app/src/pages/Calls.tsx`)
- Tier filter pills wrap to 3 rows at 320px — acceptable. Use `gap-1.5`.
- Day-group rows: tighten to `px-3 py-3`. Hide `c.market_source · c.market_ticker` on mobile (one tap away on CallDetail). Keep right-side return % inline.

### Episodes (`app/src/pages/Episodes.tsx`)
- Cover image: `w-14 h-14 sm:w-20 sm:h-20`. 80px square eats 25% of a 320px screen.

### EpisodeDetail (`app/src/pages/EpisodeDetail.tsx`)
- Header: `flex-col sm:flex-row` so image stacks above metadata on mobile; image to `w-20 h-20`.
- Calls list: same density as Calls page.
- **Substack write-up** (~30K chars after backfill): wrap in collapsible `<details>` on mobile, default-closed, summary "Read full write-up". Inline at `md:+`.

### Markets (`app/src/pages/Markets.tsx`)
- Pills + rows already wrap via flex. Bump pill padding for touch ([section 6](#6-touch-targets)).

### Principles
- Single column already works. Bump body to `text-base`.

### Calculator (`app/src/pages/Calculator.tsx`)
- Grids responsive. Add `inputMode="decimal"` to `<input type="number">` in `Field` for the numeric keypad.

### Guide
- In progress. Use `grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4` for the card grid.

### Admin
- Lowest priority. Ship as-is.

---

## 4. Calendar Mobile

**Recommend: hybrid week-strip + list on mobile; 7-col grid at `md:`+.**

7-col at 320px = ~40px cells, useless beyond a number. Tradeoffs: (a) shrunk cells keep overview but are untappable; (b) vertical week-list is roomy but loses month-at-a-glance; (c) pure list loses calendar feel. Hybrid keeps both.

**Hybrid spec:**
- Top: horizontal week strip — 7 day-cells (DOW letter + date + event-dot), active highlighted, swipe/arrows to change week.
- Below: vertical list of the week's days, each with episode card(s) + call rows; rows route to EpisodeDetail/CallDetail.
- Month picker chip ("May 2026 ▾") opens compact month grid in a modal sheet.
- At `md:+`, render the full 7-col grid (the in-flight rewrite).

Gate with CSS `hidden md:block` / `md:hidden` branches in `Calendar.tsx` — no JS media detection needed.

---

## 5. CallDetail Mobile

`LifecycleChart` (`app/src/components/LifecycleChart.tsx`) already uses `ResponsiveContainer`. Width handles, but at narrow widths:

1. **X-axis tick crowding**: add `interval="preserveStartEnd"` to `<XAxis>`, font to `10px`.
2. **Event marker hit area**: current `r={6}` is invisible to fingers. Bump to `r={8}` on mobile and overlay an invisible `r={20}` hit circle via a custom dot component. Tap opens popover with event quote + jump-to-timestamp link.
3. **Chart height**: `height={180}` on mobile (vs. desktop `240`) so more events list shows above the fold.
4. **Pan-scroll fallback**: only if responsive fit tests poorly, wrap in `overflow-x-auto` with `min-w-[480px]`. Try fit-first.

**Page-level deltas:**
- Lifecycle event card inner row: `flex-col sm:flex-row` so the jump-to-timestamp link gets full-width tap area on mobile.
- Quote blockquote: bump to `text-base`.
- Add a `← All calls` breadcrumb at top on mobile only.

---

## 6. Touch Targets

WCAG AAA: 44×44px. Audit:

| Component | Current | Fix |
|---|---|---|
| Top nav `NavLink` | ~36px tall | N/A — replaced by tab bar on mobile |
| Tier filter pills (Calls, Markets) | `py-1 text-xs` ~28px | `py-2 sm:py-1 text-sm sm:text-xs` |
| Wordmark `<Link>` | `h-7` image | Wrap in `py-2` for 44px+ vertical zone |
| Footer links | `text-xs` only | `inline-block py-2` |
| Calculator number inputs | `py-2` OK | Add `inputMode="decimal"` |

Add one utility in `index.css`:
```css
@media (max-width: 767px) {
  .tap { min-height: 44px; min-width: 44px; }
}
```
Apply `.tap` rather than touching each component.

---

## 7. Typography Scaling

`text-xs` (12px) is heavy throughout. Fine on desktop at arm's length; fails on phones held closer than 30cm.

| Role | Mobile | Tablet+ |
|---|---|---|
| Page h1 | `text-xl` | `md:text-2xl` |
| Section h2 | `text-base` | `md:text-lg` |
| Body | `text-sm` | unchanged |
| Stat card value | `text-2xl` | unchanged |
| Stat card label | `text-xs` | unchanged |
| Meta/faint | `text-xs` | unchanged |
| Quote blockquotes | `text-base` | `md:text-sm` |
| Substack body | `text-base` | `md:text-sm` |
| Tier pill | `text-sm` | `sm:text-xs` |

Long-form prose (Substack body, Principles) gets `leading-relaxed` on mobile — already set in EpisodeDetail; verify Principles matches.

---

## 8. Performance

Current: 800KB JS / 236KB gzipped. 4G p75 budget ~170KB gzipped — we're 38% over.

**Target:** 180KB gzipped initial; lazy-load rest per route.

**Code-split (highest savings first):**

1. **Recharts** — ~120KB gzipped. Only `CallDetail` and (eventually) `Markets` need it. `React.lazy(() => import('./components/LifecycleChart'))` with skeleton `<Suspense fallback>`. ~50% of overage.
2. **Route-level splitting** — `App.tsx` imports all pages eagerly. Convert to `React.lazy()` per route. Calculator/Guide/Admin/Principles rarely first-load.
3. **Substack body**: lazy-render via `<details>` so DOM doesn't pay layout cost.

**Other:** `rollupOptions.output.manualChunks` in `vite.config.ts` to peel recharts + react-router for HTTP/2 parallel-fetch. Episode covers keep `loading="lazy"`, add `decoding="async"`. `<link rel="preload">` the sticky-header logo.

---

## 9. PWA Decision

**Recommend: yes — minimal PWA. Manifest + icons + offline-fallback SW. Skip aggressive caching for now.**

| Pro | Con |
|---|---|
| Home-screen icon = brand persistence (fan tracker = canonical use case) | SW correctness burden; bad caching = stale-data nightmare |
| Removes browser chrome → more vertical on iOS Safari | iOS install flow clunky (Share → Add to Home Screen) |
| Trivial offline-fallback UX | True offline needs IndexedDB mirror — out of scope |
| Free Lighthouse PWA score | API 100% network-bound; no offline-first benefit yet |

**v1 scope:** `manifest.webmanifest` (name, short_name "Predictable", theme `#07091a`, icons 192/512). `vite-plugin-pwa` in `generateSW`: cache-first for hashed JS + logo; network-first 5s-timeout for `/api/*`; offline fallback HTML. No data persistence in v1.

Repo memory: this is a "clone of `anythingimake/spoons/app/` minus PWA bits" — re-adding is ~30 lines in `vite.config.ts` + manifest.

---

## 10. Implementation Order

Vertical slices, highest-impact first. Each phase independently deployable.

**Phase 1 — Foundation (~1 day, highest impact)**: bottom tab bar + drawer in `App.tsx`; `hidden md:flex` desktop nav; header shrink + `pb-20` on `<main>`; `.tap` utility applied to pills, footer, Wordmark; verify ribbon wraps at 320px.

**Phase 2 — Typography + page polish (~half day)**: apply mobile type scale ([section 7](#7-typography-scaling)); Episodes cover shrink; EpisodeDetail header stack + Substack `<details>` wrap; Calls + Markets row tightening, hide source/ticker meta on mobile.

**Phase 3 — Calendar hybrid (~1 day)**: week-strip + list components, gated `md:`; month-picker modal.

**Phase 4 — CallDetail chart (~half day)**: mobile chart height + tick density; touch-friendly markers with popover; lifecycle row `flex-col sm:flex-row`.

**Phase 5 — Performance (~half day)**: route-level `React.lazy()` for all 11 pages; `LifecycleChart` lazy load; Vite manual chunks for recharts + react-router.

**Phase 6 — PWA (~half day)**: `vite-plugin-pwa`, manifest, icons, offline fallback; test install on iOS Safari + Android Chrome.

**Phase 7 — Admin (defer unless requested).**

**Out of scope:** native wrappers, offline-first sync, landscape-specific layouts, gestures.
