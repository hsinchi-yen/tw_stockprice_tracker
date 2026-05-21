import { evaluateAlertStatus } from './AlertEvaluator';
import { getStocks, addStocks, updateStock, removeStock, fetchQuotes, StockConfig, QuoteData } from './ApiClient';

// ── State ────────────────────────────────────────────────────────────────────
let allStocks: StockConfig[] = [];

// Cache keyed by stock.ticker (exact match). Stores quote + previous price for S2 momentum.
type CachedQuote = QuoteData & { prevPrice?: number };
let quoteCache = new Map<string, CachedQuote>();

let currentPage = 1;
let gridRows    = parseInt(localStorage.getItem('twstock-rows') ?? '5', 10) as 4 | 5 | 6;

function cardsPerPage() { return 6 * gridRows; }

// Restore persisted sensitivity; default 0.05%
const _savedSens = parseFloat(localStorage.getItem('twstock-sensitivity') ?? '0.05');
let nearingBandFraction = _savedSens / 100;

const VOLUME_THRESHOLD    = 5.0;  // S1: 5% turnover rate = notable volume
const MOMENTUM_MIN_PCT    = 0.05; // S2: show velocity indicator when ≥ 0.05% move per refresh
const REFRESH_OPEN_MS     = 15_000;   // poll interval during market hours
const REFRESH_CLOSED_MS   = 300_000;  // poll interval when market is closed
const FLASH_DURATION_MS   = 1_500;    // search not-found flash duration
const HIGHLIGHT_MS        = 1_600;    // card highlight after search jump

type SortMode = 'none' | 'change-desc' | 'change-asc' | 'volume-desc';
let sortMode: SortMode = 'none';
let refreshTimer: number;

// ── Custom order (drag-and-drop) ──────────────────────────────────────────────
let dragSrcTicker: string | null = null;
let _cachedOrder: string[] | null = null;

function loadCustomOrder(): string[] {
  if (_cachedOrder !== null) return _cachedOrder;
  try { _cachedOrder = JSON.parse(localStorage.getItem('twstock-order') ?? '[]'); }
  catch { _cachedOrder = []; }
  return _cachedOrder!;
}
function saveCustomOrder(tickers: string[]) {
  _cachedOrder = tickers;
  localStorage.setItem('twstock-order', JSON.stringify(tickers));
}
function applyCustomOrder(stocks: StockConfig[]): StockConfig[] {
  const saved = loadCustomOrder();
  if (saved.length === 0) return stocks;
  const map      = new Map(stocks.map(s => [s.ticker, s]));
  const savedSet = new Set(saved);                                   // O(1) lookup
  const ordered  = saved.filter(t => map.has(t)).map(t => map.get(t)!);
  const rest     = stocks.filter(s => !savedSet.has(s.ticker));     // was O(n²)
  return [...ordered, ...rest];
}

// ── Market Status ─────────────────────────────────────────────────────────────
function getMarketStatus(): 'open' | 'closed' {
  const now   = new Date();
  const utc   = now.getTime() + now.getTimezoneOffset() * 60000;
  const taipei = new Date(utc + 8 * 3600000);
  const day   = taipei.getDay();
  const mins  = taipei.getHours() * 60 + taipei.getMinutes();
  if (day === 0 || day === 6) return 'closed';
  return mins >= 9 * 60 && mins < 13 * 60 + 30 ? 'open' : 'closed';
}

let _lastKnownMarketStatus: 'open' | 'closed' | null = null;

function updateMarketStatus() {
  const status = getMarketStatus();
  const dot    = document.getElementById('market-dot')!;
  const label  = document.getElementById('market-label')!;
  dot.className  = `market-dot ${status}`;
  label.textContent = status === 'open' ? '盤中' : '休市';

  // Only reset the refresh timer when the market status actually changes,
  // to avoid restarting the interval every 10s even if nothing changed.
  if (status !== _lastKnownMarketStatus) {
    _lastKnownMarketStatus = status;
    clearInterval(refreshTimer);
    const interval = status === 'open' ? REFRESH_OPEN_MS : REFRESH_CLOSED_MS;
    refreshTimer   = window.setInterval(doRefresh, interval);
  }
}

