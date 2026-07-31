// ai-proxy — every AI feature behind one metered Edge Function (Spec B).
// Prompts are ported VERBATIM from the pre-B client (www/app.js, www/photo.js,
// www/macros.js) — do not rewrite the prompt text; it's the tested product voice.
import { createClient } from "npm:@supabase/supabase-js@2";
import { computeCost, quotaState, mergeEstimates, rateLimited } from "../_shared/metering.mjs";
import { MACRO_IDS, extractEstimateFields, toNestedMacros, mergePhotoItems } from "../_shared/proxy-shapes.mjs";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY")!;
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const admin = createClient(SUPABASE_URL, SERVICE_KEY);

// Browser + Capacitor WebView clients preflight (Authorization header) — the
// function must answer CORS itself; the gateway does not.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

// ============================================================
// Macro catalog: MACRO_IDS comes from _shared/proxy-shapes.mjs (www/macros.js
// CATALOG order). The client no longer sends its enabled-macro list; the
// server always asks for the full catalog and the client keeps what it shows.
// ============================================================

// Ported verbatim from www/macros.js promptFields()
function promptFields(ids: string[]) {
  return (ids || []).map((id) => '  "' + id + '_lower": <number>,\n  "' + id + '_upper": <number>').join(",\n");
}

// ============================================================
// Prompt builders — ported verbatim from the client.
// Each returns { system, userOpenAI, userAnthropic, tokens }.
// tokens = the per-feature budget the old adapters used
// (estimate 500, photo/vision 1500, assessment 8000).
// ============================================================

// Ported verbatim from www/app.js buildSystemPromptEstimate()
function buildSystemPromptEstimate(ids: string[]) {
  return `You are a precise nutrition database assistant. You base estimates on USDA FoodData Central, nutrition labels, and established food composition databases. Be consistent and deterministic.

Respond with ONLY a JSON object (no markdown fences) in this exact format:
{
  "reasoning": "<step-by-step reasoning; not shown to the user>",
${promptFields(ids)}
}
Units: calories in kcal, sodium in mg, all other macros in grams.`;
}

// Ported verbatim from www/app.js buildEstimatePrompt()
function buildEstimatePromptText(food: string, qty: unknown, unit: string) {
  return `Estimate the nutritional content of this food:

Food: ${food}
Quantity: ${qty} ${unit}

Instructions:
1. Identify the exact food item and its standard preparation method
2. Reference USDA FoodData Central or manufacturer nutrition data where possible
3. Calculate per-unit nutritional values, then scale to the given quantity
4. For well-known items with nutrition labels, use tight ranges (lower ≈ upper)
5. For variable items (restaurant food, home-cooked), widen ranges but stay evidence-based
6. Show your reasoning step by step in the "reasoning" field`;
}

function buildEstimatePrompt(payload: any) {
  const user = buildEstimatePromptText(payload.food, payload.qty, payload.unit);
  return {
    system: buildSystemPromptEstimate(MACRO_IDS),
    userOpenAI: user,
    userAnthropic: user,
    tokens: 500,
    timeoutMs: 30_000,
  };
}

// Ported verbatim from www/photo.js buildVisionSystemPrompt()
function buildVisionSystemPrompt(macroIds: string[]) {
  return `You are a precise nutrition assistant analyzing a photo of food. Identify each distinct food item visible. Estimate each item's portion from visual cues (plate size, utensils, packaging) and its nutrition. Be consistent and evidence-based.

Respond with ONLY a JSON object (no markdown fences) in this exact format:
{
  "reasoning": "<brief reasoning; not shown to the user>",
  "items": [
    {
      "food": "<short food name>",
      "portion": "<human-readable portion, e.g. '1 sandwich' or '~150 g'>",
${promptFields(macroIds)}
    }
  ]
}
Units: calories in kcal, sodium in mg, all other macros in grams. Give one object per distinct food.`;
}

// Ported verbatim from www/photo.js buildVisionUserText() — payload.hint is the
// client's `history` object ({ priorItems, correction }).
function buildVisionUserText(history: any) {
  let t = "Identify each distinct food in this photo. For each, return a short name, an estimated portion, and the nutrition estimates. Return ONLY the JSON object.";
  if (history && Array.isArray(history.priorItems) && history.priorItems.length) {
    t += "\n\nYour previous reading was:\n" + JSON.stringify(history.priorItems.map((i: any) => ({ food: i.food, portion: i.portion })));
  }
  if (history && history.correction) {
    t += "\n\nThe user provided this correction — re-estimate the whole photo accordingly:\n" + String(history.correction);
  }
  return t;
}

function buildPhotoPrompt(payload: any) {
  const userText = buildVisionUserText(payload.hint);
  const dataUrl = String(payload.imageDataUrl || "");
  // Anthropic needs the data URL split into media_type + base64 payload.
  const comma = dataUrl.indexOf(",");
  const header = comma >= 0 ? dataUrl.slice(0, comma) : "";
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const mediaType = (header.match(/^data:([^;]+)/) || [])[1] || "image/jpeg";
  return {
    system: buildVisionSystemPrompt(MACRO_IDS),
    userOpenAI: [
      { type: "text", text: userText },
      { type: "image_url", image_url: { url: dataUrl } },
    ],
    userAnthropic: [
      { type: "text", text: userText },
      { type: "image", source: { type: "base64", media_type: mediaType, data: b64 } },
    ],
    tokens: 1500,
    timeoutMs: 30_000,
  };
}

