import { esc } from './sanitize.js?v=20260214';
import { CONFIG } from './config.js?v=20260214';

// =====================================================================
// DASHBOARD TỔNG QUAN — module riêng, không tạo Web3Service thứ hai.
// main.js inject { web3, api, computeMetrics, isAdmin, account, rank }.
// Mọi chuỗi động qua esc(); click qua data-act (delegated, scoped #tab-dashboard).
// =====================================================================

const THROTTLE_MS = 30000;
const POOL = 6;
const CHART_DAYS = 30;
const FEED_TOP = 8;
const TS_CACHE_KEY = 'bdi_docts_ts_v1_' + CONFIG.CONTRACT_ADDRESS;

let _ctx = null;
let _lastRefresh = 0;
let _inflight = null;
let _listenerBound = false;

// Dữ liệu theo nguồn — tách bạch on-chain / MongoDB, không cộng trùng
let _metrics = null;       // computeMetrics() merged {docCount, issuerCount, latency}
let _added = [];           // DocumentAdded events
let _revoked = [];         // DocumentRevoked events
let _batches = [];         // MongoDB batches
let _partnerDocs = {};     // docId -> orgName
let _admin = { pending: null, sessions: null, keys: null };
let _errors = {};          // src -> true
let _blockTs = {};         // blockNumber -> unix ts (session)
let _docTs = null;         // docId -> unix ts (persist localStorage)

const $ = (id) => document.getElementById(id);
// Chẩn đoán hiển thị ngay trong tab — debug lỗi "trang trắng" không cần console
function dbg(msg) {
    window.__dashDebug = msg;
    const el = $('dash-debug');
    if (el) el.innerText = `[dash] ${msg}`;
}
const shortAddr = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '—');
const shortId = (s) => (s && s.length > 14 ? `${s.slice(0, 8)}…${s.slice(-4)}` : (s || '—'));

function loadTsCache() {
    if (_docTs) return _docTs;
    try { _docTs = JSON.parse(localStorage.getItem(TS_CACHE_KEY) || '{}') || {}; }
    catch { _docTs = {}; }
    return _docTs;
}
function saveTsCache() {
    try {
        const keys = Object.keys(_docTs);
        if (keys.length > 3000) { // giới hạn kích thước cache
            for (const k of keys.slice(0, keys.length - 3000)) delete _docTs[k];
        }
        localStorage.setItem(TS_CACHE_KEY, JSON.stringify(_docTs));
    } catch {}
}

// Pool concurrency 5-8 req/đợt — ở đây 6
async function pool(items, fn) {
    const out = new Array(items.length);
    for (let i = 0; i < items.length; i += POOL) {
        await Promise.all(items.slice(i, i + POOL).map((it, j) => fn(it).then(r => { out[i + j] = r; }).catch(() => { out[i + j] = null; })));
    }
    return out;
}

async function resolveBlockTs(blockNumbers) {
    const need = [...new Set(blockNumbers.filter(b => b != null && _blockTs[b] === undefined))];
    if (!need.length || !_ctx?.web3?.provider) return;
    await pool(need, async (b) => {
        try {
            const blk = await _ctx.web3.provider.getBlock(Number(b));
            _blockTs[b] = blk ? Number(blk.timestamp) : null;
        } catch { _blockTs[b] = null; }
    });
}

// Timestamp của event: ưu tiên block timestamp (getDocument[2] trả cùng giá trị
// vì doc được ghi trong block đó); fallback getDocument cho event lẻ
async function eventTs(ev) {
    const b = ev.blockNumber != null ? Number(ev.blockNumber) : null;
    if (b != null) {
        if (_blockTs[b] === undefined) await resolveBlockTs([b]);
        if (_blockTs[b]) return _blockTs[b];
    }
    const docId = ev.args?.[0];
    if (docId && _docTs?.[docId]) return _docTs[docId];
    try {
        const d = await _ctx.web3.contract.getDocument(docId);
        const ts = Number(d?.[2] || 0) || null;
        if (ts && docId) { loadTsCache()[docId] = ts; saveTsCache(); }
        return ts;
    } catch { return null; }
}