// ── Sorting ───────────────────────────────────────────────────────────────────
function getSortedStocks(): StockConfig[] {
  if (sortMode === 'none') return applyCustomOrder([...allStocks]);
  return [...allStocks].sort((a, b) => {
    const qa = quoteCache.get(a.ticker);
    const qb = quoteCache.get(b.ticker);
    const va = qa ? (sortMode === 'volume-desc' ? (qa.volumeRatio ?? 0) : qa.changePercent) : -999;
    const vb = qb ? (sortMode === 'volume-desc' ? (qb.volumeRatio ?? 0) : qb.changePercent) : -999;
    return sortMode === 'change-asc' ? va - vb : vb - va;
  });
}

function setSortMode(mode: SortMode) {
  sortMode = mode;
  document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`sort-${mode}`)?.classList.add('active');
  renderGrid();
}

// ── Toast notifications ───────────────────────────────────────────────────────
function showToast(msg: string, type: 'info' | 'error' = 'info') {
  const container = document.getElementById('toast-container')!;
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  container.appendChild(el);
  // Trigger transition on next frame
  requestAnimationFrame(() => el.classList.add('toast-visible'));
  setTimeout(() => {
    el.classList.remove('toast-visible');
    el.addEventListener('transitionend', () => el.remove(), { once: true });
  }, 3500);
}

// ── Grid & Cards ──────────────────────────────────────────────────────────────
function renderGrid() {
  const grid = document.getElementById('grid-container')!;
  grid.className = `grid rows-${gridRows}`;
  grid.innerHTML = '';
  const sorted     = getSortedStocks();
  const totalPages = Math.max(1, Math.ceil(sorted.length / cardsPerPage()));
  if (currentPage > totalPages) currentPage = totalPages;

  (document.getElementById('current-page') as HTMLElement).textContent = String(currentPage);
  (document.getElementById('total-pages')  as HTMLElement).textContent = String(totalPages);
  (document.getElementById('stock-count')  as HTMLElement).textContent = String(allStocks.length);

  const pageSlice = sorted.slice((currentPage - 1) * cardsPerPage(), currentPage * cardsPerPage());
  pageSlice.forEach(stock => grid.appendChild(buildCard(stock)));
}

