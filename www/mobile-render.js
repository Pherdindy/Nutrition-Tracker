// Mobile renderers. Loaded after app.js + assessment-view.js; relies on globals:
//  renderFoodCards:        loadFoodEntries, getDailyFoodTotals, formatDate, formatTime,
//                          escapeHtml, renderNum, isMobile, editFood, deleteFood
//  renderDayCards:         loadDayEntries, loadProfile, loadFoodEntries, calcBMR, calcTDEE,
//                          surplusClass, getDailyFoodTotals, formatDate, escapeHtml, renderNum,
//                          isMobile, editDay, deleteDay
//  renderAssessmentScorecard: window.AssessmentView, renderActionPlan, escapeHtml

function renderFoodCards() {
  const host = document.getElementById("food-cards");
  if (!host) return;
  if (!isMobile()) return; // cards only render on mobile; desktop uses the table

  const enabled = getEnabledMacros();
  const fmt = getValueFormat();
  const filterDate = document.getElementById("food-date-filter")?.value;
  let entries = loadFoodEntries();
  if (filterDate) entries = entries.filter((f) => f.date === filterDate);
  entries.sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : (a.time < b.time ? -1 : 1)));

  const groups = {};
  entries.forEach((e) => { (groups[e.date] ||= []).push(e); });
  const dates = Object.keys(groups).sort((a, b) => (a < b ? 1 : -1));

  let html = "";
  for (const date of dates) {
    const totals = getDailyFoodTotals(date, entries);
    html += `<div class="cards-day-header">
      <span>${formatDate(date)}</span>
      <span class="cards-day-total">${renderNum(totals.calLow, 0)}–${renderNum(totals.calHigh, 0)} cal</span>
    </div>`;
    for (const e of groups[date]) {
      const calStr = Macros.formatMacro(Macros.getMacro(e, "calories"), fmt);
      const rows = enabled.filter((id) => id !== "calories")
        .map((id) => `<div class="food-card-row"><span>${escapeHtml(Macros.byId(id).label)}</span><b>${Macros.formatMacro(Macros.getMacro(e, id), fmt)} ${escapeHtml(Macros.byId(id).unit)}</b></div>`)
        .join("");
      const badge = e.estimateStatus === "pending" ? '<span class="est-badge est-pending" title="Estimating…">…</span>'
        : (e.estimateStatus === "error" ? '<span class="est-badge est-error" title="Estimate failed">!</span>' : "");
      html += `<div class="food-card" data-id="${e.id}">
        <div class="food-card-main">
          <div class="food-card-name">${escapeHtml(e.food)}</div>
          <div class="food-card-cal">${calStr} cal ${badge}</div>
        </div>
        <div class="food-card-sub">${formatTime(e.time)} · ${e.qty} ${escapeHtml(e.unit)}</div>
        ${rows}
        <button class="card-menu-btn" data-id="${e.id}" aria-label="Actions">&#8942;</button>
      </div>`;
    }
  }
  if (!entries.length) {
    html = `<div class="cards-empty">No food entries yet. Tap + to add one.</div>`;
  }
  host.innerHTML = html;

  // Tap card body to edit
  host.querySelectorAll(".food-card").forEach((card) => {
    card.addEventListener("click", (ev) => {
      if (ev.target.closest(".card-menu-btn")) return; // handled below
      editFood(Number(card.dataset.id));
    });
  });
  // Overflow menu = delete (Phase 1: edit on tap, delete here).
  // deleteFood() already shows its own confirm() — don't double-prompt.
  host.querySelectorAll(".card-menu-btn").forEach((btn) => {
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      deleteFood(Number(btn.dataset.id));
    });
  });
}

