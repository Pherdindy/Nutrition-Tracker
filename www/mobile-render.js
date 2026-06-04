// Mobile renderers. Loaded after app.js; relies on app.js globals
// (loadFoodEntries, getDailyFoodTotals, formatDate, formatTime, escapeHtml,
//  renderNum, isMobile, editFood, deleteFood).

function renderFoodCards() {
  const host = document.getElementById("food-cards");
  if (!host) return;
  if (!isMobile()) return; // cards only render on mobile; desktop uses the table

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
      html += `<div class="food-card" data-id="${e.id}">
        <div class="food-card-main">
          <div class="food-card-name">${escapeHtml(e.food)}</div>
          <div class="food-card-cal">${renderNum(e.calLow, 0)}–${renderNum(e.calHigh, 0)} cal</div>
        </div>
        <div class="food-card-sub">${formatTime(e.time)} · ${e.qty} ${escapeHtml(e.unit)}</div>
        <div class="food-card-row"><span>Protein</span><b>${renderNum(e.proLow, 0)}–${renderNum(e.proHigh, 0)} g</b></div>
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