function setGridRows(rows: 4 | 5 | 6) {
  gridRows = rows;
  localStorage.setItem('twstock-rows', String(rows));
  const grid = document.getElementById('grid-container')!;
  grid.className = `grid rows-${rows}`;
  document.querySelectorAll('.rows-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`rows-${rows}`)?.classList.add('active');
  currentPage = 1;
  renderGrid();
}

function buildCard(stock: StockConfig): HTMLElement {
  const card      = document.createElement('div');
  card.className  = 'card';
  card.id         = `card-${stock.ticker}`;
  card.setAttribute('draggable', 'true');
  const tickerShort = stock.ticker.replace(/\.(TW|TWO)$/i, '');

  card.innerHTML = `
    <div class="card-header">
      <span class="symbol"></span>
      <button class="remove-btn" title="移除">✕</button>
    </div>
    <div class="name" title="">讀取中...</div>
    <div class="price-row">
      <span class="price">--</span>
      <span class="change">--</span>
    </div>
    <div class="volume">--</div>
    <div class="targets">
      <label>買<input type="number" class="buy-input"  placeholder="--" step="0.5"></label>
      <label>賣<input type="number" class="sell-input" placeholder="--" step="0.5"></label>
    </div>`;
  (card.querySelector('.symbol') as HTMLElement).textContent = tickerShort;
  const buyInput  = card.querySelector('.buy-input')  as HTMLInputElement;
  const sellInput = card.querySelector('.sell-input') as HTMLInputElement;
  if (stock.buyTarget  != null) buyInput.value  = String(stock.buyTarget);
  if (stock.sellTarget != null) sellInput.value = String(stock.sellTarget);

  buyInput.addEventListener('change', (e: Event) => {
    const v = parseFloat((e.target as HTMLInputElement).value);
    updateStock(stock.ticker, { buyTarget: isNaN(v) ? null : v });
    stock.buyTarget = isNaN(v) ? null : v;
  });
  sellInput.addEventListener('change', (e: Event) => {
    const v = parseFloat((e.target as HTMLInputElement).value);
    updateStock(stock.ticker, { sellTarget: isNaN(v) ? null : v });
    stock.sellTarget = isNaN(v) ? null : v;
  });
  card.querySelector('.remove-btn')!.addEventListener('click', async () => {
    if (!confirm(`確認移除 ${tickerShort}？目標價設定將一併刪除。`)) return;
    await removeStock(stock.ticker);
    allStocks = allStocks.filter(s => s.ticker !== stock.ticker);
    quoteCache.delete(stock.ticker);
    renderGrid();
    showToast(`已移除 ${tickerShort}`);
  });

  // Drag-and-drop reorder
  card.addEventListener('dragstart', (e) => {
    dragSrcTicker = stock.ticker;
    card.classList.add('dragging');
    e.dataTransfer!.effectAllowed = 'move';
  });
  card.addEventListener('dragend', () => {
    card.classList.remove('dragging');
    dragSrcTicker = null;
    document.querySelectorAll('.card').forEach(c => c.classList.remove('drag-over'));
  });
  card.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'move';
    if (dragSrcTicker && dragSrcTicker !== stock.ticker) card.classList.add('drag-over');
  });
  card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
  card.addEventListener('drop', (e) => {
    e.preventDefault();
    card.classList.remove('drag-over');
    if (!dragSrcTicker || dragSrcTicker === stock.ticker) return;
    // Reorder within the full allStocks list
    const ordered = applyCustomOrder([...allStocks]);
    const srcIdx  = ordered.findIndex(s => s.ticker === dragSrcTicker);
    const dstIdx  = ordered.findIndex(s => s.ticker === stock.ticker);
    if (srcIdx === -1 || dstIdx === -1) return;
    ordered.splice(dstIdx, 0, ordered.splice(srcIdx, 1)[0]);
    // Sync allStocks to the new order
    const newOrder = ordered.map(s => s.ticker);
    allStocks = newOrder.map(t => allStocks.find(s => s.ticker === t)!);
    saveCustomOrder(newOrder);
    if (sortMode !== 'none') { sortMode = 'none'; document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active')); document.getElementById('sort-none')?.classList.add('active'); }
    renderGrid();
  });

  const q = quoteCache.get(stock.ticker);
  if (q) applyQuoteToCard(card, stock, q);
  return card;
}

function applyQuoteToCard(card: HTMLElement, stock: StockConfig, q: CachedQuote) {
  const status = evaluateAlertStatus(
    q.price, stock.buyTarget, stock.sellTarget, nearingBandFraction,
    q.volumeRatio, VOLUME_THRESHOLD,
  );
  card.className = 'card' + (status !== 'normal' ? ` status-${status}` : '');

  (card.querySelector('.name')  as HTMLElement).textContent = q.name;
  (card.querySelector('.name')  as HTMLElement).title       = q.name;
  (card.querySelector('.price') as HTMLElement).textContent = q.price.toLocaleString();

  const changeEl  = card.querySelector('.change') as HTMLElement;
  const sign      = q.changePercent > 0 ? '+' : '';
  changeEl.textContent = `${sign}${q.changePercent.toFixed(2)}%`;
  const dir = q.changePercent > 0 ? 'up' : q.changePercent < 0 ? 'down' : 'flat';
  changeEl.className   = `change ${dir}`;

  // Volume display + S2 momentum arrow when price moved ≥ MOMENTUM_MIN_PCT since last refresh
  const totalStr  = q.totalSharesK != null ? `/${q.totalSharesK.toLocaleString()}` : '';
  const ratioStr  = q.volumeRatio  != null ? ` <span class="turnover-rate">(週轉率 ${q.volumeRatio.toFixed(2)}%)</span>` : '';
  let momentumStr = '';
  if (q.prevPrice != null && q.prevPrice > 0) {
    const vel = ((q.price - q.prevPrice) / q.prevPrice) * 100;
    if (Math.abs(vel) >= MOMENTUM_MIN_PCT) {
      momentumStr = vel > 0
        ? ` <span class="momentum up">▲${vel.toFixed(2)}%</span>`
        : ` <span class="momentum down">▼${Math.abs(vel).toFixed(2)}%</span>`;
    }
  }
  (card.querySelector('.volume') as HTMLElement).innerHTML =
    `${q.volume.toLocaleString()}${totalStr}張${ratioStr}${momentumStr}`;
}

