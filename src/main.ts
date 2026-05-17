import { evaluateAlertStatus } from './AlertEvaluator';
import { getStocks, addStocks, updateStock, removeStock, fetchQuotes, StockConfig } from './ApiClient';
import type { QuoteData } from '../server/ProxyService';

// ── State ────────────────────────────────────────────────────────────────────
let allStocks: StockConfig[] = [];

// Cache keyed by stock.ticker (exact match). Stores quote + previous price for S2 momentum.
type CachedQuote = QuoteData & { prevPrice?: number };
let quoteCache = new Map<string, CachedQuote>();

let currentPage = 1;
let gridRows    = parseInt(localStorage.getItem('twstock-rows') ?? '5', 10) as 4 | 5 | 6;

function cardsPerPage() { return 6 * gridRows; }

let thresholdPercent = 0.0005; // 0.05% — price target proximity sensitivity
const VOLUME_THRESHOLD = 5.0;  // S1: 5% turnover rate = notable volume
const MOMENTUM_MIN_PCT = 0.05; // S2: show velocity indicator when ≥ 0.05% move per refresh

type SortMode = 'none' | 'change-desc' | 'change-asc' | 'volume-desc';
let sortMode: SortMode = 'none';
let refreshTimer: number;

// ── Custom order (drag-and-drop) ──────────────────────────────────────────────
let dragSrcTicker: string | null = null;

function loadCustomOrder(): string[] {
  try { return JSON.parse(localStorage.getItem('twstock-order') ?? '[]'); } catch { return []; }
}
function saveCustomOrder(tickers: string[]) {
  localStorage.setItem('twstock-order', JSON.stringify(tickers));
}
function applyCustomOrder(stocks: StockConfig[]): StockConfig[] {
  const saved = loadCustomOrder();
  if (saved.length === 0) return stocks;
  const map     = new Map(stocks.map(s => [s.ticker, s]));
  const ordered = saved.filter(t => map.has(t)).map(t => map.get(t)!);
  const rest    = stocks.filter(s => !saved.includes(s.ticker));
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

function updateMarketStatus() {
  const status = getMarketStatus();
  const dot    = document.getElementById('market-dot')!;
  const label  = document.getElementById('market-label')!;
  dot.className  = `market-dot ${status}`;
  label.textContent = status === 'open' ? '盤中' : '休市';

  clearInterval(refreshTimer);
  const interval = status === 'open' ? 15000 : 300000;
  refreshTimer   = window.setInterval(doRefresh, interval);
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
      <span class="symbol">${tickerShort}</span>
      <button class="remove-btn" title="移除">✕</button>
    </div>
    <div class="name" title="">讀取中...</div>
    <div class="price-row">
      <span class="price">--</span>
      <span class="change">--</span>
    </div>
    <div class="volume">--</div>
    <div class="targets">
      <label>買<input type="number" class="buy-input"  value="${stock.buyTarget  ?? ''}" placeholder="--" step="0.5"></label>
      <label>賣<input type="number" class="sell-input" value="${stock.sellTarget ?? ''}" placeholder="--" step="0.5"></label>
    </div>`;

  card.querySelector('.buy-input')!.addEventListener('change', (e: any) => {
    const v = parseFloat(e.target.value);
    updateStock(stock.ticker, { buyTarget: isNaN(v) ? null : v });
    stock.buyTarget = isNaN(v) ? null : v;
  });
  card.querySelector('.sell-input')!.addEventListener('change', (e: any) => {
    const v = parseFloat(e.target.value);
    updateStock(stock.ticker, { sellTarget: isNaN(v) ? null : v });
    stock.sellTarget = isNaN(v) ? null : v;
  });
  card.querySelector('.remove-btn')!.addEventListener('click', async () => {
    await removeStock(stock.ticker);
    allStocks = allStocks.filter(s => s.ticker !== stock.ticker);
    quoteCache.delete(stock.ticker);
    renderGrid();
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
    q.price, stock.buyTarget, stock.sellTarget, thresholdPercent,
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

  try {
    const quotes = await fetchQuotes(pageStocks.map(s => s.ticker));
    quotes.forEach((q: QuoteData) => {
      // Preserve prevPrice for S2 momentum before overwriting cache
      const prev = quoteCache.get(q.symbol);
      quoteCache.set(q.symbol, { ...q, prevPrice: prev?.price });
    });
    pageStocks.forEach(stock => {
      const card = document.getElementById(`card-${stock.ticker}`);
      const q    = quoteCache.get(stock.ticker);
      if (card && q) applyQuoteToCard(card, stock, q);
    });
  } catch (e) {
    console.error('Failed to fetch prices', e);
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
    setTimeout(() => input.classList.remove('not-found'), 1500);
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
    setTimeout(() => card.classList.remove('card-highlight'), 1600);
  }
}

// ── Batch import modal ────────────────────────────────────────────────────────
function openBatchModal()  { (document.getElementById('batch-modal') as HTMLElement).style.display = 'flex'; (document.getElementById('batch-input') as HTMLTextAreaElement).value = ''; }
function closeBatchModal() { (document.getElementById('batch-modal') as HTMLElement).style.display = 'none'; }

async function submitBatch() {
  const raw     = (document.getElementById('batch-input') as HTMLTextAreaElement).value;
  const tickers = raw.split(/[\s,，\n]+/).map(t => t.trim().toUpperCase()).filter(Boolean);
  if (tickers.length === 0) return closeBatchModal();
  await addStocks(tickers);
  allStocks = await getStocks();
  closeBatchModal();
  renderGrid();
  doRefresh();
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
  };
  addBtn.addEventListener('click', doAdd);
  tickerInput.addEventListener('keydown', (e: KeyboardEvent) => { if (e.key === 'Enter') doAdd(); });

  document.getElementById('batch-btn')!.addEventListener('click', openBatchModal);
  document.getElementById('batch-cancel')!.addEventListener('click', closeBatchModal);
  document.getElementById('batch-submit')!.addEventListener('click', submitBatch);
  document.getElementById('refresh-btn')!.addEventListener('click', doRefresh);

  const slider = document.getElementById('sensitivity-slider') as HTMLInputElement;
  slider.addEventListener('input', (e: any) => {
    const v = parseFloat(e.target.value);
    (document.getElementById('sensitivity-val') as HTMLElement).textContent = `${v}%`;
    thresholdPercent = v / 100;
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
  setInterval(updateMarketStatus, 60000);
  doRefresh();
  await setupEvents();
}

init();
