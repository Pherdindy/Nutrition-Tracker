// ============================================================
// DATA LAYER — Supabase with in-memory cache
// ============================================================

const SUPABASE_URL = 'https://wcbpvvyhswaricoadqbb.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_I_XmlCcMCBDOkbU8PWN42A_SID54xxi';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const _cache = { transactions: null, categories: null, stockTrades: null, ready: false };

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

// ---- Stock Trade functions ----

function loadStockTrades() {
  if (_cache.ready && _cache.stockTrades) return [..._cache.stockTrades];
  const saved = localStorage.getItem('ft_stock_trades');
  return saved ? JSON.parse(saved) : [];
}

function saveStockTrade(trade) {
  const list = loadStockTrades();
  list.push(trade);
  _cache.stockTrades = list;
  localStorage.setItem('ft_stock_trades', JSON.stringify(list));
  const tempId = trade.id;
  bgWrite(async () => {
    const { id, created_at, ...row } = trade;
    const { data, error } = await sb.from('stock_trades').insert(row).select();
    if (error) throw error;
    if (data && data[0]) {
      _cache.stockTrades = _cache.stockTrades.map(t => t.id === tempId ? data[0] : t);
      localStorage.setItem('ft_stock_trades', JSON.stringify(_cache.stockTrades));
    }
  });
}

function updateStockTrade(trade) {
  const list = loadStockTrades();
  const idx = list.findIndex(t => t.id === trade.id);
  if (idx === -1) return;
  list[idx] = { ...trade };
  _cache.stockTrades = list;
  localStorage.setItem('ft_stock_trades', JSON.stringify(list));
  bgWrite(async () => {
    const { created_at, ...row } = trade;
    const { error } = await sb.from('stock_trades').update(row).eq('id', trade.id);
    if (error) throw error;
  });
}

function deleteStockTrade(id) {
  _cache.stockTrades = loadStockTrades().filter(t => t.id !== id);
  localStorage.setItem('ft_stock_trades', JSON.stringify(_cache.stockTrades));
  bgWrite(async () => {
    const { error } = await sb.from('stock_trades').delete().eq('id', id);
    if (error) throw error;
  });
}

async function refreshStockTrades() {
  const { data, error } = await sb.from('stock_trades').select('*').order('date_bought', { ascending: false });
  if (!error && data) {
    const local = JSON.parse(localStorage.getItem('ft_stock_trades') || '[]');
    const merged = mergeById(data, local);
    _cache.stockTrades = merged;
    localStorage.setItem('ft_stock_trades', JSON.stringify(merged));
  }
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

  // Stock trades
  try {
    const { data, error } = await sb.from('stock_trades').select('*').order('date_bought', { ascending: false });
    const local = JSON.parse(localStorage.getItem('ft_stock_trades') || '[]');
    if (!error && data) {
      _cache.stockTrades = mergeById(data, local);
    } else {
      _cache.stockTrades = local;
    }
  } catch (e) {
    _cache.stockTrades = JSON.parse(localStorage.getItem('ft_stock_trades') || '[]');
  }
  localStorage.setItem('ft_stock_trades', JSON.stringify(_cache.stockTrades));

  _cache.ready = true;
  console.log(`[Supabase] Loaded ${_cache.transactions.length} txns, ${_cache.stockTrades.length} trades`);
}

