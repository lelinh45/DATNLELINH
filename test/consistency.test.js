import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const mainJs = read('assets/js/main.js');
const web3Js = read('assets/js/web3Service.js');
const serverJs = read('server.js');
const indexHtml = read('index.html');
const batchModel = read('models/Batch.js');

// Backend phụ đã được merge vào server.js chính — nếu user xóa folder thì skip,
// các guard về backend phụ không còn ý nghĩa.
const backendDir = path.join(root, '..', 'backend-data-integrity');
const backend2Exists = fs.existsSync(path.join(backendDir, 'server.js'));
const backend2Server = backend2Exists ? fs.readFileSync(path.join(backendDir, 'server.js'), 'utf8') : '';
const backend2Wallet = fs.existsSync(path.join(backendDir, 'models/Wallet.js'))
    ? fs.readFileSync(path.join(backendDir, 'models/Wallet.js'), 'utf8') : '';

// =====================================================================
// C1 — REVOCATION CONSISTENCY: thu hồi phải ghi cả on-chain lẫn MongoDB
// =====================================================================
test('C1: revokeDoc ghi thu hồi lên chain (web3.revokeDocument) VÀ MongoDB (revokeBatchFile)', () => {
    const start = mainJs.indexOf('window.revokeDoc = ');
    assert.ok(start > 0, 'Không tìm thấy revokeDoc');
    const body = mainJs.slice(start, start + 6000);
    assert.ok(body.includes('web3.revokeDocument'), 'revokeDoc phải gọi revokeDocument on-chain');
    assert.ok(body.includes('revokeBatchFile'), 'revokeDoc phải cập nhật MongoDB');
    assert.ok(body.includes('ensureAuth'), 'revokeDoc phải ensureAuth (không phải loginWithWallet ép ký lại)');
    assert.ok(!body.includes('await ApiService.loginWithWallet'), 'revokeDoc không được ép ký lại mỗi lần (I4)');
});

test('C1: verify đối chiếu trạng thái thu hồi từ MongoDB (ngoài chain)', () => {
    assert.ok(mainJs.includes('getDocumentStatus'), 'handleVerify phải hỏi Mongo status');
    assert.ok(serverJs.includes("/api/documents/:docId/status"), 'server phải có endpoint status');
});

// =====================================================================
// I2 — getUserRole KHÔNG được trả role giả khi lỗi
// =====================================================================
test('I2: getUserRole trả null khi lỗi RPC — không trả 1', () => {
    const fn = web3Js.slice(web3Js.indexOf('async getUserRole'), web3Js.indexOf('async addDocumentOnChain'));
    assert.ok(fn.includes('return null'), 'getUserRole phải trả null khi lỗi');
    assert.ok(!/return\s+1\b/.test(fn), 'getUserRole không được trả role giả 1');
});

// =====================================================================
// I3 — BLACKLIST CÓ HẠN + TRUST PROXY
// =====================================================================
test('I3: IP ban có hạn (ipBans Map + BAN_MS), không còn blacklist vĩnh viễn', () => {
    assert.ok(serverJs.includes('ipBans'), 'server phải dùng ipBans có hạn');
    assert.ok(!serverJs.includes('blacklistedIPs.add'), 'không được ban vĩnh viễn');
    assert.ok(serverJs.includes("app.set('trust proxy', 1)"), 'server phải trust proxy cho req.ip đúng');
});

// =====================================================================
// KEY ESCROW — xem/tải file cho người có quyền
// =====================================================================
test('Key escrow: server bọc encKey bằng AES-256-GCM + endpoint key có check quyền', () => {
    assert.ok(serverJs.includes('wrapKey') && serverJs.includes('aes-256-gcm'), 'phải bọc key bằng AES-256-GCM');
    assert.ok(serverJs.includes("f.encKey ? wrapKey(f.encKey)"), 'POST /batches phải bọc encKey');
    const keyRoute = serverJs.slice(serverJs.indexOf("/api/documents/:docId/key"));
    assert.ok(keyRoute.includes('isUploader') && keyRoute.includes('rank < 3'), 'key endpoint: private chỉ uploader hoặc ADMIN');
    assert.ok(keyRoute.includes("'public'"), 'key endpoint: public cho mọi ví đã đăng nhập');
});