function renderDayCards() {
  const host = document.getElementById("day-cards");
  if (!host) return;
  if (!isMobile()) return; // cards only render on mobile; desktop uses the table

  const profile = loadProfile();
  const food = loadFoodEntries();
  const days = loadDayEntries().slice().sort((a, b) => (a.date < b.date ? 1 : -1));

  let html = "";
  for (const day of days) {
    const bmr = calcBMR(day.weight, profile.height, day.age);
    const tdee = calcTDEE(bmr, day.activity);
    const target = tdee - day.deficit;
    const t = getDailyFoodTotals(day.date, food);
    const overLow = t.calLow - target, overHigh = t.calHigh - target;
    html += `<div class="day-card">
      <button class="day-card-head" data-id="${day.id}">
        <span class="day-card-date">${formatDate(day.date)}</span>
        <span class="day-card-kcal">${renderNum(t.calLow, 0)}–${renderNum(t.calHigh, 0)} / ${renderNum(target, 0)} cal</span>
        <span class="day-card-caret">&#9656;</span>
      </button>
      <div class="day-card-body">
        <div class="food-card-row"><span>Weight</span><b>${day.weight} lb</b></div>
        <div class="food-card-row"><span>BMR / TDEE</span><b>${renderNum(bmr,0)} / ${renderNum(tdee,0)}</b></div>
        <div class="food-card-row"><span>Activity</span><b>${escapeHtml(day.activity)}</b></div>
        <div class="food-card-row"><span>Deficit / Target</span><b>${day.deficit} / ${renderNum(target,0)}</b></div>
        <div class="food-card-row"><span>Cal +/-</span><b class="${surplusClass(overLow)}">${renderNum(overLow,0)} … ${renderNum(overHigh,0)}</b></div>
        <div class="food-card-row"><span>Protein</span><b>${renderNum(t.proLow,0)}–${renderNum(t.proHigh,0)} g (target ${day.proteinTargetLow}–${day.proteinTargetHigh})</b></div>
        <div class="day-card-actions">
          <button class="btn btn-secondary btn-sm" data-edit="${day.id}">Edit</button>
          <button class="btn btn-secondary btn-sm" data-del="${day.id}">Delete</button>
        </div>
      </div>
    </div>`;
  }
  if (!days.length) html = `<div class="cards-empty">No daily entries yet. Use + Add Day.</div>`;
  host.innerHTML = html;

  host.querySelectorAll(".day-card-head").forEach((h) => {
    h.addEventListener("click", () => h.parentElement.classList.toggle("expanded"));
  });
  host.querySelectorAll("[data-edit]").forEach((b) =>
    b.addEventListener("click", () => editDay(Number(b.dataset.edit))));
  host.querySelectorAll("[data-del]").forEach((b) =>
    b.addEventListener("click", () => deleteDay(Number(b.dataset.del))));  // deleteDay confirms internally
}

// Renders the simplified mobile scorecard from the best available assessment data.
// `data` is a single provider's assessment object (result.round2[0].data or round1[0].data).
function renderAssessmentScorecard(data, fullResult) { // fullResult reserved for future provider attribution
  const container = document.getElementById("assessment-results");
  if (!container || !data) return;
  const AV = window.AssessmentView;
  if (!AV) { container.innerHTML = '<p style="padding:16px;color:var(--text-dim)">Scorecard unavailable — assessment view module failed to load.</p>'; return; }

  const score = Number(data.overall_score) || 0;
  const pct = Math.max(0, Math.min(100, Math.round((score / 10) * 100)));
  const chips = [
    AV.calorieChip(data.calorie_assessment && data.calorie_assessment.status),
    AV.proteinChip(data.protein_assessment && data.protein_assessment.status),
    AV.varietyChip(data),
  ];
  const actions = AV.topActions(data, 3);

  let html = `<div class="score-card">
    <div class="score-ring" style="--pct:${pct}">
      <div class="score-ring-inner"><span class="score-num">${score}</span><span class="score-den">/10</span></div>
    </div>
    <div class="score-verdict">${escapeHtml(AV.verdictLine(score))}</div>
    <div class="score-chips">
      ${chips.map((c) => `<span class="chip chip-${c.tone}">${escapeHtml(c.label)}</span>`).join("")}
    </div>`;

  if (actions.length) {
    html += `<div class="score-section-label">Do this week</div>
      <div class="score-actions">
        ${actions.map((a) => `<div class="score-action">${escapeHtml(a.text)}</div>`).join("")}
      </div>`;
  }

  // Progressive disclosure — reuse existing detailed renderers inside <details>.
  html += `<details class="score-drill"><summary>Food groups</summary><div class="score-drill-body" id="drill-groups"></div></details>`;
  html += `<details class="score-drill"><summary>Full grocery &amp; sourcing plan</summary><div class="score-drill-body" id="drill-plan"></div></details>`;
  html += `<details class="score-drill"><summary>Why this score</summary><div class="score-drill-body">${escapeHtml(data.reasoning || "")}</div></details>`;
  container.innerHTML = html;

  // Populate drill-downs.
  const groupsHost = document.getElementById("drill-groups");
  if (groupsHost) {
    groupsHost.innerHTML = Object.entries(data.food_groups || {})
      .map(([k, v]) => `<div class="food-card-row"><span>${escapeHtml(k.replace(/_/g, " "))}</span><b>${escapeHtml((v && v.status) || "")}</b></div>`)
      .join("");
  }
  const planHost = document.getElementById("drill-plan");
  if (planHost && typeof renderActionPlan === "function") {
    planHost.innerHTML = renderActionPlan(data);
  }
}