function initFromLocalStorage() {
  _cache.transactions = JSON.parse(localStorage.getItem('ft_transactions') || '[]');
  _cache.categories = loadCategories();
  _cache.stockTrades = JSON.parse(localStorage.getItem('ft_stock_trades') || '[]');
  _cache.ready = true;
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

function fmtPct(val) {
  return (val >= 0 ? '+' : '') + val.toFixed(2) + '%';
}

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
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
let deleteTarget = 'transaction'; // 'transaction' or 'trade'
let catModalState = { mode: null, type: null, catName: null, subIdx: null };
let editingTradeId = null;

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

// ---- Month filter ----

const txnMonthFilter = document.getElementById('txn-month-filter');
const summaryMonthFilter = document.getElementById('summary-month-filter');
txnMonthFilter.value = currentMonth();
summaryMonthFilter.value = currentMonth();
txnMonthFilter.addEventListener('change', render);
summaryMonthFilter.addEventListener('change', render);

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
          <button class="btn-icon delete" onclick="openDeleteModal(${t.id},'transaction')">Del</button>
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
  const month = summaryMonthFilter.value;
  const txns = getFilteredTransactions(month);
  let totalIncome = 0, totalExpense = 0;
  const expenseByCat = {}, incomeByCat = {};
  txns.forEach(t => {
    const a = Number(t.amount), label = t.subcategory ? `${t.category} > ${t.subcategory}` : t.category;
    if (t.type === 'income') { totalIncome += a; incomeByCat[label] = (incomeByCat[label] || 0) + a; }
    else { totalExpense += a; expenseByCat[label] = (expenseByCat[label] || 0) + a; }
  });
  const net = totalIncome - totalExpense;

  document.getElementById('summary-cards').innerHTML = `
    <div class="summary-card"><div class="card-label">Total Income</div><div class="card-value positive">${fmt(totalIncome)}</div></div>
    <div class="summary-card"><div class="card-label">Total Expenses</div><div class="card-value negative">${fmt(totalExpense)}</div></div>
    <div class="summary-card"><div class="card-label">Net</div><div class="card-value ${net >= 0 ? 'positive' : 'negative'}">${net >= 0 ? '+' : ''}${fmt(net)}</div></div>`;

  const eRows = Object.entries(expenseByCat).sort((a, b) => b[1] - a[1]).map(([c, a]) => {
    const p = totalExpense > 0 ? (a / totalExpense * 100) : 0;
    return `<tr><td>${escapeHtml(c)}</td><td class="num">${fmt(a)}</td><td><div class="pct-bar-cell"><div class="pct-bar"><div class="pct-bar-fill" style="width:${p}%"></div></div><span class="pct-text">${p.toFixed(1)}%</span></div></td></tr>`;
  }).join('');
  document.querySelector('#expense-breakdown tbody').innerHTML = eRows || `<tr><td colspan="3"><div class="empty-state">No expenses</div></td></tr>`;

  const iRows = Object.entries(incomeByCat).sort((a, b) => b[1] - a[1]).map(([c, a]) => `<tr><td>${escapeHtml(c)}</td><td class="num">${fmt(a)}</td></tr>`).join('');
  document.querySelector('#income-breakdown tbody').innerHTML = iRows || `<tr><td colspan="2"><div class="empty-state">No income</div></td></tr>`;
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
  else if (action === 'delete-cat') { if (confirm(`Delete "${cat}" and all subcategories?`)) { const c = loadCategories(); delete c[type][cat]; saveCategories(c); render(); } }
  else if (action === 'add-sub') openCatModal('add-sub', type, cat);
  else if (action === 'edit-sub') openCatModal('edit-sub', type, cat, idx);
  else if (action === 'delete-sub') { const c = loadCategories(); if (c[type][cat]) { c[type][cat].splice(idx, 1); saveCategories(c); render(); } }
});

// ============================================================
// RENDER — Stock Journal Tab
// ============================================================