// Ported verbatim from www/app.js SYSTEM_PROMPT_DIET_ASSESSMENT
const SYSTEM_PROMPT_DIET_ASSESSMENT = `You are a registered dietitian analyzing a food diary. Evaluate the diet based on the food log provided. Be specific and evidence-based.

CRITICAL for calorie_assessment: The user may be on a calorie deficit plan. You will be given per-day data: each day's activity level, TDEE (total daily energy expenditure = maintenance calories), planned deficit, calorie intake target (= TDEE minus deficit), and actual calories eaten. TDEE varies daily based on activity (gym day vs sedentary day). Use these definitions:
- "surplus" = eating ABOVE TDEE (would gain weight). Only use this if intake consistently exceeds TDEE.
- "on_target" = eating near the calorie intake target (within ~10% of target), still well below TDEE
- "deficit" = eating significantly below the calorie intake target (undereating beyond the planned deficit)
Being slightly above the intake target but still well below TDEE is NOT a surplus — it just means the deficit is smaller than planned. Compare intake to EACH DAY'S TDEE individually, not to an average.

Food group status definitions:
- "missing" = literally zero foods from this group in the entire period
- "critically_low" = trace amounts present but far below recommended (e.g. a splash of milk in coffee for dairy, a small garnish of vegetables)
- "low" = some intake but still below recommended servings
- "adequate" = meeting or near recommended servings
- "good" = meeting or exceeding recommended servings consistently

IMPORTANT: Keep your response concise to stay within token limits. The reasoning field should be brief (3-5 sentences max). Keep summaries to 1-2 sentences. Limit concerns, suggestions, and positive_observations to 3-4 items each.

You MUST respond with ONLY a JSON object (no markdown fences, no extra text) in this exact format:
{
  "reasoning": "<brief analysis: key findings on food groups, macros, and calorie intake vs TDEE and target>",
  "overall_score": <1-10 integer>,
  "calorie_assessment": {
    "score": <1-10>,
    "status": "<deficit|on_target|surplus>",
    "summary": "<brief explanation referencing both TDEE and intake target>"
  },
  "protein_assessment": {
    "score": <1-10>,
    "status": "<deficient|adequate|good|excellent>",
    "summary": "<brief explanation>"
  },
  "food_groups": {
    "fruits": { "score": <1-10>, "servings_estimated": <number>, "recommended": <number>, "status": "<missing|critically_low|low|adequate|good>" },
    "vegetables": { "score": <1-10>, "servings_estimated": <number>, "recommended": <number>, "status": "<missing|critically_low|low|adequate|good>" },
    "whole_grains": { "score": <1-10>, "servings_estimated": <number>, "recommended": <number>, "status": "<missing|critically_low|low|adequate|good>" },
    "lean_protein": { "score": <1-10>, "servings_estimated": <number>, "recommended": <number>, "status": "<missing|critically_low|low|adequate|good>" },
    "dairy_calcium": { "score": <1-10>, "servings_estimated": <number>, "recommended": <number>, "status": "<missing|critically_low|low|adequate|good>" },
    "healthy_fats": { "score": <1-10>, "servings_estimated": <number>, "recommended": <number>, "status": "<missing|critically_low|low|adequate|good>" }
  },
  "fiber_assessment": {
    "estimated_daily_g": <number>,
    "recommended_daily_g": <number>,
    "status": "<deficient|low|adequate|good>"
  },
  "concerns": ["<specific concern 1>", "<specific concern 2>"],
  "suggestions": [
    { "food": "<specific food>", "reason": "<why>", "when": "<meal timing suggestion>" }
  ],
  "positive_observations": ["<what is going well 1>", "<what is going well 2>"],
  "action_plan": {
    "daily_targets": [
      { "group": "<food group name>", "current": <current daily servings number>, "target": <recommended daily servings number>, "add": "<what to add>" }
    ],
    "grocery_add": [
      {
        "category": "<category name, e.g. Leafy Greens>",
        "weekly_target": "<total weekly target, e.g. 14 cups cooked (2-3 bundles)>",
        "pick": "<how many to pick, e.g. Pick 2-3 varieties>",
        "options": [
          { "item": "<specific food>", "portion": "<serving size + weekly qty>", "note": "<brief benefit or tip>" }
        ]
      }
    ],
    "grocery_keep": [
      {
        "category": "<category name, e.g. Protein>",
        "options": [
          { "item": "<food (optimal version)>", "portion": "<weekly quantity>", "note": "<upgrade tip if any>" }
        ]
      }
    ],
    "stop_and_replace": [
      { "stop": "<food to reduce or stop>", "why": "<health reason>", "replace_with": "<better alternative>" }
    ],
    "sourcing_guide": [
      { "food": "<food item>", "risk": "<contamination or quality risk>", "what_to_look_for": "<PH buying tips>" }
    ],
    "meal_ideas": ["<simple meal or snack idea>"]
  }
}

IMPORTANT for action_plan:
- daily_targets: Include ALL food groups that can be improved — missing, critically_low, low, AND adequate groups that could reach optimal. Only skip groups already at "good" with no room to improve. "current" is estimated daily average servings from the food log. "target" is the optimal recommended daily servings.
- grocery_add: Foods to ADD, organized by CATEGORY. Each category should have a weekly_target (total amount needed), a "pick" hint (e.g. "Pick 2-3 varieties to mix and match"), and 3-6 specific options the user can choose from. Categories should cover: Leafy Greens, Cruciferous Vegetables, Other Vegetables, Fruits, Whole Grains/Legumes, Dairy/Calcium, Healthy Fats, Nuts/Seeds, Brain Foods, etc. — only include categories relevant to the user's gaps. Each option needs a specific portion size and weekly quantity. Give EXHAUSTIVE options so the user has variety. Aim for 5-8 categories.
- grocery_keep: Foods to KEEP BUYING, organized by category. Each option should suggest the most health-optimal version with upgrade tips. 2-4 categories.
- stop_and_replace: Foods the user is currently eating that should be REDUCED or REPLACED. Look for: processed foods, seed/vegetable oils, excess refined carbs, sugary drinks, processed meats (hotdog, spam, tocino, longganisa), instant noodles, white bread, margarine. Be specific about WHY it's harmful and WHAT to replace it with. 2-5 items. Only include items actually found in the food log.
- sourcing_guide: For EACH recommended food in the grocery lists, note contamination risks and Philippines-specific buying guidance. 5-8 items covering the most important foods.
- meal_ideas: 3-5 simple, practical ideas that address both gaps and areas that can be optimized.

EVIDENCE-BASED OPTIMAL FOOD REFERENCE — Use this to make grocery recommendations precise and top-tier:

BRAIN HEALTH & COGNITIVE FUNCTION (prioritize these):
- Wild-caught salmon or sardines: richest source of DHA/EPA omega-3 (2-3 servings/week). DHA is 40% of brain polyunsaturated fat. Sardines also provide vitamin D + calcium.
- Blueberries: highest antioxidant fruit, anthocyanins cross blood-brain barrier, improve memory consolidation (BDNF). 1 cup/day ideal.
- Walnuts: only nut with significant ALA omega-3 + polyphenols. 1 oz (7 halves)/day linked to slower cognitive decline.
- Dark leafy greens (spinach, kale, Swiss chard): folate + lutein + vitamin K1. 2+ cups/day. Lutein accumulates in brain tissue and is linked to neural efficiency.
- Eggs (whole, pasture-raised): choline (1 egg = 147mg, need 550mg/day). Choline is precursor to acetylcholine (memory neurotransmitter). Also lutein + zeaxanthin.
- Extra virgin olive oil (cold-pressed): oleocanthal has ibuprofen-like anti-neuroinflammatory effect. 2-4 tbsp/day. Central to Mediterranean diet brain benefits.
- Dark chocolate (85%+ cacao): flavanols increase cerebral blood flow. 1-2 squares/day.
- Turmeric (with black pepper): curcumin crosses blood-brain barrier, boosts BDNF, clears amyloid. 1 tsp/day with piperine for 2000% absorption increase.
- Green tea: L-theanine + EGCG. L-theanine promotes alpha brain waves (calm focus). 2-3 cups/day.
- Avocado: monounsaturated fat improves blood flow to brain. Also potassium + folate.

LONGEVITY & ANTI-INFLAMMATORY:
- Cruciferous vegetables (broccoli, cauliflower, Brussels sprouts): sulforaphane activates Nrf2 pathway, most potent natural Phase 2 enzyme inducer. Broccoli sprouts have 50x more sulforaphane than mature broccoli.
- Legumes (lentils, chickpeas, black beans): fiber + plant protein + resistant starch. Blue Zone staple. 1 cup cooked/day.
- Berries (blueberries, strawberries, blackberries, raspberries): polyphenols reduce inflammatory markers (CRP, IL-6). 1-2 cups/day.
- Fermented foods (plain Greek yogurt, kefir, kimchi, sauerkraut): diverse probiotics for gut-brain axis. Gut produces 95% of serotonin. 1-2 servings/day.
- Garlic (fresh, crushed, wait 10 min before cooking): allicin is antimicrobial + cardioprotective. 2-3 cloves/day.
- Sweet potato: beta-carotene (converted to vitamin A) + complex carbs + fiber. Better than white potato.
- Tomatoes (cooked): lycopene bioavailability increases 5x when cooked with olive oil. Neuroprotective.

OPTIMAL PROTEIN SOURCES (ranked by bioavailability + nutrient density):
1. Wild-caught salmon (omega-3 + astaxanthin + protein)
2. Pasture-raised eggs (complete amino acids + choline + D3)
3. Grass-fed beef (CLA + creatine + B12 + heme iron) — 2-3x/week max
4. Sardines/mackerel (omega-3 + calcium from bones + low mercury)
5. Free-range chicken breast/thigh (lean complete protein)
6. Plain Greek yogurt (probiotics + casein + whey)
7. Lentils/chickpeas (fiber + iron + folate)

HEART & METABOLIC HEALTH:
- Oats (steel-cut or rolled): beta-glucan fiber lowers LDL cholesterol. 1/2 cup dry/day.
- Almonds: vitamin E + magnesium + monounsaturated fat. 1 oz (23 almonds)/day.
- Flaxseed (ground): ALA omega-3 + lignans. 2 tbsp/day. Must be ground for absorption.
- Beets: dietary nitrates convert to nitric oxide, improve blood flow + exercise performance.

MICRONUTRIENT GAPS TO WATCH:
- Magnesium (most people deficient): pumpkin seeds, dark chocolate, spinach, almonds
- Vitamin D: fatty fish, egg yolks, mushrooms (UV-exposed), or supplement
- Vitamin K2 (different from K1): natto, grass-fed butter, egg yolks — directs calcium to bones not arteries
- Zinc: oysters (highest food source), pumpkin seeds, beef, lentils
- B12: animal products only — critical for methylation + nerve function

UPGRADE RULES for grocery_keep items:
- White rice → brown rice or quinoa (fiber + complete protein for quinoa)
- Regular chicken → free-range/pasture-raised (better omega-6:3 ratio)
- Regular eggs → pasture-raised (2x omega-3, 3x vitamin D, 6x vitamin E)
- Conventional olive oil → cold-pressed extra virgin (retains polyphenols)
- Regular yogurt → plain Greek yogurt (2x protein, live cultures)
- White bread → sourdough whole grain (lower glycemic, better mineral absorption from fermentation)
- Regular butter → grass-fed butter (vitamin K2 + CLA)
- Canola/vegetable oil → extra virgin olive oil or avocado oil (no seed oil oxidation)

FOODS TO FLAG FOR stop_and_replace (only if found in food log):
- Hotdog/processed meats (nitrites + sodium nitrate → nitrosamines, WHO Group 1 carcinogen)
- Instant noodles (TBHQ preservative + high sodium + trans fats + zero nutrition)
- Margarine/vegetable shortening (trans fats, inflammatory omega-6)
- Seed/vegetable oils (soybean, canola, corn oil — oxidize at high heat, inflammatory)
- White bread/pandesal (refined flour, high glycemic, stripped of fiber/nutrients)
- Sugary drinks/juice (fructose overload → fatty liver, insulin resistance)
- Processed cheese (fillers, emulsifiers, minimal real dairy)
- Fried street food (reused oil = oxidized lipids + acrylamide)
- Tocino/longganisa/spam (nitrites + excess sugar + sodium + preservatives)

CONTAMINATION RISKS & PHILIPPINES SOURCING GUIDE (use for sourcing_guide field):
- Turmeric powder: HIGH RISK of lead contamination (lead chromate added for color in South/Southeast Asia). Look for: whole turmeric root from local palengke (safest), or branded organic powder with third-party testing. Avoid loose/unbranded powder. Grate fresh root yourself.
- Salmon: Farm-raised has PCBs, dioxins, antibiotics, artificial color (astaxanthin added). In PH: frozen wild-caught Alaskan salmon from S&R, Landers, or specialty stores. Check label says "wild-caught" not "Atlantic" (Atlantic = farmed). Alternative: local sardinas (galunggong family) are wild, cheap, low mercury, high omega-3.
- Chicken/poultry: PH commercial poultry uses antibiotics as growth promoters. Look for: "antibiotic-free" or "free-range" labels — brands like Bounty Fresh Free Range, or buy from known free-range farms at weekend markets (Salcedo, Legazpi, etc.). Backyard/native chicken (manok bisaya/native) from palengke is often antibiotic-free but verify.
- Eggs: Commercial PH eggs from battery cages, hens fed antibiotics + soy feed. Look for: "free-range" or "pasture-raised" — Sunnyside Farms, Happy Egg, or local farm eggs from weekend markets. Native/itlog ng pugo are less contaminated.
- Fish (general): Mercury risk in large predatory fish (tuna, swordfish, shark). PH-safe choices: galunggong (round scad), bangus (milkfish — farmed but relatively clean), sardines, tilapia (local pond-raised). Avoid: imported tuna steaks, large yellowfin.
- Vegetables: Pesticide residues common in PH conventional produce. Prioritize: local organic from Good Food Community, The Green Grocer, or farmers markets. Wash all produce in vinegar-water solution (1:3 ratio, soak 15 min). Leafy greens (kangkong, pechay, malunggay) from backyard gardens are ideal.
- Rice: PH rice may have arsenic (absorbed from soil/water). Rinse thoroughly (3-4 washes), cook with excess water and drain (reduces arsenic 40-60%). Brown rice has more arsenic than white due to bran — still worth it for fiber but wash well.
- Olive oil: Widespread fraud/adulteration globally. In PH: buy from reputable stores (S&R, Landers). Look for: dark glass bottle, harvest date (not just expiry), specific origin (e.g. "Product of Spain/Italy/Greece" not just "packed in"). Brands: Colavita, California Olive Ranch, Cobram Estate. Avoid: suspiciously cheap EVOO, clear plastic bottles.
- Dark chocolate: Cadmium + lead contamination in cacao. Look for: European-sourced (stricter limits). Brands available in PH: Lindt 85%, Endangered Species, Hu Kitchen. Avoid: cheap unbranded tablea unless verified source.
- Peanut butter: Aflatoxin risk from mold in peanuts (PH climate = high risk). Buy: sealed branded jars (no-stir natural PB), not loose palengke ground peanuts. Brands: organic/natural PB from Healthy Options, or almond butter as alternative.
- Honey: Widely adulterated with corn syrup in PH. Buy from verified local beekeepers or brands with traceability (e.g. Bohol Bee Farm, Milea).
- Supplements (if recommended): Buy from reputable pharmacies (Mercury Drug, Watsons) or Healthy Options. Check for FDA-PH registration. Avoid: Shopee/Lazada unverified sellers.`;

