# Incomplete-log day tag — design

**Date:** 2026-11-17 · **Branch:** `feat/incomplete-days` (off `feat/metering`; merges after it)

## Goal

Let the user tag a day as "incomplete log" (not everything eaten was recorded) so the
day is visibly marked and does not drag down averages or skew AI diet assessments.

## Behavior

### Tagging
- The Edit Day modal (`#day-modal`, used by both desktop and mobile) gains a checkbox:
  **"Incomplete log — I didn't record everything this day"**.
- `saveDay()` persists the checkbox state as `incomplete: true|false` on the day entry;
  `openDayModal()` populates it.
- Days auto-created by `ensureDayExists()` (and the onboarding first-day insert) start
  `incomplete: false`.
- No inline quick-toggle (YAGNI — tagging is occasional).

### Display
- **Desktop tracker table** (`renderCalorieTracker`): date cell shows a muted
  "Incomplete" pill; the row gets a `day-incomplete` class (slight dim).
- **Mobile day card** (`renderDayCards`): same pill in the card header next to the
  date, visible while collapsed.
- **Assessment results**: when any days in the range were excluded, a meta pill next
  to "N days" reads "K incomplete day(s) excluded".
- Tagged days remain listed in the tracker with their real totals; their food entries
  are never modified or hidden from the Food Log.

### Exclusion from stats
- All averages and AI assessments flow through `buildRangeData()` (including both
  halves of year-over-year). It drops every food entry whose date is a tagged day
  before computing `foodByDate`, `dates`, `numDays`, totals, averages, and
  `dailyContext` (tagged days are also removed from `filteredDays`).
- `buildRangeData()` returns `excludedIncompleteDays` (count of tagged day rows within
  the range) for the meta pill.
- If every day in the range is tagged, the result has zero entries and the existing
  empty-range handling applies (no new code path).
- The ai-proxy builds the prompt server-side from this already-filtered data, so
  **no Edge Function change** is needed.

## Data & sync

- Migration `incomplete_days_01`:
  `alter table public.days add column incomplete boolean not null default false;`
  Existing `per_user_all` RLS covers it; no policy change.
- Client mapping:
  - `dayRowToJs`: `incomplete: r.incomplete === true`
  - `dayJsToRow`: includes `incomplete: !!e.incomplete`
  - `Targets.migrateDay`: carries `incomplete: day.incomplete === true` — it currently
    whitelists fields, so without this the flag is silently stripped on every load.
- Older clients that omit the field don't clobber it: PostgREST upsert only updates
  columns present in the payload. A brand-new row from an old client gets the default
  `false`.
- localStorage offline cache stores the field as part of the day JSON; no key change.

## Testable unit

New pure helper in `www/targets.js` (UMD, already loaded by app and tests):

```js
Targets.excludeIncompleteDays(foodEntries, dayEntries)
  // -> { food, days, excludedDates }  (excludedDates: sorted array of tagged dates)
```

`buildRangeData()` calls it on its date-filtered inputs; `excludedIncompleteDays` =
`excludedDates.length`.

## Testing

- `tests/`: `migrateDay` keeps `incomplete: true`, defaults missing/garbage to `false`.
- `excludeIncompleteDays`: drops food for tagged dates only; untagged days untouched;
  all-tagged input → empty food/days; no tagged days → identity and `excludedDates: []`.
- Live: apply migration (Supabase MCP), verify column; emulator — tag a day via Edit
  modal, confirm pill on card, relaunch to confirm persistence, run a short assessment
  and confirm the excluded pill + lower day count; verify server row has
  `incomplete = true`.

## Out of scope

- Inline toggle on rows/cards; telling the AI about partial days; per-meal
  completeness; auto-detecting incomplete days.
