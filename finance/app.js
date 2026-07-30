// ============================================================
// DATA LAYER — Supabase with in-memory cache
// ============================================================

const SUPABASE_URL = 'https://wcbpvvyhswaricoadqbb.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_I_XmlCcMCBDOkbU8PWN42A_SID54xxi';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---- Auth gate ----
// transactions/settings are locked to the owner account
// server-side (per-user RLS since 2026-07); Supabase reads/writes silently
// fail until this app holds the owner's session.

function showGate(show) { document.getElementById('auth-gate').classList.toggle('hidden', !show); }
function setGateError(msg) { document.getElementById('gate-error').textContent = msg || ''; }

async function gateSendCode() {
  const email = document.getElementById('gate-email').value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setGateError('Enter a valid email address'); return; }
  setGateError('');
  const { error } = await sb.auth.signInWithOtp({ email });
  if (error) { setGateError(error.message); return; }
  document.getElementById('gate-code-row').classList.remove('hidden');
  document.getElementById('gate-code').focus();
}

async function gateVerifyCode() {
  const email = document.getElementById('gate-email').value.trim();
  const token = document.getElementById('gate-code').value.trim();
  // Supabase email-OTP length is configurable 6-10 digits; this project sends 8.
  if (!/^\d{6,10}$/.test(token)) { setGateError('Enter the code from the email'); return; }
  setGateError('');
  const { error } = await sb.auth.verifyOtp({ email, token, type: 'email' });
  if (error) setGateError(error.message);
  // Success path: onAuthStateChange hides the gate and starts the app.
}

window.financeSignOut = () => sb.auth.signOut().then(() => location.reload());

const _cache = { transactions: null, categories: null, ready: false };

// ---- Default Categories ----

const DEFAULT_CATEGORIES = {
  expense: {
    'Rent': [], 'Groceries': [], 'Dining Out': [], 'Transport': [], 'Utilities': [],
    'Subscriptions': [], 'Shopping': [], 'Entertainment': [], 'Health': [], 'Education': [], 'Other': []
  },
  income: {
    'Salary': [], 'Freelance': [], 'Investment': [], 'Gift': [], 'Other': []
  }
};
const UNCATEGORIZED_CATEGORY = 'Uncategorized';

// ---- bgWrite ----

function bgWrite(fn) {
  Promise.resolve().then(fn).catch(err => console.error('[Supabase bgWrite]', err));
}

// ---- Category functions ----

function loadCategories() {
  if (_cache.categories) return JSON.parse(JSON.stringify(_cache.categories));
  const saved = localStorage.getItem('ft_categories');
  return saved ? JSON.parse(saved) : JSON.parse(JSON.stringify(DEFAULT_CATEGORIES));
}

function saveCategories(cats) {
  _cache.categories = JSON.parse(JSON.stringify(cats));
  localStorage.setItem('ft_categories', JSON.stringify(cats));
  bgWrite(async () => {
    const { error } = await sb.from('settings').upsert({ key: 'ft_categories', value: JSON.stringify(cats) });
    if (error) throw error;
  });
}

function persistTransactions(list, changedRows = []) {
  _cache.transactions = list;
  localStorage.setItem('ft_transactions', JSON.stringify(list));
  if (!changedRows.length) return;
  bgWrite(async () => {
    for (const txn of changedRows) {
      const { created_at, ...row } = txn;
      const { error } = await sb.from('transactions').update(row).eq('id', txn.id);
      if (error) throw error;
    }
  });
}

function remapTransactions(remapFn) {
  const list = loadTransactions();
  const changedRows = [];
  const next = list.map(txn => {
    const updated = remapFn(txn);
    if (!updated || updated === txn) return txn;
    changedRows.push(updated);
    return updated;
  });
  if (changedRows.length) persistTransactions(next, changedRows);
  return changedRows.length;
}

function ensureCategoryExists(cats, type, name) {
  if (!cats[type]) cats[type] = {};
  if (!cats[type][name]) cats[type][name] = [];
  return name;
}

function getDeletedCategoryFallback(cats, type, removedName) {
  if (removedName !== 'Other') return ensureCategoryExists(cats, type, 'Other');
  return ensureCategoryExists(cats, type, UNCATEGORIZED_CATEGORY);
}

function renameCategoryTransactions(type, oldName, newName) {
  if (!oldName || oldName === newName) return;
  remapTransactions(txn => txn.type === type && txn.category === oldName ? { ...txn, category: newName } : txn);
}

function moveDeletedCategoryTransactions(type, removedName, fallbackCategory) {
  remapTransactions(txn => (
    txn.type === type && txn.category === removedName
      ? { ...txn, category: fallbackCategory, subcategory: null }
      : txn
  ));
}

function renameSubcategoryTransactions(type, categoryName, oldName, newName) {
  if (!oldName || oldName === newName) return;
  remapTransactions(txn => (
    txn.type === type && txn.category === categoryName && txn.subcategory === oldName
      ? { ...txn, subcategory: newName }
      : txn
  ));
}

function clearDeletedSubcategoryTransactions(type, categoryName, removedName) {
  remapTransactions(txn => (
    txn.type === type && txn.category === categoryName && txn.subcategory === removedName
      ? { ...txn, subcategory: null }
      : txn
  ));
}

// ---- Transaction functions ----

function loadTransactions() {
  if (_cache.ready && _cache.transactions) return [..._cache.transactions];
  const saved = localStorage.getItem('ft_transactions');
  return saved ? JSON.parse(saved) : [];
}

function saveTransaction(txn) {
  const list = loadTransactions();
  list.push(txn);
  _cache.transactions = list;
  localStorage.setItem('ft_transactions', JSON.stringify(list));
  const tempId = txn.id;
  bgWrite(async () => {
    const { id, created_at, ...row } = txn;
    const { data, error } = await sb.from('transactions').insert(row).select();
    if (error) throw error;
    if (data && data[0]) {
      _cache.transactions = _cache.transactions.map(t => t.id === tempId ? data[0] : t);
      localStorage.setItem('ft_transactions', JSON.stringify(_cache.transactions));
    }
  });
}

function updateTransaction(txn) {
  const list = loadTransactions();
  const idx = list.findIndex(t => t.id === txn.id);
  if (idx === -1) return;
  list[idx] = { ...txn };
  _cache.transactions = list;
  localStorage.setItem('ft_transactions', JSON.stringify(list));
  bgWrite(async () => {
    const { created_at, ...row } = txn;
    const { error } = await sb.from('transactions').update(row).eq('id', txn.id);
    if (error) throw error;
  });
}

function deleteTransaction(id) {
  _cache.transactions = loadTransactions().filter(t => t.id !== id);
  localStorage.setItem('ft_transactions', JSON.stringify(_cache.transactions));
  bgWrite(async () => {
    const { error } = await sb.from('transactions').delete().eq('id', id);
    if (error) throw error;
  });
}

async function refreshTransactions() {
  const { data, error } = await sb.from('transactions').select('*').order('date', { ascending: false });
  if (!error && data) {
    const local = JSON.parse(localStorage.getItem('ft_transactions') || '[]');
    const merged = mergeById(data, local);
    _cache.transactions = merged;
    localStorage.setItem('ft_transactions', JSON.stringify(merged));
  }
}

