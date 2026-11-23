# Nutrition Details: Your Own Numbers, Remembered Foods, Explanations — Design Spec

**Date:** 2026-11-23
**Status:** Design approved 2026-11-23. The user waived review of this document and asked
for the plan and the implementation. Amended while planning (listed at the end).
**Applies to:** web and Android (same `www/`), plus the `ai-proxy` Edge Function
**Builds on:** row-level food sync (`www/sync.js`, commit `eedefe2`)
**Followed by:** label photo (its own spec), which will fill in the same structures
**Reverses:** "macros are AI-only" (2026-06-05) and "hide AI reasoning" (2026-06-04).
Both come back behind a tap, so adding food stays as quick as it is now.

## Problem

From the owner's own log, November 2026:

- The AI's numbers cannot be corrected. The workaround is to type the label into the
  food name ("Sardines at 11g protein/56 grams") or the unit ("Yakult, 50 calories").
- Every log asks the AI again and gets a different answer:

  | Logged | First day | Next day |
  |---|---|---|
  | Sardines, 4 pcs | 166–191 kcal | 95–110 kcal |
  | "Sardines at 11g protein/56 grams", 79 g then 80 g | 165–175 kcal | 143–150 kcal |

- 69 of 176 entries (39%) repeat an earlier name and unit, each a new AI call.
- Changing an entry's quantity throws its numbers away and asks the AI again.
- The AI answers with eight nutrients; the app keeps only those switched on.
- The AI says what it based its answer on; the app throws that away.

## Decisions

1. **Corrections and AI estimates are both remembered** (option C), with a visible
   "from Nov 20" tag and an "Ask AI again" button.
2. **Remembered foods are found by searching past entries.** No new table or screen.
   The alternative, a "My foods" list to browse and edit, is more to build.
3. **A number the user types is theirs.** The AI never replaces it.
4. **Changing the amount scales the numbers** whenever the units allow it. No AI call.
5. **Explanations show what the AI declared**: the assumed weight, the reference food
   and one sentence, for each of the two estimates. Never step-by-step reasoning
   (that wording was dropped in `eaed210`, together with adding refusal handling) and
   never model names.
6. **All eight nutrients are saved.** Fiber is on by default.

## Rules

- **R1.** `entry.macros` is always the total for what was eaten. Amounts on a label are
  converted before they are stored.
- **R2.** An AI answer never changes a number marked `mine`, on any device.
- **R3.** Existing numbers stay visible until an answer replaces them. A failed or
  refused call leaves them as they are.
- **R4.** Reuse and scaling never need the network.

## Data model

**Per nutrient**, in the existing `macros` jsonb: `{ low, high, mine?: true }`.
`mine` means the user typed it, and then `low === high`. Every reader goes through
`Macros.getMacro`, which ignores the extra key.

**Per entry**, `entry.nutrition` ↔ new nullable column `food_entries.nutrition jsonb`.
Every field is optional; entries from before this feature have none.

```js
{
  at: 1795417693000,        // ms: when these numbers were decided (typed, or answered)
  from: { id, date },       // reused: the entry where they were decided
  basis: { qty, unit },     // the last typed numbers were for this amount, e.g. 56 g;
                            // absent if they were for the entry's own amount
  grams: 48,                // weight of what was eaten, assumed or corrected
  gramsMine: true,          // corrected by the user
  asked: { qty, unit },     // the amount the AI was asked about
  why: [{ ref, note, grams, kcal }],  // one per AI estimate, at most two
  how: "average",           // or "both" (they disagreed) or "one"
  photo: true,              // from a photo: never reused
  refresh: true,            // "Ask AI again" is waiting for its answer
}
```

`grams` is the mean of the weights in `why`, to a whole gram, or to one decimal below
10 g. `ref` is cut to 120 characters and `note` to 200. `foodRowToJs` and
`foodJsToRow` carry the object, so it takes part in the sync signature.

A build without this feature leaves the column alone (PostgREST only writes the columns
it is sent) and keeps `mine` when it passes `macros` through. But if someone changes an
amount there, it asks the AI and drops the numbers, as it does today. All devices
should be updated.

## Units

Two units are the **same** after lower-casing, trimming, dropping a final full stop
and applying this table; any other word longer than three letters also loses a plural
"s" (not "ss").

| Kind | Unit | Also written |
|---|---|---|
| Weight | g | gram, grams, gr, gms |
| | kg | kilo, kilos, kilogram(s) |
| | oz | ounce(s) |
| | lb | lbs, pound(s) |
| Volume | ml | milliliter(s), millilitre(s), cc |
| | l | liter(s), litre(s) |
| | tsp | tsps, teaspoon(s) |
| | tbsp | tbsps, tablespoon(s) |
| | cup | cups |
| | fl oz | floz, fluid ounce(s) |
| Count | pc | pcs, piece, pieces |