// ── Fetch prices ──────────────────────────────────────────────────────────────
async function doRefresh() {
  const sorted     = getSortedStocks();
  const start      = (currentPage - 1) * cardsPerPage();
  const pageStocks = sorted.slice(start, start + cardsPerPage());
  if (pageStocks.length === 0) return;

  const refreshBtn = document.getElementById('refresh-btn');
  refreshBtn?.classList.add('loading');

  try {
    const quotes = await fetchQuotes(pageStocks.map(s => s.ticker));
    quotes.forEach((q: QuoteData) => {
      const prev = quoteCache.get(q.symbol);
      quoteCache.set(q.symbol, { ...q, prevPrice: prev?.price });
    });
    pageStocks.forEach(stock => {
      const card = document.getElementById(`card-${stock.ticker}`);
      const q    = quoteCache.get(stock.ticker);
      if (card && q) applyQuoteToCard(card, stock, q);
    });

    // Update last-refreshed timestamp
    const now = new Date();
    const hh  = String(now.getHours()).padStart(2, '0');
    const mm  = String(now.getMinutes()).padStart(2, '0');
    const ss  = String(now.getSeconds()).padStart(2, '0');
    const el  = document.getElementById('last-updated');
    if (el) el.textContent = `更新 ${hh}:${mm}:${ss}`;

    // Clear any prior error banner
    const banner = document.getElementById('error-banner');
    if (banner) banner.style.display = 'none';
  } catch (e) {
    console.error('Failed to fetch prices', e);
    const banner = document.getElementById('error-banner');
    if (banner) banner.style.display = 'flex';
  } finally {
    refreshBtn?.classList.remove('loading');
  }
}

// ── Search ────────────────────────────────────────────────────────────────────
function searchStock() {
  const input = document.getElementById('search-input') as HTMLInputElement;
  const raw   = input.value.trim().toUpperCase();
  if (!raw) return;

  const normalize = (t: string) => t.replace(/\.(TW|TWO)$/i, '');
  const query  = normalize(raw);
  const sorted = getSortedStocks();
  const idx    = sorted.findIndex(s => normalize(s.ticker) === query);

  if (idx === -1) {
    input.classList.add('not-found');
    setTimeout(() => input.classList.remove('not-found'), FLASH_DURATION_MS);
    return;
  }

  const targetPage = Math.ceil((idx + 1) / cardsPerPage());
  if (currentPage !== targetPage) {
    currentPage = targetPage;
    renderGrid();
    doRefresh();
  }

  const card = document.getElementById(`card-${sorted[idx].ticker}`);
  if (card) {
    card.classList.remove('card-highlight');
    void (card as HTMLElement).offsetWidth; // restart animation
    card.classList.add('card-highlight');
    setTimeout(() => card.classList.remove('card-highlight'), HIGHLIGHT_MS);
  }
}

// ── Batch import modal ────────────────────────────────────────────────────────
function openBatchModal()  { (document.getElementById('batch-modal') as HTMLElement).style.display = 'flex'; (document.getElementById('batch-input') as HTMLTextAreaElement).value = ''; }
function closeBatchModal() { (document.getElementById('batch-modal') as HTMLElement).style.display = 'none'; }