function reconcileTransactionsWithCategories() {
  const cats = loadCategories();
  const list = loadTransactions();
  const changedRows = [];
  let categoriesChanged = false;
  const next = list.map(txn => {
    const categoryName = txn.category || '';
    const subcategoryName = txn.subcategory || null;
    const typeCats = cats[txn.type] || {};
    if (!typeCats[categoryName]) {
      const fallbackCategory = ensureCategoryExists(cats, txn.type, UNCATEGORIZED_CATEGORY);
      categoriesChanged = true;
      const updated = { ...txn, category: fallbackCategory, subcategory: null };
      changedRows.push(updated);
      return updated;
    }
    if (subcategoryName && !typeCats[categoryName].includes(subcategoryName)) {
      const updated = { ...txn, subcategory: null };
      changedRows.push(updated);
      return updated;
    }
    return txn;
  });
  if (categoriesChanged) saveCategories(cats);
  if (changedRows.length) persistTransactions(next, changedRows);
}

// ---- Init ----

function mergeById(supaData, localData) {
  const supaIds = new Set(supaData.map(t => t.id));
  return [...supaData, ...localData.filter(t => !supaIds.has(t.id))];
}

async function initFromSupabase() {
  // Each table loads independently — one failure doesn't block others

  // Transactions
  try {
    const { data, error } = await sb.from('transactions').select('*').order('date', { ascending: false });
    const local = JSON.parse(localStorage.getItem('ft_transactions') || '[]');
    if (!error && data) {
      _cache.transactions = mergeById(data, local);
    } else {
      _cache.transactions = local;
    }
  } catch (e) {
    _cache.transactions = JSON.parse(localStorage.getItem('ft_transactions') || '[]');
  }
  localStorage.setItem('ft_transactions', JSON.stringify(_cache.transactions));

  // Categories from settings
  try {
    const { data: catData } = await sb.from('settings').select('value').eq('key', 'ft_categories').maybeSingle();
    if (catData && catData.value) {
      _cache.categories = JSON.parse(catData.value);
      localStorage.setItem('ft_categories', JSON.stringify(_cache.categories));
    } else {
      _cache.categories = loadCategories();
    }
  } catch (e) {
    _cache.categories = loadCategories();
  }

  _cache.ready = true;
  console.log(`[Supabase] Loaded ${_cache.transactions.length} txns`);
}

function initFromLocalStorage() {
  _cache.transactions = JSON.parse(localStorage.getItem('ft_transactions') || '[]');
  _cache.categories = loadCategories();
  _cache.ready = true;
}

// ---- Offline resync ----
// initFromSupabase overwrites localStorage with server-preferred data, so the
// pre-init snapshot (captured in startApp BEFORE init runs) is the only record
// of rows created/edited while writes were failing. Push those up.

async function resyncTable(table, lsKey, fields, snapshotJson, getList, setList) {
  const { data: server, error } = await sb.from(table).select('*');
  if (error || !server) { console.warn(`[resync] cannot read ${table}: ${error ? error.message : 'no data'}`); return; }
  const local = JSON.parse(snapshotJson || '[]');
  const plan = FinanceSync.planResync(server, local, fields);
  if (plan.serverOnlyIds.length) {
    console.warn(`[resync] ${table}: ${plan.serverOnlyIds.length} rows exist only on the server (possible offline deletes) — left untouched`);
  }
  if (!plan.inserts.length && !plan.updates.length) return;
  console.log(`[resync] ${table}: pushing ${plan.inserts.length} new + ${plan.updates.length} edited offline rows`);
  let list = getList();
  for (const row of plan.inserts) {
    const { id, created_at, ...payload } = row;
    const { data, error: e } = await sb.from(table).insert(payload).select();
    if (e) { console.error(`[resync] insert failed on ${table}: ${e.message}`); continue; }
    if (data && data[0]) list = list.map(t => t.id === row.id ? data[0] : t);
  }
  for (const row of plan.updates) {
    const { created_at, ...payload } = row;
    const { error: e } = await sb.from(table).update(payload).eq('id', row.id);
    if (e) { console.error(`[resync] update failed on ${table}: ${e.message}`); continue; }
    // The cache holds the stale server version after init — restore the local edit.
    list = list.map(t => t.id === row.id ? { ...row } : t);
  }
  setList(list);
  localStorage.setItem(lsKey, JSON.stringify(list));
}

async function resyncOfflineData(snapshot) {
  await resyncTable('transactions', 'ft_transactions',
    ['date', 'type', 'category', 'subcategory', 'description', 'amount', 'notes'],
    snapshot.transactions, () => _cache.transactions, l => { _cache.transactions = l; });
  // Categories: the local snapshot is the user's latest state on this device;
  // if it differs from what the server had, the local version wins.
  if (snapshot.categories) {
    try {
      const { data } = await sb.from('settings').select('value').eq('key', 'ft_categories').maybeSingle();
      const serverValue = data && data.value;
      if (serverValue !== snapshot.categories) {
        console.log('[resync] categories: pushing offline category edits');
        _cache.categories = JSON.parse(snapshot.categories);
        localStorage.setItem('ft_categories', snapshot.categories);
        const { error } = await sb.from('settings').upsert({ key: 'ft_categories', value: snapshot.categories });
        if (error) console.error(`[resync] categories upsert failed: ${error.message}`);
      }
    } catch (e) { console.error('[resync] categories failed:', e); }
  }
}

// ============================================================
// HELPERS
// ============================================================

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fmt(amount) {
  return Number(amount).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function formatInputDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function currentDateValue() {
  return formatInputDate(new Date());
}

function parseMonthValue(monthValue) {
  const match = /^(\d{4})-(\d{2})$/.exec(monthValue || currentMonth());
  if (!match) return parseMonthValue(currentMonth());
  return { year: Number(match[1]), monthIndex: Number(match[2]) - 1 };
}

function getMonthEnd(year, monthIndex) {
  return formatInputDate(new Date(year, monthIndex + 1, 0));
}

function formatMonthLabel(year, monthIndex) {
  return new Date(year, monthIndex, 1).toLocaleDateString('en-PH', { month: 'long', year: 'numeric' });
}

function formatDateRangeLabel(startDate, endDate) {
  if (startDate && endDate) {
    return startDate === endDate ? formatDateShort(startDate) : `${formatDateShort(startDate)} - ${formatDateShort(endDate)}`;
  }
  if (startDate) return `From ${formatDateShort(startDate)}`;
  if (endDate) return `Up to ${formatDateShort(endDate)}`;
  return 'All Time';
}

function getWeekStart(dateValue) {
  const date = new Date(`${dateValue}T00:00:00`);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  return formatInputDate(date);
}

function getWeekEnd(dateValue) {
  const start = new Date(`${getWeekStart(dateValue)}T00:00:00`);
  start.setDate(start.getDate() + 6);
  return formatInputDate(start);
}

function filterTransactionsByDateRange(txns, startDate, endDate) {
  return txns.filter(t => t.date && (!startDate || t.date >= startDate) && (!endDate || t.date <= endDate));
}

function getFilteredTransactions(monthValue) {
  const all = loadTransactions();
  if (!monthValue) return all;
  return all.filter(t => t.date && t.date.startsWith(monthValue));
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-PH', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
}

function formatDateShort(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

// ============================================================
// UI STATE
// ============================================================

let currentTab = 'transactions';
let editingId = null;
let deletingId = null;
let catModalState = { mode: null, type: null, catName: null, subIdx: null };
let currentSummaryContext = { txns: [], label: 'All Time', startDate: null, endDate: null };
let activeExpenseDetailLabel = null;

// ---- Tab switching ----

document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(s => s.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    document.getElementById(tab).classList.add('active');
    currentTab = tab;
    render();
  });
});