// ---------------- NGUỒN DỮ LIỆU (độc lập, lỗi cục bộ) ----------------

async function loadChain() {
    const { web3, computeMetrics } = _ctx;
    const [metrics, added, revoked] = await Promise.all([
        computeMetrics(),
        web3.queryHistory(),
        web3.queryRevokedHistory(),
    ]);
    _metrics = metrics || null;
    _added = added || [];
    _revoked = revoked || [];
    // Block gần nhất cho system panel — 1 call nhẹ
    try { _latestBlock = await web3.provider.getBlockNumber(); } catch {}
    _errors.chain = false;
}
let _latestBlock = null;

async function loadDb() {
    const [batches, partnerDocs] = await Promise.all([
        _ctx.api.getBatchesFromDatabase(),
        _ctx.api.getPartnerDocs(),
    ]);
    _batches = Array.isArray(batches) ? batches : [];
    _partnerDocs = partnerDocs && typeof partnerDocs === 'object' ? partnerDocs : {};
    _errors.db = false;
}

async function loadAdmin() {
    // Chỉ gọi khi ADMIN — User/Viewer không bắn request gây 403
    const [pending, sessions, keys] = await Promise.allSettled([
        _ctx.api.getPendingWallets(),
        _ctx.api.getSessions(),
        _ctx.api.listApiKeys(),
    ]);
    _admin = {
        pending: pending.status === 'fulfilled' ? pending.value : null,
        sessions: sessions.status === 'fulfilled' ? (sessions.value?.sessions || []) : null,
        keys: keys.status === 'fulfilled' ? keys.value : null,
    };
    _errors.admin = (_admin.pending === null && _admin.sessions === null && _admin.keys === null);
}

// Timeout mỗi nguồn — fetch của apiService không có AbortSignal, 1 request
// treo (backend sập/network suspended) sẽ khóa allSettled → dashboard trắng
const SRC_TIMEOUT_MS = 20000;
function withTimeout(promise, ms) {
    return Promise.race([
        promise,
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)),
    ]);
}

async function loadSource(src, timeoutMs) {
    dbg(`load ${src}…`);
    try {
        const job = src === 'chain' ? loadChain() : src === 'db' ? loadDb() : loadAdmin();
        await (timeoutMs ? withTimeout(job, timeoutMs) : job);
        dbg(`${src} OK`);
    } catch (e) {
        _errors[src] = true;
        dbg(`${src} LỖI: ${e?.message || e}`);
    }
    renderAll();
}

// ---------------- RENDER ----------------

function kpiCard(id, value, label, sub, extraClass = '') {
    const el = $(id);
    if (!el) return;
    el.innerHTML = `
        <div class="stat-value">${esc(value)}</div>
        <div class="stat-label">${esc(label)}</div>
        <div class="stat-sub">${esc(sub)}</div>`;
    if (extraClass) el.classList.add(...extraClass.split(' '));
}

function errStrip(src, label) {
    return `<div class="flex items-center justify-between gap-2 bg-err-soft border border-err text-err text-xs rounded-md px-3 py-2">
        <span><i class="fa-solid fa-triangle-exclamation mr-1"></i>${esc(label)}</span>
        <button type="button" data-act="dash-retry" data-src="${esc(src)}" class="font-bold underline hover:no-underline">Thử lại</button>
    </div>`;
}