// Ported verbatim from www/app.js SYSTEM_PROMPT_DIET_RECONCILE
const SYSTEM_PROMPT_DIET_RECONCILE = `You are a senior registered dietitian acting as a NEUTRAL JUDGE. Two independent analyses of the same food diary disagreed. Your job is to determine which analysis is more accurate by checking claims against the raw food data.

CRITICAL DEBIASING RULES:
- Do NOT compromise or average between the two analyses. Splitting the difference is WRONG.
- For EACH disagreement, re-examine the raw food data yourself and determine which analysis is correct.
- If Analysis A says "low" and Analysis B says "critically_low", check the actual food log: count real servings, then decide which label is accurate. Pick one.
- If both analyses are wrong on a point, give your own independent assessment.
- The analyses are labeled A and B — you do not know which AI produced which. Treat them equally.
- Your reasoning MUST cite specific foods from the log to justify each decision (e.g. "pechay appeared twice in 7 days = ~0.3 servings/day, which is critically_low not low").

Food group status definitions:
- "missing" = literally zero foods from this group in the entire period
- "critically_low" = trace amounts present but far below recommended
- "low" = some intake but still below recommended servings
- "adequate" = meeting or near recommended servings
- "good" = meeting or exceeding recommended servings consistently

Keep your response concise. Reasoning: 4-6 sentences citing specific foods. Summaries: 1-2 sentences. Limit concerns, suggestions, positive_observations to 3-4 items each.

You MUST respond with ONLY a JSON object (no markdown fences, no extra text) in the same format as the original assessment:
{
  "reasoning": "<brief: where the two analyses agreed/disagreed and how you resolved each>",
  "overall_score": <1-10 integer>,
  "calorie_assessment": { "score": <1-10>, "status": "<deficit|on_target|surplus>", "summary": "<explanation>" },
  "protein_assessment": { "score": <1-10>, "status": "<deficient|adequate|good|excellent>", "summary": "<explanation>" },
  "food_groups": {
    "fruits": { "score": <1-10>, "servings_estimated": <number>, "recommended": <number>, "status": "<missing|critically_low|low|adequate|good>" },
    "vegetables": { "score": <1-10>, "servings_estimated": <number>, "recommended": <number>, "status": "<missing|critically_low|low|adequate|good>" },
    "whole_grains": { "score": <1-10>, "servings_estimated": <number>, "recommended": <number>, "status": "<missing|critically_low|low|adequate|good>" },
    "lean_protein": { "score": <1-10>, "servings_estimated": <number>, "recommended": <number>, "status": "<missing|critically_low|low|adequate|good>" },
    "dairy_calcium": { "score": <1-10>, "servings_estimated": <number>, "recommended": <number>, "status": "<missing|critically_low|low|adequate|good>" },
    "healthy_fats": { "score": <1-10>, "servings_estimated": <number>, "recommended": <number>, "status": "<missing|critically_low|low|adequate|good>" }
  },
  "fiber_assessment": { "estimated_daily_g": <number>, "recommended_daily_g": <number>, "status": "<deficient|low|adequate|good>" },
  "concerns": ["<concern>"],
  "suggestions": [{ "food": "<food>", "reason": "<why>", "when": "<timing>" }],
  "positive_observations": ["<observation>"],
  "action_plan": {
    "daily_targets": [{ "group": "<food group>", "current": <number>, "target": <number>, "add": "<what to add>" }],
    "grocery_add": [{ "category": "<name>", "weekly_target": "<total>", "pick": "<hint>", "options": [{ "item": "<food>", "portion": "<qty>", "note": "<tip>" }] }],
    "grocery_keep": [{ "category": "<name>", "options": [{ "item": "<food>", "portion": "<qty>", "note": "<tip>" }] }],
    "stop_and_replace": [{ "stop": "<food>", "why": "<reason>", "replace_with": "<alternative>" }],
    "sourcing_guide": [{ "food": "<food>", "risk": "<risk>", "what_to_look_for": "<PH tips>" }],
    "meal_ideas": ["<idea>"]
  }
}

For action_plan: grocery_add = categorized with 3-6 options per category for variety/mix-and-match. grocery_keep = categorized with optimal upgrade tips. stop_and_replace = foods from the log to cut. sourcing_guide = PH-specific contamination/buying tips. Be exhaustive with options.`;

