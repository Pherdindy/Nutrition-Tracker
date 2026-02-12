// ============================================================
// DATA LAYER
// ============================================================

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

function loadProfile() {
  const saved = localStorage.getItem("nt_profile");
  return saved ? JSON.parse(saved) : { ...DEFAULT_PROFILE };
}

function saveProfile(profile) {
  localStorage.setItem("nt_profile", JSON.stringify(profile));
}

function loadFoodEntries() {
  const saved = localStorage.getItem("nt_food");
  return saved ? JSON.parse(saved) : [];
}

function saveFoodEntries(entries) {
  localStorage.setItem("nt_food", JSON.stringify(entries));
}

function loadDayEntries() {
  const saved = localStorage.getItem("nt_days");
  return saved ? JSON.parse(saved) : [];
}

function saveDayEntries(entries) {
  localStorage.setItem("nt_days", JSON.stringify(entries));
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
// INITIALIZE DATA
// ============================================================

const DATA_VERSION = 2; // Bump this when seed data changes

function initData() {
  const currentVersion = parseInt(localStorage.getItem("nt_version") || "0");
  if (currentVersion < DATA_VERSION) {
    // Seed data updated — reload from seed
    const foodEntries = SEED_FOOD.map((f, i) => ({ id: i + 1, ...f }));
    saveFoodEntries(foodEntries);
    const dayEntries = SEED_DAYS.map((d, i) => ({ id: i + 1, ...d }));
    saveDayEntries(dayEntries);
    saveProfile(DEFAULT_PROFILE);
    localStorage.setItem("nt_version", String(DATA_VERSION));
  }
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

// GPT-5+ models use max_completion_tokens and don't support temperature
function openaiModelParams(model, tokens) {
  if (model.startsWith("gpt-5") || model.startsWith("o1") || model.startsWith("o3") || model.startsWith("o4")) {
    return { max_completion_tokens: tokens };
  }
  return { max_tokens: tokens, temperature: 0 };
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
      return parseAIResponse(data.choices[0].message.content);
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
      return parseAIResponse(data.choices[0].message.content);
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
  const parsed = JSON.parse(cleaned);
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
    primaryModel: localStorage.getItem(`nt_${providerId}_primary`) || provider.defaultPrimary,
    secondaryModel: localStorage.getItem(`nt_${providerId}_secondary`) || provider.defaultSecondary,
  };
}

function saveProviderKey(providerId, key) {
  const provider = PROVIDERS.find((p) => p.id === providerId);
  if (provider) localStorage.setItem(provider.keyName, key);
}

function saveProviderModel(providerId, role, modelId) {
  localStorage.setItem(`nt_${providerId}_${role}`, modelId);
}

function getSpreadThreshold() {
  return parseFloat(localStorage.getItem("nt_spread_threshold") || "15");
}

function saveSpreadThreshold(val) {
  localStorage.setItem("nt_spread_threshold", String(val));
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

    // --- Round 2: Reconciliation with secondary models ---
    setEstimateStatus("Providers disagreed — reconciling with secondary models...");

    const round2Promises = activeProviders
      .filter((p) => successful.some((s) => s.providerId === p.id))
      .map(async (provider) => {
        const settings = getProviderSettings(provider.id);
        try {
          const data = await provider.callReconciliation(food, qty, unit, settings.apiKey, settings.secondaryModel, successful);
          return { providerId: provider.id, providerName: provider.name, model: settings.secondaryModel, data, error: null };
        } catch (err) {
          return { providerId: provider.id, providerName: provider.name, model: settings.secondaryModel, data: null, error: err.message };
        }
      });

    const round2Results = await Promise.all(round2Promises);
    const r2Successful = round2Results.filter((r) => r.data !== null);

    if (r2Successful.length === 0) {
      // Round 2 all failed — fall back to Round 1 average
      const avg = averageResults(successful.map((r) => r.data));
      fillNutritionFields(avg);
      _lastValidationData = {
        round: 1,
        round1: successful,
        failed,
        final: avg,
        spread,
        threshold,
        verdict: "r2_failed",
      };
      renderValidationResults(_lastValidationData);
      setEstimateStatus("Reconciliation failed — using Round 1 average.", true);
      btn.disabled = false;
      return;
    }

    const r2Avg = averageResults(r2Successful.map((r) => r.data));
    const r2Spread = calcSpread(r2Successful.map((r) => r.data));
    fillNutritionFields(r2Avg);
    _lastValidationData = {
      round: 2,
      round1: successful,
      round2: r2Successful,
      failed,
      final: r2Avg,
      spread,
      r2Spread,
      threshold,
      verdict: "reconciled",
    };
    renderValidationResults(_lastValidationData);
    setEstimateStatus("Done!");
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
  } else if (data.verdict === "reconciled" && data.round2) {
    html += `<div class="verdict verdict-escalated">&#9888; Round 1 spread: ${data.spread.toFixed(1)}% (exceeds ${data.threshold}% threshold)</div>`;
    html += '<div class="verdict-detail">Escalated to smarter secondary models. Each saw all Round 1 estimates and re-evaluated.</div>';

    // --- Round 2 section with change tracking ---
    html += '<div class="round-label round-label-r2">Round 2 &mdash; Reconciliation (secondary models)</div>';
    html += '<table class="validation-table"><thead><tr>';
    html += '<th>Provider</th><th>Cal &#8595;</th><th></th><th>Cal &#8593;</th><th></th><th>Pro &#8595;</th><th></th><th>Pro &#8593;</th><th></th>';
    html += '</tr></thead><tbody>';

    for (const r2 of data.round2) {
      const r1 = data.round1.find((r) => r.providerId === r2.providerId);
      const r1d = r1 ? r1.data : r2.data;
      html += `<tr>
        <td>${escapeHtml(r2.providerName)}</td>
        <td class="num">${renderNum(r2.data.calories_lower, 1)}</td>
        <td class="num">${formatDelta(r1d.calories_lower, r2.data.calories_lower)}</td>
        <td class="num">${renderNum(r2.data.calories_upper, 1)}</td>
        <td class="num">${formatDelta(r1d.calories_upper, r2.data.calories_upper)}</td>
        <td class="num">${renderNum(r2.data.protein_lower, 1)}</td>
        <td class="num">${formatDelta(r1d.protein_lower, r2.data.protein_lower)}</td>
        <td class="num">${renderNum(r2.data.protein_upper, 1)}</td>
        <td class="num">${formatDelta(r1d.protein_upper, r2.data.protein_upper)}</td>
      </tr>`;
    }
    html += '</tbody></table>';

    // Round 2 reasoning
    for (const r2 of data.round2) {
      html += renderReasoning(r2.providerName + " (R2)", r2.data.reasoning);
    }

    // Spread reduction summary
    const r2SpreadVal = data.r2Spread !== undefined ? data.r2Spread : calcSpread(data.round2.map((r) => r.data));
    html += `<div class="spread-summary">`;
    html += `Spread: <span class="spread-r1">${data.spread.toFixed(1)}%</span> &#8594; <span class="spread-r2">${r2SpreadVal.toFixed(1)}%</span>`;
    if (r2SpreadVal < data.spread) {
      html += ` <span class="spread-improved">(&#8595;${(data.spread - r2SpreadVal).toFixed(1)}% reduction)</span>`;
    }
    html += '</div>';

    html += '<div class="verdict verdict-consensus">&#10003; Final values: average of Round 2 reconciled estimates</div>';
  } else if (data.verdict === "r2_failed") {
    html += `<div class="verdict verdict-warning">&#9888; Round 1 spread: ${data.spread.toFixed(1)}% (exceeds ${data.threshold}% threshold)</div>`;
    html += '<div class="verdict-detail">Reconciliation with secondary models failed. Falling back to Round 1 average.</div>';
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
  html += '<p style="font-size:0.78rem;color:var(--text-dim);margin-bottom:16px;">API keys are stored locally in your browser. Used to auto-estimate calories &amp; protein when adding food.</p>';

  for (const provider of PROVIDERS) {
    const settings = getProviderSettings(provider.id);
    html += `<div class="provider-section">`;
    html += `<h3 class="provider-name">${escapeHtml(provider.name)}</h3>`;

    // API key
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
      { "group": "<food group name>", "current": <current daily servings number>, "target": <recommended daily servings number>, "add": "<what to add, e.g. '2 cups leafy greens, 1 cup mixed veg'>" }
    ],
    "grocery_list": ["<item (quantity for 1 week)>", "<item (quantity for 1 week)>"],
    "meal_ideas": ["<simple meal or snack idea to fill gaps>", "<another idea>"]
  }
}