function renderKpis() {
    if (_errors.chain) {
        const row = $('dash-kpi-row');
        if (row) row.innerHTML = `<div class="col-span-full">${errStrip('chain', 'Không tải được số liệu on-chain')}</div>`;
        return;
    }
    const m = _metrics || {};
    kpiCard('dash-kpi-active', m.docCount ?? '—', 'Tài liệu hiệu lực', 'On-chain + Database');
    kpiCard('dash-kpi-stamped', _added.length, 'Đã đóng dấu', 'On-chain');
    kpiCard('dash-kpi-revoked', _revoked.length, 'Đã thu hồi', 'On-chain');
    kpiCard('dash-kpi-wallets', m.issuerCount ?? '—', 'Ví được cấp quyền', 'On-chain + Database');
}

function renderAdminRow() {
    const row = $('dash-admin-row');
    if (!row) return;
    if (!_ctx?.isAdmin) { row.classList.add('hidden'); return; }
    row.classList.remove('hidden');
    if (_errors.admin) {
        row.innerHTML = `<div class="md:col-span-3">${errStrip('admin', 'Không tải được thống kê quản trị')}</div>`;
        return;
    }
    const pending = _admin.pending;
    const sessions = _admin.sessions;
    const keys = _admin.keys;
    const activeKeys = Array.isArray(keys) ? keys.filter(k => !k.revoked) : null;
    const lastUsed = activeKeys && activeKeys.length ? activeKeys.map(k => k.lastUsedAt || 0).filter(Boolean).sort((a, b) => b - a)[0] : null;
    const cell = (v, l, s) => `<div class="stat"><div class="stat-value">${esc(v)}</div><div class="stat-label">${esc(l)}</div><div class="stat-sub">${esc(s)}</div></div>`;
    row.innerHTML =
        cell(pending === null ? '—' : pending.length, 'Ví chờ duyệt', 'Database') +
        cell(sessions === null ? '—' : sessions.length, 'Phiên đăng nhập', 'Database') +
        cell(activeKeys === null ? '—' : `${activeKeys.length}${lastUsed ? ' · dùng gần nhất ' + new Date(lastUsed).toLocaleDateString('vi-VN') : ''}`, 'API key active', 'Database');
}

function relTime(ts) {
    if (!ts) return '';
    const d = Date.now() / 1000 - ts;
    if (d < 60) return 'vừa xong';
    if (d < 3600) return `${Math.floor(d / 60)} phút trước`;
    if (d < 86400) return `${Math.floor(d / 3600)} giờ trước`;
    return `${Math.floor(d / 86400)} ngày trước`;
}

async function renderFeed() {
    const box = $('dash-feed');
    if (!box) return;
    if (_errors.chain) { box.innerHTML = errStrip('chain', 'Không tải được hoạt động on-chain'); return; }
    if (!_added.length && !_revoked.length) {
        box.innerHTML = `<div class="empty"><i class="fa-solid fa-inbox empty-icon"></i><div class="empty-text">Chưa có hoạt động</div><div class="empty-hint">Tài liệu đóng dấu sẽ hiện tại đây</div></div>`;
        return;
    }
    const merged = [
        ..._added.map(ev => ({ ev, kind: 'added' })),
        ..._revoked.map(ev => ({ ev, kind: 'revoked' })),
    ].sort((a, b) => (Number(b.ev.blockNumber) || 0) - (Number(a.ev.blockNumber) || 0) || (Number(b.ev.index) || 0) - (Number(a.ev.index) || 0))
     .slice(0, FEED_TOP);
    // Resolve timestamp chỉ cho top-8 (block đã cache phần lớn từ chart)
    const items = await Promise.all(merged.map(async ({ ev, kind }) => {
        const ts = await eventTs(ev);
        const docId = ev.args?.[0] || '';
        const actor = kind === 'added' ? (ev.args?.[3] || '') : (ev.args?.[1] || '');
        return { kind, docId, actor, ts, block: ev.blockNumber };
    }));
    const icon = (k) => k === 'added'
        ? '<i class="fa-solid fa-file-circle-check text-ok"></i>'
        : '<i class="fa-solid fa-file-circle-xmark text-err"></i>';
    const label = (k) => k === 'added' ? 'Đóng dấu' : 'Thu hồi';
    box.innerHTML = `<ul class="divide-y divide-line">${items.map(it => `
        <li class="flex items-center gap-3 py-2.5">
            <span class="w-8 h-8 rounded-md bg-sunken border border-line flex items-center justify-center shrink-0">${icon(it.kind)}</span>
            <div class="flex-1 min-w-0">
                <div class="text-sm text-ink font-medium truncate">${label(it.kind)} <span class="font-mono text-xs text-accent">${esc(shortId(it.docId))}</span></div>
                <div class="text-[11px] text-faint">${esc(shortAddr(it.actor))} · block ${esc(String(it.block ?? '—'))}</div>
            </div>
            <span class="text-[11px] text-faint shrink-0">${esc(relTime(it.ts))}</span>
        </li>`).join('')}</ul>`;
}