// Ported from www/macros.js getMacro()/sumMacro() — the compiled assessment
// data package carries entries with the nested { id: { low, high } } shape.
function getMacroRange(entry: any, id: string) {
  const m = entry && entry.macros && entry.macros[id];
  if (!m || m.low == null || m.high == null) return null;
  return { low: m.low, high: m.high };
}
function sumMacroRange(entries: any[], id: string) {
  return (entries || []).reduce((acc: any, e: any) => {
    const m = getMacroRange(e, id);
    if (m) { acc.low += Number(m.low) || 0; acc.high += Number(m.high) || 0; }
    return acc;
  }, { low: 0, high: 0 });
}

// Ported verbatim from www/app.js buildAssessmentPrompt() — the payload's
// `data` is the same compiled package getAssessmentData() produces.
function buildAssessmentPromptText(data: any) {
  let prompt = `Analyze this food diary for nutritional completeness and diet quality.\n\n`;
  prompt += `Period: ${data.startDate} to ${data.endDate} (${data.numDays} days tracked)\n`;
  prompt += `Total food entries: ${data.totalEntries}\n\n`;

  prompt += `Daily averages:\n`;
  prompt += `- Calories eaten: ${data.avgCalLow}-${data.avgCalHigh} kcal/day\n`;
  prompt += `- Protein eaten: ${data.avgProLow}-${data.avgProHigh} g/day\n`;
  if (data.avgProTargetLow) prompt += `- Protein target: ${data.avgProTargetLow}-${data.avgProTargetHigh} g/day\n`;

  // Per-day calorie context
  const ctxDates = Object.keys(data.dailyContext || {}).sort();
  if (ctxDates.length > 0) {
    prompt += `\nCalorie context (IMPORTANT for calorie_assessment):\n`;
    prompt += `TDEE varies per day based on activity level. Each day's TDEE, planned deficit, and calorie intake target are listed below.\n`;
    prompt += `"Surplus" means eating ABOVE that day's TDEE (would gain weight). Being above the intake target but below TDEE is NOT surplus — it just means the deficit is smaller than planned.\n\n`;
    prompt += `Per-day breakdown:\n`;
    for (const date of ctxDates) {
      const ctx = data.dailyContext[date];
      const dayFoods = data.foodByDate[date] || [];
      const _eat = sumMacroRange(dayFoods, "calories");
      const eatLow = _eat.low;
      const eatHigh = _eat.high;
      prompt += `  ${date}: Activity="${ctx.activity}" | TDEE=${ctx.tdee} | Deficit=${ctx.deficit} | Target=${ctx.calorieTarget} | Eaten=${Math.round(eatLow)}-${Math.round(eatHigh)} kcal\n`;
    }
  }

  // Year-over-year: include previous year summary for comparison
  if (data.isYoY && data.previousYear && data.previousYear.totalEntries > 0) {
    const py = data.previousYear;
    prompt += `\n--- Previous Year Comparison (${py.label}) ---\n`;
    prompt += `Days tracked: ${py.numDays}, Food entries: ${py.totalEntries}\n`;
    prompt += `Daily averages: ${py.avgCalLow}-${py.avgCalHigh} kcal, ${py.avgProLow}-${py.avgProHigh}g protein\n`;
    const pyCtx = Object.values(py.dailyContext || {});
    if (pyCtx.length > 0) {
      const pyAvgTDEE = Math.round(pyCtx.reduce((s: number, c: any) => s + c.tdee, 0) / pyCtx.length);
      const pyAvgTarget = Math.round(pyCtx.reduce((s: number, c: any) => s + c.calorieTarget, 0) / pyCtx.length);
      prompt += `Avg TDEE: ${pyAvgTDEE} kcal, Avg calorie target: ${pyAvgTarget} kcal\n`;
    }
    prompt += `\nCompare the current year's diet against the previous year and note improvements or regressions.\n`;
  }

  prompt += `\n--- Complete Food Log ---\n`;
  const sortedDates = data.dates.sort();
  for (const date of sortedDates) {
    prompt += `\n${date}:\n`;
    const items = data.foodByDate[date];
    for (const item of items) {
      const _c = getMacroRange(item, "calories"), _p = getMacroRange(item, "protein");
      const calStr = _c ? `${_c.low}-${_c.high}` : "?";
      const proStr = _p ? `${_p.low}-${_p.high}` : "?";
      prompt += `  ${item.time} - ${item.food}, ${item.qty} ${item.unit} (${calStr} cal, ${proStr}g protein)\n`;
    }
  }

  return prompt;
}

