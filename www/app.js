// ============================================================
// DATA LAYER — Supabase with in-memory cache
// ============================================================

const SUPABASE_URL = 'https://wcbpvvyhswaricoadqbb.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_I_XmlCcMCBDOkbU8PWN42A_SID54xxi';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const _cache = { food: null, days: null, profile: null, assessments: null, settings: {}, ready: false };

// ---- Mappers: snake_case DB ↔ camelCase JS ----

function foodRowToJs(r) {
  return { id: r.id, date: r.date, time: r.time, food: r.food, qty: Number(r.qty), unit: r.unit, calLow: Number(r.cal_low), calHigh: Number(r.cal_high), proLow: Number(r.pro_low), proHigh: Number(r.pro_high), aiThoughtProcess: r.ai_thought_process || null };
}
function foodJsToRow(e) {
  return { id: e.id, date: e.date, time: e.time, food: e.food, qty: e.qty, unit: e.unit, cal_low: e.calLow, cal_high: e.calHigh, pro_low: e.proLow, pro_high: e.proHigh, ai_thought_process: e.aiThoughtProcess || null };
}

function dayRowToJs(r) {
  return { id: r.id, date: r.date, age: r.age, weight: Number(r.weight), activity: r.activity, deficit: Number(r.deficit), proteinTargetLow: Number(r.protein_target_low), proteinTargetHigh: Number(r.protein_target_high) };
}
function dayJsToRow(e) {
  return { id: e.id, date: e.date, age: e.age, weight: e.weight, activity: e.activity, deficit: e.deficit, protein_target_low: e.proteinTargetLow, protein_target_high: e.proteinTargetHigh };
}

function profileRowToJs(r) {
  return { height: Number(r.height), proteinLow: Number(r.protein_low), proteinHigh: Number(r.protein_high) };
}
function profileJsToRow(p) {
  return { id: 1, height: p.height, protein_low: p.proteinLow, protein_high: p.proteinHigh };
}

// ---- bgWrite: fire-and-forget async write to Supabase ----