function renderStocks() {
  const trades = loadStockTrades();
  const open = trades.filter(t => !t.date_sold);
  const closed = trades.filter(t => t.date_sold);

  // Summary
  let totalInvested = 0, totalRealizedPL = 0, totalFees = 0, wins = 0;
  open.forEach(t => { totalInvested += Number(t.price_bought) * Number(t.shares_bought); totalFees += Number(t.buy_fees || 0); });
  closed.forEach(t => {
    const buyAmt = Number(t.price_bought) * Number(t.shares_bought);
    const sellAmt = Number(t.price_sold) * Number(t.shares_sold || t.shares_bought);
    const fees = Number(t.buy_fees || 0) + Number(t.sell_fees || 0);
    const net = sellAmt - buyAmt - fees;
    totalRealizedPL += net;
    totalFees += fees;
    if (net > 0) wins++;
  });
  const winRate = closed.length > 0 ? (wins / closed.length * 100) : 0;

  document.getElementById('stock-summary-cards').innerHTML = `
    <div class="summary-card"><div class="card-label">Open Invested</div><div class="card-value">${fmt(totalInvested)}</div></div>
    <div class="summary-card"><div class="card-label">Realized P&L</div><div class="card-value ${totalRealizedPL >= 0 ? 'positive' : 'negative'}">${totalRealizedPL >= 0 ? '+' : ''}${fmt(totalRealizedPL)}</div></div>
    <div class="summary-card"><div class="card-label">Win Rate</div><div class="card-value">${winRate.toFixed(0)}% <span style="font-size:0.8rem;color:var(--text-dim)">(${wins}/${closed.length})</span></div></div>`;

  // Open positions
  const openTbody = document.getElementById('open-positions-tbody');
  if (!open.length) {
    openTbody.innerHTML = `<tr><td colspan="7"><div class="empty-state">No open positions</div></td></tr>`;
  } else {
    openTbody.innerHTML = open.map(t => {
      const buyAmt = Number(t.price_bought) * Number(t.shares_bought);
      return `<tr>
        <td class="stock-code">${escapeHtml(t.stock_code)}</td>
        <td>${formatDateShort(t.date_bought)}</td>
        <td class="num">${fmt(t.price_bought)}</td>
        <td class="num">${Number(t.shares_bought).toLocaleString()}</td>
        <td class="num">${fmt(buyAmt)}</td>
        <td class="num">${fmt(t.buy_fees || 0)}</td>
        <td><div class="actions">
          <button class="btn-icon" onclick="openEditTradeModal(${t.id})">Edit</button>
          <button class="btn-icon delete" onclick="openDeleteModal(${t.id},'trade')">Del</button>
        </div></td></tr>`;
    }).join('');
  }

  // Trade history
  const histTbody = document.getElementById('trade-history-tbody');
  if (!closed.length) {
    histTbody.innerHTML = `<tr><td colspan="9"><div class="empty-state">No completed trades</div></td></tr>`;
  } else {
    histTbody.innerHTML = closed.sort((a, b) => b.date_sold.localeCompare(a.date_sold)).map(t => {
      const buyAmt = Number(t.price_bought) * Number(t.shares_bought);
      const shares = Number(t.shares_sold || t.shares_bought);
      const sellAmt = Number(t.price_sold) * shares;
      const gross = sellAmt - buyAmt;
      const fees = Number(t.buy_fees || 0) + Number(t.sell_fees || 0);
      const net = gross - fees;
      const pct = buyAmt > 0 ? (net / buyAmt * 100) : 0;
      return `<tr>
        <td class="stock-code">${escapeHtml(t.stock_code)}</td>
        <td class="trade-compact"><div class="trade-date">${formatDateShort(t.date_bought)}</div><div class="trade-price">@ ${fmt(t.price_bought)}</div></td>
        <td class="trade-compact"><div class="trade-date">${formatDateShort(t.date_sold)}</div><div class="trade-price">@ ${fmt(t.price_sold)}</div></td>
        <td class="num">${shares.toLocaleString()}</td>
        <td class="num ${gross >= 0 ? 'positive' : 'negative'}">${gross >= 0 ? '+' : ''}${fmt(gross)}</td>
        <td class="num">${fmt(fees)}</td>
        <td class="num ${net >= 0 ? 'positive' : 'negative'}">${net >= 0 ? '+' : ''}${fmt(net)}</td>
        <td class="num ${pct >= 0 ? 'positive' : 'negative'}">${fmtPct(pct)}</td>
        <td><div class="actions">
          <button class="btn-icon" onclick="openEditTradeModal(${t.id})">Edit</button>
          <button class="btn-icon delete" onclick="openDeleteModal(${t.id},'trade')">Del</button>
        </div></td></tr>`;
    }).join('');
  }
}

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
  renderStocks();
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
// DELETE MODAL (shared for transactions & trades)
// ============================================================

const deleteModal = document.getElementById('delete-modal');

function openDeleteModal(id, target) {
  deletingId = id;
  deleteTarget = target;
  document.getElementById('delete-modal-title').textContent = target === 'trade' ? 'Delete Trade' : 'Delete Transaction';
  document.getElementById('delete-modal-msg').textContent = `Are you sure you want to delete this ${target}?`;
  deleteModal.classList.remove('hidden');
}

function closeDeleteModal() { deleteModal.classList.add('hidden'); deletingId = null; }

document.getElementById('delete-cancel').addEventListener('click', closeDeleteModal);
deleteModal.querySelector('.modal-overlay').addEventListener('click', closeDeleteModal);