const txnMonthFilter = document.getElementById('txn-month-filter');
const summaryRangeTypeSelect = document.getElementById('summary-range-type');
const summaryWeekFilter = document.getElementById('summary-week-filter');
const summaryMonthFilter = document.getElementById('summary-month-filter');
const summaryQuarterFilter = document.getElementById('summary-quarter-filter');
const summarySemiannualFilter = document.getElementById('summary-semiannual-filter');
const summaryYearFilter = document.getElementById('summary-year-filter');
const summaryCustomStartFilter = document.getElementById('summary-custom-start-filter');
const summaryCustomEndFilter = document.getElementById('summary-custom-end-filter');
const summaryRangeLabel = document.getElementById('summary-range-label');
const summaryFilterControls = {
  weekly: document.getElementById('summary-week-control'),
  monthly: document.getElementById('summary-month-control'),
  quarterly: document.getElementById('summary-quarter-control'),
  semiannual: document.getElementById('summary-semiannual-control'),
  yearly: document.getElementById('summary-year-control'),
  custom: document.getElementById('summary-custom-control')
};

function getTransactionYears() {
  const years = new Set([new Date().getFullYear()]);
  loadTransactions().forEach(txn => {
    if (txn.date) years.add(Number(txn.date.slice(0, 4)));
  });
  return [...years].filter(Number.isFinite).sort((a, b) => b - a);
}

function populateSummaryYearOptions() {
  const years = getTransactionYears();
  const previousValue = summaryYearFilter.value || String(new Date().getFullYear());
  summaryYearFilter.innerHTML = years.map(year => `<option value="${year}">${year}</option>`).join('');
  summaryYearFilter.value = years.includes(Number(previousValue)) ? previousValue : String(years[0] || new Date().getFullYear());
}

function updateSummaryFilterControls() {
  const rangeType = summaryRangeTypeSelect.value;
  Object.entries(summaryFilterControls).forEach(([type, control]) => {
    control.classList.toggle('hidden', type !== rangeType);
  });
  if (rangeType === 'yearly') populateSummaryYearOptions();
}

function getSummaryRange() {
  switch (summaryRangeTypeSelect.value) {
    case 'weekly': {
      const anchorDate = summaryWeekFilter.value || currentDateValue();
      const startDate = getWeekStart(anchorDate);
      const endDate = getWeekEnd(anchorDate);
      return { startDate, endDate, label: formatDateRangeLabel(startDate, endDate) };
    }
    case 'monthly': {
      const { year, monthIndex } = parseMonthValue(summaryMonthFilter.value);
      return {
        startDate: formatInputDate(new Date(year, monthIndex, 1)),
        endDate: getMonthEnd(year, monthIndex),
        label: formatMonthLabel(year, monthIndex)
      };
    }
    case 'quarterly': {
      const { year, monthIndex } = parseMonthValue(summaryQuarterFilter.value);
      const quarter = Math.floor(monthIndex / 3) + 1;
      const startMonth = (quarter - 1) * 3;
      return {
        startDate: formatInputDate(new Date(year, startMonth, 1)),
        endDate: getMonthEnd(year, startMonth + 2),
        label: `Q${quarter} ${year}`
      };
    }
    case 'semiannual': {
      const { year, monthIndex } = parseMonthValue(summarySemiannualFilter.value);
      const half = monthIndex < 6 ? 1 : 2;
      const startMonth = half === 1 ? 0 : 6;
      return {
        startDate: formatInputDate(new Date(year, startMonth, 1)),
        endDate: getMonthEnd(year, startMonth + 5),
        label: `H${half} ${year}`
      };
    }
    case 'yearly': {
      populateSummaryYearOptions();
      const year = Number(summaryYearFilter.value) || new Date().getFullYear();
      return {
        startDate: `${year}-01-01`,
        endDate: `${year}-12-31`,
        label: String(year)
      };
    }
    case 'custom': {
      let startDate = summaryCustomStartFilter.value || null;
      let endDate = summaryCustomEndFilter.value || null;
      if (startDate && endDate && startDate > endDate) [startDate, endDate] = [endDate, startDate];
      return { startDate, endDate, label: formatDateRangeLabel(startDate, endDate) };
    }
    case 'all':
    default:
      return { startDate: null, endDate: null, label: 'All Time' };
  }
}

function getSummaryTransactions() {
  const range = getSummaryRange();
  return {
    ...range,
    txns: filterTransactionsByDateRange(loadTransactions(), range.startDate, range.endDate)
  };
}

txnMonthFilter.value = currentMonth();
summaryWeekFilter.value = currentDateValue();
summaryMonthFilter.value = currentMonth();
summaryQuarterFilter.value = currentMonth();
summarySemiannualFilter.value = currentMonth();
summaryCustomStartFilter.value = `${currentMonth()}-01`;
summaryCustomEndFilter.value = currentDateValue();
populateSummaryYearOptions();
updateSummaryFilterControls();

txnMonthFilter.addEventListener('change', render);
summaryRangeTypeSelect.addEventListener('change', () => { updateSummaryFilterControls(); render(); });
[summaryWeekFilter, summaryMonthFilter, summaryQuarterFilter, summarySemiannualFilter, summaryYearFilter, summaryCustomStartFilter, summaryCustomEndFilter]
  .forEach(control => control.addEventListener('change', render));

// ============================================================
// RENDER — Transactions Tab
// ============================================================

