# Workouts: design

**Date:** 2026-11-23
**Status:** Design approved 2026-11-23 ("Build straight through it like last time"). Each
production step waits for the user's explicit yes.

## Why

The activity list has no place for 90 minutes of zone 2 cardio, no duration, and no way
to combine lifting and cardio. One step of the list is about 300 kcal for the owner, more
than half of their 550 kcal deficit. The user chose a mix: one-tap choices for people who
want it simple, and logged workouts whose calories the AI works out.

## Rules

- **W1.** A day's total is BMR × (the rest of the day) + the middle of each workout's
  *extra* calories (above resting). A choice of the list that already includes a workout
  never counts on top of logged workouts.
- **W2.** What the user types (what, minutes, calories) is never changed by an AI answer,
  on any device.
- **W3.** Numbers stay until an answer replaces them.
- **W4.** Reusing, changing the minutes, the list, and typed calories need no AI call and
  no connection.

## The list

`Workouts.ACTIVITIES`. The five existing labels are unchanged (they are stored in `days`).
New ones sit between them. `rest` marks what can be the rest of a day with workouts.

| Label | Multiplier | rest |
|---|---|---|
| 🪑 Sat all day (no exercise) | 1.2 | yes |
| 🚶 Light activity (walked / errands) | 1.375 | yes |
| 🚴 Zone 2 cardio, about 45 min | 1.4 | |
| 🏃 Hard cardio (run, intervals), about 45 min | 1.5 | |
| 🏋️ Gym day (moderate workout) | 1.55 | |
| 🚴 Zone 2 cardio, 90 min or more | 1.6 | |
| 💪 Hard gym session (intense) | 1.725 | |
| 🏃 Very active day (sports + gym) | 1.9 | |

The new ones are 1.2 plus (MET − 1) × hours ÷ 22 kcal per kg of BMR, with MET 6 for zone
2 and 9 for hard cardio (2024 Compendium of Physical Activities), rounded up a little
because few people sit literally all day.

**New days** (`ensureDayExists`) copy the last weight, as before, and the last `rest`
choice of an earlier day; never a choice that includes a workout. Without one: "Sat all
day".

## Workouts

### Data

New table `workouts`, one row per workout, so that a workout added on one device cannot
undo a day edited on another:

```
id bigint, user_id uuid default auth.uid(), date date not null,
what text not null,                     -- "Stationary bike, zone 2"
minutes numeric not null default 0,     -- typed; 0 = not given
kcal numeric,                           -- typed by the user; null = the AI's
effort jsonb not null default '{}',     -- the AI's answer and where it is from
estimate_status text,                   -- pending | error | done
created_at timestamptz default now()
primary key (user_id, id); RLS per_user_all; no access for anon
```

`effort`: `{ at, met: { low, high }, minutes, why: [{ ref, note, met, minutes }], how,
from: { id, date }, refresh, of }`, all optional. `met` is how many times resting energy
(gross). `minutes` only if the user gave none.

In the app a workout is `{ id, date, what, minutes, kcal, effort, estimateStatus }`.

### Calories

Extra calories = (MET − 1) × kg × hours, for `met.low` and `met.high`, with the weight of
*that day*. Typed calories are used as they are. Not known (no answer yet): counts as 0
and says so. The AI is not sent the weight.

### Saving (`Workouts.resolve`)

- Calories typed: no AI. Status `done`.
- Same words as before and a known effort: kept; other minutes simply scale.
- Other words, or new: the latest workout with the same words (case and spaces aside) and
  a known effort is reused, with `from` and without an AI call ("from Nov 23"). Typed
  calories are not reused: they differ from session to session.
- Otherwise the AI is asked (`pending`). Renamed: with the numbers of the old words until
  the answer (`of`: whose they are; never reused; taken back by the old words).
- "Ask AI again" asks in any case; the old effort stays until the answer (`refresh`), and
  for good if there is no credit.
