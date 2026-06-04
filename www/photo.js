// Pure photo food-capture helpers: vision prompt builders, response parser, entry mapper.
// UMD: usable as a browser global (window.PhotoEstimate) and a Node module.
(function (root, factory) {
  const Macros = (typeof require === "function") ? require("./macros.js") : root.Macros;
  const api = factory(Macros);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PhotoEstimate = api;
})(typeof self !== "undefined" ? self : this, function (Macros) {

  function buildVisionSystemPrompt(macroIds) {
    return `You are a precise nutrition assistant analyzing a photo of food. Identify each distinct food item visible. Estimate each item's portion from visual cues (plate size, utensils, packaging) and its nutrition. Be consistent and evidence-based.

Respond with ONLY a JSON object (no markdown fences) in this exact format:
{
  "reasoning": "<brief reasoning; not shown to the user>",
  "items": [
    {
      "food": "<short food name>",
      "portion": "<human-readable portion, e.g. '1 sandwich' or '~150 g'>",
${Macros.promptFields(macroIds)}
    }
  ]
}
Units: calories in kcal, sodium in mg, all other macros in grams. Give one object per distinct food.`;
  }

  function buildVisionUserText(history) {
    let t = "Identify each distinct food in this photo. For each, return a short name, an estimated portion, and the nutrition estimates. Return ONLY the JSON object.";
    if (history && Array.isArray(history.priorItems) && history.priorItems.length) {
      t += "\n\nYour previous reading was:\n" + JSON.stringify(history.priorItems.map((i) => ({ food: i.food, portion: i.portion })));
    }
    if (history && history.correction) {
      t += "\n\nThe user provided this correction — re-estimate the whole photo accordingly:\n" + history.correction;
    }
    return t;
  }

  function parseVisionResponse(jsonText, macroIds) {
    const cleaned = String(jsonText).trim().replace(/```json?\s*/g, "").replace(/```/g, "").trim();
    let parsed;
    try { parsed = JSON.parse(cleaned); }
    catch (e) { throw new Error("Could not parse photo result"); }
    const raw = Array.isArray(parsed.items) ? parsed.items : [];
    const items = raw.map((it) => ({
      food: String(it.food || "").trim() || "Unknown item",
      portion: String(it.portion || "").trim() || "1 serving",
      macros: Macros.parseMacros(it, macroIds),
    }));
    return { items };
  }

  function itemsToEntries(items, date, time, idStart) {
    return (items || []).map((it, i) => ({
      id: idStart + i,
      date, time,
      food: it.food,
      qty: 1,
      unit: it.portion,
      macros: it.macros || {},
      estimateStatus: "done",
    }));
  }

  return { buildVisionSystemPrompt, buildVisionUserText, parseVisionResponse, itemsToEntries };
});