function renderTransactions() {
  const month = txnMonthFilter.value;
  const txns = getFilteredTransactions(month);
  const groups = {};
  txns.forEach(t => { if (!groups[t.date]) groups[t.date] = []; groups[t.date].push(t); });
  const sortedDates = Object.keys(groups).sort((a, b) => b.localeCompare(a));
  const tbody = document.getElementById('txn-tbody');
  tbody.innerHTML = '';
  let monthIncome = 0, monthExpense = 0;

  sortedDates.forEach(date => {
    const items = groups[date];
    let dayIncome = 0, dayExpense = 0;
    items.forEach(t => { const a = Number(t.amount); if (t.type === 'income') dayIncome += a; else dayExpense += a; });
    monthIncome += dayIncome; monthExpense += dayExpense;

    const hr = document.createElement('tr'); hr.className = 'date-group-row';
    hr.innerHTML = `<td colspan="6"><span class="date-dot"></span>${formatDate(date)}</td>`;
    tbody.appendChild(hr);

    items.forEach(t => {
      const tr = document.createElement('tr');
      if (t.type === 'income') tr.className = 'income-row';
      let catDisplay = escapeHtml(t.category);
      if (t.subcategory) catDisplay += ` <span class="cat-sub-label">&rsaquo; ${escapeHtml(t.subcategory)}</span>`;
      tr.innerHTML = `
        <td><span class="type-badge ${t.type}">${t.type === 'income' ? 'Income' : 'Expense'}</span></td>
        <td>${catDisplay}</td>
        <td>${escapeHtml(t.description)}</td>
        <td class="num ${t.type === 'income' ? 'positive' : 'negative'}">${t.type === 'income' ? '+' : '-'}${fmt(t.amount)}</td>
        <td style="color:var(--text-secondary)">${escapeHtml(t.notes || '')}</td>
        <td><div class="actions">
          <button class="btn-icon" onclick="openEditModal(${t.id})">Edit</button>
          <button class="btn-icon delete" onclick="openDeleteModal(${t.id})">Del</button>
        </div></td>`;
      tbody.appendChild(tr);
    });

    const dn = dayIncome - dayExpense;
    const dr = document.createElement('tr'); dr.className = 'daily-totals-row';
    dr.innerHTML = `<td colspan="3" style="text-align:right">Day: <span class="positive" style="margin-left:8px">+${fmt(dayIncome)}</span><span class="negative" style="margin-left:8px">-${fmt(dayExpense)}</span></td><td class="num ${dn >= 0 ? 'positive' : 'negative'}">${dn >= 0 ? '+' : ''}${fmt(dn)}</td><td colspan="2"></td>`;
    tbody.appendChild(dr);
  });

  if (!sortedDates.length) tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><div class="empty-state-icon">&#128203;</div>No transactions this month</div></td></tr>`;

  const mn = monthIncome - monthExpense;
  document.getElementById('month-totals').innerHTML = `
    <div class="total-card"><div class="total-label">Income</div><div class="total-value positive">${fmt(monthIncome)}</div></div>
    <div class="total-card"><div class="total-label">Expenses</div><div class="total-value negative">${fmt(monthExpense)}</div></div>
    <div class="total-card"><div class="total-label">Net</div><div class="total-value ${mn >= 0 ? 'positive' : 'negative'}">${mn >= 0 ? '+' : ''}${fmt(mn)}</div></div>`;
}

// ============================================================
// RENDER — Summary Tab
// ============================================================

function renderSummary() {
  populateSummaryYearOptions();
  currentSummaryContext = getSummaryTransactions();
  const { txns, label } = currentSummaryContext;
  let totalIncome = 0, totalExpense = 0;
  const expenseByCat = {}, incomeByCat = {};
  summaryRangeLabel.textContent = `Period: ${label}`;
  txns.forEach(t => {
    const a = Number(t.amount);
    const categoryLabel = t.subcategory ? `${t.category} > ${t.subcategory}` : t.category;
    if (t.type === 'income') { totalIncome += a; incomeByCat[categoryLabel] = (incomeByCat[categoryLabel] || 0) + a; }
    else { totalExpense += a; expenseByCat[categoryLabel] = (expenseByCat[categoryLabel] || 0) + a; }
  });
  const net = totalIncome - totalExpense;

  document.getElementById('summary-cards').innerHTML = `
    <div class="summary-card"><div class="card-label">Total Income</div><div class="card-value positive">${fmt(totalIncome)}</div></div>
    <div class="summary-card"><div class="card-label">Total Expenses</div><div class="card-value negative">${fmt(totalExpense)}</div></div>
    <div class="summary-card"><div class="card-label">Net</div><div class="card-value ${net >= 0 ? 'positive' : 'negative'}">${net >= 0 ? '+' : ''}${fmt(net)}</div></div>`;

  const eRows = Object.entries(expenseByCat).sort((a, b) => b[1] - a[1]).map(([c, a]) => {
    const p = totalExpense > 0 ? (a / totalExpense * 100) : 0;
    return `<tr><td><button type="button" class="breakdown-link" data-expense-label="${escapeAttr(c)}">${escapeHtml(c)}</button></td><td class="num">${fmt(a)}</td><td><div class="pct-bar-cell"><div class="pct-bar"><div class="pct-bar-fill" style="width:${p}%"></div></div><span class="pct-text">${p.toFixed(1)}%</span></div></td></tr>`;
  }).join('');
  document.querySelector('#expense-breakdown tbody').innerHTML = eRows || `<tr><td colspan="3"><div class="empty-state">No expenses</div></td></tr>`;

  const iRows = Object.entries(incomeByCat).sort((a, b) => b[1] - a[1]).map(([c, a]) => `<tr><td>${escapeHtml(c)}</td><td class="num">${fmt(a)}</td></tr>`).join('');
  document.querySelector('#income-breakdown tbody').innerHTML = iRows || `<tr><td colspan="2"><div class="empty-state">No income</div></td></tr>`;

  if (activeExpenseDetailLabel && !expenseDetailModal.classList.contains('hidden')) renderExpenseDetailModal(activeExpenseDetailLabel);
}

function getSummaryCategoryLabel(txn) {
  return txn.subcategory ? `${txn.category} > ${txn.subcategory}` : txn.category;
}

function renderExpenseDetailModal(label) {
  const rows = currentSummaryContext.txns
    .filter(txn => txn.type === 'expense' && getSummaryCategoryLabel(txn) === label)
    .sort((a, b) => b.date.localeCompare(a.date) || Number(b.amount) - Number(a.amount));
  const total = rows.reduce((sum, txn) => sum + Number(txn.amount), 0);
  document.getElementById('expense-detail-title').textContent = label;
  document.getElementById('expense-detail-period').textContent = `Period: ${currentSummaryContext.label}`;
  document.getElementById('expense-detail-summary').innerHTML = `
    <div class="detail-summary-pill"><strong>${rows.length}</strong> transaction${rows.length === 1 ? '' : 's'}</div>
    <div class="detail-summary-pill">Total <strong>${fmt(total)}</strong></div>`;
  document.querySelector('#expense-detail-table tbody').innerHTML = rows.map(txn => `
    <tr>
      <td>${formatDateShort(txn.date)}</td>
      <td>${escapeHtml(txn.description)}</td>
      <td class="num negative">-${fmt(txn.amount)}</td>
      <td>${escapeHtml(txn.notes || '')}</td>
    </tr>`).join('') || `<tr><td colspan="4"><div class="empty-state">No expenses in this period</div></td></tr>`;
}

function openExpenseDetailModal(label) {
  if (!label) return;
  activeExpenseDetailLabel = label;
  renderExpenseDetailModal(label);
  expenseDetailModal.classList.remove('hidden');
}

function closeExpenseDetailModal() {
  expenseDetailModal.classList.add('hidden');
  activeExpenseDetailLabel = null;
}