function bgWrite(fn) {
  Promise.resolve().then(fn).catch(err => console.error('[Supabase bgWrite]', err));
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

const DEFAULT_PROFILE = { height: 170.1, proteinLow: 135, proteinHigh: 150 };

// ---- Data functions (synchronous reads from cache, write-through to Supabase) ----

function loadProfile() {
  if (_cache.ready && _cache.profile) return { ..._cache.profile };
  const saved = localStorage.getItem("nt_profile");
  return saved ? JSON.parse(saved) : { ...DEFAULT_PROFILE };
}

function saveProfile(profile) {
  _cache.profile = { ...profile };
  localStorage.setItem("nt_profile", JSON.stringify(profile));
  bgWrite(async () => {
    const { error } = await sb.from('profile').upsert(profileJsToRow(profile));
    if (error) throw error;
  });
}

function loadFoodEntries() {
  if (_cache.ready && _cache.food) return [..._cache.food];
  const saved = localStorage.getItem("nt_food");
  return saved ? JSON.parse(saved) : [];
}

function saveFoodEntries(entries) {
  _cache.food = [...entries];
  localStorage.setItem("nt_food", JSON.stringify(entries));
  bgWrite(async () => {
    // Delete all then re-insert (simple approach for full-array saves)
    const { error: delErr } = await sb.from('food_entries').delete().gte('id', 0);
    if (delErr) throw delErr;
    if (entries.length > 0) {
      const rows = entries.map(foodJsToRow);
      const { error } = await sb.from('food_entries').upsert(rows);
      if (error) throw error;
    }
  });
}

function loadDayEntries() {
  if (_cache.ready && _cache.days) return [..._cache.days];
  const saved = localStorage.getItem("nt_days");
  return saved ? JSON.parse(saved) : [];
}

function saveDayEntries(entries) {
  _cache.days = [...entries];
  localStorage.setItem("nt_days", JSON.stringify(entries));
  bgWrite(async () => {
    const { error: delErr } = await sb.from('days').delete().gte('id', 0);
    if (delErr) throw delErr;
    if (entries.length > 0) {
      const rows = entries.map(dayJsToRow);
      const { error } = await sb.from('days').upsert(rows);
      if (error) throw error;
    }
  });
}

// ============================================================
// SEED DATA (imported from Excel)
// ============================================================

const SEED_FOOD = [
  { date:"2026-02-05", time:"11:00", food:"Fried rice", qty:1, unit:"cup", calLow:279, calHigh:300, proLow:5, proHigh:6 },
  { date:"2026-02-05", time:"11:00", food:"Beef stew", qty:160, unit:"g", calLow:185, calHigh:230, proLow:10, proHigh:13 },
  { date:"2026-02-05", time:"16:00", food:"Coffee with 1 tsp creamer and 1 tbsp milk", qty:1, unit:"cup", calLow:17, calHigh:25, proLow:0.5, proHigh:0.5 },
  { date:"2026-02-05", time:"11:00", food:"Nestle yogurt", qty:110, unit:"g", calLow:92, calHigh:92, proLow:3.5, proHigh:3.5 },
  { date:"2026-02-05", time:"17:00", food:"Unsalted roasted cashews", qty:29.5, unit:"g", calLow:185.85, calHigh:185.85, proLow:5, proHigh:5 },
  { date:"2026-02-05", time:"19:00", food:"Ribeye steak", qty:50, unit:"g", calLow:145, calHigh:165, proLow:12, proHigh:14 },
  { date:"2026-02-05", time:"19:00", food:"Baby back ribs", qty:2, unit:"ribs", calLow:160, calHigh:220, proLow:14, proHigh:16 },
  { date:"2026-02-05", time:"19:00", food:"White rice", qty:280, unit:"g", calLow:360, calHigh:390, proLow:7, proHigh:8 },
  { date:"2026-02-05", time:"22:00", food:"Protein shake", qty:2, unit:"scoop", calLow:244, calHigh:244, proLow:48, proHigh:48 },
  { date:"2026-02-05", time:"23:00", food:"Eggs w/ butter and 1 tbsp ketchup", qty:2, unit:"pieces", calLow:170, calHigh:150, proLow:10, proHigh:10 },
  { date:"2026-02-05", time:"23:00", food:"Fish oil", qty:1, unit:"capsule", calLow:15, calHigh:15, proLow:0, proHigh:0 },
  { date:"2026-02-06", time:"09:00", food:"Honeycured Bacon", qty:40, unit:"g", calLow:180, calHigh:180, proLow:12, proHigh:12 },
  { date:"2026-02-06", time:"09:00", food:"Eggs w/ 1 tsp butter", qty:2, unit:"pieces", calLow:176, calHigh:176, proLow:12, proHigh:12 },
  { date:"2026-02-06", time:"09:00", food:"Oatmeal", qty:0.5, unit:"cups", calLow:150, calHigh:150, proLow:5, proHigh:5 },
  { date:"2026-02-06", time:"09:00", food:"Blueberries", qty:0.5, unit:"cups", calLow:42, calHigh:42, proLow:0.5, proHigh:0.5 },
  { date:"2026-02-06", time:"09:00", food:"Honeycured Bacon", qty:10, unit:"g", calLow:30, calHigh:30, proLow:0, proHigh:0 },
  { date:"2026-02-06", time:"14:30", food:"Jollibee 1 pc. Chicken Rib", qty:1, unit:"pieces", calLow:200, calHigh:290, proLow:12, proHigh:15 },
  { date:"2026-02-06", time:"14:30", food:"White rice", qty:160, unit:"g", calLow:210, calHigh:210, proLow:4, proHigh:5 },
  { date:"2026-02-06", time:"14:30", food:"Jolly spaghetti", qty:1, unit:"order", calLow:500, calHigh:550, proLow:23, proHigh:23 },
  { date:"2026-02-06", time:"14:30", food:"Jolly fries", qty:40, unit:"g", calLow:120, calHigh:130, proLow:1, proHigh:2 },
  { date:"2026-02-06", time:"14:30", food:"Regular coke", qty:1, unit:"cup", calLow:140, calHigh:140, proLow:0, proHigh:0 },
  { date:"2026-02-06", time:"13:30", food:"Protein shake", qty:1, unit:"scoop", calLow:122, calHigh:122, proLow:24, proHigh:24 },
  { date:"2026-02-06", time:"17:00", food:"Coffee with 1 tsp creamer and 1 tbsp milk", qty:1, unit:"cup", calLow:17, calHigh:25, proLow:0.5, proHigh:0.5 },
  { date:"2026-02-06", time:"19:00", food:"Fish oil", qty:1, unit:"capsule", calLow:15, calHigh:15, proLow:0, proHigh:0 },
  { date:"2026-02-06", time:"19:00", food:"Chicken", qty:150, unit:"g", calLow:250, calHigh:250, proLow:45, proHigh:47 },
  { date:"2026-02-06", time:"21:00", food:"Royal", qty:160, unit:"ml", calLow:32, calHigh:32, proLow:0, proHigh:0 },
  { date:"2026-02-07", time:"07:30", food:"3 inch Bola-bola siopao", qty:2, unit:"pieces", calLow:480, calHigh:560, proLow:18, proHigh:24 },
  { date:"2026-02-07", time:"11:30", food:"Adobo chicken", qty:87, unit:"g", calLow:180, calHigh:180, proLow:23, proHigh:23 },
  { date:"2026-02-07", time:"11:30", food:"White rice", qty:160, unit:"g", calLow:160, calHigh:208, proLow:4, proHigh:4 },
  { date:"2026-02-07", time:"11:30", food:"Lean beef cubes", qty:45, unit:"g", calLow:72, calHigh:72, proLow:12, proHigh:12 },
  { date:"2026-02-07", time:"11:30", food:"Beef Tendon", qty:8, unit:"g", calLow:12, calHigh:12, proLow:3, proHigh:3 },
  { date:"2026-02-07", time:"11:30", food:"Noodles", qty:95, unit:"g", calLow:347, calHigh:347, proLow:10, proHigh:12 },
  { date:"2026-02-07", time:"20:00", food:"Icho Japanese Restaurant", qty:1, unit:"visit", calLow:970, calHigh:970, proLow:95, proHigh:95 },
  { date:"2026-02-07", time:"22:00", food:"Potato Fries Ketchup", qty:1, unit:"pack", calLow:300, calHigh:300, proLow:0, proHigh:0 },
  { date:"2026-02-08", time:"08:00", food:"Bacon", qty:41.5, unit:"g", calLow:225, calHigh:225, proLow:15, proHigh:15 },
  { date:"2026-02-08", time:"08:00", food:"White rice", qty:101.5, unit:"g", calLow:132, calHigh:132, proLow:2.7, proHigh:2.7 },
  { date:"2026-02-08", time:"12:00", food:"Tawilis", qty:2, unit:"pcs", calLow:80, calHigh:120, proLow:8, proHigh:12 },
  { date:"2026-02-08", time:"12:00", food:"Egg fried rice", qty:40, unit:"g", calLow:70, calHigh:80, proLow:1.5, proHigh:2.5 },
  { date:"2026-02-08", time:"23:59", food:"Protein shake", qty:1.25, unit:"scoop", calLow:152.5, calHigh:152.5, proLow:30, proHigh:30 },
  { date:"2026-02-08", time:"18:00", food:"Baliwag chicken", qty:180, unit:"g", calLow:300, calHigh:400, proLow:30, proHigh:40 },
  { date:"2026-02-08", time:"18:00", food:"Fried itik", qty:40, unit:"g", calLow:80, calHigh:100, proLow:8, proHigh:10 },
  { date:"2026-02-08", time:"18:00", food:"White rice", qty:150, unit:"g", calLow:195, calHigh:195, proLow:3, proHigh:4 },
  { date:"2026-02-08", time:"18:00", food:"Baliwag chicken", qty:70, unit:"g", calLow:120, calHigh:120, proLow:12, proHigh:12 },
  { date:"2026-02-08", time:"19:00", food:"Fish oil", qty:1, unit:"capsule", calLow:15, calHigh:15, proLow:0, proHigh:0 },
  { date:"2026-02-09", time:"09:00", food:"Eggs", qty:111, unit:"g", calLow:163, calHigh:163, proLow:14, proHigh:14 },
  { date:"2026-02-09", time:"09:00", food:"Rendered Bacon", qty:32, unit:"g", calLow:173, calHigh:173, proLow:11.8, proHigh:11.8 },
  { date:"2026-02-09", time:"09:00", food:"Oatmeal", qty:40, unit:"g", calLow:152, calHigh:152, proLow:5.3, proHigh:5.3 },
  { date:"2026-02-09", time:"09:00", food:"Blueberries", qty:0.25, unit:"cups", calLow:21, calHigh:21, proLow:0.3, proHigh:0.3 },
  { date:"2026-02-09", time:"09:00", food:"Honeycured Bacon", qty:12.5, unit:"g", calLow:38, calHigh:38, proLow:0, proHigh:0 },
  { date:"2026-02-09", time:"18:30", food:"White rice", qty:230, unit:"g", calLow:299, calHigh:299, proLow:6, proHigh:6 },
  { date:"2026-02-09", time:"18:30", food:"Beef stew", qty:40, unit:"g", calLow:50, calHigh:50, proLow:5, proHigh:5 },
  { date:"2026-02-09", time:"18:30", food:"Pork and chives dumpling", qty:4, unit:"pcs", calLow:250, calHigh:250, proLow:8, proHigh:8 },
  { date:"2026-02-09", time:"12:00", food:"White rice", qty:200, unit:"g", calLow:260, calHigh:260, proLow:5, proHigh:5 },
  { date:"2026-02-09", time:"12:00", food:"Beef stew", qty:140, unit:"g", calLow:175, calHigh:175, proLow:17, proHigh:17 },
  { date:"2026-02-09", time:"12:00", food:"Fish oil", qty:1, unit:"capsule", calLow:15, calHigh:15, proLow:0, proHigh:0 },
  { date:"2026-02-09", time:"22:30", food:"Protein shake", qty:1.5, unit:"scoop", calLow:183, calHigh:183, proLow:36, proHigh:36 },
  { date:"2026-02-09", time:"23:00", food:"Chicken", qty:2, unit:"pcs", calLow:310, calHigh:310, proLow:23, proHigh:23 },
  { date:"2026-02-09", time:"23:00", food:"White rice", qty:150, unit:"g", calLow:195, calHigh:195, proLow:4, proHigh:4 },
  { date:"2026-02-10", time:"09:00", food:"Honeycured Bacon", qty:42, unit:"g", calLow:190, calHigh:190, proLow:12, proHigh:12 },
  { date:"2026-02-10", time:"09:00", food:"Eggs", qty:109, unit:"g", calLow:155, calHigh:155, proLow:13, proHigh:13 },
  { date:"2026-02-10", time:"09:00", food:"Oatmeal", qty:0.5, unit:"cups", calLow:150, calHigh:150, proLow:5, proHigh:5 },
  { date:"2026-02-10", time:"09:00", food:"Blueberries", qty:0.25, unit:"cups", calLow:21, calHigh:21, proLow:0, proHigh:0 },
  { date:"2026-02-10", time:"12:00", food:"Lean beef cubes", qty:60, unit:"g", calLow:96, calHigh:96, proLow:16, proHigh:16 },
  { date:"2026-02-10", time:"12:00", food:"Noodles", qty:95, unit:"g", calLow:347, calHigh:347, proLow:10, proHigh:12 },
  { date:"2026-02-10", time:"19:30", food:"Lapu lapu fillet tempura", qty:77, unit:"g", calLow:160, calHigh:160, proLow:11, proHigh:11 },
  { date:"2026-02-10", time:"19:30", food:"Japanese mayonnaise", qty:22, unit:"g", calLow:150, calHigh:150, proLow:0.3, proHigh:0.3 },
  { date:"2026-02-10", time:"19:30", food:"White rice", qty:119, unit:"g", calLow:155, calHigh:155, proLow:3.2, proHigh:3.2 },
  { date:"2026-02-10", time:"19:30", food:"Shrimp (peeled)", qty:43.5, unit:"g", calLow:43, calHigh:43, proLow:10.4, proHigh:10.4 },
  { date:"2026-02-10", time:"19:30", food:"Pechay", qty:31.3, unit:"g", calLow:4, calHigh:4, proLow:0.5, proHigh:0.5 },
  { date:"2026-02-10", time:"19:30", food:"Protein shake", qty:2, unit:"scoop", calLow:244, calHigh:244, proLow:48, proHigh:48 },
  { date:"2026-02-10", time:"19:30", food:"Fish oil", qty:1, unit:"capsule", calLow:15, calHigh:15, proLow:0, proHigh:0 },
  { date:"2026-02-11", time:"10:00", food:"Fried rice", qty:125, unit:"g", calLow:162, calHigh:162, proLow:3.4, proHigh:3.4 },
  { date:"2026-02-11", time:"10:00", food:"Egg", qty:55, unit:"g", calLow:79, calHigh:79, proLow:6.9, proHigh:6.9 },
  { date:"2026-02-11", time:"10:00", food:"Shrimp (peeled)", qty:45, unit:"g", calLow:45, calHigh:45, proLow:10.8, proHigh:10.8 },
  { date:"2026-02-11", time:"10:00", food:"Lapu lapu fillet tempura", qty:50, unit:"g", calLow:100, calHigh:100, proLow:7.5, proHigh:7.5 },
  { date:"2026-02-11", time:"10:00", food:"Pechay", qty:30, unit:"g", calLow:4, calHigh:4, proLow:0.5, proHigh:0.5 },
  { date:"2026-02-11", time:"12:00", food:"White rice", qty:112.8, unit:"g", calLow:147, calHigh:147, proLow:3, proHigh:3 },
  { date:"2026-02-11", time:"12:00", food:"Steamed wanton", qty:87.84, unit:"g", calLow:132, calHigh:132, proLow:7, proHigh:7 },
  { date:"2026-02-11", time:"12:00", food:"Pechay", qty:20, unit:"g", calLow:3, calHigh:3, proLow:0.4, proHigh:0.4 },
  { date:"2026-02-11", time:"12:00", food:"Napoleones", qty:36.2, unit:"g", calLow:95, calHigh:95, proLow:1.2, proHigh:1.2 },
  { date:"2026-02-11", time:"12:00", food:"Chips", qty:30, unit:"g", calLow:150, calHigh:150, proLow:0, proHigh:0 },
  { date:"2026-02-11", time:"18:30", food:"Tenderloin Pork w/ Onions", qty:104.5, unit:"g", calLow:155, calHigh:155, proLow:27, proHigh:27 },
  { date:"2026-02-11", time:"18:30", food:"White rice", qty:198.7, unit:"g", calLow:258, calHigh:258, proLow:5.4, proHigh:5.4 },
  { date:"2026-02-11", time:"18:30", food:"Steamed wanton", qty:54.2, unit:"g", calLow:81, calHigh:81, proLow:4.3, proHigh:4.3 },
  { date:"2026-02-11", time:"18:30", food:"Fish oil", qty:1, unit:"capsule", calLow:15, calHigh:15, proLow:0, proHigh:0 },
  { date:"2026-02-11", time:"19:30", food:"Protein shake", qty:2, unit:"scoop", calLow:244, calHigh:244, proLow:48, proHigh:48 },
  { date:"2026-02-11", time:"19:30", food:"Banana", qty:1, unit:"pieces", calLow:110, calHigh:110, proLow:1, proHigh:1.3 },
  { date:"2026-02-12", time:"09:00", food:"Scrambled Eggs w/ 1 tsp butter", qty:105, unit:"g", calLow:190, calHigh:190, proLow:11, proHigh:11 },
  { date:"2026-02-12", time:"09:00", food:"Crispy Spam", qty:45, unit:"g", calLow:142, calHigh:142, proLow:6, proHigh:6 },
  { date:"2026-02-12", time:"09:00", food:"Oatmeal", qty:0.5, unit:"cups", calLow:152, calHigh:152, proLow:5, proHigh:5 },
  { date:"2026-02-12", time:"09:00", food:"Blueberries", qty:0.25, unit:"cups", calLow:21, calHigh:21, proLow:0.3, proHigh:0.3 },
  { date:"2026-02-12", time:"09:00", food:"White rice", qty:130, unit:"g", calLow:169, calHigh:169, proLow:3.5, proHigh:3.5 },
  { date:"2026-02-12", time:"09:00", food:"Lumpiang Shanghai", qty:85, unit:"g", calLow:230, calHigh:230, proLow:9, proHigh:9 },
  { date:"2026-02-12", time:"09:00", food:"Coffee with 1 tsp creamer", qty:9, unit:"g", calLow:45, calHigh:45, proLow:0, proHigh:0 },
];

const SEED_DAYS = [
  { date:"2026-02-05", age:32, weight:166, activity:"\u{1F3CB}\uFE0F Gym day (moderate workout)", deficit:550, proteinTargetLow:135, proteinTargetHigh:150 },
  { date:"2026-02-06", age:32, weight:166, activity:"\u{1F4AA} Hard gym session (intense)", deficit:550, proteinTargetLow:135, proteinTargetHigh:150 },
  { date:"2026-02-07", age:32, weight:166, activity:"\u{1F6B6} Light activity (walked / errands)", deficit:550, proteinTargetLow:135, proteinTargetHigh:150 },
  { date:"2026-02-08", age:32, weight:168, activity:"\u{1FA91} Sat all day (no exercise)", deficit:550, proteinTargetLow:135, proteinTargetHigh:150 },
  { date:"2026-02-09", age:32, weight:168, activity:"\u{1F4AA} Hard gym session (intense)", deficit:550, proteinTargetLow:135, proteinTargetHigh:150 },
  { date:"2026-02-10", age:32, weight:168, activity:"\u{1FA91} Sat all day (no exercise)", deficit:550, proteinTargetLow:135, proteinTargetHigh:150 },
  { date:"2026-02-11", age:32, weight:168, activity:"\u{1F6B6} Light activity (walked / errands)", deficit:550, proteinTargetLow:135, proteinTargetHigh:150 },
  { date:"2026-02-12", age:32, weight:168, activity:"\u{1FA91} Sat all day (no exercise)", deficit:550, proteinTargetLow:135, proteinTargetHigh:150 },
];

// ============================================================
// INITIALIZE DATA — Supabase with localStorage fallback
// ============================================================

const DATA_VERSION = 2; // Bump this when seed data changes

async function initFromSupabase() {
  const [foodRes, daysRes, profileRes, assessRes, settingsRes] = await Promise.all([
    sb.from('food_entries').select('*').order('date', { ascending: false }),
    sb.from('days').select('*').order('date', { ascending: false }),
    sb.from('profile').select('*').eq('id', 1).maybeSingle(),
    sb.from('assessments').select('*').order('timestamp', { ascending: false }),
    sb.from('settings').select('*'),
  ]);

  // Check for errors on critical tables
  if (foodRes.error) throw foodRes.error;
  if (daysRes.error) throw daysRes.error;

  const hasFoodData = foodRes.data && foodRes.data.length > 0;
  const hasDaysData = daysRes.data && daysRes.data.length > 0;
  const hasProfileData = profileRes.data != null;

  // If Supabase is empty, check if we should migrate from localStorage or seed
  if (!hasFoodData && !hasDaysData && !hasProfileData) {
    const localFood = localStorage.getItem("nt_food");
    const localDays = localStorage.getItem("nt_days");
    if (localFood || localDays) {
      // Migrate existing localStorage data to Supabase
      await migrateLocalStorageToSupabase();
    } else {
      // Fresh install — seed data
      await seedSupabase();
    }
    // Re-fetch after migration/seeding
    return initFromSupabase();
  }

  // Populate cache from Supabase data
  _cache.food = foodRes.data.map(foodRowToJs);
  _cache.days = daysRes.data.map(dayRowToJs);
  _cache.profile = hasProfileData ? profileRowToJs(profileRes.data) : { ...DEFAULT_PROFILE };
  _cache.assessments = (assessRes.data || []).map(r => r.data);

  // Settings (key-value pairs)
  _cache.settings = {};
  if (settingsRes.data) {
    for (const row of settingsRes.data) {
      _cache.settings[row.key] = row.value;
    }
  }

  // Sync back to localStorage as offline fallback
  localStorage.setItem("nt_food", JSON.stringify(_cache.food));
  localStorage.setItem("nt_days", JSON.stringify(_cache.days));
  localStorage.setItem("nt_profile", JSON.stringify(_cache.profile));
  localStorage.setItem("nt_assessments", JSON.stringify(_cache.assessments));

  _cache.ready = true;
  console.log('[Supabase] Loaded from cloud:', _cache.food.length, 'food entries,', _cache.days.length, 'days');
}

function initFromLocalStorage() {
  // Fallback: populate cache from localStorage (same as old behavior)
  const currentVersion = parseInt(localStorage.getItem("nt_version") || "0");
  if (currentVersion < DATA_VERSION) {
    const foodEntries = SEED_FOOD.map((f, i) => ({ id: i + 1, ...f }));
    localStorage.setItem("nt_food", JSON.stringify(foodEntries));
    const dayEntries = SEED_DAYS.map((d, i) => ({ id: i + 1, ...d }));
    localStorage.setItem("nt_days", JSON.stringify(dayEntries));
    localStorage.setItem("nt_profile", JSON.stringify(DEFAULT_PROFILE));
    localStorage.setItem("nt_version", String(DATA_VERSION));
  }

  const savedFood = localStorage.getItem("nt_food");
  _cache.food = savedFood ? JSON.parse(savedFood) : [];
  const savedDays = localStorage.getItem("nt_days");
  _cache.days = savedDays ? JSON.parse(savedDays) : [];
  const savedProfile = localStorage.getItem("nt_profile");
  _cache.profile = savedProfile ? JSON.parse(savedProfile) : { ...DEFAULT_PROFILE };
  const savedAssessments = localStorage.getItem("nt_assessments");
  _cache.assessments = savedAssessments ? JSON.parse(savedAssessments) : [];

  _cache.ready = true;
  console.log('[localStorage] Loaded from local storage (offline fallback)');
}

async function migrateLocalStorageToSupabase() {
  console.log('[Supabase] Migrating localStorage data to Supabase...');

  const foodRaw = localStorage.getItem("nt_food");
  const daysRaw = localStorage.getItem("nt_days");
  const profileRaw = localStorage.getItem("nt_profile");
  const assessmentsRaw = localStorage.getItem("nt_assessments");

  // Migrate food entries
  if (foodRaw) {
    const food = JSON.parse(foodRaw);
    if (food.length > 0) {
      const rows = food.map(foodJsToRow);
      const { error } = await sb.from('food_entries').upsert(rows);
      if (error) console.error('[Supabase] Food migration error:', error);
    }
  }

  // Migrate day entries
  if (daysRaw) {
    const days = JSON.parse(daysRaw);
    if (days.length > 0) {
      const rows = days.map(dayJsToRow);
      const { error } = await sb.from('days').upsert(rows);
      if (error) console.error('[Supabase] Days migration error:', error);
    }
  }

  // Migrate profile
  if (profileRaw) {
    const profile = JSON.parse(profileRaw);
    const { error } = await sb.from('profile').upsert(profileJsToRow(profile));
    if (error) console.error('[Supabase] Profile migration error:', error);
  }

  // Migrate assessments
  if (assessmentsRaw) {
    const assessments = JSON.parse(assessmentsRaw);
    if (assessments.length > 0) {
      const rows = assessments.map(a => ({
        timestamp: a.timestamp,
        period: a.period || 'unknown',
        data: a,
      }));
      const { error } = await sb.from('assessments').insert(rows);
      if (error) console.error('[Supabase] Assessments migration error:', error);
    }
  }

  // Migrate settings (provider modes, models, spread threshold — NOT API keys)
  const settingsToMigrate = [];
  for (const provider of ['openai', 'anthropic']) {
    const mode = localStorage.getItem(`nt_${provider}_mode`);
    if (mode) settingsToMigrate.push({ key: `${provider}_mode`, value: mode });
    const primary = localStorage.getItem(`nt_${provider}_primary`);
    if (primary) settingsToMigrate.push({ key: `${provider}_primary`, value: primary });
    const secondary = localStorage.getItem(`nt_${provider}_secondary`);
    if (secondary) settingsToMigrate.push({ key: `${provider}_secondary`, value: secondary });
  }
  const threshold = localStorage.getItem("nt_spread_threshold");
  if (threshold) settingsToMigrate.push({ key: 'spread_threshold', value: threshold });

  if (settingsToMigrate.length > 0) {
    const { error } = await sb.from('settings').upsert(settingsToMigrate);
    if (error) console.error('[Supabase] Settings migration error:', error);
  }

  console.log('[Supabase] Migration complete');
}

async function seedSupabase() {
  console.log('[Supabase] Seeding initial data...');
  const foodEntries = SEED_FOOD.map((f, i) => ({ id: i + 1, ...f }));
  const dayEntries = SEED_DAYS.map((d, i) => ({ id: i + 1, ...d }));

  const foodRows = foodEntries.map(foodJsToRow);
  const dayRows = dayEntries.map(dayJsToRow);

  await Promise.all([
    sb.from('food_entries').upsert(foodRows),
    sb.from('days').upsert(dayRows),
    sb.from('profile').upsert(profileJsToRow(DEFAULT_PROFILE)),
  ]);

  localStorage.setItem("nt_version", String(DATA_VERSION));
  console.log('[Supabase] Seeding complete');
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
  return {
    calLow: dayFoods.reduce((s, f) => s + (Number(f.calLow) || 0), 0),
    calHigh: dayFoods.reduce((s, f) => s + (Number(f.calHigh) || 0), 0),
    proLow: dayFoods.reduce((s, f) => s + (Number(f.proLow) || 0), 0),
    proHigh: dayFoods.reduce((s, f) => s + (Number(f.proHigh) || 0), 0),
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
  const filterDate = document.getElementById("food-date-filter").value;
  let entries = loadFoodEntries();

  if (filterDate) {
    entries = entries.filter((f) => f.date === filterDate);
  }

  // Sort by date desc, then time
  entries.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return a.time < b.time ? -1 : 1;
  });

  // Group by date
  const groups = {};
  entries.forEach((e) => {
    if (!groups[e.date]) groups[e.date] = [];
    groups[e.date].push(e);
  });

  let html = "";
  const sortedDates = Object.keys(groups).sort((a, b) => (a < b ? 1 : -1));

  for (const date of sortedDates) {
    const items = groups[date];
    // Date group header
    const totals = getDailyFoodTotals(date, loadFoodEntries());
    html += `<tr class="date-group-row">
      <td colspan="5">${formatDate(date)} - ${items.length} items</td>
      <td class="num">${renderNum(totals.calLow, 1)}</td>
      <td class="num">${renderNum(totals.calHigh, 1)}</td>
      <td class="num">${renderNum(totals.proLow, 1)}</td>
      <td class="num">${renderNum(totals.proHigh, 1)}</td>
      <td></td>
    </tr>`;

    for (const entry of items) {
      html += `<tr>
        <td>${formatDate(entry.date)}</td>
        <td>${formatTime(entry.time)}</td>
        <td>${escapeHtml(entry.food)}</td>
        <td class="num">${entry.qty}</td>
        <td>${escapeHtml(entry.unit)}</td>
        <td class="num">${renderNum(entry.calLow, 2)}</td>
        <td class="num">${renderNum(entry.calHigh, 2)}</td>
        <td class="num">${renderNum(entry.proLow, 2)}</td>
        <td class="num">${renderNum(entry.proHigh, 2)}</td>
        <td>
          <div class="actions">
            ${entry.aiThoughtProcess ? `<button class="btn-icon thought-btn" onclick="viewThoughtProcess(${entry.id})" title="View AI thought process">&#129504;</button>` : ''}
            <button class="btn-icon" onclick="editFood(${entry.id})" title="Edit">&#9998;</button>
            <button class="btn-icon delete" onclick="deleteFood(${entry.id})" title="Delete">&#10005;</button>
          </div>
        </td>
      </tr>`;
    }
  }

  if (!entries.length) {
    html = `<tr><td colspan="10" style="text-align:center;color:var(--text-dim);padding:32px;">No food entries yet. Click "+ Add Food" to start tracking.</td></tr>`;
  }

  tbody.innerHTML = html;
}

// ---- Calorie Tracker Table ----

function renderCalorieTracker() {
  const tbody = document.querySelector("#calorie-tracker-table tbody");
  const profile = loadProfile();
  const days = loadDayEntries();
  const food = loadFoodEntries();

  // Sort by date desc
  days.sort((a, b) => (a.date < b.date ? 1 : -1));

  let html = "";
  for (const day of days) {
    const bmr = calcBMR(day.weight, profile.height, day.age);
    const tdee = calcTDEE(bmr, day.activity);
    const target = tdee - day.deficit;
    const totals = getDailyFoodTotals(day.date, food);
    const surpLow = totals.calLow - target;
    const surpHigh = totals.calHigh - target;
    const proSurpLow = totals.proLow - day.proteinTargetLow;
    const proSurpHigh = totals.proHigh - day.proteinTargetHigh;

    html += `<tr class="day-summary">
      <td>${formatDate(day.date)}</td>
      <td class="num">${day.age}</td>
      <td class="num">${day.weight}</td>
      <td class="num">${renderNum(bmr, 1)}</td>
      <td>${escapeHtml(day.activity)}</td>
      <td class="num">${renderNum(tdee, 1)}</td>
      <td class="num">${day.deficit}</td>
      <td class="num">${renderNum(target, 0)}</td>
      <td class="num">${renderNum(totals.calLow, 1)}</td>
      <td class="num">${renderNum(totals.calHigh, 1)}</td>
      <td class="num ${surplusClass(surpLow)}">${renderNum(surpLow, 1)}</td>
      <td class="num ${surplusClass(surpHigh)}">${renderNum(surpHigh, 1)}</td>
      <td class="num">${renderNum(totals.proLow, 1)}</td>
      <td class="num">${renderNum(totals.proHigh, 1)}</td>
      <td class="num">${day.proteinTargetLow}</td>
      <td class="num">${day.proteinTargetHigh}</td>
      <td class="num ${surplusClass(-proSurpLow)}">${renderNum(proSurpLow, 1)}</td>
      <td class="num ${surplusClass(-proSurpHigh)}">${renderNum(proSurpHigh, 1)}</td>
      <td>
        <div class="actions">
          <button class="btn-icon" onclick="editDay(${day.id})" title="Edit">&#9998;</button>
          <button class="btn-icon delete" onclick="deleteDay(${day.id})" title="Delete">&#10005;</button>
        </div>
      </td>
    </tr>`;
  }

  if (!days.length) {
    html = `<tr><td colspan="19" style="text-align:center;color:var(--text-dim);padding:32px;">No daily entries yet. Click "+ Add Day" to start.</td></tr>`;
  }

  tbody.innerHTML = html;
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
}

// ============================================================
// FOOD CRUD
// ============================================================

function openFoodModal(entry) {
  const modal = document.getElementById("food-modal");
  const title = document.getElementById("food-modal-title");

  if (entry) {
    title.textContent = "Edit Food Entry";
    document.getElementById("food-id").value = entry.id;
    document.getElementById("food-date").value = entry.date;
    document.getElementById("food-time").value = entry.time;
    document.getElementById("food-name").value = entry.food;
    document.getElementById("food-qty").value = entry.qty;
    document.getElementById("food-unit").value = entry.unit;
    document.getElementById("food-cal-low").value = entry.calLow;
    document.getElementById("food-cal-high").value = entry.calHigh;
    document.getElementById("food-protein-low").value = entry.proLow;
    document.getElementById("food-protein-high").value = entry.proHigh;
    // Restore saved thought process
    if (entry.aiThoughtProcess) {
      _lastValidationData = entry.aiThoughtProcess;
    }
  } else {
    title.textContent = "Add Food Entry";
    document.getElementById("food-form").reset();
    document.getElementById("food-id").value = "";
    // Default date to today
    document.getElementById("food-date").value = new Date().toISOString().slice(0, 10);
    // Default time to now
    const now = new Date();
    document.getElementById("food-time").value =
      now.getHours().toString().padStart(2, "0") + ":" + now.getMinutes().toString().padStart(2, "0");
  }

  populateFoodSuggestions();
  document.getElementById("validation-results").innerHTML = "";
  setEstimateStatus("");

  // Show saved thought process if editing an entry that has one
  if (entry && entry.aiThoughtProcess) {
    renderValidationResults(entry.aiThoughtProcess);
  }

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

  // Copy defaults from most recent existing day, or use fallback defaults
  const sorted = [...days].sort((a, b) => (a.date < b.date ? 1 : -1));
  const prev = sorted[0];
  const profile = loadProfile();

  const maxId = days.length ? Math.max(...days.map((d) => d.id)) : 0;
  const newDay = {
    id: maxId + 1,
    date,
    age: prev ? prev.age : 32,
    weight: prev ? prev.weight : 168,
    activity: prev ? prev.activity : ACTIVITY_TYPES[0].label,
    deficit: prev ? prev.deficit : 550,
    proteinTargetLow: prev ? prev.proteinTargetLow : profile.proteinLow,
    proteinTargetHigh: prev ? prev.proteinTargetHigh : profile.proteinHigh,
  };

  days.push(newDay);
  saveDayEntries(days);
}

function saveFood(e) {
  e.preventDefault();
  const entries = loadFoodEntries();
  const id = document.getElementById("food-id").value;

  const entry = {
    date: document.getElementById("food-date").value,
    time: document.getElementById("food-time").value,
    food: document.getElementById("food-name").value,
    qty: parseFloat(document.getElementById("food-qty").value),
    unit: document.getElementById("food-unit").value,
    calLow: parseFloat(document.getElementById("food-cal-low").value),
    calHigh: parseFloat(document.getElementById("food-cal-high").value),
    proLow: parseFloat(document.getElementById("food-protein-low").value),
    proHigh: parseFloat(document.getElementById("food-protein-high").value),
  };

  // Attach AI thought process if available
  if (_lastValidationData) {
    entry.aiThoughtProcess = _lastValidationData;
    _lastValidationData = null;
  }

  // Preserve existing thought process if no new estimation was run
  if (!entry.aiThoughtProcess && id) {
    const existing = entries.find((e) => e.id === parseInt(id));
    if (existing && existing.aiThoughtProcess) {
      entry.aiThoughtProcess = existing.aiThoughtProcess;
    }
  }

  if (id) {
    // Edit
    const idx = entries.findIndex((e) => e.id === parseInt(id));
    if (idx !== -1) {
      entries[idx] = { ...entries[idx], ...entry };
    }
  } else {
    // Add
    const maxId = entries.length ? Math.max(...entries.map((e) => e.id)) : 0;
    entry.id = maxId + 1;
    entries.push(entry);
  }

  saveFoodEntries(entries);
  ensureDayExists(entry.date);
  closeFoodModal();
  renderFoodTable();
  renderCalorieTracker();
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

window.viewThoughtProcess = function (id) {
  const entries = loadFoodEntries();
  const entry = entries.find((e) => e.id === id);
  if (!entry || !entry.aiThoughtProcess) return;
  // Open the food modal in edit mode — it will display the saved thought process
  openFoodModal(entry);
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
  const title = document.getElementById("day-modal-title");
  const profile = loadProfile();

  populateActivitySelect();

  if (entry) {
    title.textContent = "Edit Day";
    document.getElementById("day-id").value = entry.id;
    document.getElementById("day-date").value = entry.date;
    document.getElementById("day-age").value = entry.age;
    document.getElementById("day-weight").value = entry.weight;
    document.getElementById("day-activity").value = entry.activity;
    document.getElementById("day-deficit").value = entry.deficit;
    document.getElementById("day-protein-target-low").value = entry.proteinTargetLow;
    document.getElementById("day-protein-target-high").value = entry.proteinTargetHigh;
  } else {
    title.textContent = "Add Day";
    document.getElementById("day-form").reset();
    document.getElementById("day-id").value = "";
    document.getElementById("day-date").value = new Date().toISOString().slice(0, 10);
    document.getElementById("day-deficit").value = 550;
    document.getElementById("day-protein-target-low").value = profile.proteinLow;
    document.getElementById("day-protein-target-high").value = profile.proteinHigh;
    // Default age/weight from last entry
    const days = loadDayEntries();
    if (days.length) {
      days.sort((a, b) => (a.date < b.date ? 1 : -1));
      document.getElementById("day-age").value = days[0].age;
      document.getElementById("day-weight").value = days[0].weight;
    }
  }

  modal.classList.remove("hidden");
}

function closeDayModal() {
  document.getElementById("day-modal").classList.add("hidden");
}

function saveDay(e) {
  e.preventDefault();
  const entries = loadDayEntries();
  const id = document.getElementById("day-id").value;

  const entry = {
    date: document.getElementById("day-date").value,
    age: parseInt(document.getElementById("day-age").value),
    weight: parseFloat(document.getElementById("day-weight").value),
    activity: document.getElementById("day-activity").value,
    deficit: parseFloat(document.getElementById("day-deficit").value),
    proteinTargetLow: parseFloat(document.getElementById("day-protein-target-low").value),
    proteinTargetHigh: parseFloat(document.getElementById("day-protein-target-high").value),
  };

  if (id) {
    const idx = entries.findIndex((e) => e.id === parseInt(id));
    if (idx !== -1) {
      entries[idx] = { ...entries[idx], ...entry };
    }
  } else {
    // Check for duplicate date
    if (entries.some((e) => e.date === entry.date)) {
      alert("A day entry for this date already exists. Please edit the existing entry instead.");
      return;
    }
    const maxId = entries.length ? Math.max(...entries.map((e) => e.id)) : 0;
    entry.id = maxId + 1;
    entries.push(entry);
  }

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
    proteinLow: parseFloat(document.getElementById("profile-protein-low").value),
    proteinHigh: parseFloat(document.getElementById("profile-protein-high").value),
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
  return div.innerHTML;
}

// ============================================================
// MULTI-AI PROVIDER INTEGRATION
// ============================================================

const SYSTEM_PROMPT_ESTIMATE = `You are a precise nutrition database assistant. You base estimates on USDA FoodData Central, nutrition labels, and established food composition databases. Be consistent and deterministic — the same food and quantity must always produce the same numbers.

You MUST respond with ONLY a JSON object (no markdown fences, no extra text) in this exact format:
{
  "reasoning": "<your step-by-step reasoning: identify the food, cite the database/source you are referencing, show the per-unit values, then multiply by the quantity>",
  "calories_lower": <number>,
  "calories_upper": <number>,
  "protein_lower": <number>,
  "protein_upper": <number>
}`;

const SYSTEM_PROMPT_RECONCILE = `You are a precise nutrition database assistant performing a reconciliation review. Two AI models estimated nutrition for the same food but disagreed. You must analyze both estimates, identify which is more accurate based on USDA FoodData Central and established databases, explain your reasoning, and provide corrected values.

You MUST respond with ONLY a JSON object (no markdown fences, no extra text) in this exact format:
{
  "reasoning": "<analyze each prior estimate, identify which is closer to database values and why, explain any corrections you are making>",
  "calories_lower": <number>,
  "calories_upper": <number>,
  "protein_lower": <number>,
  "protein_upper": <number>
}`;

// GPT-5+ and reasoning models use max_completion_tokens (includes thinking tokens) and don't support temperature
function openaiModelParams(model, tokens) {
  if (model.startsWith("gpt-5") || model.startsWith("o1") || model.startsWith("o3") || model.startsWith("o4")) {
    // Reasoning models need much higher limits — thinking/reasoning tokens count against the budget
    return { max_completion_tokens: Math.max(tokens * 8, 8000) };
  }
  return { max_tokens: tokens, temperature: 0 };
}

function extractOpenAIContent(data) {
  const choice = data.choices && data.choices[0];
  if (!choice) throw new Error("No response from OpenAI");
  if (choice.finish_reason === "length") {
    throw new Error("Response truncated (token limit reached) — try a simpler query or fewer items");
  }
  const content = choice.message && choice.message.content;
  if (!content) throw new Error("Empty response from OpenAI");
  return content;
}

const PROVIDERS = [
  {
    id: "openai",
    name: "OpenAI",
    keyName: "nt_key_openai",
    models: [
      { id: "gpt-5-mini", label: "GPT-5 Mini" },
      { id: "gpt-5.2", label: "GPT-5.2" },
      { id: "gpt-4o-mini", label: "GPT-4o Mini (legacy)" },
      { id: "gpt-4o", label: "GPT-4o (legacy)" },
    ],
    defaultPrimary: "gpt-5-mini",
    defaultSecondary: "gpt-5.2",
    call: async (food, qty, unit, apiKey, model) => {
      const prompt = buildEstimatePrompt(food, qty, unit);
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT_ESTIMATE },
            { role: "user", content: prompt },
          ],
          ...openaiModelParams(model, 500),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || `OpenAI API error ${res.status}`);
      }
      const data = await res.json();
      return parseAIResponse(extractOpenAIContent(data));
    },
    callReconciliation: async (food, qty, unit, apiKey, model, round1Results) => {
      const prompt = buildReconciliationPrompt(food, qty, unit, round1Results);
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT_RECONCILE },
            { role: "user", content: prompt },
          ],
          ...openaiModelParams(model, 600),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || `OpenAI API error ${res.status}`);
      }
      const data = await res.json();
      return parseAIResponse(extractOpenAIContent(data));
    },
  },
  {
    id: "anthropic",
    name: "Claude",
    keyName: "nt_key_anthropic",
    models: [
      { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
      { id: "claude-sonnet-4-5-20250929", label: "Sonnet 4.5" },
      { id: "claude-opus-4-6", label: "Opus 4.6" },
    ],
    defaultPrimary: "claude-haiku-4-5-20251001",
    defaultSecondary: "claude-opus-4-6",
    call: async (food, qty, unit, apiKey, model) => {
      const prompt = buildEstimatePrompt(food, qty, unit);
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model,
          max_tokens: 500,
          messages: [
            { role: "user", content: prompt },
          ],
          system: SYSTEM_PROMPT_ESTIMATE,
          temperature: 0,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || `Claude API error ${res.status}`);
      }
      const data = await res.json();
      return parseAIResponse(data.content[0].text);
    },
    callReconciliation: async (food, qty, unit, apiKey, model, round1Results) => {
      const prompt = buildReconciliationPrompt(food, qty, unit, round1Results);
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model,
          max_tokens: 600,
          messages: [
            { role: "user", content: prompt },
          ],
          system: SYSTEM_PROMPT_RECONCILE,
          temperature: 0,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || `Claude API error ${res.status}`);
      }
      const data = await res.json();
      return parseAIResponse(data.content[0].text);
    },
  },
];

function buildEstimatePrompt(food, qty, unit) {
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

function buildReconciliationPrompt(food, qty, unit, round1Results) {
  let estimateLines = round1Results
    .map((r) => {
      let line = `${r.providerName} estimated: calories ${r.data.calories_lower}-${r.data.calories_upper} kcal, protein ${r.data.protein_lower}-${r.data.protein_upper} g`;
      if (r.data.reasoning) line += `\n  Reasoning: ${r.data.reasoning}`;
      return line;
    })
    .join("\n\n");

  return `Two AI models estimated the nutrition for this food but disagreed. Review both estimates and their reasoning, then provide the corrected final answer.

Food: ${food}
Quantity: ${qty} ${unit}

--- Previous estimates ---
${estimateLines}

Instructions:
1. Compare both estimates against USDA FoodData Central or known nutrition data
2. Identify which estimate is more accurate and explain why
3. If one model made an error (wrong serving size, wrong food variant, etc.), call it out
4. Provide your corrected final values with reasoning`;
}

function parseAIResponse(content) {
  const cleaned = content.trim().replace(/```json?\s*/g, "").replace(/```/g, "").trim();
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`Invalid JSON from AI (response may have been truncated): ${e.message}`);
  }
  return {
    calories_lower: parsed.calories_lower,
    calories_upper: parsed.calories_upper,
    protein_lower: parsed.protein_lower,
    protein_upper: parsed.protein_upper,
    reasoning: parsed.reasoning || null,
  };
}

// --- Provider Settings ---

function getProviderSettings(providerId) {
  const provider = PROVIDERS.find((p) => p.id === providerId);
  if (!provider) return {};
  return {
    apiKey: localStorage.getItem(provider.keyName) || "",
    primaryModel: _cache.settings[`${providerId}_primary`] || localStorage.getItem(`nt_${providerId}_primary`) || provider.defaultPrimary,
    secondaryModel: _cache.settings[`${providerId}_secondary`] || localStorage.getItem(`nt_${providerId}_secondary`) || provider.defaultSecondary,
    mode: _cache.settings[`${providerId}_mode`] || localStorage.getItem(`nt_${providerId}_mode`) || "api",
  };
}

function saveProviderMode(providerId, mode) {
  const key = `${providerId}_mode`;
  _cache.settings[key] = mode;
  localStorage.setItem(`nt_${providerId}_mode`, mode);
  bgWrite(async () => {
    const { error } = await sb.from('settings').upsert({ key, value: mode });
    if (error) throw error;
  });
}

function saveProviderKey(providerId, key) {
  const provider = PROVIDERS.find((p) => p.id === providerId);
  if (provider) localStorage.setItem(provider.keyName, key);
  // API keys stay in localStorage only — never sent to Supabase
}

function saveProviderModel(providerId, role, modelId) {
  const key = `${providerId}_${role}`;
  _cache.settings[key] = modelId;
  localStorage.setItem(`nt_${providerId}_${role}`, modelId);
  bgWrite(async () => {
    const { error } = await sb.from('settings').upsert({ key, value: modelId });
    if (error) throw error;
  });
}

function getSpreadThreshold() {
  if (_cache.settings['spread_threshold']) return parseFloat(_cache.settings['spread_threshold']);
  return parseFloat(localStorage.getItem("nt_spread_threshold") || "15");
}

function saveSpreadThreshold(val) {
  _cache.settings['spread_threshold'] = String(val);
  localStorage.setItem("nt_spread_threshold", String(val));
  bgWrite(async () => {
    const { error } = await sb.from('settings').upsert({ key: 'spread_threshold', value: String(val) });
    if (error) throw error;
  });
}

// --- Spread Calculation ---

function calcSpread(results) {
  // results is an array of { calories_lower, calories_upper, protein_lower, protein_upper }
  const fields = ["calories_lower", "calories_upper", "protein_lower", "protein_upper"];
  let worstSpread = 0;

  for (const field of fields) {
    const values = results.map((r) => r[field]);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    if (avg === 0) continue;
    const spread = ((max - min) / avg) * 100;
    if (spread > worstSpread) worstSpread = spread;
  }

  return worstSpread;
}

function averageResults(results) {
  const n = results.length;
  return {
    calories_lower: Math.round(results.reduce((s, r) => s + r.calories_lower, 0) / n * 10) / 10,
    calories_upper: Math.round(results.reduce((s, r) => s + r.calories_upper, 0) / n * 10) / 10,
    protein_lower: Math.round(results.reduce((s, r) => s + r.protein_lower, 0) / n * 10) / 10,
    protein_upper: Math.round(results.reduce((s, r) => s + r.protein_upper, 0) / n * 10) / 10,
  };
}

// --- Last validation data (saved with food entry) ---
let _lastValidationData = null;

// --- Estimation Flow ---

async function estimateNutrition() {
  _lastValidationData = null;
  const food = document.getElementById("food-name").value.trim();
  const qty = document.getElementById("food-qty").value;
  const unit = document.getElementById("food-unit").value.trim();

  if (!food || !qty || !unit) {
    setEstimateStatus("Fill in food name, quantity, and unit first.", true);
    return;
  }

  // Determine which providers have API keys configured
  const activeProviders = PROVIDERS.filter((p) => {
    const settings = getProviderSettings(p.id);
    return settings.apiKey.length > 0;
  });

  if (activeProviders.length === 0) {
    setEstimateStatus("Configure at least one AI provider API key in the Calorie Target tab.", true);
    return;
  }

  const btn = document.getElementById("estimate-btn");
  btn.disabled = true;
  setEstimateStatus("Estimating...");
  document.getElementById("validation-results").innerHTML = "";

  try {
    // --- Round 1: Run all providers in parallel with primary models ---
    const round1Promises = activeProviders.map(async (provider) => {
      const settings = getProviderSettings(provider.id);
      try {
        const data = await provider.call(food, qty, unit, settings.apiKey, settings.primaryModel);
        return { providerId: provider.id, providerName: provider.name, data, error: null };
      } catch (err) {
        return { providerId: provider.id, providerName: provider.name, data: null, error: err.message };
      }
    });

    const round1Results = await Promise.all(round1Promises);
    const successful = round1Results.filter((r) => r.data !== null);
    const failed = round1Results.filter((r) => r.error !== null);

    if (successful.length === 0) {
      const errMsgs = failed.map((f) => `${f.providerName}: ${f.error}`).join("; ");
      setEstimateStatus(`All providers failed: ${errMsgs}`, true);
      btn.disabled = false;
      return;
    }

    // Single provider or only one succeeded — use directly
    if (successful.length === 1) {
      const result = successful[0].data;
      fillNutritionFields(result);
      const warning = failed.length > 0
        ? `${failed[0].providerName} failed. Using ${successful[0].providerName} only.`
        : `Only ${successful[0].providerName} configured. No cross-validation.`;
      _lastValidationData = {
        round: 1,
        round1: successful,
        failed,
        final: result,
        spread: 0,
        verdict: "single",
        warning,
      };
      renderValidationResults(_lastValidationData);
      setEstimateStatus("Done!");
      btn.disabled = false;
      return;
    }

    // Multiple providers succeeded — check spread
    const spread = calcSpread(successful.map((r) => r.data));
    const threshold = getSpreadThreshold();

    if (spread <= threshold) {
      // Consensus — use average
      const avg = averageResults(successful.map((r) => r.data));
      fillNutritionFields(avg);
      _lastValidationData = {
        round: 1,
        round1: successful,
        failed,
        final: avg,
        spread,
        threshold,
        verdict: "consensus",
      };
      renderValidationResults(_lastValidationData);
      setEstimateStatus("Done!");
      btn.disabled = false;
      return;
    }

    // --- Reconciliation loop: keep going until spread is within threshold (max 5 rounds) ---
    const MAX_ROUNDS = 5;
    const reconRounds = [];
    let prevResults = successful;
    let converged = false;

    for (let roundNum = 2; roundNum <= MAX_ROUNDS; roundNum++) {
      setEstimateStatus(`Providers disagreed — reconciling (round ${roundNum})...`);

      const reconPromises = activeProviders
        .filter((p) => prevResults.some((s) => s.providerId === p.id))
        .map(async (provider) => {
          const settings = getProviderSettings(provider.id);
          try {
            const data = await provider.callReconciliation(food, qty, unit, settings.apiKey, settings.secondaryModel, prevResults);
            return { providerId: provider.id, providerName: provider.name, model: settings.secondaryModel, data, error: null };
          } catch (err) {
            return { providerId: provider.id, providerName: provider.name, model: settings.secondaryModel, data: null, error: err.message };
          }
        });

      const reconResults = await Promise.all(reconPromises);
      const reconSuccessful = reconResults.filter((r) => r.data !== null);

      if (reconSuccessful.length === 0) {
        // This round failed — fall back to previous best
        const prevAvg = averageResults(prevResults.map((r) => r.data));
        fillNutritionFields(prevAvg);
        _lastValidationData = {
          round: roundNum - 1,
          round1: successful,
          reconRounds,
          failed,
          final: prevAvg,
          spread,
          threshold,
          verdict: "recon_failed",
        };
        renderValidationResults(_lastValidationData);
        setEstimateStatus(`Round ${roundNum} failed — using round ${roundNum - 1} average.`, true);
        btn.disabled = false;
        return;
      }

      const reconSpread = calcSpread(reconSuccessful.map((r) => r.data));
      reconRounds.push({ roundNum, results: reconSuccessful, spread: reconSpread });

      if (reconSpread <= threshold) {
        converged = true;
        const avg = averageResults(reconSuccessful.map((r) => r.data));
        fillNutritionFields(avg);
        _lastValidationData = {
          round: roundNum,
          round1: successful,
          reconRounds,
          failed,
          final: avg,
          spread,
          threshold,
          verdict: "reconciled",
        };
        renderValidationResults(_lastValidationData);
        setEstimateStatus("Done!");
        break;
      }

      // Spread still too high — feed this round's results as input to next round
      prevResults = reconSuccessful;
    }

    if (!converged) {
      // Hit max rounds — use the last round's average
      const lastRound = reconRounds[reconRounds.length - 1];
      const avg = averageResults(lastRound.results.map((r) => r.data));
      fillNutritionFields(avg);
      _lastValidationData = {
        round: MAX_ROUNDS,
        round1: successful,
        reconRounds,
        failed,
        final: avg,
        spread,
        threshold,
        verdict: "max_rounds",
      };
      renderValidationResults(_lastValidationData);
      setEstimateStatus(`Spread still ${lastRound.spread.toFixed(1)}% after ${MAX_ROUNDS} rounds — using last average.`, true);
    }
  } catch (err) {
    setEstimateStatus(err.message, true);
  } finally {
    btn.disabled = false;
  }
}

function fillNutritionFields(result) {
  document.getElementById("food-cal-low").value = result.calories_lower;
  document.getElementById("food-cal-high").value = result.calories_upper;
  document.getElementById("food-protein-low").value = result.protein_lower;
  document.getElementById("food-protein-high").value = result.protein_upper;
}

function setEstimateStatus(msg, isError = false) {
  const el = document.getElementById("estimate-status");
  el.textContent = msg;
  el.className = "estimate-status" + (isError ? " error" : "");
}

// --- Validation Results UI ---

function formatDelta(r1Val, r2Val) {
  const diff = r2Val - r1Val;
  if (Math.abs(diff) < 0.05) return '<span class="delta delta-same">=</span>';
  const arrow = diff > 0 ? "&#9650;" : "&#9660;";
  const cls = diff > 0 ? "delta-up" : "delta-down";
  return `<span class="delta ${cls}">${arrow}${Math.abs(diff).toFixed(1)}</span>`;
}

function renderReasoning(providerName, reasoning) {
  if (!reasoning) return '';
  return `<div class="reasoning-block">
    <details>
      <summary class="reasoning-toggle">${escapeHtml(providerName)}'s reasoning</summary>
      <div class="reasoning-text">${escapeHtml(reasoning)}</div>
    </details>
  </div>`;
}

function renderValidationResults(data) {
  const container = document.getElementById("validation-results");
  if (!container) return;

  let html = '<div class="validation-panel">';
  html += '<div class="validation-header">AI Thought Process</div>';

  // --- Round 1 section ---
  html += '<div class="round-label">Round 1 &mdash; Initial estimates (fast models)</div>';
  html += '<table class="validation-table"><thead><tr>';
  html += '<th>Provider</th><th>Cal &#8595;</th><th>Cal &#8593;</th><th>Pro &#8595;</th><th>Pro &#8593;</th>';
  html += '</tr></thead><tbody>';

  for (const r of data.round1) {
    html += `<tr>
      <td>${escapeHtml(r.providerName)}</td>
      <td class="num">${renderNum(r.data.calories_lower, 1)}</td>
      <td class="num">${renderNum(r.data.calories_upper, 1)}</td>
      <td class="num">${renderNum(r.data.protein_lower, 1)}</td>
      <td class="num">${renderNum(r.data.protein_upper, 1)}</td>
    </tr>`;
  }
  html += '</tbody></table>';

  // Round 1 reasoning
  for (const r of data.round1) {
    html += renderReasoning(r.providerName, r.data.reasoning);
  }

  // --- Verdict ---
  if (data.verdict === "single") {
    html += `<div class="verdict verdict-warning">&#9888; ${escapeHtml(data.warning)}</div>`;
  } else if (data.verdict === "consensus") {
    html += `<div class="verdict verdict-consensus">&#10003; Consensus reached (${data.spread.toFixed(1)}% spread, within ${data.threshold}% threshold)</div>`;
    html += '<div class="verdict-detail">Models agreed &mdash; final values are the average of Round 1.</div>';
  } else if ((data.verdict === "reconciled" || data.verdict === "max_rounds") && data.reconRounds) {
    html += `<div class="verdict verdict-escalated">&#9888; Round 1 spread: ${data.spread.toFixed(1)}% (exceeds ${data.threshold}% threshold)</div>`;
    html += '<div class="verdict-detail">Escalated to smarter secondary models for reconciliation.</div>';

    // --- Render each reconciliation round ---
    let prevRoundResults = data.round1;
    for (const rnd of data.reconRounds) {
      html += `<div class="round-label round-label-r2">Round ${rnd.roundNum} &mdash; Reconciliation (secondary models)</div>`;
      html += '<table class="validation-table"><thead><tr>';
      html += '<th>Provider</th><th>Cal &#8595;</th><th></th><th>Cal &#8593;</th><th></th><th>Pro &#8595;</th><th></th><th>Pro &#8593;</th><th></th>';
      html += '</tr></thead><tbody>';

      for (const r of rnd.results) {
        const prev = prevRoundResults.find((p) => p.providerId === r.providerId);
        const prevD = prev ? prev.data : r.data;
        html += `<tr>
          <td>${escapeHtml(r.providerName)}</td>
          <td class="num">${renderNum(r.data.calories_lower, 1)}</td>
          <td class="num">${formatDelta(prevD.calories_lower, r.data.calories_lower)}</td>
          <td class="num">${renderNum(r.data.calories_upper, 1)}</td>
          <td class="num">${formatDelta(prevD.calories_upper, r.data.calories_upper)}</td>
          <td class="num">${renderNum(r.data.protein_lower, 1)}</td>
          <td class="num">${formatDelta(prevD.protein_lower, r.data.protein_lower)}</td>
          <td class="num">${renderNum(r.data.protein_upper, 1)}</td>
          <td class="num">${formatDelta(prevD.protein_upper, r.data.protein_upper)}</td>
        </tr>`;
      }
      html += '</tbody></table>';

      for (const r of rnd.results) {
        html += renderReasoning(`${r.providerName} (R${rnd.roundNum})`, r.data.reasoning);
      }

      // Spread summary for this round
      const prevSpread = rnd.roundNum === 2 ? data.spread : data.reconRounds[data.reconRounds.indexOf(rnd) - 1].spread;
      html += `<div class="spread-summary">`;
      html += `Spread: <span class="spread-r1">${prevSpread.toFixed(1)}%</span> &#8594; <span class="spread-r2">${rnd.spread.toFixed(1)}%</span>`;
      if (rnd.spread < prevSpread) {
        html += ` <span class="spread-improved">(&#8595;${(prevSpread - rnd.spread).toFixed(1)}% reduction)</span>`;
      }
      html += '</div>';

      prevRoundResults = rnd.results;
    }

    if (data.verdict === "reconciled") {
      html += `<div class="verdict verdict-consensus">&#10003; Final values: average of Round ${data.round} reconciled estimates</div>`;
    } else {
      html += `<div class="verdict verdict-warning">&#9888; Spread still above threshold after ${data.round} rounds — using last round average</div>`;
    }
  } else if (data.verdict === "recon_failed") {
    html += `<div class="verdict verdict-warning">&#9888; Round 1 spread: ${data.spread.toFixed(1)}% (exceeds ${data.threshold}% threshold)</div>`;
    html += '<div class="verdict-detail">Reconciliation with secondary models failed. Falling back to previous round average.</div>';
  }

  // Failed providers
  if (data.failed && data.failed.length > 0) {
    for (const f of data.failed) {
      html += `<div class="verdict verdict-warning">&#9888; ${escapeHtml(f.providerName)} failed: ${escapeHtml(f.error)}</div>`;
    }
  }

  // Final values row
  html += '<div class="final-values-row">';
  html += `<span class="final-label">Final:</span> `;
  html += `Cal ${renderNum(data.final.calories_lower, 1)}&ndash;${renderNum(data.final.calories_upper, 1)} kcal | `;
  html += `Pro ${renderNum(data.final.protein_lower, 1)}&ndash;${renderNum(data.final.protein_upper, 1)} g`;
  html += '</div>';

  html += '</div>';
  container.innerHTML = html;
}

// --- Settings UI ---

function renderProviderSettings() {
  const container = document.getElementById("provider-settings");
  if (!container) return;

  let html = '<div class="settings-card"><h2>AI Providers</h2>';
  html += '<p style="font-size:0.78rem;color:var(--text-dim);margin-bottom:16px;">API keys are stored locally in your browser. Food estimation always uses the API. Diet Assessment can use API or Manual mode (free — paste into your subscription).</p>';

  for (const provider of PROVIDERS) {
    const settings = getProviderSettings(provider.id);
    html += `<div class="provider-section">`;
    html += `<h3 class="provider-name">${escapeHtml(provider.name)}</h3>`;

    // API key (always shown — needed for food estimation)
    html += `<div class="form-row">
      <label for="key-${provider.id}">API Key</label>
      <div class="key-row">
        <input type="password" id="key-${provider.id}" value="${escapeHtml(settings.apiKey)}" placeholder="${provider.id === 'openai' ? 'sk-...' : 'sk-ant-...'}">
        <button class="btn btn-primary btn-sm" onclick="saveProviderKeyUI('${provider.id}')">Save</button>
      </div>
    </div>`;

    // Primary model
    html += `<div class="form-row">
      <label for="primary-${provider.id}">Primary model (fast/cheap)</label>
      <select id="primary-${provider.id}" onchange="saveProviderModelUI('${provider.id}','primary',this.value)">`;
    for (const m of provider.models) {
      html += `<option value="${m.id}" ${settings.primaryModel === m.id ? 'selected' : ''}>${escapeHtml(m.label)}</option>`;
    }
    html += `</select></div>`;

    // Secondary model
    html += `<div class="form-row">
      <label for="secondary-${provider.id}">Secondary model (reconciliation)</label>
      <select id="secondary-${provider.id}" onchange="saveProviderModelUI('${provider.id}','secondary',this.value)">`;
    for (const m of provider.models) {
      html += `<option value="${m.id}" ${settings.secondaryModel === m.id ? 'selected' : ''}>${escapeHtml(m.label)}</option>`;
    }
    html += `</select></div>`;

    // Diet Assessment mode toggle
    html += `<div class="form-row">
      <label for="mode-${provider.id}">Diet Assessment mode</label>
      <select id="mode-${provider.id}" onchange="saveProviderModeUI('${provider.id}',this.value)">
        <option value="api" ${settings.mode === 'api' ? 'selected' : ''}>API (automatic)</option>
        <option value="manual" ${settings.mode === 'manual' ? 'selected' : ''}>Manual (free — use your subscription)</option>
      </select>
    </div>`;

    html += `</div>`;
  }

  html += '</div>';
  container.innerHTML = html;

  // Validation settings
  const valContainer = document.getElementById("validation-settings");
  if (!valContainer) return;

  const threshold = getSpreadThreshold();
  let valHtml = '<div class="settings-card"><h2>Validation Settings</h2>';
  valHtml += `<div class="form-row">
    <label for="spread-threshold">Spread threshold</label>
    <select id="spread-threshold" onchange="saveSpreadThresholdUI(this.value)">
      <option value="5" ${threshold === 5 ? 'selected' : ''}>5%</option>
      <option value="10" ${threshold === 10 ? 'selected' : ''}>10%</option>
      <option value="15" ${threshold === 15 ? 'selected' : ''}>15%</option>
      <option value="20" ${threshold === 20 ? 'selected' : ''}>20%</option>
    </select>
  </div>`;
  valHtml += '<p style="font-size:0.78rem;color:var(--text-dim);">If any nutrition field\'s spread between providers exceeds this threshold, models reconcile using their secondary (smarter) models.</p>';
  valHtml += '</div>';
  valContainer.innerHTML = valHtml;
}

window.saveProviderKeyUI = function (providerId) {
  const input = document.getElementById(`key-${providerId}`);
  if (input) {
    saveProviderKey(providerId, input.value.trim());
    alert(`${PROVIDERS.find((p) => p.id === providerId)?.name || providerId} API key saved!`);
  }
};

window.saveProviderModelUI = function (providerId, role, modelId) {
  saveProviderModel(providerId, role, modelId);
};

window.saveSpreadThresholdUI = function (val) {
  saveSpreadThreshold(parseFloat(val));
};

window.saveProviderModeUI = function (providerId, mode) {
  saveProviderMode(providerId, mode);
  renderProviderSettings();
};

// ============================================================
// DIET ASSESSMENT
// ============================================================

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

  let totalCalLow = 0, totalCalHigh = 0, totalProLow = 0, totalProHigh = 0;
  filteredFood.forEach(f => {
    totalCalLow += Number(f.calLow) || 0;
    totalCalHigh += Number(f.calHigh) || 0;
    totalProLow += Number(f.proLow) || 0;
    totalProHigh += Number(f.proHigh) || 0;
  });

  // Per-day calorie context (TDEE varies by activity)
  const dailyContext = {};
  let avgProTargetLow = null, avgProTargetHigh = null;
  if (filteredDays.length > 0) {
    let totalProTLow = 0, totalProTHigh = 0;
    filteredDays.forEach(day => {
      const bmr = calcBMR(day.weight, profile.height, day.age);
      const tdee = calcTDEE(bmr, day.activity);
      const target = tdee - day.deficit;
      dailyContext[day.date] = {
        activity: day.activity,
        tdee: Math.round(tdee),
        deficit: day.deficit,
        calorieTarget: Math.round(target),
      };
      totalProTLow += day.proteinTargetLow;
      totalProTHigh += day.proteinTargetHigh;
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

// --- Prompt Builder ---

function buildAssessmentPrompt(data) {
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
      const eatLow = dayFoods.reduce((s, f) => s + (Number(f.calLow) || 0), 0);
      const eatHigh = dayFoods.reduce((s, f) => s + (Number(f.calHigh) || 0), 0);
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
      const pyAvgTDEE = Math.round(pyCtx.reduce((s, c) => s + c.tdee, 0) / pyCtx.length);
      const pyAvgTarget = Math.round(pyCtx.reduce((s, c) => s + c.calorieTarget, 0) / pyCtx.length);
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
      prompt += `  ${item.time} - ${item.food}, ${item.qty} ${item.unit} (${item.calLow}-${item.calHigh} cal, ${item.proLow}-${item.proHigh}g protein)\n`;
    }
  }

  return prompt;
}

function buildAssessmentReconciliationPrompt(data, round1Results) {
  let prompt = buildAssessmentPrompt(data);
  prompt += `\n\n--- Two Independent Analyses (anonymized) ---\n`;
  // Anonymize: shuffle order randomly so judge can't infer which is which
  const shuffled = [...round1Results].sort(() => Math.random() - 0.5);
  prompt += `\nAnalysis A:\n`;
  prompt += JSON.stringify(shuffled[0].data, null, 2);
  prompt += `\n\nAnalysis B:\n`;
  prompt += JSON.stringify(shuffled[1].data, null, 2);
  prompt += `\n\nFor each category where A and B disagree, re-examine the raw food data above and determine which is correct. Do NOT average or compromise — pick the answer supported by the data, or give your own if both are wrong. Cite specific foods from the log in your reasoning.`;
  return prompt;
}

// --- API Call Wrapper ---

async function callProviderForAssessment(provider, prompt, model, systemPrompt) {
  const settings = getProviderSettings(provider.id);
  const apiKey = settings.apiKey;

  if (provider.id === "openai") {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt },
        ],
        ...openaiModelParams(model, 8000),
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `OpenAI API error ${res.status}`);
    }
    const data = await res.json();
    return parseAssessmentResponse(extractOpenAIContent(data));
  } else if (provider.id === "anthropic") {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model,
        max_tokens: 8000,
        messages: [
          { role: "user", content: prompt },
        ],
        system: systemPrompt,
        temperature: 0,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `Claude API error ${res.status}`);
    }
    const data = await res.json();
    if (data.stop_reason === "max_tokens") {
      throw new Error("Response truncated (token limit reached)");
    }
    return parseAssessmentResponse(data.content[0].text);
  }
  throw new Error(`Unknown provider: ${provider.id}`);
}

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

