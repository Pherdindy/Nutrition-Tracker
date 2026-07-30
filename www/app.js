// ---- Responsive helpers (Phase 1 mobile) ----
const MOBILE_MQ = window.matchMedia("(max-width: 720px)");
function isMobile() { return MOBILE_MQ.matches; }

// Re-render whatever is currently on screen when the breakpoint flips
// (desktop tables <-> mobile cards). Renderers register themselves here.
const _responsiveRenderers = [];
function onBreakpointChange(fn) { _responsiveRenderers.push(fn); }
MOBILE_MQ.addEventListener("change", () => {
  _responsiveRenderers.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
});

function activateTab(tabId) {
  document.querySelectorAll(".tab").forEach((t) =>
    t.classList.toggle("active", t.dataset.tab === tabId));
  document.querySelectorAll(".bottom-nav-item").forEach((b) =>
    b.classList.toggle("active", b.dataset.tab === tabId));
  document.querySelectorAll(".tab-content").forEach((c) =>
    c.classList.toggle("active", c.id === tabId));
}

// ============================================================
// DATA LAYER — Supabase with in-memory cache
// ============================================================

const SUPABASE_URL = 'https://wcbpvvyhswaricoadqbb.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_I_XmlCcMCBDOkbU8PWN42A_SID54xxi';
// PKCE flow so the Android deep-link return can exchange a code for a session;
// detectSessionInUrl handles the ?code= redirect in plain-browser (dev) mode.
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { flowType: "pkce", persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

// All AI goes through the ai-proxy Edge Function; the server owns keys,
// models, prompts, and metering. Throws { status, message } on failure.
async function callAi(feature, payload) {
  const { data, error } = await sb.functions.invoke("ai-proxy", { body: { feature, payload } });
  if (error) {
    const status = error.context?.status ?? 500;
    throw { status, message: BillingView.aiErrorMessage(status) };
  }
  try { if (typeof refreshCreditBar === "function") refreshCreditBar(); }
  catch (e) { /* UI refresh must never fail the call */ }
  return data;
}

// ---- AI credit bar + paywall (metering UI) ----

let _aiExhausted = false;

async function refreshCreditBar() {
  try {
    const { data } = await sb.rpc("ai_usage_summary");
    if (!data || data.error) return;
    const vm = BillingView.creditBar(data.pct_used, data.plan);
    const fill = document.getElementById("credit-bar-fill");
    if (!fill) return;
    fill.style.width = vm.width;
    fill.className = vm.cls;
    document.getElementById("credit-bar-label").textContent = `${vm.label} · ${vm.planLabel}`;
    _aiExhausted = !!data.exhausted;
  } catch (e) { /* offline: keep last state */ }
}

// Idempotent: a 402 landing while the modal is already up is a no-op.
function openPaywall() {
  const modal = document.getElementById("paywall-modal");
  if (!modal || !modal.classList.contains("hidden")) return;
  modal.classList.remove("hidden");
}

function closePaywall() {
  const modal = document.getElementById("paywall-modal");
  if (modal) modal.classList.add("hidden");
}

const _cache = { food: null, days: null, profile: null, assessments: null, settings: {}, ready: false };

// ---- Mappers: snake_case DB ↔ camelCase JS ----

function foodRowToJs(r) {
  const base = { id: r.id, date: r.date, time: r.time, food: r.food, qty: Number(r.qty), unit: r.unit,
    estimateStatus: r.estimate_status || null };
  if (r.macros) { base.macros = r.macros; return base; }
  // legacy fallback: build macros from cal/pro columns
  base.calLow = Number(r.cal_low); base.calHigh = Number(r.cal_high);
  base.proLow = Number(r.pro_low); base.proHigh = Number(r.pro_high);
  return Macros.migrateEntry(base);
}
function foodJsToRow(e) {
  const cal = Macros.getMacro(e, "calories") || { low: null, high: null };
  const pro = Macros.getMacro(e, "protein") || { low: null, high: null };
  return { id: e.id, date: e.date, time: e.time, food: e.food, qty: e.qty, unit: e.unit,
    macros: e.macros || {}, estimate_status: e.estimateStatus || null,
    cal_low: cal.low, cal_high: cal.high, pro_low: pro.low, pro_high: pro.high,
    ai_thought_process: null };
}

function dayRowToJs(r) {
  return Targets.migrateDay({ id: r.id, date: r.date, weight: Number(r.weight), activity: r.activity });
}
function dayJsToRow(e) {
  // Keep legacy day columns populated from the current global profile so old rows stay valid
  // (no days-table schema change) and any reader that still expects them works. Reads ignore them.
  const p = (typeof loadProfile === "function") ? loadProfile() : {};
  return { id: e.id, date: e.date, weight: e.weight, activity: e.activity,
    age: p.age != null ? p.age : DEFAULT_PROFILE.age, deficit: Targets.deficitForGoal(p.weightLossGoal),
    protein_target_low: p.proteinLow != null ? p.proteinLow : DEFAULT_PROFILE.proteinLow, protein_target_high: p.proteinHigh != null ? p.proteinHigh : DEFAULT_PROFILE.proteinHigh };
}
function profileRowToJs(r) {
  return { height: Number(r.height), age: r.age != null ? Number(r.age) : null, proteinLow: Number(r.protein_low), proteinHigh: Number(r.protein_high), weightLossGoal: r.weight_loss_goal || null };
}
function profileJsToRow(p) {
  // No id: the profile table keys on user_id (filled by its auth.uid() default).
  return { height: p.height, age: p.age, protein_low: p.proteinLow, protein_high: p.proteinHigh, weight_loss_goal: p.weightLossGoal };
}

// ---- bgWrite: fire-and-forget async write to Supabase ----

function bgWrite(fn) {
  Promise.resolve().then(fn).catch(err => console.error('[Supabase bgWrite]', err));
}

// ---- Per-user localStorage cache (theme + API keys stay device-global) ----
const CACHE_BASES = ["food", "days", "profile", "assessments", "version"];
function lsGet(base) { return localStorage.getItem(AuthView.nsKey(currentUid(), base)); }
function lsSet(base, value) { localStorage.setItem(AuthView.nsKey(currentUid(), base), value); }
function clearUserCache() {
  for (const base of CACHE_BASES) localStorage.removeItem(AuthView.nsKey(currentUid(), base));
}

// ---- Constants ----

const ACTIVITY_TYPES = [
  { label: "\u{1FA91} Sat all day (no exercise)", multiplier: 1.2 },
  { label: "\u{1F6B6} Light activity (walked / errands)", multiplier: 1.375 },
  { label: "\u{1F3CB}\uFE0F Gym day (moderate workout)", multiplier: 1.55 },
  { label: "\u{1F4AA} Hard gym session (intense)", multiplier: 1.725 },
  { label: "\u{1F3C3} Very active day (sports + gym)", multiplier: 1.9 },
];

const WEIGHT_LOSS_GOALS = [
  { goal: "0.25 kg/week", daily: 275, weekly: 1925 },
  { goal: "0.50 kg/week", daily: 550, weekly: 3850 },
  { goal: "0.75 kg/week", daily: 825, weekly: 5775 },
  { goal: "1.00 kg/week", daily: 1100, weekly: 7700 },
];

const DEFAULT_PROFILE = { height: 170.1, age: 32, proteinLow: 135, proteinHigh: 150, weightLossGoal: "0.50 kg/week" };

// ---- Data functions (synchronous reads from cache, write-through to Supabase) ----

function loadProfile() {
  if (_cache.ready && _cache.profile) return { ..._cache.profile };
  const saved = lsGet("profile");
  return saved ? JSON.parse(saved) : { ...DEFAULT_PROFILE };
}

function saveProfile(profile) {
  _cache.profile = { ...profile };
  lsSet("profile", JSON.stringify(profile));
  bgWrite(async () => {
    const { error } = await sb.from('profile').upsert(profileJsToRow(profile), { onConflict: 'user_id' });
    if (error) throw error;
  });
}

function getDeficit() { return Targets.deficitForGoal(loadProfile().weightLossGoal); }

function loadFoodEntries() {
  if (_cache.ready && _cache.food) return _cache.food.map(Macros.migrateEntry);
  const saved = lsGet("food");
  return saved ? JSON.parse(saved).map(Macros.migrateEntry) : [];
}

function saveFoodEntries(entries) {
  _cache.food = [...entries];
  lsSet("food", JSON.stringify(entries));
  bgWrite(async () => {
    // Upsert FIRST, then delete only rows that no longer exist. This is non-destructive
    // on failure: if the upsert errors (e.g. a missing column), nothing is deleted, so the
    // table is never emptied. (The old delete-all-then-insert wiped the table when the
    // re-insert failed.)
    if (entries.length === 0) {
      const { error } = await sb.from('food_entries').delete().gte('id', 0);
      if (error) throw error;
      return;
    }
    const rows = entries.map(foodJsToRow);
    const { error: upErr } = await sb.from('food_entries').upsert(rows);
    if (upErr) throw upErr; // table untouched — no rows deleted
    const ids = entries.map((e) => e.id);
    const { error: delErr } = await sb.from('food_entries').delete().not('id', 'in', `(${ids.join(',')})`);
    if (delErr) throw delErr;
  });
}

function loadDayEntries() {
  if (_cache.ready && _cache.days) return [..._cache.days];
  const saved = lsGet("days");
  return saved ? JSON.parse(saved).map(Targets.migrateDay) : [];
}

function saveDayEntries(entries) {
  _cache.days = [...entries];
  lsSet("days", JSON.stringify(entries));
  bgWrite(async () => {
    if (entries.length === 0) {
      const { error } = await sb.from('days').delete().gte('id', 0);
      if (error) throw error;
      return;
    }
    const rows = entries.map(dayJsToRow);
    const { error: upErr } = await sb.from('days').upsert(rows);
    if (upErr) throw upErr; // table untouched — no rows deleted
    const ids = entries.map((e) => e.id);
    const { error: delErr } = await sb.from('days').delete().not('id', 'in', `(${ids.join(',')})`);
    if (delErr) throw delErr;
  });
}

// ============================================================
// INITIALIZE DATA — Supabase with localStorage fallback
// ============================================================

async function initFromSupabase() {
  const [foodRes, daysRes, profileRes, assessRes, settingsRes] = await Promise.all([
    sb.from('food_entries').select('*').order('date', { ascending: false }),
    sb.from('days').select('*').order('date', { ascending: false }),
    sb.from('profile').select('*').maybeSingle(),
    sb.from('assessments').select('*').order('timestamp', { ascending: false }),
    sb.from('settings').select('*'),
  ]);

  // Check for errors on critical tables
  if (foodRes.error) throw foodRes.error;
  if (daysRes.error) throw daysRes.error;
  if (profileRes.error) throw profileRes.error;

  const hasFoodData = foodRes.data && foodRes.data.length > 0;
  const hasDaysData = daysRes.data && daysRes.data.length > 0;
  const hasProfileData = profileRes.data != null;

  // Populate cache from Supabase data
  _cache.food = foodRes.data.map(foodRowToJs);
  _cache.profile = hasProfileData ? profileRowToJs(profileRes.data) : { ...DEFAULT_PROFILE };
  const _needSeed = _cache.profile.age == null || _cache.profile.weightLossGoal == null;
  _cache.profile = Targets.migrateProfile(_cache.profile, daysRes.data.map((r) => ({ age: r.age, deficit: r.deficit })));
  _cache.days = daysRes.data.map(dayRowToJs);
  _cache.assessments = (assessRes.data || []).map(r => r.data);

  // Settings (key-value pairs)
  _cache.settings = {};
  if (settingsRes.data) {
    for (const row of settingsRes.data) {
      _cache.settings[row.key] = row.value;
    }
  }

  // Sync back to localStorage as offline fallback. Only mirror the profile when the
  // cloud really has one — otherwise an offline relaunch would read the mirrored
  // DEFAULT_PROFILE placeholder and skip onboarding.
  lsSet("food", JSON.stringify(_cache.food));
  lsSet("days", JSON.stringify(_cache.days));
  if (hasProfileData) lsSet("profile", JSON.stringify(_cache.profile));
  else localStorage.removeItem(AuthView.nsKey(currentUid(), "profile"));
  lsSet("assessments", JSON.stringify(_cache.assessments));

  _cache.ready = true;
  _cache.profileMissing = !hasProfileData;
  if (_needSeed) saveProfile(_cache.profile); // persist only when age/goal were missing before seeding
  console.log('[Supabase] Loaded from cloud:', _cache.food.length, 'food entries,', _cache.days.length, 'days');
}

function initFromLocalStorage() {
  // Fallback: populate cache from localStorage (same as old behavior)
  const savedFood = lsGet("food");
  _cache.food = savedFood ? JSON.parse(savedFood).map(Macros.migrateEntry) : [];
  const savedDays = lsGet("days");
  const parsedDays = savedDays ? JSON.parse(savedDays) : [];
  const savedProfile = lsGet("profile");
  _cache.profile = savedProfile ? JSON.parse(savedProfile) : { ...DEFAULT_PROFILE };
  const _needSeed = _cache.profile.age == null || _cache.profile.weightLossGoal == null;
  _cache.profile = Targets.migrateProfile(_cache.profile, parsedDays);
  _cache.days = parsedDays.map(Targets.migrateDay);
  const savedAssessments = lsGet("assessments");
  _cache.assessments = savedAssessments ? JSON.parse(savedAssessments) : [];

  _cache.ready = true;
  _cache.profileMissing = !savedProfile;
  if (_needSeed) saveProfile(_cache.profile); // persist only when age/goal were missing before seeding
  console.log('[localStorage] Loaded from local storage (offline fallback)');
}

// ============================================================
// CALCULATIONS (match Excel formulas exactly)
// ============================================================

function calcBMR(weightLbs, heightCm, age) {
  // Mifflin-St Jeor (male): 10 * weight_kg + 6.25 * height_cm - 5 * age + 5
  return 10 * (weightLbs / 2.20462) + 6.25 * heightCm - 5 * age + 5;
}

function getActivityMultiplier(activityLabel) {
  const found = ACTIVITY_TYPES.find((a) => a.label === activityLabel);
  return found ? found.multiplier : 1.2;
}

function calcTDEE(bmr, activityLabel) {
  return bmr * getActivityMultiplier(activityLabel);
}

function getDailyFoodTotals(date, foodEntries) {
  const dayFoods = foodEntries.filter((f) => f.date === date);
  const cal = Macros.sumMacro(dayFoods, "calories");
  const pro = Macros.sumMacro(dayFoods, "protein");
  return {
    calLow: cal.low, calHigh: cal.high,
    proLow: pro.low, proHigh: pro.high,
    macro: (id) => Macros.sumMacro(dayFoods, id),
  };
}

// ============================================================
// RENDERING
// ============================================================

function formatDate(dateStr) {
  const [y, m, d] = dateStr.split("-");
  return `${m}-${d}-${y.slice(2)}`;
}

function formatTime(timeStr) {
  const [h, m] = timeStr.split(":");
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? "PM" : "AM";
  const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${h12}:${m} ${ampm}`;
}

function surplusClass(val) {
  if (val > 50) return "positive";
  if (val < -50) return "negative";
  return "neutral";
}

function proteinSurplusClass(val) {
  // For protein, surplus is good, deficit is bad (opposite of calories)
  if (val >= 0) return "positive-protein";
  return "negative";
}

function renderNum(val, decimals = 0) {
  if (val === null || val === undefined) return "";
  return Number(val).toFixed(decimals);
}

// ---- Food Eaten Table ----

function renderFoodTable() {
  const tbody = document.querySelector("#food-eaten-table tbody");
  const enabled = getEnabledMacros();
  const fmt = getValueFormat();
  const head = document.getElementById("food-eaten-head");
  if (head) {
    head.innerHTML = `<tr><th>Date</th><th>Time</th><th>Food</th><th>Qty</th><th>Unit</th>`
      + enabled.map((id) => `<th class="num">${escapeHtml(Macros.byId(id).label)}</th>`).join("")
      + `<th>Actions</th></tr>`;
  }
  const filterDate = document.getElementById("food-date-filter").value;
  let entries = loadFoodEntries();
  if (filterDate) entries = entries.filter((f) => f.date === filterDate);
  entries.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return a.time < b.time ? -1 : 1;
  });
  const groups = {};
  entries.forEach((e) => { (groups[e.date] ||= []).push(e); });
  const allEntries = loadFoodEntries();
  let html = "";
  const sortedDates = Object.keys(groups).sort((a, b) => (a < b ? 1 : -1));
  for (const date of sortedDates) {
    const items = groups[date];
    const totals = getDailyFoodTotals(date, allEntries);
    html += `<tr class="date-group-row"><td colspan="5">${formatDate(date)} - ${items.length} items</td>`
      + enabled.map((id) => `<td class="num">${Macros.formatMacro(totals.macro(id), fmt)}</td>`).join("")
      + `<td></td></tr>`;
    for (const entry of items) {
      html += `<tr>
        <td>${formatDate(entry.date)}</td>
        <td>${formatTime(entry.time)}</td>
        <td>${escapeHtml(entry.food)}</td>
        <td class="num">${entry.qty}</td>
        <td>${escapeHtml(entry.unit)}</td>`
        + enabled.map((id) => `<td class="num">${Macros.formatMacro(Macros.getMacro(entry, id), fmt)}</td>`).join("")
        + `<td><div class="actions">${statusBadge(entry)}<button class="btn-icon" onclick="editFood(${entry.id})" title="Edit">&#9998;</button><button class="btn-icon delete" onclick="deleteFood(${entry.id})" title="Delete">&#10005;</button></div></td>
      </tr>`;
    }
  }
  if (!entries.length) {
    html = `<tr><td colspan="${5 + enabled.length + 1}" style="text-align:center;color:var(--text-dim);padding:32px;">No food entries yet. Click "+ Add Food" to start tracking.</td></tr>`;
  }
  tbody.innerHTML = html;
  if (typeof renderFoodCards === "function") renderFoodCards();
}

function statusBadge(entry) {
  if (entry.estimateStatus === "pending") return `<span class="est-badge est-pending" title="Estimating…">…</span>`;
  if (entry.estimateStatus === "error") return `<button class="btn-icon est-badge est-error" onclick="retryEstimate(${entry.id})" title="Estimate failed — tap to retry">!</button>`;
  return "";
}
window.retryEstimate = function (id) {
  const entries = loadFoodEntries();
  const e = entries.find((x) => x.id === id);
  if (e) { e.estimateStatus = "pending"; saveFoodEntries(entries); renderFoodTable(); renderCalorieTracker(); enqueueEstimate(id); }
};

// ---- Calorie Tracker Table ----

function renderCalorieTracker() {
  const tbody = document.querySelector("#calorie-tracker-table tbody");
  const profile = loadProfile();
  const days = loadDayEntries();
  const food = loadFoodEntries();

  // Sort by date desc
  days.sort((a, b) => (a.date < b.date ? 1 : -1));

  const deficit = getDeficit();
  let html = "";
  for (const day of days) {
    const bmr = calcBMR(day.weight, profile.height, profile.age);
    const tdee = calcTDEE(bmr, day.activity);
    const target = tdee - deficit;
    const totals = getDailyFoodTotals(day.date, food);
    const surpLow = totals.calLow - target, surpHigh = totals.calHigh - target;
    const proSurpLow = totals.proLow - profile.proteinLow, proSurpHigh = totals.proHigh - profile.proteinHigh;
    html += `<tr class="day-summary">
      <td>${formatDate(day.date)}</td>
      <td class="num">${day.weight}</td>
      <td class="num">${renderNum(bmr, 1)}</td>
      <td>${escapeHtml(day.activity)}</td>
      <td class="num">${renderNum(tdee, 1)}</td>
      <td class="num">${renderNum(target, 0)}</td>
      <td class="num">${renderNum(totals.calLow, 1)}</td>
      <td class="num">${renderNum(totals.calHigh, 1)}</td>
      <td class="num ${surplusClass(surpLow)}">${renderNum(surpLow, 1)}</td>
      <td class="num ${surplusClass(surpHigh)}">${renderNum(surpHigh, 1)}</td>
      <td class="num">${renderNum(totals.proLow, 1)}</td>
      <td class="num">${renderNum(totals.proHigh, 1)}</td>
      <td class="num ${surplusClass(-proSurpLow)}">${renderNum(proSurpLow, 1)}</td>
      <td class="num ${surplusClass(-proSurpHigh)}">${renderNum(proSurpHigh, 1)}</td>
      <td><div class="actions">
        <button class="btn-icon" onclick="editDay(${day.id})" title="Edit">&#9998;</button>
        <button class="btn-icon delete" onclick="deleteDay(${day.id})" title="Delete">&#10005;</button>
      </div></td>
    </tr>`;
  }

  if (!days.length) {
    html = `<tr><td colspan="15" style="text-align:center;color:var(--text-dim);padding:32px;">Log food to start tracking days.</td></tr>`;
  }

  tbody.innerHTML = html;
  if (typeof renderDayCards === "function") renderDayCards();
}

// ---- Calorie Target Tables ----

function renderCalorieTarget() {
  // Activity table
  const actTbody = document.querySelector("#activity-table tbody");
  actTbody.innerHTML = ACTIVITY_TYPES.map(
    (a) => `<tr><td>${a.label}</td><td class="num">${a.multiplier.toFixed(3)}</td></tr>`
  ).join("");

  // Goals table
  const goalsTbody = document.querySelector("#goals-table tbody");
  goalsTbody.innerHTML = WEIGHT_LOSS_GOALS.map(
    (g) => `<tr><td>${g.goal}</td><td class="num">${g.daily}</td><td class="num">${g.weekly}</td></tr>`
  ).join("");

  // Profile form
  const profile = loadProfile();
  document.getElementById("profile-height").value = profile.height;
  document.getElementById("profile-protein-low").value = profile.proteinLow;
  document.getElementById("profile-protein-high").value = profile.proteinHigh;
  document.getElementById("profile-age").value = profile.age != null ? profile.age : 32;
  const _goalSel = document.getElementById("profile-goal");
  if (_goalSel) _goalSel.innerHTML = Targets.GOALS.map((g) => `<option value="${escapeHtml(g.goal)}" ${profile.weightLossGoal === g.goal ? "selected" : ""}>${escapeHtml(g.goal)}</option>`).join("");
}

// ============================================================
// FOOD CRUD
// ============================================================


let _foodEditOriginal = null;

function showFoodPane(name) {
  document.querySelectorAll("#food-modal-tabs .modal-tab").forEach((t) => t.classList.toggle("active", t.dataset.pane === name));
  document.querySelectorAll("#food-modal .modal-pane").forEach((p) => p.classList.toggle("hidden", p.dataset.pane !== name));
}

function openFoodModal(entry) {
  const modal = document.getElementById("food-modal");
  document.getElementById("food-modal-title").textContent = entry ? "Edit Food Entry" : "Add Food Entry";
  document.getElementById("food-id").value = entry ? entry.id : "";
  document.getElementById("food-date").value = entry ? entry.date : new Date().toISOString().slice(0, 10);
  document.getElementById("food-time").value = entry ? entry.time : new Date().toTimeString().slice(0, 5);
  document.getElementById("food-name").value = entry ? entry.food : "";
  document.getElementById("food-qty").value = entry ? entry.qty : "";
  document.getElementById("food-unit").value = entry ? entry.unit : "";
  populateFoodSuggestions();
  _foodEditOriginal = entry ? { food: entry.food, qty: entry.qty, unit: entry.unit } : null;
  const tabs = document.getElementById("food-modal-tabs");
  if (entry) {
    tabs.classList.add("hidden");
  } else {
    tabs.classList.remove("hidden");
    document.getElementById("batch-date").value = new Date().toISOString().slice(0, 10);
    document.getElementById("batch-time").value = new Date().toTimeString().slice(0, 5);
    document.getElementById("batch-items").innerHTML = "";
    for (let i = 0; i < 3; i++) addBatchRow();
    populateBatchSuggestions();
  }
  showFoodPane("single");
  modal.classList.remove("hidden");
}

function populateFoodSuggestions() {
  const entries = loadFoodEntries();
  const foods = [...new Set(entries.map((e) => e.food))];
  const units = [...new Set(entries.map((e) => e.unit))];
  document.getElementById("food-suggestions").innerHTML = foods.map((f) => `<option value="${escapeHtml(f)}">`).join("");
  document.getElementById("unit-suggestions").innerHTML = units.map((u) => `<option value="${escapeHtml(u)}">`).join("");
}

function closeFoodModal() {
  document.getElementById("food-modal").classList.add("hidden");
}

function ensureDayExists(date) {
  const days = loadDayEntries();
  if (days.some((d) => d.date === date)) return;
  const sorted = [...days].sort((a, b) => (a.date < b.date ? 1 : -1));
  const prev = sorted[0];
  const maxId = days.length ? Math.max(...days.map((d) => d.id)) : 0;
  days.push({ id: maxId + 1, date, weight: prev ? prev.weight : 168, activity: prev ? prev.activity : ACTIVITY_TYPES[0].label });
  saveDayEntries(days);
}


function saveFood(e) {
  e.preventDefault();
  const entries = loadFoodEntries();
  const id = document.getElementById("food-id").value;
  const base = {
    date: document.getElementById("food-date").value,
    time: document.getElementById("food-time").value,
    food: document.getElementById("food-name").value,
    qty: parseFloat(document.getElementById("food-qty").value),
    unit: document.getElementById("food-unit").value,
  };
  let saved;
  if (id) {
    const idx = entries.findIndex((x) => x.id === parseInt(id));
    if (idx === -1) { console.warn("saveFood: entry not found for id", id); return; }
    saved = { ...entries[idx], ...base };
    if (Macros.needsReestimate(_foodEditOriginal, base)) { saved.macros = {}; saved.estimateStatus = "pending"; }
    entries[idx] = saved;
  } else {
    const maxId = entries.length ? Math.max(...entries.map((x) => x.id)) : 0;
    saved = { ...base, id: maxId + 1, macros: {}, estimateStatus: "pending" };
    entries.push(saved);
  }
  saveFoodEntries(entries);
  ensureDayExists(base.date);
  closeFoodModal();
  renderFoodTable();
  renderCalorieTracker();
  if (saved && saved.estimateStatus === "pending") enqueueEstimate(saved.id);
}

const _estimateQueue = [];
let _estimateRunning = false;

function enqueueEstimate(entryId) {
  if (_aiExhausted) {
    // Credit exhausted: the entry is already saved (manual logging untouched) —
    // don't burn a proxy call; mark it retryable and show the paywall instead.
    const entries = loadFoodEntries();
    const t = entries.find((e) => e.id === entryId);
    if (t && t.estimateStatus === "pending") {
      t.estimateStatus = "error";
      saveFoodEntries(entries);
      renderFoodTable(); renderCalorieTracker();
    }
    openPaywall();
    return;
  }
  if (!_estimateQueue.includes(entryId)) _estimateQueue.push(entryId);
  runEstimateQueue();
}
async function runEstimateQueue() {
  if (_estimateRunning) return;
  _estimateRunning = true;
  try {
    while (_estimateQueue.length) {
      const id = _estimateQueue.shift();
      const snapshot = loadFoodEntries();
      const entry = snapshot.find((e) => e.id === id);
      if (!entry || entry.estimateStatus !== "pending") continue;
      const ids = Macros.blankEnabled(entry, getEnabledMacros());
      if (!ids.length) {
        const fresh = loadFoodEntries();
        const t = fresh.find((e) => e.id === id);
        if (t) { t.estimateStatus = "manual"; saveFoodEntries(fresh); }
        continue;
      }
      let filled = null, errStatus = null;
      try {
        const est = await callAi("estimate", { food: entry.food, qty: entry.qty, unit: entry.unit });
        filled = est && est.macros ? est.macros : null;
      } catch (err) {
        errStatus = err && err.status;
        console.error("[AI] estimate failed:", err);
      }
      // Reload fresh AFTER the await so a concurrent user edit isn't overwritten.
      const fresh = loadFoodEntries();
      const t = fresh.find((e) => e.id === id);
      // Quota exhausted (402): every remaining attempt would fail the same way —
      // fail the rest of the queue without burning proxy calls, then show the
      // paywall once. 429 is transient, so it does NOT drain: remaining entries
      // keep their own attempts.
      const drained = errStatus === 402 ? _estimateQueue.splice(0, _estimateQueue.length) : [];
      for (const qid of drained) {
        const q = fresh.find((e) => e.id === qid);
        if (q && q.estimateStatus === "pending") q.estimateStatus = "error";
      }
      if (t) { // current entry may have been deleted while the estimate was in flight
        if (filled) {
          if (!t.macros) t.macros = {};
          for (const mid of ids) if (filled[mid]) t.macros[mid] = filled[mid];
          t.estimateStatus = ids.every((mid) => filled[mid]) ? "done" : "error";
        } else {
          t.estimateStatus = "error";
        }
      }
      if (t || drained.length) {
        saveFoodEntries(fresh);
        renderFoodTable(); renderCalorieTracker();
      }
      if (errStatus === 402 && typeof openPaywall === "function") openPaywall();
    }
  } finally { _estimateRunning = false; }
}
function resumePendingEstimates() {
  loadFoodEntries().filter((e) => e.estimateStatus === "pending").forEach((e) => enqueueEstimate(e.id));
}

window.editFood = function (id) {
  const entries = loadFoodEntries();
  const entry = entries.find((e) => e.id === id);
  if (entry) openFoodModal(entry);
};

window.deleteFood = function (id) {
  if (!confirm("Delete this food entry?")) return;
  let entries = loadFoodEntries();
  entries = entries.filter((e) => e.id !== id);
  saveFoodEntries(entries);
  renderFoodTable();
  renderCalorieTracker();
};

// ============================================================
// DAY CRUD
// ============================================================

function populateActivitySelect() {
  const select = document.getElementById("day-activity");
  select.innerHTML = ACTIVITY_TYPES.map(
    (a) => `<option value="${escapeHtml(a.label)}">${a.label}</option>`
  ).join("");
}

function openDayModal(entry) {
  const modal = document.getElementById("day-modal");
  document.getElementById("day-modal-title").textContent = "Edit Day";
  populateActivitySelect();
  document.getElementById("day-id").value = entry.id;
  document.getElementById("day-date").value = entry.date;
  document.getElementById("day-weight").value = entry.weight;
  document.getElementById("day-activity").value = entry.activity;
  modal.classList.remove("hidden");
}

function closeDayModal() {
  document.getElementById("day-modal").classList.add("hidden");
}

function saveDay(e) {
  e.preventDefault();
  const entries = loadDayEntries();
  const id = document.getElementById("day-id").value;
  const idx = entries.findIndex((x) => x.id === parseInt(id));
  if (idx === -1) { console.warn("saveDay: day not found", id); return; }
  entries[idx] = { ...entries[idx], weight: parseFloat(document.getElementById("day-weight").value), activity: document.getElementById("day-activity").value };
  saveDayEntries(entries);
  closeDayModal();
  renderCalorieTracker();
}

window.editDay = function (id) {
  const entries = loadDayEntries();
  const entry = entries.find((e) => e.id === id);
  if (entry) openDayModal(entry);
};

window.deleteDay = function (id) {
  if (!confirm("Delete this day entry?")) return;
  let entries = loadDayEntries();
  entries = entries.filter((e) => e.id !== id);
  saveDayEntries(entries);
  renderCalorieTracker();
};

// ============================================================
// PROFILE
// ============================================================

function saveProfileForm(e) {
  e.preventDefault();
  const profile = {
    height: parseFloat(document.getElementById("profile-height").value),
    age: parseInt(document.getElementById("profile-age").value),
    proteinLow: parseFloat(document.getElementById("profile-protein-low").value),
    proteinHigh: parseFloat(document.getElementById("profile-protein-high").value),
    weightLossGoal: document.getElementById("profile-goal").value,
  };
  saveProfile(profile);
  renderCalorieTracker();
  alert("Profile saved!");
}

// ============================================================
// UTILITIES
// ============================================================

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  // Also escape quotes so the result is safe inside double/single-quoted HTML attributes
  // (textContent→innerHTML escapes &,<,> but not quotes). Entities decode identically in
  // both attribute and text contexts, so this is safe for all existing callers.
  return div.innerHTML.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// ============================================================
// SETTINGS (key-value: _cache.settings + localStorage + Supabase)
// ============================================================

function getSetting(key, fallback) {
  if (_cache.settings[key] != null) return _cache.settings[key];
  const ls = localStorage.getItem(`nt_${key}`);
  return ls != null ? ls : fallback;
}
function setSetting(key, value) {
  const v = String(value);
  _cache.settings[key] = v;
  localStorage.setItem(`nt_${key}`, v);
  bgWrite(async () => {
    const { error } = await sb.from("settings").upsert({ key, value: v });
    if (error) throw error;
  });
}
// Macro-tracking settings
function getEnabledMacros() {
  const raw = getSetting("macros_enabled", null);
  try { return Macros.resolveEnabled(raw ? JSON.parse(raw) : null); }
  catch { return Macros.defaultEnabled(); }
}
function setEnabledMacros(ids) { setSetting("macros_enabled", JSON.stringify(Macros.resolveEnabled(ids))); }
function getValueFormat() { return getSetting("value_format", "single") === "range" ? "range" : "single"; }
function setValueFormat(fmt) { setSetting("value_format", fmt === "range" ? "range" : "single"); }
function getTheme() { const t = getSetting("theme", "dark"); return (t === "light" || t === "system") ? t : "dark"; }
function setTheme(t) { setSetting("theme", (t === "light" || t === "system") ? t : "dark"); }
function applyTheme() {
  const prefersLight = !!(window.matchMedia && matchMedia("(prefers-color-scheme: light)").matches);
  const eff = Theme.resolveTheme(getTheme(), prefersLight);
  document.documentElement.setAttribute("data-theme", eff);
  if (window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.StatusBar) {
    const bar = Theme.statusBarFor(eff);
    Capacitor.Plugins.StatusBar.setBackgroundColor({ color: bar.color }).catch(() => {});
    Capacitor.Plugins.StatusBar.setStyle({ style: bar.style }).catch(() => {});
  }
}

// --- AI estimation (via ai-proxy) ---

async function estimatePhoto(image, history) {
  // hint carries the same {priorItems, correction} object the correction loop builds (null on first read)
  const imageDataUrl = `data:${image.mimeType};base64,${image.base64}`;
  return callAi("photo", { imageDataUrl, hint: history }); // -> {items, ai_thought_process}
}

async function capturePhoto() {
  if (!(window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.Camera)) {
    alert("Camera is only available in the installed app.");
    return null;
  }
  try {
    // TODO: getPhoto is deprecated in @capacitor/camera v8; migrate to pickImages/pickMedia when upgrading to v9.
    const photo = await Capacitor.Plugins.Camera.getPhoto({
      quality: 70, resultType: "base64", source: "PROMPT", width: 1024, correctOrientation: true,
    });
    if (!photo || !photo.base64String) return null;
    return { base64: photo.base64String, mimeType: `image/${photo.format || "jpeg"}` };
  } catch (e) {
    return null; // user cancelled or denied permission — no-op
  }
}

// --- Photo capture modal ---

let _photoImage = null, _photoHistory = null, _photoItems = [];

function setPhotoStatus(msg, isErr) {
  const el = document.getElementById("photo-status");
  if (el) { el.textContent = msg || ""; el.classList.toggle("error", !!isErr); }
}
function openPhotoModal() {
  _photoItems = [];
  document.getElementById("photo-items").innerHTML = "";
  document.getElementById("photo-correct").classList.add("hidden");
  document.getElementById("photo-correct-text").value = "";
  document.getElementById("photo-confirm").disabled = true;
  setPhotoStatus("");
  document.getElementById("photo-modal").classList.remove("hidden");
}
function closePhotoModal() {
  _photoImage = null; _photoHistory = null; _photoItems = [];
  document.getElementById("photo-modal").classList.add("hidden");
}
function renderPhotoItems() {
  const fmt = getValueFormat();
  const host = document.getElementById("photo-items");
  if (!_photoItems.length) { host.innerHTML = `<p class="cards-empty">No foods detected. Add a correction or cancel.</p>`; document.getElementById("photo-confirm").disabled = true; return; }
  host.innerHTML = _photoItems.map((it, i) => `
    <div class="photo-item" data-idx="${i}">
      <input class="photo-item-food" data-idx="${i}" value="${escapeHtml(it.food)}">
      <input class="photo-item-portion" data-idx="${i}" value="${escapeHtml(it.portion)}">
      <div class="photo-item-macros">${getEnabledMacros().map((id) => `${escapeHtml(Macros.byId(id).label)} ${Macros.formatMacro(Macros.getMacro(it, id), fmt)}`).join(" · ")}</div>
    </div>`).join("");
  document.getElementById("photo-confirm").disabled = false;
  host.querySelectorAll(".photo-item-food").forEach((el) => el.addEventListener("input", (e) => { _photoItems[+e.target.dataset.idx].food = e.target.value; }));
  host.querySelectorAll(".photo-item-portion").forEach((el) => el.addEventListener("input", (e) => { _photoItems[+e.target.dataset.idx].portion = e.target.value; }));
}
async function runPhotoEstimate() {
  setPhotoStatus("Reading photo…");
  document.getElementById("photo-confirm").disabled = true;
  document.getElementById("photo-correct-submit").disabled = true;
  try {
    const { items } = await estimatePhoto(_photoImage, _photoHistory);
    // _photoItems is fully replaced by each estimate; inline edits made before a
    // Correct round-trip are intentionally discarded (the AI re-reads the photo).
    _photoItems = items;
    setPhotoStatus(items.length ? "" : "No foods detected.");
    renderPhotoItems();
  } catch (e) {
    setPhotoStatus((e && e.message) || "Couldn't read that photo — try again or add manually.", true);
    if (e && e.status === 402 && typeof openPaywall === "function") openPaywall();
  } finally {
    document.getElementById("photo-correct-submit").disabled = false;
  }
}
async function startPhotoCapture() {
  if (_aiExhausted) { openPaywall(); return; }
  if (!document.getElementById("photo-modal").classList.contains("hidden")) return; // already open
  const image = await capturePhoto();
  if (!image) return;
  _photoImage = image; _photoHistory = null;
  openPhotoModal();
  await runPhotoEstimate();
}
function confirmPhotoItems() {
  document.getElementById("photo-confirm").disabled = true;
  const entries = loadFoodEntries();
  const maxId = entries.length ? Math.max(...entries.map((e) => e.id)) : 0;
  const now = new Date();
  const date = now.toISOString().slice(0, 10), time = now.toTimeString().slice(0, 5);
  const created = PhotoEstimate.itemsToEntries(_photoItems, date, time, maxId + 1);
  if (!created.length) return;
  saveFoodEntries([...entries, ...created]);
  ensureDayExists(date);
  closePhotoModal();
  renderFoodTable(); renderCalorieTracker();
}

// --- Settings UI ---

function renderAccountSettings() {
  const host = document.getElementById("account-settings");
  if (!host) return;
  const email = _authUser && _authUser.email ? _authUser.email : "(unknown)";
  host.innerHTML = `<div class="settings-card">
    <h2>Account</h2>
    <p style="color:var(--text-dim);margin:0 0 12px;">Signed in as <b style="color:var(--text)">${escapeHtml(email)}</b></p>
    <button id="sign-out-btn" class="btn btn-secondary">Sign out</button>
  </div>`;
  document.getElementById("sign-out-btn").addEventListener("click", signOut);
}

async function signOut() {
  // Capture identity up front: sb.auth.signOut() emits SIGNED_OUT (nulling
  // _authUser) BEFORE it resolves, so currentUid() is null in the finally.
  const uid = currentUid();
  const wipe = () => { for (const b of CACHE_BASES) localStorage.removeItem(AuthView.nsKey(uid, b)); };
  _estimateQueue.length = 0;   // stop in-flight estimate follow-ups
  wipe();                      // wipe this user's offline cache before identity flips
  try { await sb.auth.signOut(); }
  catch (e) { console.error("[Auth] signOut:", e); }
  finally { wipe(); location.reload(); } // re-clear: catch writes that raced the network call
}

function renderMacroSettings() {
  const c = document.getElementById("macro-settings");
  if (!c) return;
  const enabled = new Set(getEnabledMacros());
  const fmt = getValueFormat();
  let html = '<div class="settings-card"><h2>Macros &amp; display</h2>';
  html += '<h3 class="provider-name">Macros to track</h3><div class="macro-toggle-list">';
  for (const m of Macros.CATALOG) {
    const checked = enabled.has(m.id) ? "checked" : "";
    const lock = m.locked ? "disabled" : "";
    html += `<label class="macro-toggle"><input type="checkbox" data-macro="${escapeHtml(m.id)}" ${checked} ${lock}> ${escapeHtml(m.label)} <span class="macro-unit">(${escapeHtml(m.unit)})</span></label>`;
  }
  html += "</div>";
  html += `<div class="form-row"><label>Value format</label><select id="set-value-format">
    <option value="single" ${fmt === "single" ? "selected" : ""}>Single value</option>
    <option value="range" ${fmt === "range" ? "selected" : ""}>Low–high range</option></select></div>`;
  const _theme = getTheme();
  html += `<div class="form-row"><label>Theme</label><select id="set-theme">
    <option value="dark" ${_theme === "dark" ? "selected" : ""}>Dark</option>
    <option value="light" ${_theme === "light" ? "selected" : ""}>Light</option>
    <option value="system" ${_theme === "system" ? "selected" : ""}>System</option></select></div>`;
  html += "</div>";
  c.innerHTML = html;

  c.querySelectorAll("input[data-macro]").forEach((cb) => cb.addEventListener("change", () => {
    const ids = [...c.querySelectorAll("input[data-macro]:checked")].map((x) => x.dataset.macro);
    setEnabledMacros(ids);
    renderFoodTable();
  }));
  c.querySelector("#set-value-format").addEventListener("change", (e) => { setValueFormat(e.target.value); renderFoodTable(); });
  const _ts = c.querySelector("#set-theme");
  if (_ts) _ts.addEventListener("change", (e) => { setTheme(e.target.value); applyTheme(); });
}

// ============================================================
// DIET ASSESSMENT
// ============================================================

// --- Data Aggregation ---

function getDateRangeForPeriod(period) {
  // Exclude today — the current day's data is incomplete (meals still pending)
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);

  if (period === "today") return { startDate: yesterdayStr, endDate: yesterdayStr };
  if (period === "week") {
    const d = new Date(); d.setDate(d.getDate() - 7);
    return { startDate: d.toISOString().slice(0, 10), endDate: yesterdayStr };
  }
  if (period === "month") {
    const d = new Date(); d.setDate(d.getDate() - 30);
    return { startDate: d.toISOString().slice(0, 10), endDate: yesterdayStr };
  }
  if (period === "quarter") {
    const d = new Date(); d.setDate(d.getDate() - 90);
    return { startDate: d.toISOString().slice(0, 10), endDate: yesterdayStr };
  }
  if (period === "semi") {
    const d = new Date(); d.setDate(d.getDate() - 180);
    return { startDate: d.toISOString().slice(0, 10), endDate: yesterdayStr };
  }
  if (period === "year") {
    const d = new Date(); d.setDate(d.getDate() - 365);
    return { startDate: d.toISOString().slice(0, 10), endDate: yesterdayStr };
  }
  if (period === "custom") {
    const from = document.getElementById("assessment-date-from")?.value;
    const to = document.getElementById("assessment-date-to")?.value;
    if (from && to) return { startDate: from, endDate: to };
  }
  // fallback
  const d = new Date(); d.setDate(d.getDate() - 7);
  return { startDate: d.toISOString().slice(0, 10), endDate: yesterdayStr };
}

function buildRangeData(foodEntries, dayEntries, profile, startDate, endDate) {
  const filteredFood = foodEntries.filter(f => f.date >= startDate && f.date <= endDate);
  const filteredDays = dayEntries.filter(d => d.date >= startDate && d.date <= endDate);

  const foodByDate = {};
  filteredFood.forEach(f => {
    if (!foodByDate[f.date]) foodByDate[f.date] = [];
    foodByDate[f.date].push(f);
  });

  const dates = Object.keys(foodByDate).sort();
  const numDays = dates.length || 1;

  const _calTotal = Macros.sumMacro(filteredFood, "calories");
  const _proTotal = Macros.sumMacro(filteredFood, "protein");
  let totalCalLow = _calTotal.low, totalCalHigh = _calTotal.high, totalProLow = _proTotal.low, totalProHigh = _proTotal.high;

  // Per-day calorie context (TDEE varies by activity)
  const dailyContext = {};
  let avgProTargetLow = null, avgProTargetHigh = null;
  if (filteredDays.length > 0) {
    let totalProTLow = 0, totalProTHigh = 0;
    const deficit = getDeficit();
    filteredDays.forEach(day => {
      const bmr = calcBMR(day.weight, profile.height, profile.age);
      const tdee = calcTDEE(bmr, day.activity);
      const target = tdee - deficit;
      dailyContext[day.date] = {
        activity: day.activity,
        tdee: Math.round(tdee),
        deficit: deficit,
        calorieTarget: Math.round(target),
      };
      totalProTLow += profile.proteinLow;
      totalProTHigh += profile.proteinHigh;
    });
    avgProTargetLow = Math.round(totalProTLow / filteredDays.length);
    avgProTargetHigh = Math.round(totalProTHigh / filteredDays.length);
  }

  return {
    startDate, endDate, dates, numDays,
    totalEntries: filteredFood.length,
    foodByDate, dailyContext,
    totalCalLow, totalCalHigh, totalProLow, totalProHigh,
    avgCalLow: Math.round(totalCalLow / numDays),
    avgCalHigh: Math.round(totalCalHigh / numDays),
    avgProLow: Math.round((totalProLow / numDays) * 10) / 10,
    avgProHigh: Math.round((totalProHigh / numDays) * 10) / 10,
    avgProTargetLow, avgProTargetHigh,
  };
}

function getAssessmentData(period) {
  const foodEntries = loadFoodEntries();
  const dayEntries = loadDayEntries();
  const profile = loadProfile();

  if (period === "yoy") {
    // Year over Year: current year vs previous year (same calendar dates)
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    const janFirst = `${today.getFullYear()}-01-01`;
    const prevYearStart = `${today.getFullYear() - 1}-01-01`;
    const prevYearEnd = `${today.getFullYear() - 1}-12-31`;

    const currentYear = buildRangeData(foodEntries, dayEntries, profile, janFirst, todayStr);
    const previousYear = buildRangeData(foodEntries, dayEntries, profile, prevYearStart, prevYearEnd);

    return {
      period: "yoy",
      isYoY: true,
      currentYear: { ...currentYear, label: `${today.getFullYear()} (Jan 1 - today)` },
      previousYear: { ...previousYear, label: `${today.getFullYear() - 1}` },
      // Use current year as the main data for the AI prompt
      startDate: janFirst,
      endDate: todayStr,
      dates: currentYear.dates,
      numDays: currentYear.numDays,
      totalEntries: currentYear.totalEntries,
      foodByDate: currentYear.foodByDate,
      dailyContext: currentYear.dailyContext,
      avgCalLow: currentYear.avgCalLow, avgCalHigh: currentYear.avgCalHigh,
      avgProLow: currentYear.avgProLow, avgProHigh: currentYear.avgProHigh,
      avgProTargetLow: currentYear.avgProTargetLow,
      avgProTargetHigh: currentYear.avgProTargetHigh,
      totalCalLow: currentYear.totalCalLow, totalCalHigh: currentYear.totalCalHigh,
      totalProLow: currentYear.totalProLow, totalProHigh: currentYear.totalProHigh,
    };
  }

  const { startDate, endDate } = getDateRangeForPeriod(period);
  const rangeData = buildRangeData(foodEntries, dayEntries, profile, startDate, endDate);
  return { period, ...rangeData };
}

// --- Response parsing (raw model texts arrive from the ai-proxy) ---

function parseAssessmentResponse(content) {
  const cleaned = content.trim().replace(/```json?\s*/g, "").replace(/```/g, "").trim();
  return JSON.parse(cleaned);
}

// --- Agreement Check ---

function checkAssessmentAgreement(data1, data2) {
  const categories = [];

  // Calorie status
  categories.push({
    name: "Calorie Status",
    a: data1.calorie_assessment?.status,
    b: data2.calorie_assessment?.status,
  });

  // Protein status
  categories.push({
    name: "Protein Status",
    a: data1.protein_assessment?.status,
    b: data2.protein_assessment?.status,
  });

  // Food groups
  const foodGroupKeys = ["fruits", "vegetables", "whole_grains", "lean_protein", "dairy_calcium", "healthy_fats"];
  for (const key of foodGroupKeys) {
    const label = key.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
    categories.push({
      name: label,
      a: data1.food_groups?.[key]?.status,
      b: data2.food_groups?.[key]?.status,
    });
  }

  // Fiber status
  categories.push({
    name: "Fiber",
    a: data1.fiber_assessment?.status,
    b: data2.fiber_assessment?.status,
  });

  let disagreements = 0;
  for (const cat of categories) {
    cat.agree = cat.a === cat.b;
    if (!cat.agree) disagreements++;
  }

  const total = categories.length;
  const disagreementRate = disagreements / total;

  return {
    categories,
    disagreements,
    total,
    disagreementRate,
    needsEscalation: disagreementRate > 0.3,
  };
}

// --- Merge / Average Results ---

function averageAssessmentScores(results) {
  const n = results.length;
  if (n === 0) return null;
  if (n === 1) return results[0];

  const avg = (field, ...paths) => {
    let sum = 0;
    for (const r of results) {
      let val = r;
      for (const p of paths) val = val?.[p];
      sum += Number(val) || 0;
    }
    return Math.round((sum / n) * 10) / 10;
  };

  // Use first result as template, average numeric scores
  const merged = JSON.parse(JSON.stringify(results[0]));
  merged.overall_score = Math.round(results.reduce((s, r) => s + (r.overall_score || 0), 0) / n);
  if (merged.calorie_assessment) merged.calorie_assessment.score = avg("calorie_assessment", "score");
  if (merged.protein_assessment) merged.protein_assessment.score = avg("protein_assessment", "score");

  const foodGroupKeys = ["fruits", "vegetables", "whole_grains", "lean_protein", "dairy_calcium", "healthy_fats"];
  for (const key of foodGroupKeys) {
    if (merged.food_groups?.[key]) {
      merged.food_groups[key].score = avg("food_groups", key, "score");
      merged.food_groups[key].servings_estimated = avg("food_groups", key, "servings_estimated");
    }
  }

  if (merged.fiber_assessment) {
    merged.fiber_assessment.estimated_daily_g = avg("fiber_assessment", "estimated_daily_g");
  }

  // Merge suggestions (dedupe by food name)
  const allSuggestions = results.flatMap(r => r.suggestions || []);
  const seen = new Set();
  merged.suggestions = allSuggestions.filter(s => {
    const key = s.food?.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Merge concerns (dedupe)
  const allConcerns = results.flatMap(r => r.concerns || []);
  merged.concerns = [...new Set(allConcerns)];

  // Merge positives (dedupe)
  const allPositives = results.flatMap(r => r.positive_observations || []);
  merged.positive_observations = [...new Set(allPositives)];

  return merged;
}

// --- Main Flow ---
// Round 1 is ONE proxy call that fans out to both models server-side and
// returns their raw texts as { a, b }. Each side is parsed exactly like the
// old per-provider path, so the result objects (and everything downstream:
// agreement check, merging, renderers, saved history) keep the same shape.

function assessResultFromRaw(id, name, model, raw) {
  const base = { providerId: id, providerName: name, model };
  if (typeof raw !== "string" || !raw.trim()) return { ...base, data: null, error: "no answer from the model" };
  try { return { ...base, data: parseAssessmentResponse(raw), error: null }; }
  catch (e) { return { ...base, data: null, error: "unreadable model response" }; }
}

async function runDietAssessment() {
  if (_aiExhausted) { openPaywall(); return; }
  const period = document.getElementById("assessment-period").value;
  const data = getAssessmentData(period);

  if (data.totalEntries === 0) {
    setAssessmentStatus("No food entries found for this period. Add food entries first.", true);
    return;
  }

  // The proxy caps assess payloads at 250k chars of JSON — refuse early instead of burning a call.
  if (JSON.stringify({ data }).length > 250000) {
    setAssessmentStatus("Too much data for a single assessment — try a shorter period.", true);
    return;
  }

  const btn = document.getElementById("run-assessment-btn");
  btn.disabled = true;
  setAssessmentStatus("Analyzing your diet...");
  document.getElementById("assessment-results").innerHTML = "";

  renderAssessmentDataSummary(data);

  try {
    // --- Round 1 ---
    const r1 = await callAi("assess-round1", { data });
    const round1Results = [
      assessResultFromRaw("model-a", "Model A", "round 1", r1 && r1.a),
      assessResultFromRaw("model-b", "Model B", "round 1", r1 && r1.b),
    ];
    const successful = round1Results.filter(r => r.data !== null);
    const failed = round1Results.filter(r => r.error !== null);

    if (successful.length === 0) {
      const errMsgs = failed.map(f => `${f.providerName}: ${f.error}`).join("; ");
      setAssessmentStatus(`Analysis failed — ${errMsgs}. Try again.`, true);
      return;
    }

    const dataSummary = { startDate: data.startDate, endDate: data.endDate, numDays: data.numDays, totalEntries: data.totalEntries, avgCalLow: data.avgCalLow, avgCalHigh: data.avgCalHigh };

    // Only one usable analysis — no cross-validation possible
    if (successful.length === 1) {
      const warning = `${failed[0].providerName} failed. Using ${successful[0].providerName} only.`;
      const resultObj = {
        timestamp: new Date().toISOString(), period, dataSummary,
        round: 1, round1: successful, failed,
        final: successful[0].data, verdict: "single", warning,
      };
      renderAssessmentResults(resultObj);
      saveAssessment(resultObj);
      renderAssessmentHistory();
      setAssessmentStatus("Done!");
      return;
    }

    // Two analyses — check agreement
    const agreement = checkAssessmentAgreement(successful[0].data, successful[1].data);

    // Round 2 reconciles the two RAW Round-1 texts; the server rejects the call
    // unless BOTH are present — the old "need two analyses to reconcile" rule.
    const canReconcile = typeof r1.a === "string" && typeof r1.b === "string";

    if (!agreement.needsEscalation || !canReconcile) {
      const merged = averageAssessmentScores(successful.map(r => r.data));
      const resultObj = {
        timestamp: new Date().toISOString(), period, dataSummary,
        round: 1, round1: successful, failed, agreement,
        final: merged, verdict: "consensus",
      };
      renderAssessmentResults(resultObj);
      saveAssessment(resultObj);
      renderAssessmentHistory();
      setAssessmentStatus("Done!");
      return;
    }

    // --- Round 2: debiased re-evaluation (one proxy call, both models) ---
    setAssessmentStatus(`Models disagreed on ${agreement.disagreements}/${agreement.total} categories — re-evaluating...`);

    let r2 = null, r2CallError = null;
    try {
      r2 = await callAi("assess-round2", { round1A: r1.a, round1B: r1.b, data });
    } catch (err) {
      r2CallError = err;
      if (err && err.status === 402) openPaywall();
    }

    const round2Results = r2 ? [
      assessResultFromRaw("model-a", "Model A", "round 2", r2.a),
      assessResultFromRaw("model-b", "Model B", "round 2", r2.b),
    ] : [];
    const r2Successful = round2Results.filter(r => r.data !== null);
    const r2Failed = round2Results.filter(r => r.error !== null);

    if (r2Successful.length === 0) {
      // Round 2 failed entirely — fall back to the Round 1 average.
      const merged = averageAssessmentScores(successful.map(r => r.data));
      const resultObj = {
        timestamp: new Date().toISOString(), period, dataSummary,
        round: 1, round1: successful, failed, agreement,
        final: merged, verdict: "r2_failed",
      };
      renderAssessmentResults(resultObj);
      saveAssessment(resultObj);
      renderAssessmentHistory();
      const detail = r2CallError && r2CallError.message ? ` (${r2CallError.message})` : "";
      setAssessmentStatus(`Round 2 failed${detail} — using Round 1 average.`, true);
      return;
    }

    const r2Merged = averageAssessmentScores(r2Successful.map(r => r.data));
    const r2Agreement = r2Successful.length >= 2 ? checkAssessmentAgreement(r2Successful[0].data, r2Successful[1].data) : null;

    const resultObj = {
      timestamp: new Date().toISOString(), period, dataSummary,
      round: 2, round1: successful, round2: r2Successful, failed, r2Failed,
      agreement, r2Agreement,
      final: r2Merged, verdict: "reconciled",
    };
    renderAssessmentResults(resultObj);
    saveAssessment(resultObj);
    renderAssessmentHistory();
    setAssessmentStatus("Done!");
  } catch (err) {
    setAssessmentStatus((err && err.message) || "Something went wrong with the AI service.", true);
    if (err && err.status === 402) openPaywall();
  } finally {
    btn.disabled = false;
  }
}

function setAssessmentStatus(msg, isError = false) {
  const el = document.getElementById("assessment-status");
  if (!el) return;
  el.textContent = msg;
  el.className = "estimate-status" + (isError ? " error" : "");
}

// --- Rendering ---

function renderAssessmentDataSummary(data) {
  const container = document.getElementById("assessment-data-summary");
  if (!container) return;

  let html = '<div class="assessment-meta">';
  html += `<span class="meta-pill"><strong>${data.startDate}</strong> to <strong>${data.endDate}</strong></span>`;
  html += `<span class="meta-pill"><strong>${data.numDays}</strong> days</span>`;
  html += `<span class="meta-pill"><strong>${data.totalEntries}</strong> food entries</span>`;
  html += '</div>';

  // Per-day TDEE table (if calorie tracker data exists)
  const ctxDates = Object.keys(data.dailyContext || {}).sort();
  if (ctxDates.length > 0) {
    html += '<table class="assessment-summary-table"><thead><tr>';
    html += '<th>Date</th><th>Activity</th><th>TDEE</th><th>Target</th><th>Eaten</th><th>vs Target</th><th>vs TDEE</th>';
    html += '</tr></thead><tbody>';
    for (const date of ctxDates) {
      const ctx = data.dailyContext[date];
      const dayFoods = data.foodByDate[date] || [];
      const _eat = Macros.sumMacro(dayFoods, "calories");
      const eatLow = Math.round(_eat.low);
      const eatHigh = Math.round(_eat.high);

      // vs Target: how close to the deficit goal (small numbers = on track)
      const vtLow = eatLow - ctx.calorieTarget;
      const vtHigh = eatHigh - ctx.calorieTarget;
      const vtClass = vtHigh < -50 ? "negative" : vtLow > 50 ? "positive" : "neutral";

      // vs TDEE: actual surplus/deficit (negative = losing weight)
      const tdLow = eatLow - ctx.tdee;
      const tdHigh = eatHigh - ctx.tdee;
      const tdClass = tdHigh < -50 ? "negative" : tdLow > 50 ? "positive" : "neutral";

      const fmtRange = (lo, hi) => {
        if (lo === hi) return `${lo > 0 ? '+' : ''}${lo}`;
        return `${lo > 0 ? '+' : ''}${lo} to ${hi > 0 ? '+' : ''}${hi}`;
      };

      html += `<tr>
        <td>${formatDate(date)}</td>
        <td>${escapeHtml(ctx.activity)}</td>
        <td class="num">${ctx.tdee}</td>
        <td class="num">${ctx.calorieTarget}</td>
        <td class="num">${eatLow === eatHigh ? eatLow : eatLow + '-' + eatHigh}</td>
        <td class="num ${vtClass}">${fmtRange(vtLow, vtHigh)}</td>
        <td class="num ${tdClass}">${fmtRange(tdLow, tdHigh)}</td>
      </tr>`;
    }
    html += '</tbody></table>';
  }

  // Averages summary
  if (data.isYoY && data.previousYear) {
    const py = data.previousYear;
    html += '<table class="assessment-summary-table"><thead><tr>';
    html += '<th>Metric</th><th>Current Year (Daily Avg)</th><th>Previous Year (Daily Avg)</th></tr></thead><tbody>';
    html += `<tr><td>Calories eaten</td><td class="num">${data.avgCalLow}-${data.avgCalHigh} kcal</td><td class="num">${py.totalEntries > 0 ? py.avgCalLow + '-' + py.avgCalHigh + ' kcal' : 'No data'}</td></tr>`;
    html += `<tr><td>Protein</td><td class="num">${data.avgProLow}-${data.avgProHigh} g</td><td class="num">${py.totalEntries > 0 ? py.avgProLow + '-' + py.avgProHigh + ' g' : 'No data'}</td></tr>`;
    html += `<tr><td>Days Tracked</td><td class="num">${data.numDays}</td><td class="num">${py.numDays}</td></tr>`;
    html += `<tr><td>Food Entries</td><td class="num">${data.totalEntries}</td><td class="num">${py.totalEntries}</td></tr>`;
    html += '</tbody></table>';
  } else if (ctxDates.length === 0) {
    // No calorie tracker data — just show averages
    html += '<table class="assessment-summary-table"><thead><tr>';
    html += '<th>Metric</th><th>Daily Avg</th><th>Target</th></tr></thead><tbody>';
    html += `<tr><td>Calories eaten</td><td class="num">${data.avgCalLow}-${data.avgCalHigh} kcal</td><td class="num">N/A</td></tr>`;
    html += `<tr><td>Protein</td><td class="num">${data.avgProLow}-${data.avgProHigh} g</td><td class="num">${data.avgProTargetLow ? data.avgProTargetLow + '-' + data.avgProTargetHigh + ' g' : 'N/A'}</td></tr>`;
    html += '</tbody></table>';
  }

  // Collapsible food log
  html += '<details class="food-log-details"><summary class="food-log-toggle">View complete food log sent to AI</summary>';
  html += '<div class="food-log-content">';
  const sortedDates = data.dates.sort();
  for (const date of sortedDates) {
    html += `<div class="food-log-date">${formatDate(date)}</div>`;
    html += '<div class="food-log-items">';
    for (const item of data.foodByDate[date]) {
      html += `${formatTime(item.time)} - ${escapeHtml(item.food)}, ${item.qty} ${escapeHtml(item.unit)}<br>`;
    }
    html += '</div>';
  }
  html += '</div></details>';

  container.innerHTML = html;
}

function getScoreClass(score) {
  if (score >= 7) return "score-good";
  if (score >= 4) return "score-ok";
  return "score-bad";
}

function statusCssClass(status) {
  // Convert "on_target" or "critically_low" to "on-target" / "critically-low" for CSS
  return (status || "").replace(/_/g, "-");
}

function statusDisplayText(status) {
  // Convert "on_target" or "critically_low" to "On Target" / "Critically Low" for display
  if (!status) return "N/A";
  return status.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function getStatusBadgeClass(status) {
  if (!status) return "badge-dim";
  const s = status.toLowerCase();
  if (["excellent", "good", "adequate", "on_target"].includes(s)) return "badge-green";
  if (["low", "deficit", "deficient"].includes(s)) return "badge-yellow";
  if (["critically_low"].includes(s)) return "badge-yellow";
  if (["missing", "surplus"].includes(s)) return "badge-red";
  return "badge-dim";
}

function renderScoreBar(label, score) {
  const cls = getScoreClass(score);
  const pct = (score / 10) * 100;
  return `<div class="score-bar-container">
    <span class="score-bar-label">${escapeHtml(label)}</span>
    <div class="score-bar-track"><div class="score-bar ${cls}" style="width:${pct}%"></div></div>
    <span class="score-value ${cls}">${score}/10</span>
  </div>`;
}

function renderSingleAssessment(providerResult) {
  const d = providerResult.data;
  if (!d) return '<div class="assessment-card"><p>No data</p></div>';

  let html = '';

  // Overall score
  html += renderScoreBar("Overall", d.overall_score || 0);

  // Calorie assessment
  if (d.calorie_assessment) {
    html += '<div class="assessment-section">';
    html += '<div class="assessment-section-title">Calories</div>';
    html += renderScoreBar("Score", d.calorie_assessment.score || 0);
    html += `<span class="assessment-status-badge status-${statusCssClass(d.calorie_assessment.status)}">${statusDisplayText(d.calorie_assessment.status)}</span> `;
    html += `<span style="font-size:0.82rem">${escapeHtml(d.calorie_assessment.summary || "")}</span>`;
    html += '</div>';
  }

  // Protein assessment
  if (d.protein_assessment) {
    html += '<div class="assessment-section">';
    html += '<div class="assessment-section-title">Protein</div>';
    html += renderScoreBar("Score", d.protein_assessment.score || 0);
    html += `<span class="assessment-status-badge status-${statusCssClass(d.protein_assessment.status)}">${statusDisplayText(d.protein_assessment.status)}</span> `;
    html += `<span style="font-size:0.82rem">${escapeHtml(d.protein_assessment.summary || "")}</span>`;
    html += '</div>';
  }

  // Food groups table
  if (d.food_groups) {
    html += '<div class="assessment-section">';
    html += '<div class="assessment-section-title">Food Groups</div>';
    html += '<table class="food-group-table"><thead><tr><th>Group</th><th>Score</th><th>Est. Servings</th><th>Recommended</th><th>Status</th></tr></thead><tbody>';
    const groups = ["fruits", "vegetables", "whole_grains", "lean_protein", "dairy_calcium", "healthy_fats"];
    for (const key of groups) {
      const g = d.food_groups[key];
      if (!g) continue;
      const label = key.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
      html += `<tr>
        <td>${label}</td>
        <td><span class="score-badge ${getScoreClass(g.score)}">${g.score}</span></td>
        <td class="num">${g.servings_estimated ?? "-"}</td>
        <td class="num">${g.recommended ?? "-"}</td>
        <td><span class="assessment-status-badge status-${statusCssClass(g.status)}">${statusDisplayText(g.status)}</span></td>
      </tr>`;
    }
    html += '</tbody></table></div>';
  }

  // Fiber assessment
  if (d.fiber_assessment) {
    html += '<div class="assessment-section">';
    html += '<div class="assessment-section-title">Fiber</div>';
    html += `<span style="font-size:0.82rem">Est. ${d.fiber_assessment.estimated_daily_g}g/day (recommended: ${d.fiber_assessment.recommended_daily_g}g)</span> `;
    html += `<span class="assessment-status-badge status-${statusCssClass(d.fiber_assessment.status)}">${statusDisplayText(d.fiber_assessment.status)}</span>`;
    html += '</div>';
  }

  // Concerns
  if (d.concerns && d.concerns.length > 0) {
    html += '<div class="assessment-section">';
    html += '<div class="assessment-section-title">Concerns</div>';
    html += '<ul class="assessment-list concerns-list">';
    for (const c of d.concerns) html += `<li>${escapeHtml(c)}</li>`;
    html += '</ul></div>';
  }

  // Suggestions
  if (d.suggestions && d.suggestions.length > 0) {
    html += '<div class="assessment-section">';
    html += '<div class="assessment-section-title">Suggestions</div>';
    html += '<ul class="assessment-list suggestions-list">';
    for (const s of d.suggestions) {
      html += `<li><strong>${escapeHtml(s.food || "")}</strong> — ${escapeHtml(s.reason || "")}`;
      if (s.when) html += `<span class="suggestion-when">(${escapeHtml(s.when)})</span>`;
      html += '</li>';
    }
    html += '</ul></div>';
  }

  // Positive observations
  if (d.positive_observations && d.positive_observations.length > 0) {
    html += '<div class="assessment-section">';
    html += '<div class="assessment-section-title">Positive Observations</div>';
    html += '<ul class="assessment-list positive-list">';
    for (const p of d.positive_observations) html += `<li>${escapeHtml(p)}</li>`;
    html += '</ul></div>';
  }

  // Reasoning
  if (d.reasoning) {
    html += '<div class="reasoning-block"><details>';
    html += `<summary class="reasoning-toggle">AI Reasoning</summary>`;
    html += `<div class="reasoning-text">${escapeHtml(d.reasoning)}</div>`;
    html += '</details></div>';
  }

  return html;
}

function renderActionPlan(assessmentData) {
  const ap = assessmentData?.action_plan;
  if (!ap) return '';

  let html = '<div class="action-plan" id="action-plan-printable">';
  html += '<div class="action-plan-header">';
  html += '<div class="action-plan-title">Weekly Action Plan</div>';
  html += '<button class="btn btn-secondary btn-print" onclick="printActionPlan()">Print / Save PDF</button>';
  html += '</div>';

  // Daily targets table
  if (ap.daily_targets && ap.daily_targets.length > 0) {
    html += '<div class="action-plan-section">';
    html += '<div class="action-plan-subtitle">Daily Serving Gaps</div>';
    html += '<table class="action-plan-table daily-targets-table"><thead><tr><th>Food Group</th><th>Current</th><th>Target</th><th>Gap</th><th>What to Add</th></tr></thead><tbody>';
    for (const t of ap.daily_targets) {
      const gap = Math.max(0, (t.target || 0) - (t.current || 0));
      html += `<tr>
        <td>${escapeHtml(t.group || "")}</td>
        <td class="num">${t.current ?? 0}</td>
        <td class="num">${t.target ?? 0}</td>
        <td class="num gap-cell">+${gap.toFixed(1)}</td>
        <td>${escapeHtml(t.add || "")}</td>
      </tr>`;
    }
    html += '</tbody></table></div>';
  }

  // Grocery checklist — What to Add (categorized with checkboxes)
  if (ap.grocery_add && ap.grocery_add.length > 0) {
    html += '<div class="action-plan-section">';
    html += '<div class="action-plan-subtitle">Grocery Checklist — What to Add</div>';
    html += '<p class="grocery-hint">Pick items from each category to meet your weekly targets. Mix and match for variety!</p>';
    html += '<div class="grocery-grid">';
    for (const cat of ap.grocery_add) {
      html += '<div class="grocery-category grocery-category-add">';
      html += `<div class="grocery-category-header">`;
      html += `<div class="grocery-category-name">${escapeHtml(cat.category || "")}</div>`;
      if (cat.weekly_target) html += `<div class="grocery-category-target">${escapeHtml(cat.weekly_target)}</div>`;
      if (cat.pick) html += `<div class="grocery-category-pick">${escapeHtml(cat.pick)}</div>`;
      html += '</div>';
      html += '<div class="grocery-options">';
      for (const opt of (cat.options || [])) {
        const id = 'gc_' + Math.random().toString(36).slice(2, 8);
        html += `<label class="grocery-item" for="${id}">`;
        html += `<input type="checkbox" id="${id}" class="grocery-checkbox">`;
        html += `<span class="grocery-item-name">${escapeHtml(opt.item || "")}</span>`;
        if (opt.portion) html += `<span class="grocery-item-portion">${escapeHtml(opt.portion)}</span>`;
        if (opt.note) html += `<span class="grocery-item-note">${escapeHtml(opt.note)}</span>`;
        html += '</label>';
      }
      html += '</div></div>';
    }
    html += '</div></div>';
  }

  // Grocery checklist — Keep Buying (categorized with checkboxes)
  if (ap.grocery_keep && ap.grocery_keep.length > 0) {
    html += '<div class="action-plan-section">';
    html += '<div class="action-plan-subtitle">Grocery Checklist — Keep Buying</div>';
    html += '<p class="grocery-hint">Foods you\'re already eating — keep it up! Upgrade tips included.</p>';
    html += '<div class="grocery-grid">';
    for (const cat of ap.grocery_keep) {
      html += '<div class="grocery-category grocery-category-keep">';
      html += `<div class="grocery-category-header">`;
      html += `<div class="grocery-category-name">${escapeHtml(cat.category || "")}</div>`;
      html += '</div>';
      html += '<div class="grocery-options">';
      for (const opt of (cat.options || [])) {
        const id = 'gk_' + Math.random().toString(36).slice(2, 8);
        html += `<label class="grocery-item" for="${id}">`;
        html += `<input type="checkbox" id="${id}" class="grocery-checkbox">`;
        html += `<span class="grocery-item-name">${escapeHtml(opt.item || "")}</span>`;
        if (opt.portion) html += `<span class="grocery-item-portion">${escapeHtml(opt.portion)}</span>`;
        if (opt.note) html += `<span class="grocery-item-note">${escapeHtml(opt.note)}</span>`;
        html += '</label>';
      }
      html += '</div></div>';
    }
    html += '</div></div>';
  }

  // Stop and replace
  if (ap.stop_and_replace && ap.stop_and_replace.length > 0) {
    html += '<div class="action-plan-section">';
    html += '<div class="action-plan-subtitle">Stop / Replace</div>';
    html += '<p class="grocery-hint">Foods to reduce or cut out, and what to eat instead:</p>';
    html += '<table class="action-plan-table stop-replace-table"><thead><tr><th>Stop / Reduce</th><th>Why</th><th>Replace With</th></tr></thead><tbody>';
    for (const s of ap.stop_and_replace) {
      html += `<tr>
        <td class="stop-cell">${escapeHtml(s.stop || "")}</td>
        <td>${escapeHtml(s.why || "")}</td>
        <td class="replace-cell">${escapeHtml(s.replace_with || "")}</td>
      </tr>`;
    }
    html += '</tbody></table></div>';
  }

  // Sourcing guide
  if (ap.sourcing_guide && ap.sourcing_guide.length > 0) {
    html += '<div class="action-plan-section">';
    html += '<div class="action-plan-subtitle">Sourcing Guide (Philippines)</div>';
    html += '<p class="grocery-hint">Contamination risks and what to look for when buying:</p>';
    html += '<table class="action-plan-table sourcing-table"><thead><tr><th>Food</th><th>Risk</th><th>What to Look For</th></tr></thead><tbody>';
    for (const s of ap.sourcing_guide) {
      html += `<tr>
        <td><strong>${escapeHtml(s.food || "")}</strong></td>
        <td class="risk-cell">${escapeHtml(s.risk || "")}</td>
        <td>${escapeHtml(s.what_to_look_for || "")}</td>
      </tr>`;
    }
    html += '</tbody></table></div>';
  }

  // Meal ideas
  if (ap.meal_ideas && ap.meal_ideas.length > 0) {
    html += '<div class="action-plan-section">';
    html += '<div class="action-plan-subtitle">Meal Ideas</div>';
    html += '<ul class="meal-ideas-list">';
    for (const idea of ap.meal_ideas) {
      html += `<li>${escapeHtml(idea)}</li>`;
    }
    html += '</ul></div>';
  }

  html += '</div>';
  return html;
}

function printActionPlan() {
  const el = document.getElementById("action-plan-printable");
  if (!el) return;
  const win = window.open("", "_blank");
  win.document.write(`<!DOCTYPE html><html><head><title>Weekly Action Plan</title><style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 20px; color: #1a1a2e; font-size: 11px; }
    .action-plan { max-width: 100%; }
    .action-plan-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
    .action-plan-title { font-size: 18px; font-weight: 700; color: #6c63ff; }
    .btn-print { display: none; }
    .action-plan-section { margin-bottom: 14px; }
    .action-plan-subtitle { font-size: 13px; font-weight: 700; margin-bottom: 6px; border-bottom: 2px solid #6c63ff; padding-bottom: 3px; }
    .grocery-hint { font-size: 10px; color: #666; margin-bottom: 6px; font-style: italic; }
    table { width: 100%; border-collapse: collapse; font-size: 10px; margin-bottom: 8px; }
    th { background: #f0f0f5; padding: 4px 6px; text-align: left; font-size: 9px; text-transform: uppercase; }
    td { padding: 4px 6px; border-bottom: 1px solid #ddd; vertical-align: top; }
    .daily-targets-table th:nth-child(1){width:18%} .daily-targets-table th:nth-child(5){width:50%}
    .stop-replace-table th:nth-child(1){width:22%} .stop-replace-table th:nth-child(2){width:40%}
    .sourcing-table th:nth-child(1){width:15%} .sourcing-table th:nth-child(2){width:25%} .sourcing-table th:nth-child(3){width:60%}
    .gap-cell { color: #e67e22; font-weight: 600; }
    .stop-cell { color: #e74c3c; text-decoration: line-through; font-weight: 600; }
    .replace-cell { color: #27ae60; font-weight: 600; }
    .risk-cell { color: #e67e22; }
    .grocery-grid { display: grid; grid-template-columns: 1fr; gap: 10px; }
    .grocery-category { border: 1px solid #ddd; border-radius: 6px; padding: 8px; break-inside: avoid; }
    .grocery-category-add { border-left: 3px solid #e67e22; }
    .grocery-category-keep { border-left: 3px solid #27ae60; }
    .grocery-category-name { font-weight: 700; font-size: 12px; margin-bottom: 2px; }
    .grocery-category-target { font-size: 9px; color: #333; }
    .grocery-category-pick { font-size: 9px; color: #6c63ff; font-style: italic; }
    .grocery-options { display: grid; grid-template-columns: 15px auto auto 1fr; gap: 0; align-items: start; }
    .grocery-item { display: contents; font-size: 10px; }
    .grocery-item > * { padding: 3px 5px 3px 0; border-bottom: 1px solid #f0f0f5; }
    .grocery-item:last-child > * { border-bottom: none; }
    .grocery-checkbox { width: 13px; height: 13px; margin-top: 1px; }
    .grocery-item-name { font-weight: 600; color: #000; }
    .grocery-item-portion { color: #000; font-size: 9px; }
    .grocery-item-note { color: #333; font-size: 9px; font-style: italic; }
    .meal-ideas-list { list-style: disc; padding-left: 20px; }
    .meal-ideas-list li { padding: 2px 0; }
    .num { text-align: right; }
    @page { margin: 15mm; }
  </style></head><body>${el.outerHTML}</body></html>`);
  win.document.close();
  win.focus();
  setTimeout(() => { win.print(); }, 300);
}

function renderAgreementSummary(agreement, providerA, providerB) {
  if (!agreement) return '';

  let html = '<div class="agreement-panel">';
  html += '<div class="agreement-panel-title">Cross-Validation Summary</div>';
  html += '<table class="agreement-table"><thead><tr>';
  html += `<th>Category</th><th>${escapeHtml(providerA)}</th><th>${escapeHtml(providerB)}</th><th>Match</th>`;
  html += '</tr></thead><tbody>';

  for (const cat of agreement.categories) {
    const rowClass = cat.agree ? "" : " class=\"disagreement-row\"";
    const icon = cat.agree ? '<span class="agree-icon">&#10003;</span>' : '<span class="disagree-icon">&#10007;</span>';
    html += `<tr${rowClass}>
      <td>${escapeHtml(cat.name)}</td>
      <td><span class="assessment-status-badge status-${statusCssClass(cat.a)}">${statusDisplayText(cat.a)}</span></td>
      <td><span class="assessment-status-badge status-${statusCssClass(cat.b)}">${statusDisplayText(cat.b)}</span></td>
      <td>${icon}</td>
    </tr>`;
  }

  html += '</tbody></table>';
  html += `<div class="agreement-count">${agreement.total - agreement.disagreements}/${agreement.total} categories agree`;
  if (agreement.needsEscalation) {
    html += ` — <span style="color:var(--orange)">escalated to Round 2</span>`;
  }
  html += '</div></div>';
  return html;
}

function renderAssessmentResults(result) {
  const container = document.getElementById("assessment-results");
  if (!container) return;
  if (isMobile()) {
    const best = (result.round2 && result.round2[0] && result.round2[0].data)
      || (result.round1 && result.round1[0] && result.round1[0].data)
      || null;
    if (best && typeof renderAssessmentScorecard === "function") { renderAssessmentScorecard(best, result); return; }
  }

  let html = '';

  // Verdict banner
  if (result.verdict === "single") {
    html += `<div class="verdict verdict-warning" style="margin-bottom:12px">&#9888; ${escapeHtml(result.warning)}</div>`;
  } else if (result.verdict === "consensus") {
    html += `<div class="verdict verdict-consensus" style="margin-bottom:12px">&#10003; Both providers agreed (${result.agreement.total - result.agreement.disagreements}/${result.agreement.total} categories match)</div>`;
  } else if (result.verdict === "reconciled") {
    html += `<div class="verdict verdict-escalated" style="margin-bottom:12px">&#9888; Round 1: ${result.agreement.disagreements}/${result.agreement.total} categories disagreed — debiased re-evaluation in Round 2</div>`;
  } else if (result.verdict === "r2_failed") {
    html += `<div class="verdict verdict-warning" style="margin-bottom:12px">&#9888; Reconciliation failed — using Round 1 average</div>`;
  }

  // Agreement summary (if two providers)
  if (result.agreement && result.round1.length >= 2) {
    html += renderAgreementSummary(result.agreement, result.round1[0].providerName, result.round1[1].providerName);
  }

  // Round 2 — Both providers re-evaluated with debiased prompt
  if (result.verdict === "reconciled" && result.round2) {
    html += '<div class="assessment-round-label r2">Round 2 — Debiased Re-evaluation</div>';
    html += `<p class="grocery-hint" style="margin-bottom:8px">Both models re-evaluated the data with anonymized Round 1 analyses (A/B). Instructed to not compromise — cite specific foods to justify each decision.</p>`;

    if (result.round2.length === 1) {
      html += '<div class="assessment-comparison"><div class="assessment-card full-width">';
      html += `<div class="assessment-provider-header">${escapeHtml(result.round2[0].providerName)} (${escapeHtml(result.round2[0].model)})</div>`;
      html += renderSingleAssessment(result.round2[0]);
      html += '</div></div>';
    } else {
      html += '<div class="assessment-comparison">';
      for (const r of result.round2) {
        html += '<div class="assessment-card">';
        html += `<div class="assessment-provider-header">${escapeHtml(r.providerName)} (${escapeHtml(r.model)})</div>`;
        html += renderSingleAssessment(r);
        html += '</div>';
      }
      html += '</div>';
    }

    // Round 2 cross-validation summary
    if (result.r2Agreement && result.round2.length >= 2) {
      html += renderAgreementSummary(result.r2Agreement, result.round2[0].providerName + " (R2)", result.round2[1].providerName + " (R2)");
    }

    // Show Round 1 briefly
    html += '<details class="food-log-details"><summary class="food-log-toggle">View Round 1 initial analyses</summary>';
    html += '<div class="food-log-content">';
    html += '<div class="assessment-comparison">';
    for (const r of result.round1) {
      html += '<div class="assessment-card">';
      html += `<div class="assessment-provider-header">${escapeHtml(r.providerName)} (${escapeHtml(r.model)}) — Round 1</div>`;
      html += renderSingleAssessment(r);
      html += '</div>';
    }
    html += '</div></div></details>';
  } else {
    // Round 1 results (consensus or single)
    if (result.round1.length === 1) {
      html += '<div class="assessment-comparison"><div class="assessment-card full-width">';
      html += `<div class="assessment-provider-header">${escapeHtml(result.round1[0].providerName)} (${escapeHtml(result.round1[0].model)})</div>`;
      html += renderSingleAssessment(result.round1[0]);
      html += '</div></div>';
    } else {
      html += '<div class="assessment-comparison">';
      for (const r of result.round1) {
        html += '<div class="assessment-card">';
        html += `<div class="assessment-provider-header">${escapeHtml(r.providerName)} (${escapeHtml(r.model)})</div>`;
        html += renderSingleAssessment(r);
        html += '</div>';
      }
      html += '</div>';
    }
  }

  // Action Plan — use best available assessment (R2 first, then R1)
  const bestAssessment = (result.round2 && result.round2.length > 0 && result.round2[0].data)
    ? result.round2[0].data
    : (result.round1 && result.round1.length > 0 && result.round1[0].data)
      ? result.round1[0].data
      : null;
  if (bestAssessment) {
    html += renderActionPlan(bestAssessment);
  }

  // Failed providers (Round 1)
  if (result.failed && result.failed.length > 0) {
    for (const f of result.failed) {
      html += `<div class="verdict verdict-warning">&#9888; ${escapeHtml(f.providerName)} failed (R1): ${escapeHtml(f.error)}</div>`;
    }
  }

  // Failed providers (Round 2)
  if (result.r2Failed && result.r2Failed.length > 0) {
    for (const f of result.r2Failed) {
      html += `<div class="verdict verdict-warning">&#9888; ${escapeHtml(f.providerName)} failed (R2): ${escapeHtml(f.error)}</div>`;
    }
  }

  container.innerHTML = html;
}

// --- localStorage Persistence ---

function loadAssessments() {
  if (_cache.ready && _cache.assessments) return [..._cache.assessments];
  const saved = lsGet("assessments");
  return saved ? JSON.parse(saved) : [];
}

function saveAssessment(result) {
  const assessments = loadAssessments();
  assessments.unshift(result);
  while (assessments.length > 20) assessments.pop();
  _cache.assessments = [...assessments];
  lsSet("assessments", JSON.stringify(assessments));
  bgWrite(async () => {
    const { error } = await sb.from('assessments').insert({
      timestamp: result.timestamp,
      period: result.period,
      data: result,
    });
    if (error) throw error;
  });
}

function deleteAssessment(index) {
  const assessments = loadAssessments();
  const removed = assessments.splice(index, 1)[0];
  _cache.assessments = [...assessments];
  lsSet("assessments", JSON.stringify(assessments));
  if (removed) {
    bgWrite(async () => {
      // Delete by matching timestamp
      const { error } = await sb.from('assessments').delete().eq('timestamp', removed.timestamp);
      if (error) throw error;
    });
  }
  renderAssessmentHistory();
}

window.viewAssessment = function (index) {
  const assessments = loadAssessments();
  const result = assessments[index];
  if (!result) return;
  renderAssessmentResults(result);
  // Scroll to results
  document.getElementById("assessment-results")?.scrollIntoView({ behavior: "smooth" });
};

window.deleteAssessmentEntry = function (index) {
  if (!confirm("Delete this assessment?")) return;
  deleteAssessment(index);
};

function renderAssessmentHistory() {
  const container = document.getElementById("assessment-history");
  if (!container) return;

  const assessments = loadAssessments();
  if (assessments.length === 0) {
    container.innerHTML = '';
    return;
  }

  let html = '<div class="assessment-section" style="margin-top:20px">';
  html += '<div class="assessment-section-title">Assessment History</div>';
  html += '<div class="table-wrapper"><table class="assessment-history-table"><thead><tr>';
  html += '<th>Date</th><th>Period</th><th>Days</th><th>Entries</th><th>Score</th><th>Verdict</th><th>Actions</th>';
  html += '</tr></thead><tbody>';

  for (let i = 0; i < assessments.length; i++) {
    const a = assessments[i];
    const date = a.timestamp ? new Date(a.timestamp).toLocaleDateString() : "N/A";
    const score = a.final?.overall_score ?? "-";
    const scoreCls = getScoreClass(score);
    const periodLabels = { today: "Today", week: "7 days", month: "30 days", quarter: "90 days", semi: "6 months", year: "12 months", yoy: "Year/Year", custom: "Custom" };
    const periodLabel = periodLabels[a.period] || a.period;
    const verdictLabel = a.verdict === "consensus" ? "Consensus" : a.verdict === "reconciled" ? "Reconciled" : a.verdict === "single" ? "Single" : a.verdict === "r2_failed" ? "R2 Failed" : a.verdict;

    html += `<tr>
      <td>${escapeHtml(date)}</td>
      <td>${escapeHtml(periodLabel)}</td>
      <td class="num">${a.dataSummary?.numDays ?? "-"}</td>
      <td class="num">${a.dataSummary?.totalEntries ?? "-"}</td>
      <td><span class="score-badge ${scoreCls}">${score}</span></td>
      <td><span class="badge ${a.verdict === 'consensus' ? 'badge-green' : a.verdict === 'reconciled' ? 'badge-blue' : 'badge-yellow'}">${escapeHtml(verdictLabel)}</span></td>
      <td>
        <div class="actions">
          <button class="btn-icon" onclick="viewAssessment(${i})" title="View">&#128065;</button>
          <button class="btn-icon delete" onclick="deleteAssessmentEntry(${i})" title="Delete">&#10005;</button>
        </div>
      </td>
    </tr>`;
  }

  html += '</tbody></table></div></div>';
  container.innerHTML = html;
}

// ============================================================
// BATCH ADD FEATURE
// ============================================================

// --- Batch Pane Functions ---


function populateBatchSuggestions() {
  const entries = loadFoodEntries();
  const foods = [...new Set(entries.map((e) => e.food))];
  const units = [...new Set(entries.map((e) => e.unit))];

  // Ensure datalists exist in the modal
  let foodDl = document.getElementById("batch-food-suggestions");
  if (!foodDl) {
    foodDl = document.createElement("datalist");
    foodDl.id = "batch-food-suggestions";
    document.getElementById("food-modal").appendChild(foodDl);
  }
  foodDl.innerHTML = foods.map((f) => `<option value="${escapeHtml(f)}">`).join("");

  let unitDl = document.getElementById("batch-unit-suggestions");
  if (!unitDl) {
    unitDl = document.createElement("datalist");
    unitDl.id = "batch-unit-suggestions";
    document.getElementById("food-modal").appendChild(unitDl);
  }
  unitDl.innerHTML = units.map((u) => `<option value="${escapeHtml(u)}">`).join("");
}

function addBatchRow() {
  const container = document.getElementById("batch-items");
  const row = document.createElement("div");
  row.className = "batch-item-row";
  row.innerHTML = `
    <input type="text" placeholder="Food" class="batch-food" autocomplete="off" list="batch-food-suggestions">
    <input type="number" placeholder="Qty" class="batch-qty" step="any">
    <input type="text" placeholder="Unit" class="batch-unit" autocomplete="off" list="batch-unit-suggestions">
    <button type="button" class="btn-icon delete batch-remove" title="Remove">&#10005;</button>
  `;
  row.querySelector(".batch-remove").addEventListener("click", () => removeBatchRow(row));
  container.appendChild(row);
}

function removeBatchRow(row) {
  const container = document.getElementById("batch-items");
  if (container.children.length <= 1) return;
  row.remove();
}


function saveBatchFoods() {
  const date = document.getElementById("batch-date").value;
  const time = document.getElementById("batch-time").value;
  if (!date || !time) { alert("Date and time are required."); return; }
  const entries = loadFoodEntries();
  let maxId = entries.length ? Math.max(...entries.map((e) => e.id)) : 0;
  const created = [];
  document.querySelectorAll("#batch-items .batch-item-row").forEach((row) => {
    const food = row.querySelector(".batch-food").value.trim();
    const qty = row.querySelector(".batch-qty").value;
    const unit = row.querySelector(".batch-unit").value.trim();
    if (!food || !qty || !unit) return;
    const entry = { id: ++maxId, date, time, food, qty: parseFloat(qty), unit, macros: {}, estimateStatus: "pending" };
    entries.push(entry); created.push(entry);
  });
  if (!created.length) { alert("Add at least one food (name, quantity, and unit)."); return; }
  saveFoodEntries(entries);
  ensureDayExists(date);
  closeFoodModal();
  renderFoodTable(); renderCalorieTracker();
  created.forEach((e) => enqueueEstimate(e.id));
}

// ============================================================
// EVENT LISTENERS & INIT
// ============================================================

// ============================================================
// AUTH GATE — sign-in required before the app starts
// ============================================================

let _authUser = null;
function setAuthUser(user) { _authUser = user || null; }
function currentUid() { return _authUser ? _authUser.id : null; }

function showAuthView(show) {
  document.getElementById("auth-view").classList.toggle("hidden", !show);
}

function setAuthError(err) {
  document.getElementById("auth-error").textContent = err ? AuthView.authErrorMessage(err) : "";
}

function isNativeApp() {
  return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
}

// In-flight guard shared by the auth actions: a double-tap on the Google
// button would fire signInWithOAuth twice and overwrite the PKCE
// code_verifier (failing the first tab's sign-in); a double-tap on Verify
// would consume the token then flash a spurious "wrong or expired" error.
let _authBusy = false;

async function signInWithGoogle() {
  if (_authBusy) return;
  _authBusy = true;
  setAuthError(null);
  try {
    if (isNativeApp()) {
      // Native: open the OAuth URL in the in-app browser; the deep-link
      // listener below completes the session with exchangeCodeForSession.
      const { data, error } = await sb.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: "com.lazymacros.app://auth-callback", skipBrowserRedirect: true },
      });
      if (error) throw error;
      await window.Capacitor.Plugins.Browser.open({ url: data.url });
    } else {
      // Plain browser (dev): normal redirect round-trip; detectSessionInUrl
      // picks up the ?code= on return.
      const { error } = await sb.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: window.location.origin },
      });
      if (error) throw error;
    }
  } catch (err) {
    console.error("[Auth] Google sign-in failed:", err);
    setAuthError(err);
  } finally {
    _authBusy = false;
  }
}

async function sendOtp() {
  if (_authBusy) return;
  setAuthError(null);
  const email = document.getElementById("auth-email").value.trim();
  if (!AuthView.validEmail(email)) { setAuthError({ message: "Enter a valid email address" }); return; }
  _authBusy = true;
  try {
    const { error } = await sb.auth.signInWithOtp({ email });
    if (error) { setAuthError(error); return; }
    document.getElementById("auth-otp-row").classList.remove("hidden");
  } finally {
    _authBusy = false;
  }
}

async function verifyOtp() {
  if (_authBusy) return;
  setAuthError(null);
  const email = document.getElementById("auth-email").value.trim();
  const token = document.getElementById("auth-otp").value.trim();
  if (!AuthView.validOtp(token)) { setAuthError({ message: "Enter the code from the email" }); return; }
  _authBusy = true;
  try {
    const { error } = await sb.auth.verifyOtp({ email, token, type: "email" });
    if (error) setAuthError(error);
    // Success path: onAuthStateChange fires and starts the app.
  } finally {
    _authBusy = false;
  }
}

function wireAuthUi() {
  document.getElementById("auth-google").addEventListener("click", signInWithGoogle);
  document.getElementById("auth-send-otp").addEventListener("click", sendOtp);
  document.getElementById("auth-verify-otp").addEventListener("click", verifyOtp);
  // Enter-key ergonomics (review ride-along): Enter in the email field sends
  // the code; Enter in the OTP field verifies it.
  document.getElementById("auth-email").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); sendOtp(); } });
  document.getElementById("auth-otp").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); verifyOtp(); } });

  if (isNativeApp() && window.Capacitor.Plugins.App) {
    // Deep-link return from the OAuth browser (native only).
    window.Capacitor.Plugins.App.addListener("appUrlOpen", async ({ url }) => {
      if (!url || !url.startsWith("com.lazymacros.app://auth-callback")) return;
      try { await window.Capacitor.Plugins.Browser.close(); } catch (e) { /* browser may already be closed */ }
      const u = new URL(url);
      // Surface OAuth denial (e.g. ?error=access_denied) instead of failing silently.
      const authErr = u.searchParams.get("error_description") || u.searchParams.get("error");
      if (authErr) { setAuthError({ message: authErr }); return; }
      const code = u.searchParams.get("code");
      if (!code) return;
      const { error } = await sb.auth.exchangeCodeForSession(code);
      if (error) { console.error("[Auth] Code exchange failed:", error); setAuthError(error); }
      // Success: onAuthStateChange starts the app.
    });
    // Supabase-recommended Capacitor pattern (review ride-along): the JS
    // refresh timer suspends while backgrounded — pause/resume it explicitly.
    window.Capacitor.Plugins.App.addListener("appStateChange", ({ isActive }) => {
      if (isActive) sb.auth.startAutoRefresh(); else sb.auth.stopAutoRefresh();
    });
  }
}

// ============================================================
// FIRST-RUN WALKTHROUGH (tutorial) — depends on window.Tutorial
// ============================================================
const TUT_ADVANCE_MS = 4500;
let _tutIndex = 0;
let _tutTimer = null;
let _tutAuto = false;        // is auto-advance currently active?
let _tutFromAuto = false;    // was this open triggered by the first-run auto-show?
let _tutReturnFocus = null;  // element to restore focus to on close
let _tutRendered = false;    // slides built once
let _tutTouchX = null;       // swipe start x

function tutReduceMotion() {
  return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
}

// Trusted, static illustration markup per slide `art` key (no user data → innerHTML is safe).
function tutArtHtml(key) {
  switch (key) {
    case "welcome":
      return '<div class="tut-emblem tut-emblem-pulse"><svg class="tut-ring" viewBox="0 0 120 120" fill="none">' +
        '<circle class="bg" cx="60" cy="60" r="50" stroke-width="10"/>' +
        '<circle class="fg" cx="60" cy="60" r="50" stroke-width="10" stroke-dasharray="235 314" transform="rotate(-90 60 60)"/>' +
        '</svg><span class="tut-score" style="font-size:1.4rem">LM</span></div>';
    case "food":
      return '<div class="tut-phone">' +
        '<div class="tut-bar"></div><div class="tut-bar short"></div><div class="tut-bar"></div><div class="tut-bar short"></div>' +
        '<div class="tut-fabs">' +
          '<span class="tut-fab tut-pulse"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></span>' +
          '<span class="tut-fab tut-fab2 tut-pulse"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h3l2-2h8l2 2h3v12H3z"/><circle cx="12" cy="13" r="3.5"/></svg></span>' +
        '</div></div>';
    case "days":
      return '<div class="tut-phone">' +
        '<div class="tut-row"><span>Weight</span><b>184 lb</b></div>' +
        '<div class="tut-row hi"><span>🏋️ Gym day</span><b>×1.55</b></div>' +
        '<div class="tut-arrow">↓</div>' +
        '<div class="tut-chip">Target 1,820 kcal</div></div>';
    case "targets":
      return '<div class="tut-phone">' +
        '<div class="tut-row"><span>Height</span><b>170 cm</b></div>' +
        '<div class="tut-row"><span>Age</span><b>32</b></div>' +
        '<div class="tut-row hi"><span>🎯 Goal</span><b>0.50 kg/wk</b></div>' +
        '<div class="tut-chip">Protein 135–150 g</div></div>';
    case "assess":
      return '<div class="tut-emblem"><svg class="tut-ring" viewBox="0 0 120 120" fill="none">' +
        '<circle class="bg" cx="60" cy="60" r="50" stroke-width="10"/>' +
        '<circle class="fg" cx="60" cy="60" r="50" stroke-width="10" stroke-dasharray="245 314" transform="rotate(-90 60 60)"/>' +
        '</svg><span class="tut-score">78</span></div>';
    case "done":
      return '<div class="tut-emblem"><svg class="tut-check-svg" viewBox="0 0 120 120">' +
        '<circle cx="60" cy="60" r="52"/>' +
        '<path d="M38 62 L54 78 L84 44" fill="none" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>' +
        '</svg></div>';
    default:
      return "";
  }
}

function renderTutorial() {
  if (_tutRendered) return;
  const vp = document.getElementById("tut-viewport");
  const count = Tutorial.slideCount();
  vp.innerHTML = Tutorial.SLIDES.map((s, i) =>
    '<div class="tut-slide" data-i="' + i + '" role="group" aria-roledescription="slide" aria-label="Slide ' + (i + 1) + ' of ' + count + '">' +
      '<div class="tut-art">' + tutArtHtml(s.art) + '</div>' +
      '<h2 class="tut-title"></h2>' +
      '<p class="tut-caption"></p>' +
    '</div>'
  ).join("");
  // Titles/captions via textContent (safe, plain text).
  Tutorial.SLIDES.forEach((s, i) => {
    const slide = vp.querySelector('.tut-slide[data-i="' + i + '"]');
    slide.querySelector(".tut-title").textContent = s.title;
    slide.querySelector(".tut-caption").textContent = s.caption;
  });
  document.getElementById("tut-dots").innerHTML = Tutorial.SLIDES.map((_, i) =>
    '<button type="button" class="tut-dot" data-i="' + i + '" aria-label="Go to slide ' + (i + 1) + '"></button>'
  ).join("");
  _tutRendered = true;
}

function tutGoTo(i) {
  _tutIndex = Tutorial.clampIndex(i);
  document.querySelectorAll("#tut-viewport .tut-slide").forEach((el) => {
    const on = Number(el.dataset.i) === _tutIndex;
    el.classList.toggle("active", on);
    el.setAttribute("aria-hidden", on ? "false" : "true"); // hide off-screen slides from assistive tech
  });
  document.querySelectorAll("#tut-dots .tut-dot").forEach((d) => {
    const on = Number(d.dataset.i) === _tutIndex;
    d.classList.toggle("active", on);
    if (on) d.setAttribute("aria-current", "true"); else d.removeAttribute("aria-current");
  });
  const fill = document.getElementById("tut-progress-fill");
  if (fill) fill.style.width = ((_tutIndex + 1) / Tutorial.slideCount() * 100) + "%";
  const last = Tutorial.isLast(_tutIndex);
  document.getElementById("tut-back").disabled = Tutorial.isFirst(_tutIndex);
  document.getElementById("tut-skip").classList.toggle("hidden", last);
  document.getElementById("tut-next").textContent = last ? "Start tracking" : "Next";
}

function tutStopAuto() {
  _tutAuto = false;
  if (_tutTimer) { clearTimeout(_tutTimer); _tutTimer = null; }
}

function tutScheduleAuto() {
  if (!_tutAuto) return;
  if (_tutTimer) clearTimeout(_tutTimer);
  _tutTimer = setTimeout(() => {
    if (!_tutAuto) return;
    if (Tutorial.isLast(_tutIndex)) { tutStopAuto(); return; }
    tutGoTo(Tutorial.next(_tutIndex));
    tutScheduleAuto();
  }, TUT_ADVANCE_MS);
}

// First manual interaction cancels auto-advance for good.
function tutInteract() { if (_tutAuto) tutStopAuto(); }

function openTutorial(fromAuto) {
  renderTutorial();
  // Mark seen the moment it opens (auto or manual); replay re-sets "1" harmlessly.
  localStorage.setItem("nt_tutorial_seen", "1");
  _tutFromAuto = !!fromAuto;
  _tutReturnFocus = document.activeElement;
  document.getElementById("tutorial-view").classList.remove("hidden");
  tutGoTo(0);
  _tutAuto = !tutReduceMotion();
  tutScheduleAuto();
  const next = document.getElementById("tut-next");
  if (next) next.focus();
}

function closeTutorial() {
  tutStopAuto();
  document.getElementById("tutorial-view").classList.add("hidden");
  if (_tutFromAuto) {
    activateTab("food-eaten"); // land new users on Food
    const foodNav = document.querySelector((isMobile() ? ".bottom-nav-item" : ".tab") + '[data-tab="food-eaten"]');
    if (foodNav) foodNav.focus();
  } else if (_tutReturnFocus && typeof _tutReturnFocus.focus === "function" && document.body.contains(_tutReturnFocus)) {
    _tutReturnFocus.focus(); // replay: return focus to the trigger (e.g. the "How to use" button)
  }
  _tutReturnFocus = null;
  _tutFromAuto = false;
}

function maybeAutoShowTutorial() {
  if (Tutorial.shouldAutoShow(localStorage.getItem("nt_tutorial_seen"))) openTutorial(true);
}

function tutTrapFocus(e) {
  if (e.key !== "Tab") return;
  const nodes = document.querySelectorAll("#tutorial-view button:not([disabled])");
  const focusable = Array.prototype.filter.call(nodes, (el) => el.offsetParent !== null);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

function initTutorialUi() {
  document.getElementById("tut-back").addEventListener("click", () => { tutInteract(); tutGoTo(Tutorial.prev(_tutIndex)); });
  document.getElementById("tut-skip").addEventListener("click", () => { tutInteract(); closeTutorial(); });
  document.getElementById("tut-next").addEventListener("click", () => {
    tutInteract();
    if (Tutorial.isLast(_tutIndex)) closeTutorial();
    else tutGoTo(Tutorial.next(_tutIndex));
  });
  document.getElementById("tut-dots").addEventListener("click", (e) => {
    const dot = e.target.closest(".tut-dot");
    if (!dot) return;
    tutInteract();
    tutGoTo(Number(dot.dataset.i));
  });
  const view = document.getElementById("tutorial-view");
  view.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closeTutorial(); return; }
    if (e.key === "ArrowRight") { e.preventDefault(); tutInteract(); tutGoTo(Tutorial.next(_tutIndex)); return; }
    if (e.key === "ArrowLeft") { e.preventDefault(); tutInteract(); tutGoTo(Tutorial.prev(_tutIndex)); return; }
    tutTrapFocus(e);
  });
  const vp = document.getElementById("tut-viewport");
  vp.addEventListener("touchstart", (e) => { _tutTouchX = e.changedTouches[0].clientX; }, { passive: true });
  vp.addEventListener("touchend", (e) => {
    if (_tutTouchX == null) return;
    const dx = e.changedTouches[0].clientX - _tutTouchX;
    _tutTouchX = null;
    tutInteract(); // any deliberate touch (tap or swipe) stops auto-advance
    if (Math.abs(dx) < 40) return;
    tutGoTo(dx < 0 ? Tutorial.next(_tutIndex) : Tutorial.prev(_tutIndex));
  }, { passive: true });
  const replay = document.getElementById("tutorial-replay-btn");
  if (replay) replay.addEventListener("click", () => openTutorial(false));
}

let _appStarted = false;

function maybeShowOnboarding() {
  if (!_cache.profileMissing) return;
  const ob = document.getElementById("onboarding-view");
  // Populate the selects (same options as the Targets tab).
  const act = document.getElementById("ob-activity");
  act.innerHTML = ACTIVITY_TYPES.map((a) => `<option value="${escapeHtml(a.label)}">${escapeHtml(a.label)}</option>`).join("");
  const goal = document.getElementById("ob-goal");
  goal.innerHTML = Targets.GOALS.map((g) => `<option value="${escapeHtml(g.goal)}">${escapeHtml(g.goal)}</option>`).join("");
  goal.value = DEFAULT_PROFILE.weightLossGoal;
  document.getElementById("ob-protein-low").value = DEFAULT_PROFILE.proteinLow;
  document.getElementById("ob-protein-high").value = DEFAULT_PROFILE.proteinHigh;
  ob.classList.remove("hidden");
}

function completeOnboarding(ev) {
  ev.preventDefault();
  const profile = {
    height: parseFloat(document.getElementById("ob-height").value),
    age: parseInt(document.getElementById("ob-age").value, 10),
    proteinLow: parseFloat(document.getElementById("ob-protein-low").value),
    proteinHigh: parseFloat(document.getElementById("ob-protein-high").value),
    weightLossGoal: document.getElementById("ob-goal").value,
  };
  if ([profile.height, profile.age, profile.proteinLow, profile.proteinHigh].some((n) => !Number.isFinite(n))) return;
  saveProfile(profile);
  // First Day entry seeds the copy-forward chain used by ensureDayExists.
  const weight = parseFloat(document.getElementById("ob-weight").value);
  const activity = document.getElementById("ob-activity").value;
  if (Number.isFinite(weight)) {
    const today = new Date().toISOString().slice(0, 10);
    saveDayEntries([...loadDayEntries(), { id: Date.now(), date: today, weight, activity }]);
  }
  _cache.profileMissing = false;
  document.getElementById("onboarding-view").classList.add("hidden");
  // Re-render everything that reads profile/days.
  renderCalorieTracker();
  renderCalorieTarget();
  // First-run walkthrough plays right after onboarding.
  maybeAutoShowTutorial();
}

async function startApp() {
  if (_appStarted) return;
  _appStarted = true;
  document.body.classList.add('loading');
  try {
    await initFromSupabase();
  } catch (err) {
    console.error('[Supabase] Init failed, falling back to localStorage:', err);
    initFromLocalStorage();
  }
  document.body.classList.remove('loading');

  maybeShowOnboarding();

  // Resume any estimates left pending from a previous session
  resumePendingEstimates();

  // Tab switching (top tabs + bottom nav share one activator)
  document.querySelectorAll(".tab, .bottom-nav-item").forEach((el) => {
    el.addEventListener("click", () => activateTab(el.dataset.tab));
  });

  // Food modal
  document.getElementById("add-food-btn").addEventListener("click", () => openFoodModal(null));
  document.getElementById("food-fab").addEventListener("click", () => openFoodModal(null));
  onBreakpointChange(renderFoodTable);
  document.getElementById("food-cancel").addEventListener("click", closeFoodModal);
  document.querySelector("#food-modal .modal-overlay").addEventListener("click", closeFoodModal);
  document.getElementById("food-form").addEventListener("submit", saveFood);

  // Day modal
  document.getElementById("day-cancel").addEventListener("click", closeDayModal);
  document.querySelector("#day-modal .modal-overlay").addEventListener("click", closeDayModal);
  document.getElementById("day-form").addEventListener("submit", saveDay);
  onBreakpointChange(renderCalorieTracker);

  // Food filter
  document.getElementById("food-date-filter").addEventListener("change", renderFoodTable);
  document.getElementById("clear-food-filter").addEventListener("click", () => {
    document.getElementById("food-date-filter").value = "";
    renderFoodTable();
  });

  // Profile form
  document.getElementById("profile-form").addEventListener("submit", saveProfileForm);
  document.getElementById("onboarding-form").addEventListener("submit", completeOnboarding);

  // Settings cards
  renderMacroSettings();
  renderAccountSettings();

  // Paywall modal
  document.getElementById("paywall-dismiss").addEventListener("click", closePaywall);
  document.querySelector("#paywall-modal .modal-overlay").addEventListener("click", closePaywall);

  // Batch pane (inside unified food modal)
  document.getElementById("batch-add-row").addEventListener("click", addBatchRow);
  document.getElementById("batch-save").addEventListener("click", saveBatchFoods);
  document.getElementById("batch-cancel").addEventListener("click", closeFoodModal);
  document.querySelectorAll("#food-modal-tabs .modal-tab").forEach((t) => t.addEventListener("click", () => showFoodPane(t.dataset.pane)));

  // Photo capture modal
  document.getElementById("photo-fab")?.addEventListener("click", startPhotoCapture);
  document.getElementById("photo-cancel").addEventListener("click", closePhotoModal);
  document.querySelector("#photo-modal .modal-overlay").addEventListener("click", closePhotoModal);
  document.getElementById("photo-confirm").addEventListener("click", confirmPhotoItems);
  document.getElementById("photo-correct-toggle").addEventListener("click", () => document.getElementById("photo-correct").classList.toggle("hidden"));
  document.getElementById("photo-correct-submit").addEventListener("click", () => {
    const t = document.getElementById("photo-correct-text").value.trim();
    if (!t) return;
    _photoHistory = { priorItems: _photoItems, correction: t };
    document.getElementById("photo-correct-text").value = "";
    document.getElementById("photo-correct").classList.add("hidden");
    runPhotoEstimate();
  });

  // Diet Assessment
  document.getElementById("run-assessment-btn").addEventListener("click", runDietAssessment);

  const periodSelect = document.getElementById("assessment-period");
  const customRange = document.getElementById("custom-date-range");
  const dateFrom = document.getElementById("assessment-date-from");
  const dateTo = document.getElementById("assessment-date-to");

  // Default custom dates
  const todayStr = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 6);
  dateFrom.value = weekAgo.toISOString().slice(0, 10);
  dateTo.value = todayStr;

  function refreshAssessmentPreview() {
    const period = periodSelect.value;
    if (period === "custom") {
      if (!dateFrom.value || !dateTo.value) return;
      if (dateFrom.value > dateTo.value) return;
    }
    const data = getAssessmentData(period);
    renderAssessmentDataSummary(data);
    document.getElementById("assessment-results").innerHTML = "";
    setAssessmentStatus("");
  }

  periodSelect.addEventListener("change", () => {
    customRange.classList.toggle("hidden", periodSelect.value !== "custom");
    refreshAssessmentPreview();
  });

  dateFrom.addEventListener("change", refreshAssessmentPreview);
  dateTo.addEventListener("change", refreshAssessmentPreview);

  // Render initial data preview and history
  renderAssessmentDataSummary(getAssessmentData("week"));
  renderAssessmentHistory();

  onBreakpointChange(() => {
    const last = loadAssessments()[0];
    if (last && document.getElementById("assessment-results").children.length) {
      renderAssessmentResults(last);
    }
  });

  document.getElementById("food-name").addEventListener("change", function () {
    const entries = loadFoodEntries();
    const match = entries.findLast((e) => e.food === this.value);
    if (match) {
      document.getElementById("food-unit").value = match.unit;
      document.getElementById("food-qty").value = match.qty;
    }
  });

  // Initial render
  renderFoodTable();
  renderCalorieTracker();
  renderCalorieTarget();

  // AI credit bar (callAi also refreshes it after every proxy call)
  refreshCreditBar();

  // Apply the saved theme (sets data-theme + native status bar) and track OS light/dark changes
  applyTheme();
  if (window.matchMedia) {
    matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => { if (getTheme() === "system") applyTheme(); });
  }

  // First-run walkthrough: show for returning users who haven't seen it.
  // (New users see it right after onboarding — see completeOnboarding.)
  if (!_cache.profileMissing) maybeAutoShowTutorial();
}

document.addEventListener("DOMContentLoaded", async () => {
  // B-spec migration: BYOK is gone; remove any keys from this device.
  localStorage.removeItem("nt_key_openai");
  localStorage.removeItem("nt_key_anthropic");
  localStorage.removeItem("nt_openai_key");
  wireAuthUi();
  initTutorialUi();
  const { data: { session } } = await sb.auth.getSession();
  setAuthUser(session ? session.user : null);
  if (session) {
    await startApp();
  } else {
    showAuthView(true);
  }
  // Fires on OTP verify, OAuth code exchange, and sign-out.
  // startApp is deferred via setTimeout so it runs outside the auth callback
  // stack: supabase-js may hold an internal lock during this callback, and
  // startApp exceptions must not propagate back into verifyOtp /
  // exchangeCodeForSession as unhandled rejections.
  sb.auth.onAuthStateChange((_event, s) => {
    const hadUser = !!_authUser;
    setAuthUser(s ? s.user : null);
    if (s) { showAuthView(false); setTimeout(() => startApp().catch(console.error), 0); }
    else if (_appStarted && hadUser) {
      // Session lost while running (token revoked/expired in background):
      // don't strand a live app silently writing to a dead session.
      location.reload();
    }
  });
});