// ============================================================
// RENDER — Weekly Snapshot Tab
// ============================================================

const snapshotYearFilter = document.getElementById('snapshot-year-filter');

function populateSnapshotYearOptions() {
  const years = getTransactionYears();
  const prev = snapshotYearFilter.value || String(new Date().getFullYear());
  snapshotYearFilter.innerHTML = years.map(y => `<option value="${y}">${y}</option>`).join('');
  snapshotYearFilter.value = years.includes(Number(prev)) ? prev : String(years[0] || new Date().getFullYear());
}

snapshotYearFilter.addEventListener('change', render);

function getWeeksInMonth(year, monthIndex) {
  const weeks = [];
  const firstDay = new Date(year, monthIndex, 1);
  const lastDay = new Date(year, monthIndex + 1, 0);
  const dow = firstDay.getDay(); // 0=Sun, 1=Mon, ...
  // Days remaining in first partial week (Mon-Sun). If month starts on Mon, full 7 days.
  const daysToSunday = dow === 0 ? 0 : 7 - dow;
  // If the stub is less than 3 days, merge it into the first full week
  let firstWeekEnd;
  if (dow === 1 || daysToSunday >= 3) {
    // Start is Mon or partial week is 3+ days — keep it as Week 1
    firstWeekEnd = new Date(firstDay);
    firstWeekEnd.setDate(firstWeekEnd.getDate() + daysToSunday);
  } else {
    // Stub is tiny (1-2 days) — extend through next Sunday
    firstWeekEnd = new Date(firstDay);
    firstWeekEnd.setDate(firstWeekEnd.getDate() + daysToSunday + 7);
  }
  if (firstWeekEnd > lastDay) firstWeekEnd = new Date(lastDay);

  weeks.push({
    startDate: formatInputDate(firstDay),
    endDate: formatInputDate(firstWeekEnd),
    displayStart: formatInputDate(firstDay),
    displayEnd: formatInputDate(firstWeekEnd),
  });

  let weekStart = new Date(firstWeekEnd);
  weekStart.setDate(weekStart.getDate() + 1);
  while (weekStart <= lastDay) {
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    const clampedEnd = weekEnd > lastDay ? lastDay : new Date(weekEnd);
    weeks.push({
      startDate: formatInputDate(weekStart),
      endDate: formatInputDate(clampedEnd),
      displayStart: formatInputDate(weekStart),
      displayEnd: formatInputDate(clampedEnd),
    });
    weekStart = new Date(clampedEnd);
    weekStart.setDate(weekStart.getDate() + 1);
  }
  return weeks;
}

function renderWeeklySnapshot() {
  populateSnapshotYearOptions();
  const year = Number(snapshotYearFilter.value) || new Date().getFullYear();
  const allTxns = loadTransactions();
  const yearTxns = allTxns.filter(t => t.date && t.date.startsWith(String(year)));

  let yearExpense = 0, yearIncome = 0;
  yearTxns.forEach(t => {
    const a = Number(t.amount);
    if (t.type === 'income') yearIncome += a; else yearExpense += a;
  });
  const yearNet = yearIncome - yearExpense;

  document.getElementById('snapshot-totals').innerHTML = `
    <div class="total-card"><div class="total-label">Year Income</div><div class="total-value positive">${fmt(yearIncome)}</div></div>
    <div class="total-card"><div class="total-label">Year Expenses</div><div class="total-value negative">${fmt(yearExpense)}</div></div>
    <div class="total-card"><div class="total-label">Year Net</div><div class="total-value ${yearNet >= 0 ? 'positive' : 'negative'}">${yearNet >= 0 ? '+' : ''}${fmt(yearNet)}</div></div>`;

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                       'July', 'August', 'September', 'October', 'November', 'December'];
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonthIdx = now.getMonth();

  let html = '';
  for (let m = 0; m < 12; m++) {
    // Skip future months
    if (year === currentYear && m > currentMonthIdx) continue;
    // Skip months with no data (but always show current month)
    const monthPrefix = `${year}-${String(m + 1).padStart(2, '0')}`;
    const monthTxns = yearTxns.filter(t => t.date && t.date.startsWith(monthPrefix));
    if (!monthTxns.length && !(year === currentYear && m === currentMonthIdx)) continue;

    const monthExpense = monthTxns.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);
    const monthIncome = monthTxns.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0);

    const weeks = getWeeksInMonth(year, m);
    let weeksHtml = '';
    weeks.forEach((w, i) => {
      const weekTxns = monthTxns.filter(t => t.date >= w.startDate && t.date <= w.endDate);
      const wExpense = weekTxns.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);
      const wIncome = weekTxns.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0);

      // Build category breakdown for expenses
      const catMap = {};
      weekTxns.filter(t => t.type === 'expense').forEach(t => {
        const cat = t.category || 'Other';
        catMap[cat] = (catMap[cat] || 0) + Number(t.amount);
      });
      const catEntries = Object.entries(catMap).sort((a, b) => b[1] - a[1]);

      const dStart = new Date(w.displayStart + 'T00:00:00');
      const dEnd = new Date(w.displayEnd + 'T00:00:00');
      const rangeLabel = `${dStart.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })} - ${dEnd.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}`;

      const barWidth = monthExpense > 0 ? Math.round(wExpense / monthExpense * 100) : 0;

      let catBreakdown = '';
      if (catEntries.length) {
        catBreakdown = `<div class="snap-week-cats">${catEntries.map(([cat, amt]) =>
          `<span class="snap-cat-chip"><span class="snap-cat-name">${escapeHtml(cat)}</span> <span class="snap-cat-amt">${fmt(amt)}</span></span>`
        ).join('')}</div>`;
      }

      weeksHtml += `
        <div class="snap-week${!wExpense && !wIncome ? ' snap-week-empty' : ''}">
          <div class="snap-week-header">
            <span class="snap-week-label">Week ${i + 1}</span>
            <span class="snap-week-range">${rangeLabel}</span>
          </div>
          <div class="snap-week-amounts">
            <span class="snap-week-expense negative">-${fmt(wExpense)}</span>
            ${wIncome ? `<span class="snap-week-income positive">+${fmt(wIncome)}</span>` : ''}
          </div>
          <div class="snap-week-bar"><div class="snap-week-bar-fill" style="width:${barWidth}%"></div></div>
          ${catBreakdown}
        </div>`;
    });

    const mNet = monthIncome - monthExpense;
    html += `
      <div class="snap-month-card">
        <div class="snap-month-header">
          <h3 class="snap-month-name">${monthNames[m]}</h3>
          <div class="snap-month-totals">
            <span class="negative">-${fmt(monthExpense)}</span>
            <span class="positive">+${fmt(monthIncome)}</span>
            <span class="${mNet >= 0 ? 'positive' : 'negative'}">${mNet >= 0 ? '+' : ''}${fmt(mNet)}</span>
          </div>
        </div>
        <div class="snap-weeks">${weeksHtml}</div>
      </div>`;
  }

  if (!html) html = `<div class="empty-state"><div class="empty-state-icon">&#128197;</div>No transactions for ${year}</div>`;
  document.getElementById('snapshot-grid').innerHTML = html;
}