test('Key escrow: encKey KHÔNG bao giờ đi vào manifest IPFS', () => {
    const manifestLine = mainJs.split('\n').find(l => l.includes('manifestBlob'));
    assert.ok(!manifestLine.includes('uploadedDocs }'), 'manifest phải dùng publicFiles đã lọc encKey');
    assert.ok(mainJs.includes('({ encKey, ...rest })'), 'phải tách encKey ra khỏi publicFiles');
});

test('Key escrow: frontend dùng key escrow trước, fallback hỏi mật khẩu', () => {
    assert.ok(mainJs.includes('resolveDocKey'), 'phải có resolveDocKey');
    assert.ok(mainJs.includes('getDocumentKey'), 'phải gọi API lấy key');
    assert.ok(mainJs.includes('input: \'password\''), 'vẫn phải có fallback hỏi mật khẩu');
});

// =====================================================================
// I8 — DOWNLOAD: anchor download, không window.open sau await
// =====================================================================
test('I8: tải file bằng anchor download, không window.open(blob) sau async', () => {
    assert.ok(mainJs.includes('a.download'), 'phải có anchor download');
    assert.ok(mainJs.includes('previewDocument'), 'phải có previewDocument');
    // window.open chỉ được mở tab trắng ĐỒNG BỘ (với ''), KHÔNG mở blob URL sau await
    const opens = mainJs.match(/window\.open\([^)]*\)/g) || [];
    for (const o of opens) {
        assert.ok(o.includes("''"), `window.open chỉ được mở tab trắng: ${o}`);
    }
});

// =====================================================================
// I1 — VÍ XÓA KHÔNG HỒI SINH
// =====================================================================
test('I1: recovery loop bỏ qua ví có role on-chain = 0 (đã xóa/thu hồi)', () => {
    const rec = mainJs.slice(mainJs.indexOf('RoleAssigned'), mainJs.indexOf('RoleAssigned') + 3000);
    assert.ok(rec.includes('getUserRole'), 'recovery phải check role on-chain trước khi thêm ví');
    assert.ok(rec.includes('continue'), 'role 0/lỗi → skip, không hồi sinh');
});

// =====================================================================
// I7 — ADMIN KHÔNG HARDCODE
// =====================================================================
test('I7: isAdminSystem derive từ contract, không so sánh địa chỉ hardcode', () => {
    const adminCheck = mainJs.split('\n').find(l => l.includes('const isAdminSystem ='));
    assert.ok(!adminCheck.includes('0x8b10'), 'isAdminSystem không được hardcode địa chỉ ví');
});

// =====================================================================
// BACKEND PHỤ ĐỒNG BỘ
// =====================================================================
test('Backend phụ: whitelist encKey/ipfsCID/qrCode + rate limit + enum ĐÃ XÓA', { skip: !backend2Exists }, () => {
    assert.ok(backend2Server.includes('encKey'), 'backend phụ phải nhận encKey');
    assert.ok(backend2Server.includes('ipfsCID') && backend2Server.includes('qrCode'), 'backend phụ phải nhận ipfsCID/qrCode');
    assert.ok(backend2Server.includes('rateLimit'), 'backend phụ phải có rate limiter');
    assert.ok(backend2Server.includes('wrapKey'), 'backend phụ phải bọc key');
    assert.ok(backend2Wallet.includes("'ĐÃ XÓA'"), 'enum backend phụ phải có ĐÃ XÓA');
});

// =====================================================================
// INDEX.HTML — KHÔNG ID TRÙNG
// =====================================================================
test('index.html: không còn duplicate id', () => {
    const ids = [...indexHtml.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
    const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
    assert.deepEqual([...new Set(dup)], [], `Duplicate id còn lại: ${[...new Set(dup)].join(', ')}`);
});

// =====================================================================
// SCHEMA
// =====================================================================
test('Schema chính: files[] có encKey', () => {
    assert.ok(batchModel.includes('encKey'), 'Batch model phải có encKey');
});