function buildAssessR1Prompt(payload: any) {
  const user = buildAssessmentPromptText(payload.data);
  return { system: SYSTEM_PROMPT_DIET_ASSESSMENT, userOpenAI: user, userAnthropic: user, tokens: 8000, timeoutMs: 90_000 };
}

// R1 analyses arrive back as raw model texts; pretty-print them as JSON when
// possible so the judge sees the same framing the client used to build
// (JSON.stringify(parsed, null, 2)); otherwise embed the raw text.
function prettyAnalysis(x: unknown) {
  if (x != null && typeof x === "object") return JSON.stringify(x, null, 2);
  const s = String(x);
  try { return JSON.stringify(JSON.parse(stripFencesApp(s)), null, 2); } catch { return s; }
}

// Ported verbatim from www/app.js buildAssessmentReconciliationPrompt()
function buildAssessR2Prompt(payload: any) {
  let prompt = buildAssessmentPromptText(payload.data);
  prompt += `\n\n--- Two Independent Analyses (anonymized) ---\n`;
  // Anonymize: shuffle order randomly so judge can't infer which is which
  const shuffled = [payload.round1A, payload.round1B].sort(() => Math.random() - 0.5);
  prompt += `\nAnalysis A:\n`;
  prompt += prettyAnalysis(shuffled[0]);
  prompt += `\n\nAnalysis B:\n`;
  prompt += prettyAnalysis(shuffled[1]);
  prompt += `\n\nFor each category where A and B disagree, re-examine the raw food data above and determine which is correct. Do NOT average or compromise — pick the answer supported by the data, or give your own if both are wrong. Cite specific foods from the log in your reasoning.`;
  return { system: SYSTEM_PROMPT_DIET_RECONCILE, userOpenAI: prompt, userAnthropic: prompt, tokens: 8000, timeoutMs: 90_000 };
}

