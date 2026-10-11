// E2E AN TOÀN — server test :3001 + MongoDB local bdi_e2e (không đụng Atlas/on-chain)
// B1 — khởi động server test:
//   Git Bash:  PORT=3001 MONGO_URI="mongodb://127.0.0.1:27017/bdi_e2e" node server.js
//   CMD:       set PORT=3001&& set MONGO_URI=mongodb://127.0.0.1:27017/bdi_e2e&& node server.js
// B2: node _e2e_safe.mjs   (xong tự drop database bdi_e2e)
import { Wallet, JsonRpcProvider, Contract } from 'ethers';
import mongoose from 'mongoose';
import crypto from 'crypto';
import 'dotenv/config';

const B = 'http://localhost:3001/api';
const LOCAL_DB = 'mongodb://127.0.0.1:27017/bdi_e2e';
const j = r => r.json();
const t0 = () => performance.now();
const ms = t => Math.round(performance.now() - t);
const post = (p, b, h = {}) => { const t = t0(); return fetch(B + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...h }, body: JSON.stringify(b) }).then(async r => ({ st: r.status, ms: ms(t), ...(await j(r).catch(() => ({}))) })); };
const get = (p, h = {}) => { const t = t0(); return fetch(B + p, { headers: h }).then(async r => ({ st: r.status, ms: ms(t), ...(await j(r).catch(() => ({}))) })); };
const login = async (w, dev) => {
    const c = await get('/auth/challenge?address=' + w.address.toLowerCase());
    return post('/auth/login', { address: w.address.toLowerCase(), signature: await w.signMessage(c.challenge), challenge: c.challenge, deviceId: dev, deviceLabel: 'E2E-SAFE' });
};
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log('  ✅', name); } else { fail++; console.log('  ❌', name, extra); } };
const timings = [];
const rec = (name, msVal) => timings.push([name, msVal]);

// Contract read-only — đo độ trễ RPC thật (không ghi gì lên chain)
const provider = new JsonRpcProvider(process.env.RPC_URL);
const contractRO = new Contract(process.env.CONTRACT_ADDRESS, [
    'function userRoles(address) view returns (uint8)',
    'function getDocument(string) view returns (string,string,uint256,address,bool,string)'
], provider);

console.log('== A. HEALTH & LATENCY PUBLIC ==');
{ const t = t0(); const r = await fetch('http://localhost:3001/'); rec('GET / (index.html)', ms(t)); ok('Trang chủ 200', r.status === 200); }
{ const w = Wallet.createRandom(); const c = await get('/auth/challenge?address=' + w.address); rec('GET /auth/challenge', c.ms); ok('Challenge 200 + có nonce', c.st === 200 && !!c.challenge); }
{ const v = await post('/verify', {}, {}); rec('POST /verify thiếu file', v.ms); ok('Verify thiếu input → 4xx (không crash)', v.st >= 400 && v.st < 500); }

console.log('== B. VÍ CHỜ DUYỆT (rank 0, chưa cấp gì) — phải bị chặn mọi API đọc/ghi ==');
const wPend = Wallet.createRandom();
const lP = await login(wPend, 'e2esafePend0001');
ok('Ví mới login được JWT (thiết bị đầu tự duyệt)', !!lP.token, JSON.stringify(lP).slice(0, 150));
const HP = { Authorization: 'Bearer ' + lP.token };
{ const r = await get('/batches', HP); rec('GET /batches (pending)', r.ms); ok('Pending → /batches 403', r.st === 403, JSON.stringify(r)); }
{ const r = await get('/wallets', HP); ok('Pending → /wallets 403', r.st === 403); }
{ const r = await post('/upload', {}, HP); ok('Pending → upload 403/400 không được qua quyền', r.st === 403 || r.st === 400, 'st=' + r.st); }
{ const r = await post('/batches/revoke', { docId: 'x', reason: 'y' }, HP); ok('Pending → revoke 403', r.st === 403); }
{ const r = await get('/apikeys', HP); ok('Pending → /apikeys 403', r.st === 403); }
{ const r = await get('/wallets/me', HP); rec('GET /wallets/me', r.ms); ok('Pending → /wallets/me 200 (hồ sơ mình)', r.st === 200); }
{ const r = await post('/wallets/sync', { address: wPend.address, alias: 'E2E Pending', requestedRole: 'NGƯỜI XEM' }, HP); ok('Pending tự khai requestedRole NGƯỜI XEM', r.st === 200 && r.requestedRole === 'NGƯỜI XEM', JSON.stringify(r).slice(0, 200)); }
{ const r = await post('/wallets/sync', { address: wPend.address, role: 'ADMIN', status: 'ACTIVE' }, HP); ok('Pending tự leo quyền role=ADMIN → 403', r.st === 403, 'st=' + r.st); }