async function runDietAssessment() {
  const period = document.getElementById("assessment-period").value;
  const data = getAssessmentData(period);

  if (data.totalEntries === 0) {
    setAssessmentStatus("No food entries found for this period. Add food entries first.", true);
    return;
  }

  const activeProviders = PROVIDERS.filter(p => {
    const settings = getProviderSettings(p.id);
    return settings.mode === "manual" || settings.apiKey.length > 0;
  });

  if (activeProviders.length === 0) {
    setAssessmentStatus("Configure at least one AI provider (API key or manual mode) in the Calorie Target tab.", true);
    return;
  }

  const btn = document.getElementById("run-assessment-btn");
  btn.disabled = true;
  setAssessmentStatus("Analyzing your diet...");
  document.getElementById("assessment-results").innerHTML = "";

  renderAssessmentDataSummary(data);

  const prompt = buildAssessmentPrompt(data);

  try {
    // --- Round 1: Manual providers first (need user interaction), then API in parallel ---
    const apiProviders = activeProviders.filter(p => getProviderSettings(p.id).mode === "api");
    const manualProviders = activeProviders.filter(p => getProviderSettings(p.id).mode === "manual");

    const fullPrompt = SYSTEM_PROMPT_DIET_ASSESSMENT + "\n\n" + prompt;

    // Run manual providers first so user isn't blocked by API calls
    const manualResults = [];
    for (const provider of manualProviders) {
      setAssessmentStatus(`Waiting for manual input (${provider.name})...`);
      try {
        const result = await promptManualResponse(`Round 1 — ${provider.name}`, fullPrompt);
        manualResults.push({ providerId: provider.id, providerName: provider.name + " (manual)", model: "your AI", data: result, error: null });
      } catch (err) {
        manualResults.push({ providerId: provider.id, providerName: provider.name + " (manual)", model: "your AI", data: null, error: err.message });
      }
    }

    // Then run API providers in parallel
    if (apiProviders.length > 0) setAssessmentStatus("Analyzing your diet...");
    const apiPromises = apiProviders.map(async provider => {
      const settings = getProviderSettings(provider.id);
      try {
        const result = await callProviderForAssessment(provider, prompt, settings.primaryModel, SYSTEM_PROMPT_DIET_ASSESSMENT);
        return { providerId: provider.id, providerName: provider.name, model: settings.primaryModel, data: result, error: null };
      } catch (err) {
        return { providerId: provider.id, providerName: provider.name, model: settings.primaryModel, data: null, error: err.message };
      }
    });

    const apiResults = await Promise.all(apiPromises);

    const round1Results = [...manualResults, ...apiResults];
    const successful = round1Results.filter(r => r.data !== null);
    const failed = round1Results.filter(r => r.error !== null);

    if (successful.length === 0) {
      const errMsgs = failed.map(f => `${f.providerName}: ${f.error}`).join("; ");
      setAssessmentStatus(`All providers failed: ${errMsgs}`, true);
      btn.disabled = false;
      return;
    }

    // Single provider
    if (successful.length === 1) {
      const warning = failed.length > 0
        ? `${failed[0].providerName} failed. Using ${successful[0].providerName} only.`
        : `Only ${successful[0].providerName} configured. No cross-validation.`;

      const resultObj = {
        timestamp: new Date().toISOString(),
        period,
        dataSummary: { startDate: data.startDate, endDate: data.endDate, numDays: data.numDays, totalEntries: data.totalEntries, avgCalLow: data.avgCalLow, avgCalHigh: data.avgCalHigh },
        round: 1,
        round1: successful,
        failed,
        final: successful[0].data,
        verdict: "single",
        warning,
      };

      renderAssessmentResults(resultObj);
      saveAssessment(resultObj);
      renderAssessmentHistory();
      setAssessmentStatus("Done!");
      btn.disabled = false;
      return;
    }

    // Two providers — check agreement
    const agreement = checkAssessmentAgreement(successful[0].data, successful[1].data);

    if (!agreement.needsEscalation) {
      // Consensus
      const merged = averageAssessmentScores(successful.map(r => r.data));
      const resultObj = {
        timestamp: new Date().toISOString(),
        period,
        dataSummary: { startDate: data.startDate, endDate: data.endDate, numDays: data.numDays, totalEntries: data.totalEntries, avgCalLow: data.avgCalLow, avgCalHigh: data.avgCalHigh },
        round: 1,
        round1: successful,
        failed,
        agreement,
        final: merged,
        verdict: "consensus",
      };

      renderAssessmentResults(resultObj);
      saveAssessment(resultObj);
      renderAssessmentHistory();
      setAssessmentStatus("Done!");
      btn.disabled = false;
      return;
    }

    // --- Round 2: Both providers re-evaluate with debiased prompt ---
    setAssessmentStatus(`Providers disagreed on ${agreement.disagreements}/${agreement.total} categories — both re-evaluating...`);

    const reconPrompt = buildAssessmentReconciliationPrompt(data, successful);
    const fullReconPrompt = SYSTEM_PROMPT_DIET_RECONCILE + "\n\n" + reconPrompt;

    const r2ActiveProviders = activeProviders.filter(p => successful.some(s => s.providerId === p.id));
    const r2ApiProviders = r2ActiveProviders.filter(p => getProviderSettings(p.id).mode === "api");
    const r2ManualProviders = r2ActiveProviders.filter(p => getProviderSettings(p.id).mode === "manual");

    // Run manual R2 first so user isn't blocked by API calls
    const r2ManualResults = [];
    for (const provider of r2ManualProviders) {
      setAssessmentStatus(`Waiting for manual Round 2 input (${provider.name})...`);
      try {
        const result = await promptManualResponse(`Round 2 — ${provider.name} (Debiased Re-evaluation)`, fullReconPrompt);
        r2ManualResults.push({ providerId: provider.id, providerName: provider.name + " (manual)", model: "your AI", data: result, error: null });
      } catch (err) {
        r2ManualResults.push({ providerId: provider.id, providerName: provider.name + " (manual)", model: "your AI", data: null, error: err.message });
      }
    }

    // Then run API R2 in parallel
    if (r2ApiProviders.length > 0) setAssessmentStatus(`Providers disagreed on ${agreement.disagreements}/${agreement.total} categories — both re-evaluating...`);
    const r2ApiPromises = r2ApiProviders.map(async provider => {
      const settings = getProviderSettings(provider.id);
      try {
        const result = await callProviderForAssessment(provider, reconPrompt, settings.secondaryModel, SYSTEM_PROMPT_DIET_RECONCILE);
        return { providerId: provider.id, providerName: provider.name, model: settings.secondaryModel, data: result, error: null };
      } catch (err) {
        return { providerId: provider.id, providerName: provider.name, model: settings.secondaryModel, data: null, error: err.message };
      }
    });

    const r2ApiResults = await Promise.all(r2ApiPromises);

    const round2Results = [...r2ManualResults, ...r2ApiResults];
    const r2Successful = round2Results.filter(r => r.data !== null);
    const r2Failed = round2Results.filter(r => r.error !== null);

    if (r2Successful.length === 0) {
      // Both R2 failed — fall back to R1 average
      const merged = averageAssessmentScores(successful.map(r => r.data));
      const resultObj = {
        timestamp: new Date().toISOString(),
        period,
        dataSummary: { startDate: data.startDate, endDate: data.endDate, numDays: data.numDays, totalEntries: data.totalEntries, avgCalLow: data.avgCalLow, avgCalHigh: data.avgCalHigh },
        round: 1,
        round1: successful,
        failed,
        agreement,
        final: merged,
        verdict: "r2_failed",
      };
      renderAssessmentResults(resultObj);
      saveAssessment(resultObj);
      renderAssessmentHistory();
      setAssessmentStatus("Round 2 failed — using Round 1 average.", true);
      btn.disabled = false;
      return;
    }

    const r2Merged = averageAssessmentScores(r2Successful.map(r => r.data));
    const r2Agreement = r2Successful.length >= 2 ? checkAssessmentAgreement(r2Successful[0].data, r2Successful[1].data) : null;

    const resultObj = {
      timestamp: new Date().toISOString(),
      period,
      dataSummary: { startDate: data.startDate, endDate: data.endDate, numDays: data.numDays, totalEntries: data.totalEntries, avgCalLow: data.avgCalLow, avgCalHigh: data.avgCalHigh },
      round: 2,
      round1: successful,
      round2: r2Successful,
      failed,
      r2Failed,
      agreement,
      r2Agreement,
      final: r2Merged,
      verdict: "reconciled",
    };

    renderAssessmentResults(resultObj);
    saveAssessment(resultObj);
    renderAssessmentHistory();
    setAssessmentStatus("Done!");
  } catch (err) {
    setAssessmentStatus(err.message, true);
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

// --- Manual Mode ---

function promptManualResponse(title, fullPrompt) {
  return new Promise((resolve, reject) => {
    const modal = document.getElementById("manual-modal");
    const titleEl = document.getElementById("manual-modal-title");
    const body = document.getElementById("manual-modal-body");

    titleEl.textContent = title;

    let html = '<div class="manual-step">';
    html += '<div class="manual-step-label">Step 1: Copy the prompt and paste into your AI</div>';
    html += '<div class="manual-prompt-actions">';
    html += '<button class="btn btn-primary btn-sm" id="manual-copy-btn">Copy Prompt to Clipboard</button>';
    html += '<button class="btn btn-secondary btn-sm" id="manual-open-claude">Open claude.ai</button>';
    html += '<button class="btn btn-secondary btn-sm" id="manual-open-chatgpt">Open chatgpt.com</button>';
    html += '</div>';
    html += '<details class="food-log-details" style="margin-top:8px"><summary class="food-log-toggle">View full prompt</summary>';
    html += `<pre class="manual-prompt-preview">${escapeHtml(fullPrompt)}</pre>`;
    html += '</details>';
    html += '</div>';

    html += '<div class="manual-step">';
    html += '<div class="manual-step-label">Step 2: Paste the JSON response below</div>';
    html += '<textarea id="manual-response-input" class="manual-textarea" placeholder="Paste the full JSON response here..."></textarea>';
    html += '<div id="manual-parse-error" class="manual-error hidden"></div>';
    html += '</div>';

    html += '<div class="modal-actions">';
    html += '<button class="btn btn-secondary" id="manual-cancel">Cancel</button>';
    html += '<button class="btn btn-primary" id="manual-submit">Submit Response</button>';
    html += '</div>';

    body.innerHTML = html;
    modal.classList.remove("hidden");

    document.getElementById("manual-copy-btn").addEventListener("click", () => {
      navigator.clipboard.writeText(fullPrompt).then(() => {
        const btn = document.getElementById("manual-copy-btn");
        btn.textContent = "Copied!";
        setTimeout(() => btn.textContent = "Copy Prompt to Clipboard", 2000);
      });
    });

    document.getElementById("manual-open-claude").addEventListener("click", () => {
      navigator.clipboard.writeText(fullPrompt).then(() => {
        window.open("https://claude.ai/new", "_blank");
      });
    });

    document.getElementById("manual-open-chatgpt").addEventListener("click", () => {
      navigator.clipboard.writeText(fullPrompt).then(() => {
        window.open("https://chatgpt.com", "_blank");
      });
    });

    document.getElementById("manual-cancel").addEventListener("click", () => {
      modal.classList.add("hidden");
      reject(new Error("Cancelled by user"));
    });

    document.getElementById("manual-submit").addEventListener("click", () => {
      const input = document.getElementById("manual-response-input").value.trim();
      const errorEl = document.getElementById("manual-parse-error");
      errorEl.classList.add("hidden");

      try {
        const cleaned = input.replace(/```json?\s*/g, "").replace(/```/g, "").trim();
        const parsed = JSON.parse(cleaned);
        modal.classList.add("hidden");
        resolve(parsed);
      } catch (e) {
        errorEl.textContent = "Failed to parse JSON: " + e.message;
        errorEl.classList.remove("hidden");
      }
    });
  });
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
      const eatLow = Math.round(dayFoods.reduce((s, f) => s + (Number(f.calLow) || 0), 0));
      const eatHigh = Math.round(dayFoods.reduce((s, f) => s + (Number(f.calHigh) || 0), 0));

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
  const saved = localStorage.getItem("nt_assessments");
  return saved ? JSON.parse(saved) : [];
}

function saveAssessment(result) {
  const assessments = loadAssessments();
  assessments.unshift(result);
  while (assessments.length > 20) assessments.pop();
  _cache.assessments = [...assessments];
  localStorage.setItem("nt_assessments", JSON.stringify(assessments));
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
  localStorage.setItem("nt_assessments", JSON.stringify(assessments));
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

const SYSTEM_PROMPT_BATCH_ESTIMATE = `You are a precise nutrition database assistant. You base estimates on USDA FoodData Central, nutrition labels, and established food composition databases. Be consistent and deterministic — the same food and quantity must always produce the same numbers.

You will receive a numbered list of food items. For EACH item, identify the food, reference the database/source, calculate per-unit values, then scale to the given quantity.

You MUST respond with ONLY a JSON object (no markdown fences, no extra text) in this exact format:
{
  "reasoning": "<step-by-step for each item: identify food, cite source, per-unit values, scale to quantity>",
  "items": [
    { "food": "<echo back food name>", "calories_lower": <number>, "calories_upper": <number>, "protein_lower": <number>, "protein_upper": <number> },
    ...
  ]
}
Items MUST be in the same order as the input list. The items array length MUST match the number of input items.`;

const SYSTEM_PROMPT_BATCH_RECONCILE = `You are a precise nutrition database assistant performing a reconciliation review. Two AI models estimated nutrition for multiple food items but disagreed. You must analyze both sets of estimates, identify which is more accurate based on USDA FoodData Central and established databases, explain your reasoning, and provide corrected values for ALL items.

You MUST respond with ONLY a JSON object (no markdown fences, no extra text) in this exact format:
{
  "reasoning": "<analyze each prior estimate set, identify which is closer to database values and why, explain any corrections>",
  "items": [
    { "food": "<echo back food name>", "calories_lower": <number>, "calories_upper": <number>, "protein_lower": <number>, "protein_upper": <number> },
    ...
  ]
}
Items MUST be in the same order as the input list. The items array length MUST match the number of input items.`;

function buildBatchEstimatePrompt(items) {
  let numbered = items.map((item, i) =>
    `${i + 1}. Food: ${item.food} | Quantity: ${item.qty} ${item.unit}`
  ).join("\n");

  return `Estimate the nutritional content of each food item below:

${numbered}

For each item, identify the food, reference USDA/nutrition databases, calculate per-unit values, then scale to the given quantity.`;
}

function buildBatchReconciliationPrompt(items, round1Results) {
  let numbered = items.map((item, i) =>
    `${i + 1}. Food: ${item.food} | Quantity: ${item.qty} ${item.unit}`
  ).join("\n");

  let estimateLines = round1Results.map((r) => {
    let lines = `${r.providerName} estimated:\n`;
    lines += r.data.items.map((item, i) =>
      `  ${i + 1}. ${item.food}: calories ${item.calories_lower}-${item.calories_upper} kcal, protein ${item.protein_lower}-${item.protein_upper} g`
    ).join("\n");
    if (r.data.reasoning) lines += `\n  Reasoning: ${r.data.reasoning}`;
    return lines;
  }).join("\n\n");

  return `Two AI models estimated the nutrition for these food items but disagreed. Review both estimates and their reasoning, then provide corrected final answers for ALL items.

Food items:
${numbered}

--- Previous estimates ---
${estimateLines}

Instructions:
1. Compare both estimates against USDA FoodData Central or known nutrition data
2. Identify which estimate is more accurate for each item and explain why
3. If a model made an error (wrong serving size, wrong food variant, etc.), call it out
4. Provide your corrected final values for ALL items with reasoning`;
}

function parseBatchAIResponse(content, expectedCount) {
  const cleaned = content.trim().replace(/```json?\s*/g, "").replace(/```/g, "").trim();
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`Invalid JSON from AI (response may have been truncated): ${e.message}`);
  }

  if (!parsed.items || !Array.isArray(parsed.items)) {
    throw new Error("Response missing 'items' array");
  }
  if (parsed.items.length !== expectedCount) {
    throw new Error(`Expected ${expectedCount} items but got ${parsed.items.length}`);
  }

  for (let i = 0; i < parsed.items.length; i++) {
    const item = parsed.items[i];
    if (item.calories_lower == null || item.calories_upper == null ||
        item.protein_lower == null || item.protein_upper == null) {
      throw new Error(`Item ${i + 1} missing required nutrition fields`);
    }
  }

  return {
    reasoning: parsed.reasoning || null,
    items: parsed.items.map(item => ({
      food: item.food || "",
      calories_lower: item.calories_lower,
      calories_upper: item.calories_upper,
      protein_lower: item.protein_lower,
      protein_upper: item.protein_upper,
    })),
  };
}

function setBatchEstimateStatus(msg, isError = false) {
  const el = document.getElementById("batch-estimate-status");
  el.textContent = msg;
  el.className = "estimate-status" + (isError ? " error" : "");
}

let _batchValidationData = null;

async function estimateBatchNutrition() {
  _batchValidationData = null;

  // Collect items from rows
  const rows = document.querySelectorAll("#batch-items .batch-item-row");
  const items = [];
  for (const row of rows) {
    const food = row.querySelector(".batch-food").value.trim();
    const qty = row.querySelector(".batch-qty").value;
    const unit = row.querySelector(".batch-unit").value.trim();
    if (food && qty && unit) {
      items.push({ food, qty: parseFloat(qty), unit });
    }
  }

  if (items.length === 0) {
    setBatchEstimateStatus("Enter at least one food item with quantity and unit.", true);
    return;
  }

  // Check all rows are filled
  for (const row of rows) {
    const food = row.querySelector(".batch-food").value.trim();
    const qty = row.querySelector(".batch-qty").value;
    const unit = row.querySelector(".batch-unit").value.trim();
    if ((food || qty || unit) && !(food && qty && unit)) {
      setBatchEstimateStatus("Fill in all fields for each row, or clear empty rows.", true);
      return;
    }
  }

  // Get active providers with API keys (food estimation always uses API)
  const activeProviders = PROVIDERS.filter((p) => {
    const settings = getProviderSettings(p.id);
    return settings.apiKey.length > 0;
  });

  if (activeProviders.length === 0) {
    setBatchEstimateStatus("Configure at least one AI provider API key in the Calorie Target tab.", true);
    return;
  }

  const btn = document.getElementById("batch-estimate-btn");
  btn.disabled = true;
  setBatchEstimateStatus("Estimating all items...");
  document.getElementById("batch-results").innerHTML = "";
  document.getElementById("batch-save").disabled = true;

  const maxTokens = Math.max(1500, items.length * 300);

  try {
    // --- Round 1: All providers in parallel with primary models ---
    const batchPrompt = buildBatchEstimatePrompt(items);

    const round1Promises = activeProviders.map(async (provider) => {
      const settings = getProviderSettings(provider.id);
      try {
        const data = await callProviderBatch(provider, settings.apiKey, settings.primaryModel, SYSTEM_PROMPT_BATCH_ESTIMATE, batchPrompt, maxTokens, items.length);
        return { providerId: provider.id, providerName: provider.name, data, error: null };
      } catch (err) {
        return { providerId: provider.id, providerName: provider.name, data: null, error: err.message };
      }
    });

    const round1Results = await Promise.all(round1Promises);
    const successful = round1Results.filter((r) => r.data !== null);
    const failed = round1Results.filter((r) => r.error !== null);

    if (successful.length === 0) {
      const errMsgs = failed.map((f) => `${f.providerName}: ${f.error}`).join("; ");
      setBatchEstimateStatus(`All providers failed: ${errMsgs}`, true);
      btn.disabled = false;
      return;
    }

    // Single provider — use directly
    if (successful.length === 1) {
      const finalItems = successful[0].data.items;
      _batchValidationData = {
        round: 1,
        round1: successful,
        failed,
        finalItems,
        spread: 0,
        verdict: "single",
        warning: failed.length > 0
          ? `${failed[0].providerName} failed. Using ${successful[0].providerName} only.`
          : `Only ${successful[0].providerName} configured. No cross-validation.`,
      };
      renderBatchResults(items, finalItems, _batchValidationData);
      setBatchEstimateStatus("Done!");
      btn.disabled = false;
      return;
    }

    // Multiple providers — check per-item spread, take worst
    let worstSpread = 0;
    for (let i = 0; i < items.length; i++) {
      const perItemResults = successful.map((r) => r.data.items[i]);
      const spread = calcSpread(perItemResults);
      if (spread > worstSpread) worstSpread = spread;
    }

    const threshold = getSpreadThreshold();

    if (worstSpread <= threshold) {
      // Consensus — average per-item
      const finalItems = items.map((_, i) => {
        const perItem = successful.map((r) => r.data.items[i]);
        return averageResults(perItem);
      });
      _batchValidationData = {
        round: 1,
        round1: successful,
        failed,
        finalItems,
        spread: worstSpread,
        threshold,
        verdict: "consensus",
      };
      renderBatchResults(items, finalItems, _batchValidationData);
      setBatchEstimateStatus("Done!");
      btn.disabled = false;
      return;
    }

    // --- Reconciliation loop: keep going until spread is within threshold (max 5 rounds) ---
    const MAX_BATCH_ROUNDS = 5;
    const batchReconRounds = [];
    let prevBatchResults = successful;
    let batchConverged = false;

    for (let roundNum = 2; roundNum <= MAX_BATCH_ROUNDS; roundNum++) {
      setBatchEstimateStatus(`Providers disagreed — reconciling (round ${roundNum})...`);

      const reconPrompt = buildBatchReconciliationPrompt(items, prevBatchResults);
      const reconPromises = activeProviders
        .filter((p) => prevBatchResults.some((s) => s.providerId === p.id))
        .map(async (provider) => {
          const settings = getProviderSettings(provider.id);
          try {
            const data = await callProviderBatch(provider, settings.apiKey, settings.secondaryModel, SYSTEM_PROMPT_BATCH_RECONCILE, reconPrompt, maxTokens + 300, items.length);
            return { providerId: provider.id, providerName: provider.name, model: settings.secondaryModel, data, error: null };
          } catch (err) {
            return { providerId: provider.id, providerName: provider.name, model: settings.secondaryModel, data: null, error: err.message };
          }
        });

      const reconResults = await Promise.all(reconPromises);
      const reconSuccessful = reconResults.filter((r) => r.data !== null);

      if (reconSuccessful.length === 0) {
        // This round failed — fall back to previous best
        const finalItems = items.map((_, i) => {
          const perItem = prevBatchResults.map((r) => r.data.items[i]);
          return averageResults(perItem);
        });
        _batchValidationData = {
          round: roundNum - 1,
          round1: successful,
          reconRounds: batchReconRounds,
          failed,
          finalItems,
          spread: worstSpread,
          threshold,
          verdict: "recon_failed",
        };
        renderBatchResults(items, finalItems, _batchValidationData);
        setBatchEstimateStatus(`Round ${roundNum} failed — using round ${roundNum - 1} average.`, true);
        btn.disabled = false;
        return;
      }

      let reconWorstSpread = 0;
      for (let i = 0; i < items.length; i++) {
        const perItem = reconSuccessful.map((r) => r.data.items[i]);
        const s = calcSpread(perItem);
        if (s > reconWorstSpread) reconWorstSpread = s;
      }
      batchReconRounds.push({ roundNum, results: reconSuccessful, spread: reconWorstSpread });

      if (reconWorstSpread <= threshold) {
        batchConverged = true;
        const finalItems = items.map((_, i) => {
          const perItem = reconSuccessful.map((r) => r.data.items[i]);
          return averageResults(perItem);
        });
        _batchValidationData = {
          round: roundNum,
          round1: successful,
          reconRounds: batchReconRounds,
          failed,
          finalItems,
          spread: worstSpread,
          threshold,
          verdict: "reconciled",
        };
        renderBatchResults(items, finalItems, _batchValidationData);
        setBatchEstimateStatus("Done!");
        break;
      }

      prevBatchResults = reconSuccessful;
    }

    if (!batchConverged) {
      const lastRound = batchReconRounds[batchReconRounds.length - 1];
      const finalItems = items.map((_, i) => {
        const perItem = lastRound.results.map((r) => r.data.items[i]);
        return averageResults(perItem);
      });
      _batchValidationData = {
        round: MAX_BATCH_ROUNDS,
        round1: successful,
        reconRounds: batchReconRounds,
        failed,
        finalItems,
        spread: worstSpread,
        threshold,
        verdict: "max_rounds",
      };
      renderBatchResults(items, finalItems, _batchValidationData);
      setBatchEstimateStatus(`Spread still ${lastRound.spread.toFixed(1)}% after ${MAX_BATCH_ROUNDS} rounds — using last average.`, true);
    }
  } catch (err) {
    setBatchEstimateStatus(err.message, true);
  } finally {
    btn.disabled = false;
  }
}

async function callProviderBatch(provider, apiKey, model, systemPrompt, userPrompt, maxTokens, expectedCount) {
  if (provider.id === "openai") {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        ...openaiModelParams(model, maxTokens),
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `OpenAI API error ${res.status}`);
    }
    const data = await res.json();
    return parseBatchAIResponse(extractOpenAIContent(data), expectedCount);
  } else if (provider.id === "anthropic") {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages: [
          { role: "user", content: userPrompt },
        ],
        system: systemPrompt,
        temperature: 0,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `Claude API error ${res.status}`);
    }
    const data = await res.json();
    return parseBatchAIResponse(data.content[0].text, expectedCount);
  }
  throw new Error(`Unknown provider: ${provider.id}`);
}