async function renderChart() {
    const box = $('dash-chart');
    if (!box) return;
    if (_errors.chain) { box.innerHTML = errStrip('chain', 'Không tải được dữ liệu biểu đồ'); return; }
    if (!_added.length) {
        box.innerHTML = `<div class="empty"><i class="fa-solid fa-chart-column empty-icon"></i><div class="empty-text">Chưa có dữ liệu đóng dấu</div><div class="empty-hint">Tài liệu mới đóng dấu sẽ xuất hiện trong 30 ngày gần nhất</div></div>`;
        return;
    }
    box.innerHTML = '<div class="text-xs text-faint py-6 text-center">Đang tải timestamp…</div>';

    // Chỉ event trong 30 ngày gần nhất; resolve block ts (dedupe + cache).
    // Cap 600 event gần nhất — tránh hàng nghìn getBlock ở lần tải đầu;
    // event cũ hơn sẽ được cache dần qua các lần refresh sau.
    const cutoff = Math.floor(Date.now() / 1000) - CHART_DAYS * 86400;
    const cache = loadTsCache();
    const recentAdded = [..._added]
        .sort((a, b) => (Number(b.blockNumber) || 0) - (Number(a.blockNumber) || 0))
        .slice(0, 600);
    const needResolve = recentAdded.filter(ev => {
        const docId = ev.args?.[0];
        return !(docId && cache[docId]);
    });
    // Gán ts từ cache trước
    const dayCount = new Array(CHART_DAYS).fill(0);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const dayIndex = (ts) => {
        const d = new Date(ts * 1000); d.setHours(0, 0, 0, 0);
        return CHART_DAYS - 1 - Math.floor((today - d) / 86400000);
    };
    const tsOf = (ev) => {
        const docId = ev.args?.[0];
        if (docId && cache[docId]) return cache[docId];
        const b = ev.blockNumber != null ? Number(ev.blockNumber) : null;
        return b != null ? _blockTs[b] : null;
    };
    // Fetch block timestamps cho event chưa cache (dedupe theo block)
    const missingBlocks = [...new Set(needResolve.map(ev => ev.blockNumber).filter(b => b != null && _blockTs[b] === undefined))];
    if (missingBlocks.length) await resolveBlockTs(missingBlocks);
    for (const ev of needResolve) {
        const docId = ev.args?.[0];
        const ts = tsOf(ev);
        if (docId && ts) cache[docId] = ts;
    }
    if (needResolve.length) saveTsCache();
    let max = 0, total = 0;
    for (const ev of _added) {
        const ts = tsOf(ev);
        if (!ts || ts < cutoff) continue;
        const i = dayIndex(ts);
        if (i >= 0 && i < CHART_DAYS) { dayCount[i]++; total++; }
    }
    for (const c of dayCount) if (c > max) max = c;
    if (!total) {
        box.innerHTML = `<div class="empty"><i class="fa-solid fa-chart-column empty-icon"></i><div class="empty-text">Chưa có dữ liệu trong 30 ngày</div></div>`;
        return;
    }
    // SVG bar chart — viewBox 600x150, cột accent bo đỉnh, <title> tooltip
    const W = 600, H = 150, padB = 18, padT = 8;
    const plotH = H - padB - padT;
    const slot = W / CHART_DAYS;
    const bw = Math.max(2, slot * 0.62);
    let bars = '';
    for (let i = 0; i < CHART_DAYS; i++) {
        const c = dayCount[i];
        if (!c) continue;
        const h = Math.max(2, (c / max) * plotH);
        const x = i * slot + (slot - bw) / 2;
        const y = padT + plotH - h;
        const d = new Date(today.getTime() - (CHART_DAYS - 1 - i) * 86400000);
        const lbl = `${d.getDate()}/${d.getMonth() + 1}`;
        bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="var(--accent)"><title>${c} tài liệu — ${lbl}</title></rect>`;
    }
    // Nhãn trục X: mỗi ~5 ngày
    let labels = '';
    for (let i = 0; i < CHART_DAYS; i += 5) {
        const d = new Date(today.getTime() - (CHART_DAYS - 1 - i) * 86400000);
        labels += `<text x="${(i * slot + slot / 2).toFixed(1)}" y="${H - 4}" font-size="9" fill="var(--faint)" text-anchor="middle">${d.getDate()}/${d.getMonth() + 1}</text>`;
    }
    labels += `<text x="${(W - slot / 2).toFixed(1)}" y="${H - 4}" font-size="9" fill="var(--faint)" text-anchor="middle">${today.getDate()}/${today.getMonth() + 1}</text>`;
    box.innerHTML = `
        <div class="flex items-baseline justify-between mb-1">
            <span class="text-[11px] text-faint">${total} tài liệu / ${CHART_DAYS} ngày · cao nhất ${max}/ngày</span>
        </div>
        <svg viewBox="0 0 ${W} ${H}" class="w-full" style="height:150px" role="img" aria-label="Biểu đồ đóng dấu 30 ngày">
            <line x1="0" y1="${padT + plotH}" x2="${W}" y2="${padT + plotH}" stroke="var(--line)" stroke-width="1"/>
            ${bars}${labels}
        </svg>`;
}

function renderSys() {
    const box = $('dash-sys');
    if (!box) return;
    const net = CONFIG.HARDHAT_CHAIN_NAME || 'Sepolia Testnet';
    const contract = CONFIG.CONTRACT_ADDRESS || '';
    const lat = _metrics?.latency;
    const rows = [
        ['Mạng', `<span class="badge badge-ok"><i class="fa-solid fa-circle text-[8px] mr-1"></i>${esc(net)}</span>`],
        ['Contract', `<button type="button" data-act="copy" data-v="${esc(contract)}" class="font-mono text-xs text-accent hover:underline" title="Copy địa chỉ contract">${esc(shortAddr(contract))} <i class="fa-regular fa-copy text-[10px]"></i></button>`],
        ['Latency RPC', lat != null ? `<span class="text-ink font-semibold">${esc(String(lat))} ms</span>` : '<span class="text-faint">—</span>'],
        ['Block gần nhất', _latestBlock != null ? `<span class="font-mono text-xs text-ink">${esc(String(_latestBlock))}</span>` : '<span class="text-faint">—</span>'],
    ];
    box.innerHTML = `
        <h3 class="text-sm font-bold text-ink mb-3 flex items-center gap-2"><i class="fa-solid fa-server text-accent"></i>Trạng thái hệ thống</h3>
        <dl class="space-y-2 text-sm">${rows.map(([k, v]) => `
            <div class="flex items-center justify-between gap-3"><dt class="text-faint text-xs">${esc(k)}</dt><dd>${v}</dd></div>`).join('')}
        </dl>`;
}

function renderRole() {
    const box = $('dash-role');
    if (!box) return;
    const rank = _ctx?.rank;
    const isAdmin = !!_ctx?.isAdmin;
    const account = (_ctx?.account || '').toLowerCase();
    if (isAdmin) {
        // Admin đã có #dash-admin-row — panel phải tóm tắt phiên/key gần nhất
        const sessions = Array.isArray(_admin.sessions) ? _admin.sessions : null;
        const recent = (sessions || []).slice(0, 3);
        const keys = Array.isArray(_admin.keys) ? _admin.keys : null;
        const lastKey = keys && keys.filter(k => k.lastUsedAt).sort((a, b) => b.lastUsedAt - a.lastUsedAt)[0];
        box.classList.remove('hidden');
        box.innerHTML = `
            <h3 class="text-sm font-bold text-ink mb-3 flex items-center gap-2"><i class="fa-solid fa-user-tie text-violet"></i>Tổng quan quản trị</h3>
            ${_errors.admin ? errStrip('admin', 'Không tải được dữ liệu quản trị') : `
            <div class="space-y-2 text-sm">
                <div class="flex justify-between"><span class="text-faint text-xs">Phiên đang hoạt động</span><span class="text-ink font-semibold">${sessions === null ? '—' : sessions.length}</span></div>
                ${recent.map(s => `<div class="text-[11px] text-muted pl-3 border-l-2 border-line">${esc(s.deviceLabel || 'Thiết bị không rõ')} · ${esc(s.current ? 'hiện tại' : relTime(s.lastSeen ? s.lastSeen / 1000 : null))}</div>`).join('')}
                <div class="flex justify-between pt-1 border-t border-line"><span class="text-faint text-xs">API key dùng gần nhất</span><span class="text-ink font-semibold text-xs">${lastKey ? esc(new Date(lastKey.lastUsedAt).toLocaleString('vi-VN')) : '—'}</span></div>
            </div>`}`;
        return;
    }
    if (rank > 0 && account) {
        // User (rank>0, không admin): tài liệu của tôi — đếm từ event, không gọi thêm RPC
        const revokedIds = new Set(_revoked.map(ev => ev.args?.[0]));
        const mine = _added.filter(ev => (ev.args?.[3] || '').toLowerCase() === account);
        const mineRevoked = mine.filter(ev => revokedIds.has(ev.args?.[0])).length;
        box.classList.remove('hidden');
        box.innerHTML = `
            <h3 class="text-sm font-bold text-ink mb-3 flex items-center gap-2"><i class="fa-solid fa-folder-open text-accent"></i>Tài liệu của tôi</h3>
            ${_errors.chain ? errStrip('chain', 'Không tải được dữ liệu on-chain') : `
            <div class="grid grid-cols-3 gap-2 text-center">
                <div><div class="text-lg font-bold text-ink">${mine.length}</div><div class="text-[10px] text-faint uppercase">Đã đóng dấu</div></div>
                <div><div class="text-lg font-bold text-ok">${mine.length - mineRevoked}</div><div class="text-[10px] text-faint uppercase">Hiệu lực</div></div>
                <div><div class="text-lg font-bold text-err">${mineRevoked}</div><div class="text-[10px] text-faint uppercase">Đã thu hồi</div></div>
            </div>`}`;
        return;
    }
    box.classList.add('hidden'); // Viewer: chỉ system panel
}

function renderDetail() {
    const body = $('dash-detail-body');
    if (!body) return;
    if (_errors.db) { body.innerHTML = errStrip('db', 'Không tải được thống kê MongoDB'); return; }
    let files = 0, pub = 0, priv = 0, mb = 0;
    const sizeToMB = (s) => { // fileSize là chuỗi "x MB"/"x KB"/"x GB" — cùng logic sizeStringToMB phía server
        const n = parseFloat(s);
        if (!isFinite(n) || n <= 0) return 0;
        if (/GB/i.test(s)) return n * 1024;
        if (/KB/i.test(s)) return n / 1024;
        return n;
    };
    for (const b of _batches) {
        for (const f of (b.files || [])) {
            files++;
            if (f.visibility === 'public') pub++; else priv++;
            mb += sizeToMB(f.fileSize);
        }
    }
    const partnerCount = Object.keys(_partnerDocs).length;
    body.innerHTML = `
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
            <div><div class="text-lg font-bold text-ink">${_batches.length}</div><div class="text-[10px] text-faint uppercase">Số batch</div></div>
            <div><div class="text-lg font-bold text-ink">${files}</div><div class="text-[10px] text-faint uppercase">Tổng file</div></div>
            <div><div class="text-lg font-bold text-info">${pub}</div><div class="text-[10px] text-faint uppercase">Công khai</div></div>
            <div><div class="text-lg font-bold text-muted">${priv}</div><div class="text-[10px] text-faint uppercase">Riêng tư · ${mb.toFixed(1)} MB</div></div>
        </div>
        <div class="mt-3 text-xs text-faint">Tài liệu đối tác: <span class="text-ink font-semibold">${partnerCount}</span> bản ghi — nguồn: Database</div>`;
}

function renderAll() {
    renderKpis();
    renderAdminRow();
    renderSys();
    renderRole();
    renderDetail();
    renderFeed();
    renderChart(); // async — tự quản skeleton, không chặn KPI
}

// ---------------- PUBLIC API ----------------

export function initDashboard(ctx) {
    dbg('initDashboard called');
    const accountChanged = _ctx && _ctx.account !== ctx.account;
    _ctx = ctx;
    if (accountChanged) {
        // Đổi ví → reset toàn bộ state + cache phiên
        _metrics = null; _added = []; _revoked = []; _batches = [];
        _partnerDocs = {}; _admin = { pending: null, sessions: null, keys: null };
        _errors = {}; _blockTs = {}; _latestBlock = null; _lastRefresh = 0;
    }
    if (!_listenerBound) {
        _listenerBound = true;
        document.addEventListener('click', (e) => {
            const btn = e.target.closest('#tab-dashboard [data-act="dash-retry"]');
            if (!btn) return;
            const src = btn.dataset.src;
            if (src) loadSource(src, SRC_TIMEOUT_MS);
        });
        // Vào tab dashboard → refresh (throttle 30s lo chi phí RPC)
        document.addEventListener('bdi:tab', (e) => {
            if (e.detail?.tabId === 'tab-dashboard') refreshDashboard();
        });
    }
    refreshDashboard(true);
}

export function refreshDashboard(force = false) {
    if (!_ctx) { dbg('refresh: _ctx null — chưa init'); return Promise.resolve(); }
    dbg(`refresh (force=${force}, throttled=${!force && Date.now() - _lastRefresh < THROTTLE_MS})`);
    const now = Date.now();
    if (!force && now - _lastRefresh < THROTTLE_MS) return Promise.resolve();
    if (_inflight) return _inflight;
    _lastRefresh = now;
    _inflight = (async () => {
        const jobs = [['chain'], ['db']];
        if (_ctx.isAdmin) jobs.push(['admin']);
        // Mỗi nguồn render độc lập (loadSource đã renderAll sau khi xong) —
        // nguồn nhanh hiện trước, nguồn treo chỉ hiện error strip sau timeout
        await Promise.allSettled(jobs.map(([s]) => loadSource(s, SRC_TIMEOUT_MS)));
    })().finally(() => { _inflight = null; });
    return _inflight;
}

// Đăng xuất/đổi ví — main.js gọi để xóa state + bỏ throttle
export function resetDashboard() {
    _ctx = null;
    _metrics = null; _added = []; _revoked = []; _batches = [];
    _partnerDocs = {}; _admin = { pending: null, sessions: null, keys: null };
    _errors = {}; _blockTs = {}; _latestBlock = null;
    _lastRefresh = 0; _inflight = null;
}