An amount can be **converted** when the units are the same, are both weights, are both
volumes, or when one is a weight and the weight of the other amount (`grams`) is
known. Otherwise it cannot, and nothing is guessed.

## Remembering

**Name match:** equal after trimming, lower-casing and collapsing spaces.

**A past entry can be reused when all of these hold:**

- its name matches, its quantity is above zero, and its amount converts to the new one
- its status is `done` or `manual`
- it is not from a photo (a photo describes one plate)
- it has all eight nutrients, **or** at least one number typed by the user

The third line means an entry saved before this feature is not reused: each food costs
one more AI call, and is complete and explained from then on.

**Which one:** the most recently decided. That is `nutrition.at`, or the entry's own
date and time if it has none; on a tie, the larger id.

**The new entry gets:**

- every number, `grams` included, times the ratio of the amounts, with `mine` kept
- the source's `nutrition`, except `refresh`; `from` is the source's own `from` if it
  has one (so a copy of a copy names the original), else the source; `at` is copied
- status `manual` if every tracked nutrient is `mine`, `done` if every tracked nutrient
  has a number, else `pending`, so that the AI fills the blanks

**Batch Add** does the same for every row. **Photo items** arrive with numbers and are
not looked up; they are marked `photo`.

**Autofill:** when adding, choosing a past food name fills in the quantity and unit of
the latest log of it (by date, time, then id). Today it uses the oldest after a reload,
and also changes the amount of an entry that is only being renamed.

## Adding

The Single form gains one link, **Enter numbers yourself**, which opens the Nutrition
section described below. Left closed, adding works as it does now.

The fields always show what would be saved: choosing a food and amount that are
remembered shows the scaled numbers and the tag, while adding and while editing.

On save: start from the remembered numbers, if any, and put the typed ones on top as
`mine`. If anything was typed, `at` is now and `from` is dropped. Every tracked
nutrient typed → `manual`, and no AI call. Otherwise the status follows the rule above.

## Editing

The Nutrition section is open. On save, in this order:

1. **Amount changed and it converts:** scale every number and `grams`.
2. **Name changed, or the amount changed and does not convert:** numbers marked `mine`
   stay as they are, as totals. The others come from a remembered entry if there is
   one, else the AI is asked (`refresh`), the old ones staying until it answers.
   Before saving, the form says so: "AI will estimate the other numbers again."
   The weight is forgotten: it was of what the entry was before.
3. **Weight corrected:** numbers not marked `mine` are multiplied by new ÷ old weight;
   `grams` is the new one, `gramsMine` is set.
4. **A number typed:** it becomes `mine`. **A number cleared:** it is no longer `mine`
   and is blank; if it is tracked, the AI fills it.
5. Only the date or time changed: nothing else happens.

Steps 3 and 4 set `at` to now and drop `from`: this entry is now the one to remember.

**An entry that has no numbers yet** behaves as it does today: any change to food,
quantity or unit leaves it `pending` and asks again. The check that throws away an
answer for something else becomes the one under "The estimate queue".

## Ask AI again

A button in the Nutrition header, shown when the entry has a number that is not `mine`,
or failed. It saves the form, sets `refresh` and `pending`, and closes. The card keeps
its numbers with the "…" badge.

- **Answer:** every number not `mine` is replaced, `from`, `photo` and `refresh` are
  dropped, `at` is now, status `done`.
- **No answer:** status `error`, numbers kept, `refresh` kept. The "!" badge retries.
- **Out of credit:** the paywall opens and nothing changes.
- It skips remembered foods.

## The estimate queue

- **Asked only if** `refresh` is set or a tracked nutrient is blank. Otherwise the
  entry becomes `manual` (every tracked nutrient `mine`) or `done`, without a call.
  Today an entry that is pending and has its numbers becomes `manual` with no call, so
  Ask AI again would do nothing.
- **Written on an answer:** with `refresh`, all eight except those `mine`; otherwise
  the blank ones of all eight. Never a `mine`.
- **Sent along as `known`:** the numbers that will not be replaced, as totals.
- **Status `done`** when every tracked nutrient has a number, else `error`.
- **Applied only if** the entry is still `pending` with the same food, quantity, unit
  **and macros** as when it was asked. The last is new: someone may have typed a number
  meanwhile, here or on another device. It is checked locally and in the conditional
  update sent to the server (`macros=eq.<json>`, value equality on jsonb), which also
  carries `nutrition`. `Sync.matches` compares objects by value for this.