// ============================================================
// RENDER — Categories Tab
// ============================================================

function renderCategories() {
  const cats = loadCategories();
  renderCatSection('expense', cats.expense, document.getElementById('expense-cats-list'));
  renderCatSection('income', cats.income, document.getElementById('income-cats-list'));
}

function renderCatSection(type, catObj, container) {
  const entries = Object.entries(catObj);
  if (!entries.length) { container.innerHTML = `<div class="cat-empty">No categories yet</div>`; return; }
  let html = '';
  entries.forEach(([catName, subs]) => {
    const ea = escapeAttr(catName);
    const subsHtml = subs.map((s, i) => `<span class="sub-chip">${escapeHtml(s)}
      <button class="sub-chip-btn" data-action="edit-sub" data-type="${type}" data-cat="${ea}" data-sub-idx="${i}" title="Edit">&#9998;</button>
      <button class="sub-chip-btn del" data-action="delete-sub" data-type="${type}" data-cat="${ea}" data-sub-idx="${i}" title="Delete">&times;</button></span>`).join('');
    html += `<div class="cat-item"><div class="cat-header"><span class="cat-name">${escapeHtml(catName)}</span><div class="cat-actions">
      <button class="btn-icon" data-action="edit-cat" data-type="${type}" data-cat="${ea}">Edit</button>
      <button class="btn-icon delete" data-action="delete-cat" data-type="${type}" data-cat="${ea}">Del</button></div></div>
      <div class="cat-subs">${subsHtml}<button class="btn-add-sub" data-action="add-sub" data-type="${type}" data-cat="${ea}">+ Add</button></div></div>`;
  });
  container.innerHTML = html;
}

document.getElementById('manage-cats-modal').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]'); if (!btn) return;
  const { action, type, cat, subIdx } = btn.dataset;
  const idx = subIdx !== undefined ? parseInt(subIdx) : null;
  if (action === 'add-cat') openCatModal('add-cat', type);
  else if (action === 'edit-cat') openCatModal('edit-cat', type, cat);
  else if (action === 'delete-cat') {
    if (confirm(`Delete "${cat}" and all subcategories?`)) {
      const c = loadCategories();
      const fallbackCategory = getDeletedCategoryFallback(c, type, cat);
      delete c[type][cat];
      saveCategories(c);
      moveDeletedCategoryTransactions(type, cat, fallbackCategory);
      renderCategories();
      render();
    }
  }
  else if (action === 'add-sub') openCatModal('add-sub', type, cat);
  else if (action === 'edit-sub') openCatModal('edit-sub', type, cat, idx);
  else if (action === 'delete-sub') {
    const c = loadCategories();
    if (c[type][cat]) {
      const removedSub = c[type][cat][idx];
      c[type][cat].splice(idx, 1);
      saveCategories(c);
      clearDeletedSubcategoryTransactions(type, cat, removedSub);
      renderCategories();
      render();
    }
  }
});

// ============================================================
// CSV EXPORT
// ============================================================

const CSV_HEADERS = ['Date', 'Type', 'Category', 'Subcategory', 'Description', 'Amount', 'Notes'];