console.log('== C. VÍ NGƯỜI XEM (rank 0 + DB flag) — đọc được, ghi bị chặn ==');
const wView = Wallet.createRandom();
const lV = await login(wView, 'e2esafeView0002');
const HV = { Authorization: 'Bearer ' + lV.token };
// Giả lập luồng thật: ví sync hồ sơ (tạo Wallet doc) → admin cấp NGƯỜI XEM trong DB
await post('/wallets/sync', { address: wView.address, alias: 'E2E Viewer' }, HV);
const mdb = await mongoose.connect(LOCAL_DB);
await mdb.connection.db.collection('wallets').updateOne(
    { address: wView.address.toLowerCase() },
    { $set: { role: 'NGƯỜI XEM', status: 'ACTIVE' } });
{ const r = await get('/batches', HV); rec('GET /batches (viewer)', r.ms); ok('Viewer → /batches 200', r.st === 200, 'st=' + r.st); }
{ const r = await get('/wallets', HV); rec('GET /wallets (viewer)', r.ms); const leak = JSON.stringify(r).includes('e2e_privacy@test.com'); ok('Viewer → /wallets 200, email/SĐT bị che', r.st === 200 && !leak, 'st=' + r.st); }
{ const r = await post('/upload', {}, HV); ok('Viewer → upload vẫn 403 (requireRole đọc chain)', r.st === 403 || r.st === 400, 'st=' + r.st); }
{ const r = await post('/batches', { batchId: 'x', files: [] }, HV); ok('Viewer → POST /batches 403', r.st === 403); }
{ const r = await post('/batches/revoke', { docId: 'x', reason: 'y' }, HV); ok('Viewer → revoke 403', r.st === 403); }
{ const r = await get('/apikeys', HV); ok('Viewer → /apikeys 403', r.st === 403); }
{ const r = await post('/wallets/sync', { address: wView.address, role: 'NHẬP LIỆU' }, HV); ok('Viewer tự đổi role → 403', r.st === 403); }
{ const r = await get('/wallets/pending', HV); ok('Viewer → khay chờ duyệt 403', r.st === 403); }

console.log('== D. VÍ NGƯỜI XEM BỊ KHÓA (status REVOKED) — mất cả quyền đọc ==');
await mdb.connection.db.collection('wallets').updateOne({ address: wView.address.toLowerCase() }, { $set: { status: 'REVOKED' } });
{ const r = await get('/batches', HV); ok('Viewer bị khóa → /batches 403', r.st === 403); }
await mdb.connection.db.collection('wallets').updateOne({ address: wView.address.toLowerCase() }, { $set: { status: 'ACTIVE' } });

console.log('== E. ADMIN THẬT (PRIVATE_KEY rank 3 on-chain) — chỉ test đọc ==');
if (process.env.PRIVATE_KEY) {
    const admin = new Wallet(process.env.PRIVATE_KEY, provider);
    const lA = await login(admin, 'e2esafeAdm0003');
    ok('Admin login', !!lA.token, JSON.stringify(lA).slice(0, 120));
    const HA = { Authorization: 'Bearer ' + lA.token };
    { const r = await get('/wallets', HA); rec('GET /wallets (admin)', r.ms); ok('Admin → /wallets 200 (thấy email nếu có)', r.st === 200); }
    { const r = await get('/wallets/pending', HA); rec('GET /wallets/pending (admin)', r.ms); ok('Admin → khay chờ duyệt 200', r.st === 200); }
    { const r = await get('/apikeys', HA); ok('Admin → /apikeys 200', r.st === 200); }
    // Từ chối ví chờ duyệt: khóa ví → biến mất khỏi khay + ví bên kia đọc được status
    { const r = await post('/wallets/reject', { address: wPend.address }, HV); ok('Viewer → reject ví → 403', r.st === 403); }
    { const r = await post('/wallets/reject', { address: 'not-an-address' }, HA); ok('Admin → reject địa chỉ xấu → 400', r.st === 400); }
    { const r = await post('/wallets/reject', { address: wPend.address }, HA); ok('Admin → reject ví chờ → 200', r.st === 200, JSON.stringify(r)); }
    { const r = await get('/wallets/me', HP); ok('Ví bị từ chối → /wallets/me vẫn đọc được + status REVOKED', r.st === 200 && r.status === 'REVOKED', JSON.stringify(r).slice(0, 150)); }
    { const r = await get('/wallets/pending', HA); const still = (r.wallets || []).some(w => w.address === wPend.address.toLowerCase()); ok('Ví bị từ chối → biến mất khỏi khay chờ', r.st === 200 && !still); }
} else console.log('  (không có PRIVATE_KEY — bỏ qua)');

console.log('== F. ĐỘ TRỄ RPC ON-CHAIN (đọc — giới hạn UX) ==');
{
    let t = t0(); const r = await contractRO.userRoles(wPend.address); rec('RPC userRoles (rank 0)', ms(t));
    ok('RPC đọc userRoles OK', r !== undefined);
    t = t0(); await contractRO.userRoles(process.env.PRIVATE_KEY ? new Wallet(process.env.PRIVATE_KEY).address : wPend.address); rec('RPC userRoles (admin)', ms(t));
}

console.log('== G. SECURITY NHANH ==');
{ const r = await get('/batches'); ok('/batches không token → 401', r.st === 401); }
{ const r = await get('/wallets', { Authorization: 'Bearer fake.jwt.here' }); ok('JWT giả → 401', r.st === 401); }
{ const r = await post('/wallets/sync', { address: 'not-an-address' }, HP); ok('Sync địa chỉ xấu → 400', r.st === 400); }

console.log('\n========== ĐỘ TRỄ TỪNG ENDPOINT ==========');
timings.forEach(([n, v]) => console.log(`  ${String(v).padStart(5)} ms  ${n}`));
const slow = timings.filter(([, v]) => v > 1500);
if (slow.length) console.log('⚠️  Endpoint chậm >1.5s:', slow.map(([n]) => n).join(', '));
console.log(`\n========== KẾT QUẢ: ${pass} PASS / ${fail} FAIL ==========`);
await mdb.connection.db.dropDatabase().catch(() => {});
await mongoose.disconnect();
process.exit(fail ? 1 : 0);