## Explanation

A closed section, **How was this worked out?**, in the Nutrition section. Lines appear
only when they apply:

| Line | Shown when |
|---|---|
| Assumed weight 48 g (12 g each) · **Change** | the unit is not a weight and `grams` is known. "each" only if the quantity is not 1. After a correction: "Your weight 90 g". |
| Assumed weight 40–56 g, using 48 g · **Change** | the two estimates' weights differ by more than 20% of the larger. The mean is used, and is what Change rescales from. |
| Based on canned sardines in oil, drained | `why` has references; duplicates once |
| Two estimates, 95 and 110 kcal, averaged | `how` is `average` |
| Two estimates, 60 and 200 kcal, disagreed, so the range covers both | `how` is `both` |
| One estimate, 95 kcal | `how` is `one` |
| For 4 pcs, scaled to 6 pcs | `asked` differs from the entry's amount. Only "For 4 pcs" while a new answer is due for an amount it does not convert to. |
| each estimate's `note` | present |
| The AI works from what it knows about food. It does not look values up. | `why` is present |
| Protein 11 g per 56 g is your number | per `mine` number: the total scaled to `basis` if it is set and converts, else "Protein 22 g is your number" |
| Numbers from Nov 20 | `from` is set |
| Estimated from your photo | `photo` |
| No explanation was saved for this entry. Ask AI again to get one. | nothing above applies, and it has a number the user did not type |

All of it is text from the AI or the user, so it is escaped.

## Server (`ai-proxy`, estimate only)

- **Prompt:** the JSON gains `"reference"` (the food it is based on and where its
  values come from) and `"total_grams"` (weight of the whole quantity, or null). The
  existing one-sentence `"reasoning"` becomes the note. With `known`, the user message
  adds: "These totals for this quantity are already known. Treat them as facts and make
  the other values consistent with them: protein 15.7 g."
- **Request:** optional `known: { <macro id>: number }`. Unknown ids, and values that
  are not finite or are negative, are ignored.
- **Response:** gains `basis: [{ ref, note, grams, kcal }]`, one per model that
  answered, and `how`. `kcal` is the middle of that model's range, `grams` a positive
  number or null. `how` is `one` when one model answered, `both` when `mergeEstimates`
  widened calories or protein, else `average`. Nothing is removed.
- **Budget:** the estimate token budget goes from 500 to 650, so that the 4.x models
  are not cut off by the longer answer.
- Merging, quotas, metering, the photo and the assessment prompts do not change.
- Request and response only grow, so client and proxy can be deployed in either order.
  Without the new proxy the weight and explanation lines simply do not appear.

## Assessments

The payload carries whole entries and is capped at 250,000 characters: about 926 of
the owner's entries today (270 characters each). This feature would roughly halve
that, so the payload is cut to what the prompt reads:

- per entry: `time`, `food`, `qty`, `unit`, and calories and protein (`low`/`high`)
- per period: `startDate`, `endDate`, `numDays`, `totalEntries`, `dates`, `dailyContext`,
  `avgCalLow/High`, `avgProLow/High`, `avgProTargetLow/High`, `isYoY`
- year over year: `previousYear` with only `label`, `numDays`, `totalEntries`, its four
  averages and `dailyContext`. Today the current year's entries go twice and the
  previous year's once, and the proxy reads only the first list.

Round 1, Round 2 and both size checks use the cut payload. About 1,442 entries fit.

## Screens

**Nutrition section** (Edit, and Add after the link):

```
Nutrition · from Nov 20                    [Ask AI again]
  Calories (kcal) [ 103 ]   Protein (g) [ 22 ] yours
  Carbs (g)       [   0 ]
  ▸ More nutrients
  These numbers are for [ 4 ] [ pcs ▾ ]
▸ How was this worked out?
[Cancel]                                   [Save entry]
```

- One field per tracked nutrient; the others under **More nutrients**. An AI range is
  shown as its middle and is kept as a range unless the field is changed.
- **These numbers are for:** follows the entry's own amount until the user changes it.
  - A number typed in this form stays as typed: it is for the amount shown, whatever
    that becomes. So a label can be typed as printed, before or after setting its amount.
  - Saved numbers on screen are converted to the amount shown, and follow the quantity
    and unit above.
  - Once changed (say to 56 g), it stays put. Saving converts the typed numbers back to
    what was eaten (R1).
  - Choosing another unit keeps the amount: 4 pcs becomes 48 g.
  - Its unit list offers only what converts to the entry's amount. If the entry's amount
    is then changed to one it does not convert to, saving is refused beside the field; it
    is never read as something else.
