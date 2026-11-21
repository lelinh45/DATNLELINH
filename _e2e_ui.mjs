// E2E UI thật: fake window.ethereum = ví admin (PRIVATE_KEY trong .env),
// eth_call/eth_getLogs forward sang Sepolia RPC thật, login → dashboard.
import puppeteer from 'puppeteer-core';
import http from 'http';
import { readFile } from 'fs/promises';
import { extname, join } from 'path';
import mongoose from 'mongoose';

const ROOT = process.cwd();
const env = await readFile(join(ROOT, '.env'), 'utf8');
const pk = (env.match(/PRIVATE_KEY=(.+)/) || [])[1]?.trim().replace(/^['\"]|['\"]$/g, '');
const mongoUri = (env.match(/MONGO_URI=(.+)/) || [])[1]?.trim().replace(/^['\"]|['\"]$/g, '');
if (!pk) { console.log('NO PRIVATE_KEY'); process.exit(1); }

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const server = http.createServer(async (req, res) => {
    try {
        let p = decodeURIComponent(req.url.split('?')[0]);
        // Proxy JSON-RPC → Sepolia (tránh CORS từ browser)
        if (p === '/rpc' && req.method === 'POST') {
            let body = '';
            req.on('data', c => body += c);
            req.on('end', async () => {
                try {
                    const r = await fetch('https://ethereum-sepolia-rpc.publicnode.com', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
                    const t = await r.text();
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(t);
                } catch (e) { res.writeHead(502); res.end('{"error":"proxy"}'); }
            });
            return;
        }
        if (p === '/') p = '/index.html';
        const d = await readFile(join(ROOT, p));
        res.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'application/octet-stream' });
        res.end(d);
    } catch { res.writeHead(404); res.end('nf'); }
});
// Port 5500 → config.js API_BASE = http://localhost:3000/api (backend thật đang chạy)
await new Promise(r => server.listen(5500, r));

const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: 'new',
    args: ['--no-sandbox'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const logs = [];
page.on('console', m => { const t = `[${m.type()}] ${m.text()}`; logs.push(t); if (m.type() === 'error') console.log('CONSOLE-ERR:', t.slice(0, 250)); });
page.on('pageerror', e => console.log('PAGEERROR:', String(e).slice(0, 250)));

// Inject mock provider TRƯỚC mọi script của trang.
// ethers do chính trang load qua CDN — provider chờ window.ethers sẵn sàng.
await page.evaluateOnNewDocument((privateKey) => {
    const waitEthers = () => new Promise((res) => {
        const t = setInterval(() => { if (window.ethers?.Wallet) { clearInterval(t); res(); } }, 50);
        setTimeout(() => { clearInterval(t); res(); }, 15000);
    });
    const RPC = '/rpc';
    const rpc = async (method, params) => {
        const r = await fetch(RPC, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
        const j = await r.json();
        if (j.error) throw new Error(j.error.message || 'rpc error');
        return j.result;
    };
    const provider = {
        isMetaMask: true,
        selectedAddress: null,
        chainId: '0xaa36a7',
        providers: null, // gán sau
        async request({ method, params }) {
            switch (method) {
                case 'eth_requestAccounts': case 'eth_accounts': {
                    await waitEthers();
                    const addr = new ethers.Wallet(privateKey).address;
                    provider.selectedAddress = addr;
                    return [addr];
                }
                case 'eth_chainId': return '0xaa36a7';
                case 'net_version': return '11155111';
                case 'wallet_switchEthereumChain': case 'wallet_addEthereumChain': return null;
                case 'personal_sign': {
                    await waitEthers();
                    const wallet = new ethers.Wallet(privateKey);
                    const data = params[0];
                    const bytes = typeof data === 'string' && data.startsWith('0x') ? ethers.getBytes(data) : ethers.toUtf8Bytes(String(data));
                    return wallet.signMessage(bytes);
                }
                case 'eth_sign': {
                    await waitEthers();
                    const wallet = new ethers.Wallet(privateKey);
                    return wallet.signingKey.sign(ethers.getBytes(params[1])).serialized;
                }
                case 'eth_sendTransaction': throw new Error('MOCK: tx not supported');
                default: return rpc(method, params || []);
            }
        },
        on() {}, removeListener() {}, removeAllListeners() {},
    };
    provider.providers = [provider];
    window.ethereum = provider;
}, pk);

console.log('Loading page on :5500 (API → localhost:3000)...');
await page.goto('http://localhost:5500/index.html', { waitUntil: 'networkidle2', timeout: 60000 });
await new Promise(r => setTimeout(r, 2000));

// Bấm "Đăng nhập bằng Ví Web3" trên login screen
await page.click('#btn-login-wallet').catch(e => console.log('click err', e.message));
console.log('clicked login');

// Chờ login flow + dashboard init (RPC calls thật → chậm)
// Thiết bị headless là "máy lạ" → backend trả DEVICE_PENDING; auto-approve
// thẳng trong Mongo (giả lập admin bấm Duyệt trên thiết bị thật)
let approved = false;
for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 5000));
    if (!approved) {
        const devId = await page.evaluate(() => localStorage.getItem('bdi_device_id')).catch(() => null);
        if (devId && mongoUri) {
            try {
                await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 8000 });
                const r = await mongoose.connection.db.collection('devicesessions')
                    .updateOne({ deviceId: devId, status: 'pending' }, { $set: { status: 'active', revoked: false } });
                console.log(`auto-approved device ${devId.slice(0, 8)}… matched=${r.matchedCount}`);
                approved = true;
            } catch (e) { console.log('approve err:', e.message); }
        }
    }
    const st = await page.evaluate(() => ({
        app: !document.getElementById('app-container')?.classList.contains('hidden'),
        dashHidden: document.getElementById('tab-dashboard')?.classList.contains('hidden'),
        kpi: document.getElementById('dash-kpi-active')?.innerText?.replace(/\s+/g, ' ').slice(0, 60),
        swal: document.querySelector('.swal2-popup')?.innerText?.replace(/\s+/g, ' ').slice(0, 150) || null,
    }));
    console.log(`t=${(i + 1) * 5}s`, JSON.stringify(st));
    // Chain quét ~42 chunk event lần đầu → chờ tới khi KPI có số thật (không '—' không '…')
    if (st.dashHidden === false && st.kpi && !st.kpi.includes('…') && !st.kpi.startsWith('—')) break;
}