// ============================================================
// Model-output parsing — fence-stripping + JSON extraction ported from
// www/app.js parseAIResponse() and www/photo.js parseVisionResponse(). The
// pure shape helpers (field extraction, nested-macros conversion, item merge
// with count/name guards) live in _shared/proxy-shapes.mjs, unit-tested by
// the node --test suite. parseEstimate returns null on any partial estimate
// so it degrades to the single-model path instead of poisoning the merge.
// ============================================================

// Fence-stripping ported verbatim from each source.
function stripFencesApp(content: string) {
  return content.trim().replace(/```json?\s*/g, "").replace(/```/g, "").trim();
}
function stripFencesPhoto(content: string) {
  return String(content).trim().replace(/```[a-zA-Z]*\s*/g, "").replace(/```/g, "").trim();
}

function parseEstimate(text: string) {
  const cleaned = stripFencesApp(text);
  let parsed: any;
  try { parsed = JSON.parse(cleaned); } catch { return null; }
  return extractEstimateFields(parsed);
}

// Ported from www/photo.js parseVisionResponse() item extraction. Returns the
// raw item objects (flat macro fields) or null when the JSON is unparseable.
function parsePhotoItems(text: string) {
  const cleaned = stripFencesPhoto(text);
  let parsed: any;
  try { parsed = JSON.parse(cleaned); } catch { return null; }
  return Array.isArray(parsed.items)
    ? parsed.items.filter((it: any) => it !== null && typeof it === "object" && !Array.isArray(it))
    : [];
}

// ============================================================
// Provider adapters
// ============================================================

type Usage = { model: string; inputTokens: number; outputTokens: number };

// Ported verbatim from www/app.js openaiModelParams():
// GPT-5+ and reasoning models use max_completion_tokens (includes thinking tokens) and don't support temperature
function openaiModelParams(model: string, tokens: number) {
  if (model.startsWith("gpt-5") || model.startsWith("o1") || model.startsWith("o3") || model.startsWith("o4")) {
    // Reasoning models need much higher limits — thinking/reasoning tokens count against the budget
    return { max_completion_tokens: Math.max(tokens * 8, 8000) };
  }
  return { max_tokens: tokens, temperature: 0 };
}

// Claude 5-family models (claude-opus-5, claude-sonnet-5 — no "-4-" in the id)
// reject `temperature` (400 invalid_request_error) and think by default, with
// thinking tokens counting against max_tokens — so they get the same headroom
// treatment as OpenAI reasoning models plus an effort dial (small structured
// extractions run at "low", assessments at "medium"). `output_config.effort`
// itself 400s on 4.x models (e.g. claude-haiku-4-5), hence the split.
function anthropicModelParams(model: string, tokens: number) {
  if (!model.includes("-4-")) {
    return {
      max_tokens: Math.max(tokens * 8, 8000),
      output_config: { effort: tokens >= 8000 ? "medium" : "low" },
    };
  }
  return { max_tokens: tokens, temperature: 0 };
}

async function callOpenAI(model: string, system: string, user: unknown, tokens: number, timeoutMs: number): Promise<{ text: string; usage: Usage }> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      ...openaiModelParams(model, tokens),
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    console.error("openai error", res.status, errBody.slice(0, 200));
    throw new Error(`openai ${res.status}`);
  }
  const j = await res.json();
  const usage: Usage | null = j.usage
    ? { model, inputTokens: j.usage.prompt_tokens, outputTokens: j.usage.completion_tokens }
    : null;
  // Ported guards from www/app.js extractOpenAIContent(). Failures after a
  // usage block carry it so truncated output still gets metered (the ledger
  // should know what we actually paid for).
  const fail = (message: string): never => { throw usage ? { message, usage } : new Error(message); };
  const choice = j.choices && j.choices[0];
  if (!choice) fail("No response from OpenAI");
  if (choice.finish_reason === "length") fail("openai truncated (token limit reached)");
  const content = choice.message && choice.message.content;
  if (!content) fail("Empty response from OpenAI");
  if (!usage) throw new Error("openai missing usage");
  return { text: content, usage };
}