document.getElementById('delete-confirm').addEventListener('click', () => {
  if (deletingId !== null) {
    if (deleteTarget === 'trade') deleteStockTrade(deletingId);
    else deleteTransaction(deletingId);
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
  if (mode === 'add-cat') { if (cats[type][name]) { alert('Already exists.'); return; } cats[type][name] = []; }
  else if (mode === 'edit-cat') {
    if (name !== catName) { if (cats[type][name]) { alert('Already exists.'); return; } const o = {}; for (const [k, v] of Object.entries(cats[type])) o[k === catName ? name : k] = v; cats[type] = o; }
  } else if (mode === 'add-sub') { if (!cats[type][catName]) return; if (cats[type][catName].includes(name)) { alert('Already exists.'); return; } cats[type][catName].push(name); }
  else if (mode === 'edit-sub') { if (!cats[type][catName]) return; if (cats[type][catName].includes(name) && cats[type][catName][subIdx] !== name) { alert('Already exists.'); return; } cats[type][catName][subIdx] = name; }
  saveCategories(cats); closeCatModal(); renderCategories(); render();
}

// ============================================================
// STOCK TRADE MODAL
// ============================================================

const tradeModal = document.getElementById('trade-modal');
const tradeFields = {
  stock: document.getElementById('trade-stock'),
  dateBought: document.getElementById('trade-date-bought'),
  priceBought: document.getElementById('trade-price-bought'),
  sharesBought: document.getElementById('trade-shares-bought'),
  buyFees: document.getElementById('trade-buy-fees'),
  dateSold: document.getElementById('trade-date-sold'),
  priceSold: document.getElementById('trade-price-sold'),
  sharesSold: document.getElementById('trade-shares-sold'),
  sellFees: document.getElementById('trade-sell-fees'),
  notes: document.getElementById('trade-notes'),
};

function openAddTradeModal() {
  editingTradeId = null;
  document.getElementById('trade-modal-title').textContent = 'Add Trade';
  tradeFields.stock.value = '';
  tradeFields.dateBought.value = new Date().toISOString().slice(0, 10);
  tradeFields.priceBought.value = ''; tradeFields.sharesBought.value = ''; tradeFields.buyFees.value = '';
  tradeFields.dateSold.value = ''; tradeFields.priceSold.value = ''; tradeFields.sharesSold.value = '';
  tradeFields.sellFees.value = ''; tradeFields.notes.value = '';
  tradeModal.classList.remove('hidden');
}

function openEditTradeModal(id) {
  const trade = loadStockTrades().find(t => t.id === id); if (!trade) return;
  editingTradeId = id;
  document.getElementById('trade-modal-title').textContent = 'Edit Trade';
  tradeFields.stock.value = trade.stock_code;
  tradeFields.dateBought.value = trade.date_bought;
  tradeFields.priceBought.value = trade.price_bought;
  tradeFields.sharesBought.value = trade.shares_bought;
  tradeFields.buyFees.value = trade.buy_fees || '';
  tradeFields.dateSold.value = trade.date_sold || '';
  tradeFields.priceSold.value = trade.price_sold || '';
  tradeFields.sharesSold.value = trade.shares_sold || '';
  tradeFields.sellFees.value = trade.sell_fees || '';
  tradeFields.notes.value = trade.notes || '';
  tradeModal.classList.remove('hidden');
}

function closeTradeModal() { tradeModal.classList.add('hidden'); editingTradeId = null; }

document.getElementById('add-trade-btn').addEventListener('click', openAddTradeModal);
document.getElementById('trade-cancel').addEventListener('click', closeTradeModal);
tradeModal.querySelector('.modal-overlay').addEventListener('click', closeTradeModal);

document.getElementById('trade-save').addEventListener('click', () => {
  const stock_code = tradeFields.stock.value.trim().toUpperCase();
  const date_bought = tradeFields.dateBought.value;
  const price_bought = parseFloat(tradeFields.priceBought.value);
  const shares_bought = parseFloat(tradeFields.sharesBought.value);
  const buy_fees = parseFloat(tradeFields.buyFees.value) || 0;
  const date_sold = tradeFields.dateSold.value || null;
  const price_sold = tradeFields.priceSold.value ? parseFloat(tradeFields.priceSold.value) : null;
  const shares_sold = tradeFields.sharesSold.value ? parseFloat(tradeFields.sharesSold.value) : null;
  const sell_fees = parseFloat(tradeFields.sellFees.value) || 0;
  const notes = tradeFields.notes.value.trim() || null;

  if (!stock_code || !date_bought || isNaN(price_bought) || isNaN(shares_bought) || price_bought <= 0 || shares_bought <= 0) {
    alert('Please fill in stock code, date bought, price, and shares.'); return;
  }

  const trade = { stock_code, date_bought, price_bought, shares_bought, buy_fees, date_sold, price_sold, shares_sold, sell_fees, notes };

  if (editingTradeId !== null) { trade.id = editingTradeId; updateStockTrade(trade); }
  else { trade.id = Date.now(); saveStockTrade(trade); }

  closeTradeModal(); render();
});

// ============================================================
// KEYBOARD
// ============================================================

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (!txnModal.classList.contains('hidden')) closeModal();
    if (!deleteModal.classList.contains('hidden')) closeDeleteModal();
    if (!catModal.classList.contains('hidden')) closeCatModal();
    if (!tradeModal.classList.contains('hidden')) closeTradeModal();
    if (!manageCatsModal.classList.contains('hidden')) closeManageCatsModal();
  }
});

// ============================================================
// INIT
// ============================================================

(async () => {
  populateCategories();
  await initFromSupabase();
  render();
})();