async function submitBatch() {
  const raw     = (document.getElementById('batch-input') as HTMLTextAreaElement).value;
  const tickers = raw.split(/[\s,，\n]+/).map(t => t.trim().toUpperCase()).filter(Boolean);
  if (tickers.length === 0) return closeBatchModal();
  const prevCount = allStocks.length;
  await addStocks(tickers);
  allStocks = await getStocks();
  const added = allStocks.length - prevCount;
  const dup   = tickers.length - added;
  closeBatchModal();
  renderGrid();
  doRefresh();
  const msg = added > 0
    ? `已新增 ${added} 檔${dup > 0 ? `，${dup} 檔已存在略過` : ''}`
    : `${dup} 檔已存在，無新增`;
  showToast(msg);
}

// ── Events ────────────────────────────────────────────────────────────────────
async function setupEvents() {
  const addBtn      = document.getElementById('add-btn')!;
  const tickerInput = document.getElementById('ticker-input') as HTMLInputElement;
  const doAdd = async () => {
    const raw = tickerInput.value.trim().toUpperCase();
    if (!raw) return;
    await addStocks([raw]);
    allStocks = await getStocks();
    tickerInput.value = '';
    renderGrid();
    doRefresh();
    showToast(`已新增 ${raw.replace(/\.(TW|TWO)$/i, '')}`);
  };
  addBtn.addEventListener('click', doAdd);
  tickerInput.addEventListener('keydown', (e: KeyboardEvent) => { if (e.key === 'Enter') doAdd(); });

  document.getElementById('batch-btn')!.addEventListener('click', openBatchModal);
  document.getElementById('batch-cancel')!.addEventListener('click', closeBatchModal);
  document.getElementById('batch-submit')!.addEventListener('click', submitBatch);
  document.getElementById('refresh-btn')!.addEventListener('click', doRefresh);

  const slider = document.getElementById('sensitivity-slider') as HTMLInputElement;
  // Restore persisted value into the slider UI on startup
  slider.value = String(_savedSens);
  (document.getElementById('sensitivity-val') as HTMLElement).textContent = `${_savedSens}%`;
  slider.addEventListener('input', (e: any) => {
    const v = parseFloat((e.target as HTMLInputElement).value);
    (document.getElementById('sensitivity-val') as HTMLElement).textContent = `${v}%`;
    nearingBandFraction = v / 100;
    localStorage.setItem('twstock-sensitivity', String(v));
  });

  (['none', 'change-desc', 'change-asc', 'volume-desc'] as SortMode[]).forEach(m => {
    document.getElementById(`sort-${m}`)?.addEventListener('click', () => setSortMode(m));
  });

  ([4, 5, 6] as const).forEach(r => {
    document.getElementById(`rows-${r}`)?.addEventListener('click', () => setGridRows(r));
  });
  document.getElementById(`rows-${gridRows}`)?.classList.add('active');

  const searchInput = document.getElementById('search-input') as HTMLInputElement;
  document.getElementById('search-btn')!.addEventListener('click', searchStock);
  searchInput.addEventListener('keydown', (e: KeyboardEvent) => { if (e.key === 'Enter') searchStock(); });

  document.getElementById('first-page')!.addEventListener('click', () => {
    if (currentPage !== 1) { currentPage = 1; renderGrid(); doRefresh(); }
  });
  document.getElementById('prev-page')!.addEventListener('click', () => {
    if (currentPage > 1) { currentPage--; renderGrid(); doRefresh(); }
  });
  document.getElementById('next-page')!.addEventListener('click', () => {
    const totalPages = Math.ceil(getSortedStocks().length / cardsPerPage());
    if (currentPage < totalPages) { currentPage++; renderGrid(); doRefresh(); }
  });
  document.getElementById('last-page')!.addEventListener('click', () => {
    const totalPages = Math.ceil(getSortedStocks().length / cardsPerPage());
    if (currentPage !== totalPages) { currentPage = totalPages; renderGrid(); doRefresh(); }
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  allStocks = await getStocks();
  renderGrid();
  updateMarketStatus();
  // Check every 10s so open/close transitions take effect within 10s rather than 60s.
  setInterval(updateMarketStatus, 10_000);
  doRefresh();
  await setupEvents();
}

init();