// --- Batch Modal Functions ---

function openBatchModal() {
  const modal = document.getElementById("batch-modal");
  document.getElementById("batch-date").value = new Date().toISOString().slice(0, 10);
  const now = new Date();
  document.getElementById("batch-time").value =
    now.getHours().toString().padStart(2, "0") + ":" + now.getMinutes().toString().padStart(2, "0");

  const container = document.getElementById("batch-items");
  container.innerHTML = "";
  for (let i = 0; i < 3; i++) addBatchRow();

  document.getElementById("batch-results").innerHTML = "";
  document.getElementById("batch-save").disabled = true;
  setBatchEstimateStatus("");
  _batchValidationData = null;

  populateBatchSuggestions();
  modal.classList.remove("hidden");
}

function populateBatchSuggestions() {
  const entries = loadFoodEntries();
  const foods = [...new Set(entries.map((e) => e.food))];
  const units = [...new Set(entries.map((e) => e.unit))];

  // Ensure datalists exist in the modal
  let foodDl = document.getElementById("batch-food-suggestions");
  if (!foodDl) {
    foodDl = document.createElement("datalist");
    foodDl.id = "batch-food-suggestions";
    document.getElementById("batch-modal").appendChild(foodDl);
  }
  foodDl.innerHTML = foods.map((f) => `<option value="${escapeHtml(f)}">`).join("");

  let unitDl = document.getElementById("batch-unit-suggestions");
  if (!unitDl) {
    unitDl = document.createElement("datalist");
    unitDl.id = "batch-unit-suggestions";
    document.getElementById("batch-modal").appendChild(unitDl);
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

function closeBatchModal() {
  document.getElementById("batch-modal").classList.add("hidden");
}

function renderBatchResults(inputItems, finalItems, validationData) {
  const container = document.getElementById("batch-results");
  let html = '';

  // Validation panel
  html += '<div class="validation-panel">';
  html += '<div class="validation-header">AI Thought Process</div>';

  // Round 1
  html += '<div class="round-label">Round 1 &mdash; Initial estimates (fast models)</div>';
  for (const r of validationData.round1) {
    html += `<div style="font-size:0.78rem;font-weight:600;color:var(--text-dim);margin:6px 0 4px;">${escapeHtml(r.providerName)}</div>`;
    html += '<table class="validation-table"><thead><tr>';
    html += '<th>Food</th><th>Cal &#8595;</th><th>Cal &#8593;</th><th>Pro &#8595;</th><th>Pro &#8593;</th>';
    html += '</tr></thead><tbody>';
    for (const item of r.data.items) {
      html += `<tr>
        <td>${escapeHtml(item.food)}</td>
        <td class="num">${renderNum(item.calories_lower, 1)}</td>
        <td class="num">${renderNum(item.calories_upper, 1)}</td>
        <td class="num">${renderNum(item.protein_lower, 1)}</td>
        <td class="num">${renderNum(item.protein_upper, 1)}</td>
      </tr>`;
    }
    html += '</tbody></table>';
    html += renderReasoning(r.providerName, r.data.reasoning);
  }

  // Verdict
  if (validationData.verdict === "single") {
    html += `<div class="verdict verdict-warning">&#9888; ${escapeHtml(validationData.warning)}</div>`;
  } else if (validationData.verdict === "consensus") {
    html += `<div class="verdict verdict-consensus">&#10003; Consensus reached (worst spread: ${validationData.spread.toFixed(1)}%, within ${validationData.threshold}% threshold)</div>`;
  } else if ((validationData.verdict === "reconciled" || validationData.verdict === "max_rounds") && validationData.reconRounds) {
    html += `<div class="verdict verdict-escalated">&#9888; Round 1 worst spread: ${validationData.spread.toFixed(1)}% (exceeds ${validationData.threshold}% threshold)</div>`;
    html += '<div class="verdict-detail">Escalated to secondary models for reconciliation.</div>';

    for (const rnd of validationData.reconRounds) {
      html += `<div class="round-label round-label-r2">Round ${rnd.roundNum} &mdash; Reconciliation (secondary models)</div>`;
      for (const r of rnd.results) {
        html += `<div style="font-size:0.78rem;font-weight:600;color:var(--text-dim);margin:6px 0 4px;">${escapeHtml(r.providerName)} (R${rnd.roundNum})</div>`;
        html += '<table class="validation-table"><thead><tr>';
        html += '<th>Food</th><th>Cal &#8595;</th><th>Cal &#8593;</th><th>Pro &#8595;</th><th>Pro &#8593;</th>';
        html += '</tr></thead><tbody>';
        for (const item of r.data.items) {
          html += `<tr>
            <td>${escapeHtml(item.food)}</td>
            <td class="num">${renderNum(item.calories_lower, 1)}</td>
            <td class="num">${renderNum(item.calories_upper, 1)}</td>
            <td class="num">${renderNum(item.protein_lower, 1)}</td>
            <td class="num">${renderNum(item.protein_upper, 1)}</td>
          </tr>`;
        }
        html += '</tbody></table>';
        html += renderReasoning(`${r.providerName} (R${rnd.roundNum})`, r.data.reasoning);
      }

      const prevSpread = rnd.roundNum === 2 ? validationData.spread : validationData.reconRounds[validationData.reconRounds.indexOf(rnd) - 1].spread;
      html += `<div class="spread-summary">`;
      html += `Worst spread: <span class="spread-r1">${prevSpread.toFixed(1)}%</span> &#8594; <span class="spread-r2">${rnd.spread.toFixed(1)}%</span>`;
      if (rnd.spread < prevSpread) {
        html += ` <span class="spread-improved">(&#8595;${(prevSpread - rnd.spread).toFixed(1)}% reduction)</span>`;
      }
      html += '</div>';
    }

    if (validationData.verdict === "reconciled") {
      html += `<div class="verdict verdict-consensus">&#10003; Final values: average of Round ${validationData.round} reconciled estimates</div>`;
    } else {
      html += `<div class="verdict verdict-warning">&#9888; Spread still above threshold after ${validationData.round} rounds — using last round average</div>`;
    }
  } else if (validationData.verdict === "recon_failed") {
    html += `<div class="verdict verdict-warning">&#9888; Worst spread: ${validationData.spread.toFixed(1)}% (exceeds ${validationData.threshold}% threshold)</div>`;
    html += '<div class="verdict-detail">Reconciliation failed. Falling back to previous round average.</div>';
  }

  if (validationData.failed && validationData.failed.length > 0) {
    for (const f of validationData.failed) {
      html += `<div class="verdict verdict-warning">&#9888; ${escapeHtml(f.providerName)} failed: ${escapeHtml(f.error)}</div>`;
    }
  }

  html += '</div>'; // end validation-panel

  // Editable results table
  html += '<div class="table-wrapper" style="margin-top:12px;"><table><thead><tr>';
  html += '<th>Food</th><th>Qty</th><th>Unit</th><th>Cal (low)</th><th>Cal (high)</th><th>Pro (low)</th><th>Pro (high)</th>';
  html += '</tr></thead><tbody>';

  let totalCalLow = 0, totalCalHigh = 0, totalProLow = 0, totalProHigh = 0;
  for (let i = 0; i < inputItems.length; i++) {
    const inp = inputItems[i];
    const fin = finalItems[i];
    totalCalLow += fin.calories_lower;
    totalCalHigh += fin.calories_upper;
    totalProLow += fin.protein_lower;
    totalProHigh += fin.protein_upper;
    html += `<tr data-batch-idx="${i}">
      <td>${escapeHtml(inp.food)}</td>
      <td class="num">${inp.qty}</td>
      <td>${escapeHtml(inp.unit)}</td>
      <td><input type="number" class="batch-res-cal-low" step="any" value="${renderNum(fin.calories_lower, 1)}"></td>
      <td><input type="number" class="batch-res-cal-high" step="any" value="${renderNum(fin.calories_upper, 1)}"></td>
      <td><input type="number" class="batch-res-pro-low" step="any" value="${renderNum(fin.protein_lower, 1)}"></td>
      <td><input type="number" class="batch-res-pro-high" step="any" value="${renderNum(fin.protein_upper, 1)}"></td>
    </tr>`;
  }

  // Totals row
  html += `<tr class="daily-total">
    <td colspan="3">Total</td>
    <td class="num">${renderNum(totalCalLow, 1)}</td>
    <td class="num">${renderNum(totalCalHigh, 1)}</td>
    <td class="num">${renderNum(totalProLow, 1)}</td>
    <td class="num">${renderNum(totalProHigh, 1)}</td>
  </tr>`;

  html += '</tbody></table></div>';
  container.innerHTML = html;
  document.getElementById("batch-save").disabled = false;
}

function saveBatchFoods() {
  const date = document.getElementById("batch-date").value;
  const time = document.getElementById("batch-time").value;
  if (!date || !time) {
    setBatchEstimateStatus("Date and time are required.", true);
    return;
  }

  const resultRows = document.querySelectorAll("#batch-results table tbody tr[data-batch-idx]");
  if (resultRows.length === 0) return;

  const entries = loadFoodEntries();
  const maxId = entries.length ? Math.max(...entries.map((e) => e.id)) : 0;

  const inputRows = document.querySelectorAll("#batch-items .batch-item-row");
  const inputItems = [];
  for (const row of inputRows) {
    const food = row.querySelector(".batch-food").value.trim();
    const qty = row.querySelector(".batch-qty").value;
    const unit = row.querySelector(".batch-unit").value.trim();
    if (food && qty && unit) inputItems.push({ food, qty: parseFloat(qty), unit });
  }

  resultRows.forEach((row, i) => {
    const idx = parseInt(row.dataset.batchIdx);
    const inp = inputItems[idx];
    if (!inp) return;

    const entry = {
      id: maxId + 1 + i,
      date,
      time,
      food: inp.food,
      qty: inp.qty,
      unit: inp.unit,
      calLow: parseFloat(row.querySelector(".batch-res-cal-low").value) || 0,
      calHigh: parseFloat(row.querySelector(".batch-res-cal-high").value) || 0,
      proLow: parseFloat(row.querySelector(".batch-res-pro-low").value) || 0,
      proHigh: parseFloat(row.querySelector(".batch-res-pro-high").value) || 0,
    };

    if (_batchValidationData) {
      entry.aiThoughtProcess = _batchValidationData;
    }

    entries.push(entry);
  });

  saveFoodEntries(entries);
  ensureDayExists(date);
  _batchValidationData = null;
  closeBatchModal();
  renderFoodTable();
  renderCalorieTracker();
}

// ============================================================
// EVENT LISTENERS & INIT
// ============================================================

document.addEventListener("DOMContentLoaded", async () => {
  document.body.classList.add('loading');
  try {
    await initFromSupabase();
  } catch (err) {
    console.error('[Supabase] Init failed, falling back to localStorage:', err);
    initFromLocalStorage();
  }
  document.body.classList.remove('loading');

  // Tab switching
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById(tab.dataset.tab).classList.add("active");
    });
  });

  // Food modal
  document.getElementById("add-food-btn").addEventListener("click", () => openFoodModal(null));
  document.getElementById("food-cancel").addEventListener("click", closeFoodModal);
  document.querySelector("#food-modal .modal-overlay").addEventListener("click", closeFoodModal);
  document.getElementById("food-form").addEventListener("submit", saveFood);

  // Day modal
  document.getElementById("add-day-btn").addEventListener("click", () => openDayModal(null));
  document.getElementById("day-cancel").addEventListener("click", closeDayModal);
  document.querySelector("#day-modal .modal-overlay").addEventListener("click", closeDayModal);
  document.getElementById("day-form").addEventListener("submit", saveDay);

  // Food filter
  document.getElementById("food-date-filter").addEventListener("change", renderFoodTable);
  document.getElementById("clear-food-filter").addEventListener("click", () => {
    document.getElementById("food-date-filter").value = "";
    renderFoodTable();
  });

  // Profile form
  document.getElementById("profile-form").addEventListener("submit", saveProfileForm);

  // Provider settings
  renderProviderSettings();

  // Migrate old API key if present
  const oldKey = localStorage.getItem("nt_openai_key");
  if (oldKey && !localStorage.getItem("nt_key_openai")) {
    localStorage.setItem("nt_key_openai", oldKey);
    localStorage.removeItem("nt_openai_key");
    renderProviderSettings();
  }

  // Estimate button
  document.getElementById("estimate-btn").addEventListener("click", estimateNutrition);

  // Batch modal
  document.getElementById("batch-add-btn").addEventListener("click", openBatchModal);
  document.getElementById("batch-add-row").addEventListener("click", addBatchRow);
  document.getElementById("batch-estimate-btn").addEventListener("click", estimateBatchNutrition);
  document.getElementById("batch-save").addEventListener("click", saveBatchFoods);
  document.getElementById("batch-cancel").addEventListener("click", closeBatchModal);
  document.querySelector("#batch-modal .modal-overlay").addEventListener("click", closeBatchModal);

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

  // Auto-fill calories when selecting a previously used food, with proportional scaling
  function scaleFromMatch() {
    const foodName = document.getElementById("food-name").value;
    const qty = parseFloat(document.getElementById("food-qty").value);
    const unit = document.getElementById("food-unit").value.trim();
    if (!foodName || !unit || !qty) return;

    const entries = loadFoodEntries();
    const match = entries.findLast((e) => e.food === foodName && e.unit === unit);
    if (match && match.qty > 0) {
      const ratio = qty / match.qty;
      document.getElementById("food-cal-low").value = parseFloat((match.calLow * ratio).toFixed(2));
      document.getElementById("food-cal-high").value = parseFloat((match.calHigh * ratio).toFixed(2));
      document.getElementById("food-protein-low").value = parseFloat((match.proLow * ratio).toFixed(2));
      document.getElementById("food-protein-high").value = parseFloat((match.proHigh * ratio).toFixed(2));
    } else {
      // No match for this unit — clear nutrition fields
      document.getElementById("food-cal-low").value = "";
      document.getElementById("food-cal-high").value = "";
      document.getElementById("food-protein-low").value = "";
      document.getElementById("food-protein-high").value = "";
    }
  }

  document.getElementById("food-name").addEventListener("change", function () {
    const entries = loadFoodEntries();
    const match = entries.findLast((e) => e.food === this.value);
    if (match) {
      document.getElementById("food-unit").value = match.unit;
      document.getElementById("food-qty").value = match.qty;
      scaleFromMatch();
    }
  });

  document.getElementById("food-qty").addEventListener("input", scaleFromMatch);
  document.getElementById("food-unit").addEventListener("change", scaleFromMatch);

  // Initial render
  renderFoodTable();
  renderCalorieTracker();
  renderCalorieTarget();
});