async function callAnthropic(model: string, system: string, user: unknown, tokens: number, timeoutMs: number): Promise<{ text: string; usage: Usage }> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, system, messages: [{ role: "user", content: user }], ...anthropicModelParams(model, tokens) }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    console.error("anthropic error", res.status, errBody.slice(0, 200));
    throw new Error(`anthropic ${res.status}`);
  }
  const j = await res.json();
  const usage: Usage | null = j.usage
    ? { model, inputTokens: j.usage.input_tokens, outputTokens: j.usage.output_tokens }
    : null;
  // Ported truncation guard (client's vision/assessment adapters); carries the
  // usage block so truncated output still gets metered.
  if (j.stop_reason === "max_tokens") {
    throw usage ? { message: "anthropic truncated (token limit)", usage } : new Error("anthropic truncated (token limit)");
  }
  if (!usage) throw new Error("anthropic missing usage");
  return {
    text: j.content.map((b: { text?: string }) => b.text ?? "").join(""),
    usage,
  };
}

// Dispatch by model id prefix: claude-* → Anthropic, everything else → OpenAI.
function callModel(model: string, system: string, userOpenAI: unknown, userAnthropic: unknown, tokens: number, timeoutMs: number) {
  return model.startsWith("claude-")
    ? callAnthropic(model, system, userAnthropic, tokens, timeoutMs)
    : callOpenAI(model, system, userOpenAI, tokens, timeoutMs);
}