function csvEscape(value) {
  const str = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function buildTransactionsCsv(txns) {
  const rows = txns.map(t => [
    t.date, t.type, t.category, t.subcategory || '', t.description,
    Number(t.amount).toFixed(2), t.notes || ''
  ]);
  return [CSV_HEADERS, ...rows].map(row => row.map(csvEscape).join(',')).join('\r\n');
}

function downloadCsv(filename, csvText) {
  // UTF-8 BOM so Excel detects the encoding
  const blob = new Blob([String.fromCharCode(0xFEFF) + csvText], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function exportAllTransactions() {
  const txns = loadTransactions().slice().sort((a, b) => a.date.localeCompare(b.date));
  if (!txns.length) { alert('No transactions to export.'); return; }
  downloadCsv(`finance-transactions-all-${currentDateValue()}.csv`, buildTransactionsCsv(txns));
}

document.getElementById('export-all-btn').addEventListener('click', exportAllTransactions);

// ============================================================
// RENDER — Monthly Breakdown Tab
// ============================================================

const bdYearFilter = document.getElementById('bd-year-filter');
const bdTypeFilter = document.getElementById('bd-type-filter');
const bdCatFilter = document.getElementById('bd-cat-filter');

function populateBreakdownYearOptions() {
  const years = getTransactionYears();
  const prev = bdYearFilter.value || String(new Date().getFullYear());
  bdYearFilter.innerHTML = years.map(y => `<option value="${y}">${y}</option>`).join('');
  bdYearFilter.value = years.includes(Number(prev)) ? prev : String(years[0] || new Date().getFullYear());
}

function populateBreakdownCategoryOptions() {
  const type = bdTypeFilter.value;
  // Union of configured categories and any category still on a transaction
  // (e.g. Uncategorized) so nothing is filterable-out of existence.
  const names = new Set(Object.keys(loadCategories()[type] || {}));
  loadTransactions().forEach(t => { if (t.type === type && t.category) names.add(t.category); });
  const prev = bdCatFilter.value;
  bdCatFilter.innerHTML = '<option value="">All Categories</option>' +
    [...names].sort((a, b) => a.localeCompare(b)).map(c => `<option value="${escapeAttr(c)}">${escapeHtml(c)}</option>`).join('');
  bdCatFilter.value = names.has(prev) ? prev : '';
}

function getBreakdownTransactions() {
  const year = bdYearFilter.value;
  const type = bdTypeFilter.value;
  const category = bdCatFilter.value;
  return loadTransactions().filter(t =>
    t.date && t.date.startsWith(year) && t.type === type && (!category || t.category === category));
}

function renderBreakdown() {
  populateBreakdownYearOptions();
  populateBreakdownCategoryOptions();
  const txns = getBreakdownTransactions();
  const type = bdTypeFilter.value;
  const sign = type === 'income' ? '+' : '-';
  const amountClass = type === 'income' ? 'positive' : 'negative';

  const total = txns.reduce((s, t) => s + Number(t.amount), 0);
  document.getElementById('bd-totals').innerHTML = `
    <div class="total-card"><div class="total-label">${bdYearFilter.value} ${type === 'income' ? 'Income' : 'Expenses'}${bdCatFilter.value ? ` — ${escapeHtml(bdCatFilter.value)}` : ''}</div>
    <div class="total-value ${amountClass}">${fmt(total)}</div></div>
    <div class="total-card"><div class="total-label">Transactions</div><div class="total-value">${txns.length}</div></div>`;

  // month "YYYY-MM" → category → txns
  const byMonth = {};
  txns.forEach(t => {
    const month = t.date.slice(0, 7);
    if (!byMonth[month]) byMonth[month] = {};
    const cat = t.category || 'Other';
    if (!byMonth[month][cat]) byMonth[month][cat] = [];
    byMonth[month][cat].push(t);
  });

  const months = Object.keys(byMonth).sort((a, b) => b.localeCompare(a));
  let html = '';
  months.forEach(month => {
    const { year, monthIndex } = parseMonthValue(month);
    const cats = Object.entries(byMonth[month])
      .map(([cat, list]) => ({ cat, list, subtotal: list.reduce((s, t) => s + Number(t.amount), 0) }))
      .sort((a, b) => b.subtotal - a.subtotal);
    const monthTotal = cats.reduce((s, c) => s + c.subtotal, 0);
    const monthCount = cats.reduce((s, c) => s + c.list.length, 0);

    let catsHtml = '';
    cats.forEach(({ cat, list, subtotal }) => {
      const rows = list
        .sort((a, b) => b.date.localeCompare(a.date) || Number(b.amount) - Number(a.amount))
        .map(t => `
          <tr>
            <td>${formatDateShort(t.date)}</td>
            <td>${t.subcategory ? escapeHtml(t.subcategory) : '<span class="bd-no-sub">—</span>'}</td>
            <td>${escapeHtml(t.description)}</td>
            <td class="num ${amountClass}">${sign}${fmt(t.amount)}</td>
            <td style="color:var(--text-secondary)">${escapeHtml(t.notes || '')}</td>
          </tr>`).join('');
      catsHtml += `
        <div class="bd-cat">
          <div class="bd-cat-header">
            <span class="bd-cat-name">${escapeHtml(cat)}</span>
            <span class="bd-cat-meta">${list.length} transaction${list.length === 1 ? '' : 's'}
              <span class="bd-cat-subtotal ${amountClass}">${sign}${fmt(subtotal)}</span></span>
          </div>
          <table class="bd-table">
            <thead><tr><th>Date</th><th>Subcategory</th><th>Description</th><th class="num">Amount</th><th>Notes</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;
    });

    html += `
      <div class="snap-month-card bd-month-card">
        <div class="snap-month-header">
          <h3 class="snap-month-name">${formatMonthLabel(year, monthIndex)}</h3>
          <div class="snap-month-totals">
            <span>${monthCount} transaction${monthCount === 1 ? '' : 's'}</span>
            <span class="${amountClass}">${sign}${fmt(monthTotal)}</span>
          </div>
        </div>
        <div class="bd-month-body">${catsHtml}</div>
      </div>`;
  });

  document.getElementById('bd-months').innerHTML = html ||
    `<div class="empty-state"><div class="empty-state-icon">&#128202;</div>No ${type} transactions for ${bdYearFilter.value}</div>`;
}

function exportBreakdownCsv() {
  const txns = getBreakdownTransactions()
    .sort((a, b) => a.date.localeCompare(b.date) || (a.category || '').localeCompare(b.category || ''));
  if (!txns.length) { alert('Nothing to export for this filter.'); return; }
  const catPart = bdCatFilter.value ? `-${bdCatFilter.value.replace(/[^a-z0-9]+/gi, '_')}` : '';
  downloadCsv(`finance-${bdTypeFilter.value}-${bdYearFilter.value}${catPart}.csv`, buildTransactionsCsv(txns));
}

bdYearFilter.addEventListener('change', render);
bdTypeFilter.addEventListener('change', () => { populateBreakdownCategoryOptions(); bdCatFilter.value = ''; render(); });
bdCatFilter.addEventListener('change', render);
document.getElementById('bd-export-btn').addEventListener('click', exportBreakdownCsv);

// ---- Summary detail modal ----

const expenseBreakdownTableBody = document.querySelector('#expense-breakdown tbody');
const expenseDetailModal = document.getElementById('expense-detail-modal');

expenseBreakdownTableBody.addEventListener('click', e => {
  const btn = e.target.closest('[data-expense-label]');
  if (!btn) return;
  openExpenseDetailModal(btn.dataset.expenseLabel);
});

document.getElementById('expense-detail-close').addEventListener('click', closeExpenseDetailModal);
expenseDetailModal.querySelector('.modal-overlay').addEventListener('click', closeExpenseDetailModal);

// ---- Manage Categories Modal ----

const manageCatsModal = document.getElementById('manage-cats-modal');

function openManageCatsModal() { renderCategories(); manageCatsModal.classList.remove('hidden'); }
function closeManageCatsModal() { manageCatsModal.classList.add('hidden'); }

document.getElementById('manage-cats-btn').addEventListener('click', openManageCatsModal);
document.getElementById('manage-cats-close').addEventListener('click', closeManageCatsModal);
manageCatsModal.querySelector('.modal-overlay').addEventListener('click', closeManageCatsModal);

// ============================================================
// RENDER (main)
// ============================================================

function render() {
  renderTransactions();
  renderSummary();
  renderWeeklySnapshot();
  renderBreakdown();
}

// ============================================================
// TRANSACTION MODAL
// ============================================================

const txnModal = document.getElementById('txn-modal');
const txnTypeSelect = document.getElementById('txn-type');
const txnCategorySelect = document.getElementById('txn-category');
const txnSubcategorySelect = document.getElementById('txn-subcategory');
const txnSubcategoryRow = document.getElementById('subcategory-row');
const txnDateInput = document.getElementById('txn-date');
const txnDescInput = document.getElementById('txn-description');
const txnAmountInput = document.getElementById('txn-amount');
const txnNotesInput = document.getElementById('txn-notes');

function populateCategories() {
  const type = txnTypeSelect.value;
  const cats = loadCategories();
  const names = Object.keys(cats[type] || {});
  txnCategorySelect.innerHTML = names.map(c => `<option value="${escapeAttr(c)}">${escapeHtml(c)}</option>`).join('');
  populateSubcategories();
}

function populateSubcategories() {
  const cats = loadCategories();
  const subs = (cats[txnTypeSelect.value] && cats[txnTypeSelect.value][txnCategorySelect.value]) || [];
  if (!subs.length) { txnSubcategoryRow.style.display = 'none'; txnSubcategorySelect.value = ''; return; }
  txnSubcategoryRow.style.display = 'block';
  txnSubcategorySelect.innerHTML = '<option value="">-- None --</option>' + subs.map(s => `<option value="${escapeAttr(s)}">${escapeHtml(s)}</option>`).join('');
}

txnTypeSelect.addEventListener('change', populateCategories);
txnCategorySelect.addEventListener('change', populateSubcategories);

function openAddModal() {
  editingId = null;
  document.getElementById('txn-modal-title').textContent = 'Add Transaction';
  txnDateInput.value = new Date().toISOString().slice(0, 10);
  txnTypeSelect.value = 'expense'; populateCategories();
  txnSubcategorySelect.value = ''; txnDescInput.value = ''; txnAmountInput.value = ''; txnNotesInput.value = '';
  txnModal.classList.remove('hidden');
}

function openEditModal(id) {
  const txn = loadTransactions().find(t => t.id === id); if (!txn) return;
  editingId = id;
  document.getElementById('txn-modal-title').textContent = 'Edit Transaction';
  txnDateInput.value = txn.date; txnTypeSelect.value = txn.type; populateCategories();
  txnCategorySelect.value = txn.category; populateSubcategories();
  if (txn.subcategory) txnSubcategorySelect.value = txn.subcategory;
  txnDescInput.value = txn.description; txnAmountInput.value = txn.amount; txnNotesInput.value = txn.notes || '';
  txnModal.classList.remove('hidden');
}

function closeModal() { txnModal.classList.add('hidden'); editingId = null; }

document.getElementById('add-txn-btn').addEventListener('click', openAddModal);
document.getElementById('txn-cancel').addEventListener('click', closeModal);
txnModal.querySelector('.modal-overlay').addEventListener('click', closeModal);

document.getElementById('txn-save').addEventListener('click', () => {
  const date = txnDateInput.value, type = txnTypeSelect.value, category = txnCategorySelect.value;
  const subcategory = txnSubcategorySelect.value || null;
  const description = txnDescInput.value.trim(), amount = parseFloat(txnAmountInput.value), notes = txnNotesInput.value.trim();
  if (!date || !description || isNaN(amount) || amount <= 0) { alert('Please fill in date, description, and a valid amount.'); return; }
  if (editingId !== null) updateTransaction({ id: editingId, date, type, category, subcategory, description, amount, notes });
  else saveTransaction({ id: Date.now(), date, type, category, subcategory, description, amount, notes });
  closeModal(); render();
});

// ============================================================
// DELETE MODAL
// ============================================================

const deleteModal = document.getElementById('delete-modal');

function openDeleteModal(id) {
  deletingId = id;
  document.getElementById('delete-modal-title').textContent = 'Delete Transaction';
  document.getElementById('delete-modal-msg').textContent = 'Are you sure you want to delete this transaction?';
  deleteModal.classList.remove('hidden');
}

function closeDeleteModal() { deleteModal.classList.add('hidden'); deletingId = null; }

document.getElementById('delete-cancel').addEventListener('click', closeDeleteModal);
deleteModal.querySelector('.modal-overlay').addEventListener('click', closeDeleteModal);

document.getElementById('delete-confirm').addEventListener('click', () => {
  if (deletingId !== null) {
    deleteTransaction(deletingId);
    closeDeleteModal(); render();
  }
});

// ============================================================
// CATEGORY MODAL
// ============================================================

const catModal = document.getElementById('cat-modal');
const catModalTitle = document.getElementById('cat-modal-title');
const catModalInput = document.getElementById('cat-modal-input');

function openCatModal(mode, type, catName, subIdx) {
  catModalState = { mode, type, catName: catName || null, subIdx: subIdx !== undefined ? subIdx : null };
  if (mode === 'add-cat') { catModalTitle.textContent = `Add ${type === 'expense' ? 'Expense' : 'Income'} Category`; catModalInput.value = ''; catModalInput.placeholder = 'Category name'; }
  else if (mode === 'edit-cat') { catModalTitle.textContent = 'Edit Category'; catModalInput.value = catName; catModalInput.placeholder = 'Category name'; }
  else if (mode === 'add-sub') { catModalTitle.textContent = `Add Subcategory to ${catName}`; catModalInput.value = ''; catModalInput.placeholder = 'Subcategory name'; }
  else if (mode === 'edit-sub') { const cats = loadCategories(); catModalTitle.textContent = 'Edit Subcategory'; catModalInput.value = cats[type][catName][subIdx]; catModalInput.placeholder = 'Subcategory name'; }
  catModal.classList.remove('hidden');
  setTimeout(() => catModalInput.focus(), 50);
}

function closeCatModal() { catModal.classList.add('hidden'); }

document.getElementById('cat-modal-cancel').addEventListener('click', closeCatModal);
catModal.querySelector('.modal-overlay').addEventListener('click', closeCatModal);
document.getElementById('cat-modal-save').addEventListener('click', saveCatModal);
catModalInput.addEventListener('keydown', e => { if (e.key === 'Enter') saveCatModal(); });

function saveCatModal() {
  const name = catModalInput.value.trim(); if (!name) return;
  const cats = loadCategories();
  const { mode, type, catName, subIdx } = catModalState;
  const prevSubName = mode === 'edit-sub' && cats[type][catName] ? cats[type][catName][subIdx] : null;
  if (mode === 'add-cat') { if (cats[type][name]) { alert('Already exists.'); return; } cats[type][name] = []; }
  else if (mode === 'edit-cat') {
    if (name !== catName) { if (cats[type][name]) { alert('Already exists.'); return; } const o = {}; for (const [k, v] of Object.entries(cats[type])) o[k === catName ? name : k] = v; cats[type] = o; }
  } else if (mode === 'add-sub') { if (!cats[type][catName]) return; if (cats[type][catName].includes(name)) { alert('Already exists.'); return; } cats[type][catName].push(name); }
  else if (mode === 'edit-sub') { if (!cats[type][catName]) return; if (cats[type][catName].includes(name) && cats[type][catName][subIdx] !== name) { alert('Already exists.'); return; } cats[type][catName][subIdx] = name; }
  saveCategories(cats);
  if (mode === 'edit-cat' && name !== catName) renameCategoryTransactions(type, catName, name);
  if (mode === 'edit-sub' && name !== prevSubName) renameSubcategoryTransactions(type, catName, prevSubName, name);
  closeCatModal();
  renderCategories();
  render();
}

// ============================================================
// KEYBOARD
// ============================================================

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (!txnModal.classList.contains('hidden')) closeModal();
    if (!deleteModal.classList.contains('hidden')) closeDeleteModal();
    if (!catModal.classList.contains('hidden')) closeCatModal();
    if (!expenseDetailModal.classList.contains('hidden')) closeExpenseDetailModal();
    if (!manageCatsModal.classList.contains('hidden')) closeManageCatsModal();
  }
});

// ============================================================
// INIT
// ============================================================

let _appStarted = false;

async function startApp() {
  if (_appStarted) return;
  _appStarted = true;
  // Snapshot BEFORE initFromSupabase — init overwrites localStorage with
  // server-preferred data, which would erase the record of offline changes.
  const snapshot = {
    transactions: localStorage.getItem('ft_transactions'),
    categories: localStorage.getItem('ft_categories'),
  };
  populateCategories();
  await initFromSupabase();
  await resyncOfflineData(snapshot);
  // Reconcile AFTER resync: its bgWrite updates need real server ids to exist.
  reconcileTransactionsWithCategories();
  render();
}

(async () => {
  document.getElementById('gate-send').addEventListener('click', gateSendCode);
  document.getElementById('gate-verify').addEventListener('click', gateVerifyCode);
  document.getElementById('gate-email').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); gateSendCode(); } });
  document.getElementById('gate-code').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); gateVerifyCode(); } });

  // Fires on OTP verify and sign-out. startApp is deferred via setTimeout so it
  // runs outside the auth callback stack (supabase-js may hold an internal
  // lock during the callback — lesson from the Lazy Macros auth gate).
  sb.auth.onAuthStateChange((_event, session) => {
    if (session) { showGate(false); setTimeout(() => startApp().catch(console.error), 0); }
  });

  const { data } = await sb.auth.getSession();
  if (data && data.session) { showGate(false); startApp().catch(console.error); }
  else showGate(true);
})();