IMPORTANT for action_plan:
- daily_targets: Include ALL food groups that can be improved — missing, critically_low, low, AND adequate groups that could reach optimal. Only skip groups already at "good" with no room to improve. "current" is estimated daily average servings from the food log. "target" is the optimal recommended daily servings.
- grocery_list: Practical items with weekly quantities the user should buy to reach optimal intake. Keep to 5-10 items max.
- meal_ideas: 3-5 simple, practical ideas (e.g. "Add a banana and handful of almonds as morning snack") that address both gaps and areas that can be optimized.`;

const SYSTEM_PROMPT_DIET_RECONCILE = `You are a registered dietitian performing a reconciliation review. Two AI models analyzed the same food diary but disagreed on key assessments. Review both analyses alongside the original food data, resolve disagreements, and produce one unified assessment.

Food group status definitions:
- "missing" = literally zero foods from this group in the entire period
- "critically_low" = trace amounts present but far below recommended
- "low" = some intake but still below recommended servings
- "adequate" = meeting or near recommended servings
- "good" = meeting or exceeding recommended servings consistently

IMPORTANT: Keep your response concise to stay within token limits. The reasoning field should be brief (3-5 sentences max). Keep summaries to 1-2 sentences. Limit concerns, suggestions, and positive_observations to 3-4 items each.

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
    "grocery_list": ["<item (weekly quantity)>"],
    "meal_ideas": ["<practical meal/snack idea>"]
  }
}