- No minutes given: the AI judges them from the description ("10,000 steps"). Typed
  minutes win over them. Minutes removed and none from the AI: asked again.

### The day form

Edit Day gains "Workouts" under the activity: the day's workouts with calories, Edit and
✕, and "+ Add workout" (what, minutes, calories if a watch or machine shows them, "Ask AI
again", "How was this worked out?"). Earlier workouts are suggested; picking one fills in
its minutes. Nothing is stored until Save; Cancel drops all of it. Save also takes what
is typed in an open workout, and asks if a workout being edited was deleted elsewhere. One
that was only looked at is left as it is; if its estimate had failed, it is tried again
(only if that is still so).

With workouts, the list is called "Rest of the day" and offers only `rest` choices. If
the day had another one, it changes to the last `rest` choice before that day and says:
"'Gym day' already includes a workout, so this is now the rest of your day." Taking the
workouts away again brings the choice back until Save.

"+ Add workout" is also on the Calorie Tracker tab (today; the day is created on Save) and
on each day.

If a day with workouts nevertheless has another choice (two devices, an older build), it
counts and shows as "Sat all day".

Deleting a day deletes its workouts; the question says how many. A workout whose day is gone
all the same (deleted on a device that did not know of it) brings the day back at the next
start.

### Shown

- Calorie Tracker, day cards: "Sat all day", and a line per workout: "Stationary bike,
  zone 2 · 90 min · 612–735 kcal" ("yours", "from Nov 23", "estimating…", or "not
  estimated" to tap for another try). TDEE, target and what follows include them.
- Assessments: the day's activity reads "Sat all day + Stationary bike, zone 2, 90 min
  (674 kcal)", and its TDEE includes it. No proxy change for that.
- Explanation: what it is based on, both efforts and how they were combined, the sum
  ("6–6.8 times resting, for 90 min at 81.6 kg, less what you burn anyway"), that the AI
  does not look values up.

## Sync

Workouts use the food path: outbox, conditional AI answers, `takeOver`, tabs. That code
(`takeOver`, `follow`, `agrees`, `applyEstimate`, `saveEstimates`, the estimate queue) is
made to work for a *spec* (table, mappers, list, what to show) instead of for food only.
An answer is applied only while the row is as it was when asked (`what`, `minutes`,
status: none of them is ever null then, so all can be matched in a URL; `effort` would
make it long, and an answer is as good for the same words and minutes). One queue for food and workouts: one AI call at a time, and "no
credit" stops both.

Cache key `workouts` per user; wiped at sign-out.

## Server (`ai-proxy`)

New feature `workout`, payload `{ what, minutes? }`, at most 2,000 characters. Model pair
of `estimate` (no config change). Prompt: JSON with `reasoning`, `reference` (at most 15
words), `minutes`, `met_lower`, `met_upper`; gross MET averaged over the whole time, rests
included; the given duration is a fact.

Response: `{ met: { low, high }, minutes, basis: [{ ref, note, met, minutes }], how,
ai_thought_process }`. A model's answer counts if 1 ≤ MET ≤ 25 and 0 < minutes ≤ 1,440.
The two are averaged; if their middles differ by more than `widen_threshold`, the range
covers both. Same metering, limits, refusals and error codes as an estimate.

## Order of release

Table, then proxy (both additive: the live app does not notice), then the app. Older
builds do not know the new labels (they count them as 1.2) and ignore workouts, so every
device should be updated before they are used.

## Testing

Pure module (`www/workouts.js`), app tests in the harness (with a `workouts` table that
enforces NOT NULL), the food tests unchanged, proxy shapes and prompt, mutation checks,
random sessions with several devices and tabs, headless Chrome with real supabase-js,
layout at 320–1280 px and 125/150%, both themes.

## Not now

Time of day, sets and reps, importing from watches, steps, a workout history page, a
female BMR (noticed: `calcBMR` is the male formula for everyone).