// Chờ biểu đồ render xong (svg hoặc empty state)
for (let i = 0; i < 20; i++) {
    const done = await page.evaluate(() => !!document.querySelector('#dash-chart svg, #dash-chart .empty, #dash-chart .stat'));
    if (done) break;
    await new Promise(r => setTimeout(r, 2000));
}

const final = await page.evaluate(() => ({
    dashText: document.getElementById('tab-dashboard')?.innerText?.replace(/\s+/g, ' ').slice(0, 900),
    pending: !document.getElementById('tab-pending')?.classList.contains('hidden'),
}));
console.log('=== DASHBOARD TEXT ===');
console.log(final.dashText);
console.log('pendingTabVisible:', final.pending);
console.log('=== LAST ERRORS ===');
logs.filter(l => l.includes('[error]') || l.includes('PAGEERROR')).slice(-15).forEach(l => console.log(l.slice(0, 250)));
const diag = await page.evaluate(() => {
    const vis = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return { rect: [r.x|0, r.y|0, r.width|0, r.height|0], display: cs.display, vis: cs.visibility, cls: (el.getAttribute('class') || '').slice(0, 80) }; };
    const td = document.getElementById('tab-dashboard');
    let chain = []; let n = td;
    while (n && chain.length < 6) { chain.push(`${n.id || n.tagName}:${getComputedStyle(n).display}`); n = n.parentElement; }
    const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
    const top = document.elementFromPoint(cx, cy);
    return {
        loginHidden: document.getElementById('login-screen')?.classList.contains('hidden'),
        appCls: document.getElementById('app-container')?.className,
        tabDash: vis(td),
        chain,
        centerTop: top ? `${top.tagName}#${top.id}.${String(top.className).slice(0, 60)}` : 'null',
        bodyBg: getComputedStyle(document.body).backgroundColor,
        kpiRect: vis(document.getElementById('dash-kpi-active')),
        dashDebugTxt: document.getElementById('dash-debug')?.innerText,
        // Đo chiều cao các card để kiểm tra layout cân đối
        chartCard: vis(document.getElementById('dash-chart')?.closest('.card')),
        feedCard: vis(document.getElementById('dash-feed')?.closest('.card')),
        sysCard: vis(document.getElementById('dash-sys')),
        roleCard: vis(document.getElementById('dash-role')),
        detailCard: vis(document.getElementById('dash-detail')),
        mainGrid: vis(document.querySelector('#tab-dashboard [class*="grid-cols-3"]')),
        feedRows: document.querySelectorAll('#dash-feed li').length,
        chartSvg: vis(document.querySelector('#dash-chart svg')),
        chartSvgTxt: document.querySelector('#dash-chart svg')?.innerHTML?.replace(/\s+/g, ' ').slice(0, 400),
        chartTexts: document.querySelectorAll('#dash-chart svg text').length,
    };
});
console.log('=== DIAG ==='); console.log(JSON.stringify(diag, null, 1));
await page.screenshot({ path: join(ROOT, '_dash_shot.png') });
console.log('screenshot → _dash_shot.png');
await mongoose.disconnect().catch(() => {});
await browser.close(); server.close();
