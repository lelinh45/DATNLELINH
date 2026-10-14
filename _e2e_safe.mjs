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
{ const r = await post('/wallets/sync', { address: wPend.address, requestedRole: 'NGƯỜI XEM' }, HP); ok('Pending thiếu tên/liên hệ khi xin quyền → 400', r.st === 400, 'st=' + r.st); }
{ const r = await post('/wallets/email', { email: 'pend@test.com', phone: '0912345678' }, HP); ok('Pending lưu email+SĐT', r.st === 200, 'st=' + r.st); }
{ const r = await post('/wallets/sync', { address: wPend.address, alias: 'E2E Pending', requestedRole: 'NGƯỜI XEM' }, HP); ok('Pending khai đủ thông tin → requestedRole OK', r.st === 200 && r.requestedRole === 'NGƯỜI XEM', JSON.stringify(r).slice(0, 200)); }
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

console.log('== D2. TRA CỨU TÀI LIỆU KHÔNG CẦN MÃ (verify bằng hash/tên file) ==');
const probeHash = crypto.createHash('sha256').update('e2e-noi-dung-thu-nghiem').digest('hex');
await mdb.connection.db.collection('batches').insertOne({
    batchId: 'e2e_batch_lookup', uploader: wView.address.toLowerCase(), ipfsCID: 'bafye2e', txHash: '0xabc',
    files: [
        { docId: 'hopdong_test.pdf_1700000001', fileName: 'hopdong_test.pdf', fileHash: probeHash, ipfsCID: 'bafy1', fileSize: '1 KB', visibility: 'private' },
        { docId: 'danhsach.xlsx_1700000002', fileName: 'danhsach.xlsx', fileHash: '0'.repeat(64), ipfsCID: 'bafy2', fileSize: '2 KB', visibility: 'public', isRevoked: true, revocationReason: 'hết hạn' }
    ]
});
{ const r = await get('/documents/lookup?hash=' + probeHash); ok('Lookup theo hash → tìm đúng docId', r.st === 200 && r.byHash && r.byHash[0] && r.byHash[0].docId === 'hopdong_test.pdf_1700000001', JSON.stringify(r).slice(0, 160)); }
{ const r = await get('/documents/lookup?name=danhsach.xlsx'); ok('Lookup theo tên file → thấy + kèm cờ thu hồi', r.st === 200 && r.byName && r.byName[0] && r.byName[0].isRevoked === true, JSON.stringify(r).slice(0, 160)); }
{ const r = await get('/documents/lookup?name=hopdong_test.pdf_1700000001'); ok('Lookup theo docId base (tên_<epoch>) → khớp', r.st === 200 && r.byName && r.byName.length === 1); }
{ const r = await get('/documents/lookup?name=' + encodeURIComponent('hopdong_test_v2.pdf')); ok('Lookup tên tương tự (đổi tên) → gợi ý bySimilar', r.st === 200 && r.byName.length === 0 && r.bySimilar && r.bySimilar.some(m => m.docId === 'hopdong_test.pdf_1700000001'), JSON.stringify(r).slice(0, 160)); }
{ const r = await get('/documents/lookup?hash=' + 'f'.repeat(64)); ok('Lookup hash lạ → rỗng (file chưa đóng dấu)', r.st === 200 && r.byHash.length === 0); }
{ const r = await get('/documents/lookup?hash=nothex'); ok('Lookup hash xấu → 400', r.st === 400); }
{ const r = await get('/documents/lookup'); ok('Lookup thiếu tham số → 400', r.st === 400); }

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
    { const r = await get('/wallets/me', HP); ok('Ví bị từ chối → /wallets/me đọc được + status REVOKED + cờ rejected', r.st === 200 && r.status === 'REVOKED' && r.rejected === true, JSON.stringify(r).slice(0, 160)); }
    { const r = await get('/wallets/pending', HA); const still = (r.wallets || []).some(w => w.address === wPend.address.toLowerCase()); ok('Ví bị từ chối → biến mất khỏi khay chờ', r.st === 200 && !still); }
    // Ví bị từ chối tự khai lại thông tin → quay lại khay chờ duyệt (không tự leo quyền)
    { const r = await post('/wallets/sync', { address: wPend.address, alias: 'E2E Re-request', requestedRole: 'NHẬP LIỆU' }, HP); ok('Ví bị từ chối khai lại → status ACTIVE, rejected=false', r.st === 200 && r.status === 'ACTIVE' && r.rejected === false, JSON.stringify(r).slice(0, 160)); }
    { const r = await get('/wallets/pending', HA); const back = (r.wallets || []).some(w => w.address === wPend.address.toLowerCase()); ok('Ví khai lại → quay lại khay chờ duyệt', r.st === 200 && back); }
    // Tích lũy từ chối: lần thứ 3 bị cấm xin lại 30 phút (chống spam khay duyệt)
    { const r = await post('/wallets/reject', { address: wPend.address }, HA); ok('Reject lần 2 → 200', r.st === 200); }
    { const r = await post('/wallets/sync', { address: wPend.address, alias: 'E2E Re-request', requestedRole: 'NHẬP LIỆU' }, HP); ok('Khai lại sau reject 2 → ACTIVE', r.st === 200 && r.status === 'ACTIVE'); }
    { const r = await post('/wallets/reject', { address: wPend.address }, HA); ok('Reject lần 3 → 200', r.st === 200); }
    { const r = await get('/wallets/me', HP); ok('Sau reject 3 → rejectCount=3 + rejectBlockedUntil > now', r.st === 200 && r.rejectCount === 3 && (r.rejectBlockedUntil || 0) > Date.now(), JSON.stringify(r).slice(0, 160)); }
    { const r = await post('/wallets/sync', { address: wPend.address, alias: 'E2E Blocked', requestedRole: 'NHẬP LIỆU' }, HP); ok('Xin lại khi đang bị chặn 30p → 429', r.st === 429, 'st=' + r.st); }

    // Ví bị Admin XÓA (status DELETED) đăng nhập lại + tự khai thông tin →
    // phải revive về ACTIVE và lọt vào khay chờ, không kẹt ngõ cụt
    await mdb.connection.db.collection('wallets').updateOne(
        { address: wPend.address.toLowerCase() },
        { $set: { status: 'DELETED', role: 'ĐÃ XÓA' } });
    { const r = await post('/wallets/sync', { address: wPend.address, alias: 'E2E Deleted-back', requestedRole: 'NGƯỜI XEM' }, HP); ok('Ví bị xóa khai lại → revive ACTIVE + role mặc định + xóa đếm từ chối + roleGranted=false', r.st === 200 && r.status === 'ACTIVE' && r.role === 'NHẬP LIỆU' && r.rejectCount === 0 && r.roleGranted === false, JSON.stringify(r).slice(0, 200)); }

    // Ví bị Admin KHÓA thủ công (REVOKED + roleGranted=true) khai lại → KHÔNG tự mở,
    // chỉ Admin mở khóa được — nếu không thì thao tác Khóa vô nghĩa
    await mdb.connection.db.collection('wallets').updateOne(
        { address: wPend.address.toLowerCase() },
        { $set: { status: 'REVOKED', role: 'BỊ KHÓA', roleGranted: true } });
    { const r = await post('/wallets/sync', { address: wPend.address, alias: 'E2E Locked', requestedRole: 'NGƯỜI XEM' }, HP); ok('Ví bị khóa thủ công khai lại → KHÔNG tự mở (giữ REVOKED)', r.st === 200 && r.status === 'REVOKED', JSON.stringify(r).slice(0, 160)); }

    // Ví TỪNG được cấp nhưng mang cờ rejected cũ → vẫn không tự mở
    // (rejected chỉ mở đường revive cho ví chưa từng được cấp)
    await mdb.connection.db.collection('wallets').updateOne(
        { address: wPend.address.toLowerCase() },
        { $set: { rejected: true } });
    { const r = await post('/wallets/sync', { address: wPend.address, alias: 'E2E Locked+Rej', requestedRole: 'NGƯỜI XEM' }, HP); ok('rejected cũ + đã từng được cấp → KHÔNG tự mở (giữ REVOKED)', r.st === 200 && r.status === 'REVOKED', JSON.stringify(r).slice(0, 160)); }
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
{ const r = await get('/wallets/admin-contact', HP); ok('/wallets/admin-contact (ví thường) → 200', r.st === 200); }
{ const r = await get('/wallets/admin-contact'); ok('/wallets/admin-contact không token → 401', r.st === 401); }

console.log('\n========== ĐỘ TRỄ TỪNG ENDPOINT ==========');
timings.forEach(([n, v]) => console.log(`  ${String(v).padStart(5)} ms  ${n}`));
const slow = timings.filter(([, v]) => v > 1500);
if (slow.length) console.log('⚠️  Endpoint chậm >1.5s:', slow.map(([n]) => n).join(', '));
console.log(`\n========== KẾT QUẢ: ${pass} PASS / ${fail} FAIL ==========`);
await mdb.connection.db.dropDatabase().catch(() => {});
await mongoose.disconnect();
process.exit(fail ? 1 : 0);