- **Invalid number** (not a number, below 0, above 99,999): message beside the field,
  nothing saved, everything typed stays.
- **Waiting:** "Estimating… You can type your own numbers meanwhile."
  **Failed:** "The estimate didn't come back. Ask again or type your own numbers."
  **Saving will ask:** "AI will estimate the numbers you leave blank."
- Save and Cancel stay reachable while the section scrolls.
- Sizes follow the content: fields flow into as many columns as fit, with no fixed
  heights; on phones inputs are at least 44 px high with 16 px text.

**Cards and table:** the tag joins the card's second line ("10:41 AM · 4 pcs · from Nov
20") and goes under the food name in the table. The year is added when it is not the
current one. "yours" is shown in Edit only.

## Defaults

Fiber becomes `defaultOn`. That reaches every account that never chose its nutrients,
existing ones included, which is intended; entries without fiber show "—". The owner
has a saved choice and is not affected.

## Errors and edge cases

| Case | Behaviour |
|---|---|
| Offline | Reuse, scaling and typed numbers work and sync later. A needed estimate ends in "!" as today. |
| Out of credit, some numbers typed | The entry is saved with them; the paywall opens only if a tracked nutrient is still blank. |
| Two devices change the same entry | Last write wins, as for any entry. An AI answer never wins over a person (R2). |
| A remembered number is wrong | Fix it once. That entry is now the latest decided and is used from then on. |
| The source entry is deleted | Entries that reused it keep their numbers and tag. The next log uses the next latest. |
| Quantity 0 or blank | Not a reuse source; the form requires a quantity, as today. |
| The AI omits `total_grams` or `reference` | Those lines do not appear. Nothing else changes. |
| Change on a weight of 0 or not a number | Message beside the field, nothing saved. |

## Structure

- `www/nutrition.js` — new pure module (`window.Nutrition`): units, name match, choosing
  a remembered entry, scaling, what an edit should do, applying typed numbers and
  weight, the explanation's lines, the tag. No DOM, no network.
- `www/app.js` — forms, queue, mapping, slim assessment payload.
- `www/mobile-render.js`, `www/index.html`, `www/styles.css` — section, tag.
- `www/sync.js` — `matches` by value. `www/macros.js` — fiber default.
- `supabase/functions/_shared/proxy-shapes.mjs` — `extractBasis`; `metering.mjs` says
  whether it widened; `ai-proxy/index.ts` — prompt, `known`, response.
- `docs/sql/` — `alter table food_entries add column if not exists nutrition jsonb;`

## Rollout

Each production step waits for the user's explicit yes.

1. **Migration `food_nutrition_01`** (one nullable column).
2. **Client, stage 1:** own numbers, scaling, remembering, tags, autofill, all eight
   nutrients, fiber, slim assessments. Works with today's proxy.
3. **Proxy v12, then client stage 2:** explanations, weight, `known`.
   Smoke test on both providers: a plain estimate, one with `known`, and no refusals.

## Testing

- **Unit:** every rule above in `www/nutrition.js`; `extractBasis`, `known` and `how` in
  the proxy modules; `Sync.matches`; the fiber default.
- **App** (real `www/app.js`, `tests/helpers/app-harness.js`, whose schema gains the
  column): add, edit, batch, photo, Ask AI again; failure keeps numbers; an answer
  after a number was typed here or on another device changes nothing (R2); amount edits
  make no AI call; reuse offline; old entries are asked once; a copy of a copy names
  the original; the assessment payload contains only listed fields.
- **Mutation checks** on R1–R4, as for the sync work.
- **First, against the real server, read-only:** that `macros=eq.<json>` matches exactly
  the one row for a sample of real entries. The conditional update depends on it.
- **Browser:** the real Supabase client against the stand-in, which learns the column
  and the `macros` filter; the section at 360, 390, 720 and 1280 px and at 125% and
  150% scaling, with nothing clipped and the buttons reachable.
- **Emulator:** the owner's session, no-op writes only, rows fingerprinted before and
  after.

## Out of scope

Label photo (next spec) and barcodes; a "My foods" screen; looking values up in a food
database; targets for fiber and other nutrients; changing past entries; vitamins and
minerals; the finance app.

## Amendments

2026-11-23, while planning; each is worked into the text above.

- Typed numbers are never converted when "These numbers are for" changes. Converting them
  would have spoiled a label typed first and its amount set after.
- An amount that stops converting is refused at saving rather than dropped, and the form
  shows what would be saved while editing too.
- A new food or an amount that does not convert forgets the old weight, and a photo entry
  that is asked about again stops being the photo's.
- Autofill only fills in an amount when adding.
- The blank-fields message, and when three of the explanation's lines appear.