// ============================================================
// Handler
// ============================================================

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // 1. Auth
  const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  const { data: userData, error: authErr } = await admin.auth.getUser(jwt);
  if (authErr || !userData?.user) return json(401, { error: "unauthenticated" });
  const uid = userData.user.id;

  let reqBody: any;
  try { reqBody = await req.json(); } catch { return json(400, { error: "bad request" }); }
  const feature = reqBody?.feature;
  const payload = (reqBody && typeof reqBody.payload === "object" && reqBody.payload !== null && !Array.isArray(reqBody.payload))
    ? reqBody.payload : {};
  if (!["estimate", "photo", "assess-round1", "assess-round2"].includes(feature)) {
    return json(400, { error: "unknown feature" });
  }
  if (feature === "photo" && (payload.imageDataUrl?.length ?? 0) > 5_000_000) {
    return json(400, { error: "image too large" });
  }
  // Size caps mirroring the photo cap — bound what a client can make us relay.
  if (feature === "estimate" && JSON.stringify(payload).length > 10_000) {
    return json(400, { error: "payload too large" });
  }
  if (feature === "photo" && JSON.stringify(payload.hint ?? null).length > 10_000) {
    return json(400, { error: "payload too large" });
  }
  if (feature.startsWith("assess") && JSON.stringify(payload).length > 250_000) {
    return json(400, { error: "payload too large" });
  }
  // R2 reconciles exactly two analyses — the old client refused fewer; enforce it here.
  if (feature === "assess-round2" && (payload.round1A == null || payload.round1B == null)) {
    return json(400, { error: "bad request" });
  }

  // 2. Config + entitlement (+ default-free upsert) + kill switch
  const { data: cfgRow } = await admin.from("ai_config").select("value").eq("id", 1).single();
  if (!cfgRow) return json(503, { error: "not configured" });
  const cfg = cfgRow.value;
  if (!cfg.enabled) return json(503, { error: "ai disabled" });
  // Read the merge dial up front with a safe default — it's consumed in step 9,
  // AFTER the ledger insert, and a bad config edit must not 500 post-billing.
  const widenThreshold = cfg.merge?.widen_threshold ?? 0.4;

  await admin.from("entitlements").upsert({ user_id: uid }, { onConflict: "user_id", ignoreDuplicates: true });
  const { data: ent } = await admin.from("entitlements").select("plan").eq("user_id", uid).single();
  const plan = ent?.plan ?? "free";
  const planCfg = cfg.plans[plan === "owner" ? "t10" : plan]; // owner runs top-tier models
  if (!planCfg) return json(503, { error: "misconfigured plan" }); // unknown plan name in entitlements

  // 3. Rate limit: ledger rows in the trailing 60s. Fail closed — a metering
  // outage must never mean free unmetered AI.
  const minuteAgo = new Date(Date.now() - 60_000).toISOString();
  const { count: recent, error: rateErr } = await admin.from("ai_usage")
    .select("id", { count: "exact", head: true })
    .eq("user_id", uid).gte("created_at", minuteAgo);
  if (rateErr) {
    console.error("rate-limit query failed", rateErr);
    return json(503, { error: "not configured" });
  }
  // Guard the config key: `recent >= undefined` is false, which would silently
  // DISABLE rate limiting if rate_per_min were ever dropped from ai_config.
  if (cfg.rate_per_min == null) console.warn("rate_per_min missing from ai_config; defaulting to 5");
  if (rateLimited(recent ?? 0, cfg.rate_per_min ?? 5)) return json(429, { error: "rate limited" });

  // 4. Quota pre-check — summed SQL-side by the ai_usage_total RPC (a JS-side
  // row fetch silently truncates at PostgREST max-rows, which would stop the
  // lifetime cap from enforcing after ~1000 ledger rows). Fail closed on error.
  let since: string | null = null;
  if (!planCfg.lifetime && plan !== "owner") {
    const monthStart = new Date();
    monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
    since = monthStart.toISOString();
  }
  const { data: usedTotal, error: usedErr } = await admin.rpc("ai_usage_total", { p_user: uid, p_since: since });
  if (usedErr) {
    console.error("usage-total rpc failed", usedErr);
    return json(503, { error: "not configured" });
  }
  const quota = quotaState({ plan, planCfg, usedUsd: Number(usedTotal) });
  // A plan whose allowance is missing/zero is an owner config mistake — that's
  // an outage (503), not a paywall (402); matches the RPC's `misconfigured`.
  if (quota.misconfigured) {
    console.error("misconfigured plan allowance", plan);
    return json(503, { error: "not configured" });
  }
  if (!quota.allowed) return json(402, { error: "quota exhausted", pct_used: quota.pctUsed });

  // 5. Model pair for this feature class
  const featureClass = feature.startsWith("assess") ? "assess" : feature;
  const pair = planCfg.models?.[featureClass];
  if (!Array.isArray(pair) || pair.length < 2) {
    console.error("missing model pair", plan, featureClass);
    return json(503, { error: "not configured" });
  }
  const [modelA, modelB] = pair;
  for (const m of [modelA, modelB]) {
    if (!cfg.prices[m]) {
      // Spec: model names never reach the client — log the id, return generic.
      console.error("unpriced model", m);
      return json(503, { error: "not configured" });
    }
  }

  // 6. Build prompts (ported verbatim from the pre-B client)
  const { system, userOpenAI, userAnthropic, tokens, timeoutMs } =
    feature === "estimate" ? buildEstimatePrompt(payload)
    : feature === "photo" ? buildPhotoPrompt(payload)
    : feature === "assess-round1" ? buildAssessR1Prompt(payload)
    : buildAssessR2Prompt(payload);

  // 7. Run the pair in parallel; degrade to single-model if one fails
  const [ra, rb] = await Promise.allSettled([
    callModel(modelA, system, userOpenAI, userAnthropic, tokens, timeoutMs),
    callModel(modelB, system, userOpenAI, userAnthropic, tokens, timeoutMs),
  ]);
  const okA = ra.status === "fulfilled" ? ra.value : null;
  const okB = rb.status === "fulfilled" ? rb.value : null;
  // Usage can come from a fulfilled call OR ride on a truncation rejection —
  // either way we paid for those tokens and they must hit the ledger, even
  // when the other side succeeds (degraded path). A rejection-carried usage
  // with malformed token counts is dropped (null) rather than allowed to turn
  // a surviving model's success into an unpriced 503.
  const settledUsage = (s: PromiseSettledResult<{ text: string; usage: Usage }>): Usage | null => {
    if (s.status === "fulfilled") return s.value.usage;
    const u = (s.reason as any)?.usage;
    return u && Number.isFinite(u.inputTokens) && Number.isFinite(u.outputTokens) ? u : null;
  };
  const usageA = settledUsage(ra);
  const usageB = settledUsage(rb);
  if (!okA && !okB) {
    // Failures still count toward the trailing-60s rate limit, and a truncated
    // response carries real token usage we already paid for — ledger it before
    // the 502 (cost 0 when neither rejection carries usage).
    const { costUsd: failCost } = computeCost(usageA, usageB, cfg.prices);
    const failLedger = {
      user_id: uid, feature,
      model_a: modelA, model_b: modelB,
      tokens_in_a: usageA?.inputTokens ?? null, tokens_out_a: usageA?.outputTokens ?? null,
      tokens_in_b: usageB?.inputTokens ?? null, tokens_out_b: usageB?.outputTokens ?? null,
      cost_usd: failCost,
    };
    let { error: failErr } = await admin.from("ai_usage").insert(failLedger);
    if (failErr) ({ error: failErr } = await admin.from("ai_usage").insert(failLedger));
    if (failErr) console.error("FAIL-LEDGER INSERT FAILED TWICE", failErr, failLedger);
    return json(502, { error: "both models failed" });
  }

  // 8. Meter with real usage from BOTH sides — a truncated-but-billed side is
  // metered alongside the survivor; only the response building below is
  // restricted to the fulfilled side's text. Ledger slots are positional
  // (A = modelA, B = modelB); model_b stays null only when side B produced
  // no billable usage at all.
  const { costUsd, unpriced } = computeCost(usageA, usageB, cfg.prices);
  if (unpriced.length) {
    // Spec: model names never reach the client — log the id, return generic.
    console.error("unpriced model", unpriced[0]);
    return json(503, { error: "not configured" });
  }
  const ledger = {
    user_id: uid, feature,
    model_a: modelA, model_b: usageB ? modelB : null,
    tokens_in_a: usageA?.inputTokens ?? null, tokens_out_a: usageA?.outputTokens ?? null,
    tokens_in_b: usageB?.inputTokens ?? null, tokens_out_b: usageB?.outputTokens ?? null,
    cost_usd: costUsd,
  };
  // One retry; if the first insert actually landed despite reporting an error
  // (false negative), this double-bills a few cents — rare, accepted.
  let { error: insErr } = await admin.from("ai_usage").insert(ledger);
  if (insErr) ({ error: insErr } = await admin.from("ai_usage").insert(ledger));
  if (insErr) console.error("LEDGER INSERT FAILED TWICE", insErr, ledger);

  // 9. Feature-specific response
  if (feature === "estimate") {
    const estA = okA ? parseEstimate(okA.text) : null;
    const estB = okB ? parseEstimate(okB.text) : null;
    if (!estA && !estB) return json(502, { error: "unparseable model output" });
    const merged = mergeEstimates(estA, estB, widenThreshold);
    return json(200, {
      cal_low: merged.cal_low, cal_high: merged.cal_high,
      pro_low: merged.pro_low, pro_high: merged.pro_high,
      // Nested { id: { low, high } } — the shape www/app.js stores on entries.
      macros: toNestedMacros(merged),
      ai_thought_process: { a: okA?.text ?? null, b: okB?.text ?? null },
    });
  }
  if (feature === "photo") {
    // The client's photo flow is itemized ({ items: [{ food, portion, macros }] },
    // consumed by PhotoEstimate.itemsToEntries) — a single merged estimate can't
    // represent it, so the pair merges per aligned item instead.
    const itemsA = okA ? parsePhotoItems(okA.text) : null;
    const itemsB = okB ? parsePhotoItems(okB.text) : null;
    if (!itemsA && !itemsB) return json(502, { error: "unparseable model output" });
    return json(200, {
      items: mergePhotoItems(itemsA, itemsB, widenThreshold),
      ai_thought_process: { a: okA?.text ?? null, b: okB?.text ?? null },
    });
  }
  // assessment rounds: return both analyses, anonymized labels
  return json(200, { a: okA?.text ?? null, b: okB?.text ?? null });
});