For action_plan: Include ALL food groups that can be improved (missing, critically_low, low, and adequate that could reach optimal) in daily_targets. Only skip groups already at "good" with no room to improve. Grocery list should have 5-10 items with weekly quantities. Meal ideas should be 3-5 practical suggestions that address gaps and optimize intake.`;

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
  prompt += `\n\n--- Previous Analyses ---\n`;
  for (const r of round1Results) {
    prompt += `\n${r.providerName}'s analysis:\n`;
    prompt += JSON.stringify(r.data, null, 2);
    prompt += `\n`;
  }
  prompt += `\nReview both analyses against the food data. Resolve any disagreements and provide one unified final assessment.`;
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
        ...openaiModelParams(model, 4096),
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `OpenAI API error ${res.status}`);
    }
    const data = await res.json();
    if (data.choices[0].finish_reason === "length") {
      throw new Error("Response truncated (token limit reached)");
    }
    return parseAssessmentResponse(data.choices[0].message.content);
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
        max_tokens: 4096,
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
    return settings.apiKey.length > 0;
  });

  if (activeProviders.length === 0) {
    setAssessmentStatus("Configure at least one AI provider API key in the Calorie Target tab.", true);
    return;
  }

  const btn = document.getElementById("run-assessment-btn");
  btn.disabled = true;
  setAssessmentStatus("Analyzing your diet...");
  document.getElementById("assessment-results").innerHTML = "";

  renderAssessmentDataSummary(data);

  const prompt = buildAssessmentPrompt(data);

  try {
    // --- Round 1: Both providers with primary models ---
    const round1Promises = activeProviders.map(async provider => {
      const settings = getProviderSettings(provider.id);
      try {
        const result = await callProviderForAssessment(provider, prompt, settings.primaryModel, SYSTEM_PROMPT_DIET_ASSESSMENT);
        return { providerId: provider.id, providerName: provider.name, model: settings.primaryModel, data: result, error: null };
      } catch (err) {
        return { providerId: provider.id, providerName: provider.name, model: settings.primaryModel, data: null, error: err.message };
      }
    });

    const round1Results = await Promise.all(round1Promises);
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

    // --- Round 2: Escalate to secondary models ---
    setAssessmentStatus(`Providers disagreed on ${agreement.disagreements}/${agreement.total} categories — reconciling...`);

    const reconPrompt = buildAssessmentReconciliationPrompt(data, successful);

    const round2Promises = activeProviders
      .filter(p => successful.some(s => s.providerId === p.id))
      .map(async provider => {
        const settings = getProviderSettings(provider.id);
        try {
          const result = await callProviderForAssessment(provider, reconPrompt, settings.secondaryModel, SYSTEM_PROMPT_DIET_RECONCILE);
          return { providerId: provider.id, providerName: provider.name, model: settings.secondaryModel, data: result, error: null };
        } catch (err) {
          return { providerId: provider.id, providerName: provider.name, model: settings.secondaryModel, data: null, error: err.message };
        }
      });

    const round2Results = await Promise.all(round2Promises);
    const r2Successful = round2Results.filter(r => r.data !== null);

    if (r2Successful.length === 0) {
      // Fall back to Round 1 average
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
      setAssessmentStatus("Reconciliation failed — using Round 1 average.", true);
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

  let html = '<div class="action-plan">';
  html += '<div class="action-plan-title">Weekly Action Plan</div>';

  // Daily targets table (only groups needing improvement)
  if (ap.daily_targets && ap.daily_targets.length > 0) {
    html += '<div class="action-plan-section">';
    html += '<div class="action-plan-subtitle">Daily Serving Gaps</div>';
    html += '<table class="action-plan-table"><thead><tr><th>Food Group</th><th>Current</th><th>Target</th><th>Gap</th><th>What to Add</th></tr></thead><tbody>';
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

  // Grocery list
  if (ap.grocery_list && ap.grocery_list.length > 0) {
    html += '<div class="action-plan-section">';
    html += '<div class="action-plan-subtitle">Grocery List (1 Week)</div>';
    html += '<ul class="grocery-list">';
    for (const item of ap.grocery_list) {
      html += `<li>${escapeHtml(item)}</li>`;
    }
    html += '</ul></div>';
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
    html += `<div class="verdict verdict-escalated" style="margin-bottom:12px">&#9888; Round 1: ${result.agreement.disagreements}/${result.agreement.total} categories disagreed — reconciled in Round 2</div>`;
  } else if (result.verdict === "r2_failed") {
    html += `<div class="verdict verdict-warning" style="margin-bottom:12px">&#9888; Reconciliation failed — using Round 1 average</div>`;
  }

  // Agreement summary (if two providers)
  if (result.agreement && result.round1.length >= 2) {
    html += renderAgreementSummary(result.agreement, result.round1[0].providerName, result.round1[1].providerName);
  }

  // Round 2 reconciled results (show prominently if present)
  if (result.verdict === "reconciled" && result.round2) {
    html += '<div class="assessment-round-label r2">Round 2 — Reconciled Assessment</div>';

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

  // Failed providers
  if (result.failed && result.failed.length > 0) {
    for (const f of result.failed) {
      html += `<div class="verdict verdict-warning">&#9888; ${escapeHtml(f.providerName)} failed: ${escapeHtml(f.error)}</div>`;
    }
  }

  container.innerHTML = html;
}

// --- localStorage Persistence ---

function loadAssessments() {
  const saved = localStorage.getItem("nt_assessments");
  return saved ? JSON.parse(saved) : [];
}

function saveAssessment(result) {
  const assessments = loadAssessments();
  assessments.unshift(result);
  // Cap at 20
  while (assessments.length > 20) assessments.pop();
  localStorage.setItem("nt_assessments", JSON.stringify(assessments));
}

function deleteAssessment(index) {
  const assessments = loadAssessments();
  assessments.splice(index, 1);
  localStorage.setItem("nt_assessments", JSON.stringify(assessments));
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
// EVENT LISTENERS & INIT
// ============================================================

document.addEventListener("DOMContentLoaded", () => {
  initData();

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

  // Auto-fill calories when selecting a previously used food
  document.getElementById("food-name").addEventListener("change", function () {
    const entries = loadFoodEntries();
    const match = entries.findLast((e) => e.food === this.value);
    if (match) {
      document.getElementById("food-unit").value = match.unit;
      document.getElementById("food-cal-low").value = match.calLow;
      document.getElementById("food-cal-high").value = match.calHigh;
      document.getElementById("food-protein-low").value = match.proLow;
      document.getElementById("food-protein-high").value = match.proHigh;
      document.getElementById("food-qty").value = match.qty;
    }
  });

  // Initial render
  renderFoodTable();
  renderCalorieTracker();
  renderCalorieTarget();
});
