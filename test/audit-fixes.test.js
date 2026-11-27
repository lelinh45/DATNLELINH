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
const configJs = read('assets/js/config.js');
const serverJs = read('server.js');

// =====================================================================
// C1 — START_BLOCK phải được định nghĩa (trước đây ReferenceError làm
// quét event on-chain crash → sổ cái trống với cache rỗng/contract mới)
// =====================================================================
test('C1: web3Service định nghĩa START_BLOCK từ CONFIG, không còn biến tự do', () => {
    assert.ok(configJs.includes('START_BLOCK'), 'config.js phải khai báo START_BLOCK');
    assert.ok(web3Js.includes('CONFIG.START_BLOCK'), 'web3Service phải đọc START_BLOCK từ CONFIG');
    // Không được còn nội suy biến START_BLOCK tự do (không khai báo trong file)
    assert.ok(web3Js.includes('const START_BLOCK = CONFIG.START_BLOCK'), 'START_BLOCK phải khai báo từ CONFIG trước khi dùng');
});

// =====================================================================
// H1 — Tab Verify trong app phải cảnh báo HẾT HẠN / CHỜ CHỮ KÝ / CÓ BẢN MỚI
// =====================================================================
test('H1: verify trong app đọc trạng thái v2 (expiresAt/sealed/threshold/successor)', () => {
    assert.ok(mainJs.includes('chainStateHtml'), 'phải có block cảnh báo trạng thái chuỗi');
    assert.ok(mainJs.includes('docData[7]'), 'phải đọc expiresAt');
    assert.ok(mainJs.includes('docData[10]'), 'phải đọc isSealed');
    assert.ok(mainJs.includes('getSuccessor'), 'phải tra successorOf on-chain');
    assert.ok(mainJs.includes('getSealStatus'), 'doc PENDING phải đếm chữ ký off-chain qua seal-status');
});

// =====================================================================
// H2 — MetaMask listeners: đổi ví → xóa JWT + reload; đổi mạng → cảnh báo
// =====================================================================
test('H2: web3Service đăng ký accountsChanged/chainChanged đúng 1 lần', () => {
    assert.ok(web3Js.includes("_bindWalletListeners"), 'phải có hàm bind listeners');
    assert.ok(web3Js.includes('_listenersBound'), 'phải chống gắn listener trùng');
    assert.ok(web3Js.includes("accountsChanged"), 'phải lắng nghe accountsChanged');
    assert.ok(web3Js.includes("chainChanged"), 'phải lắng nghe chainChanged');
    assert.ok(web3Js.includes('ApiService.logout'), 'đổi ví phải xóa JWT trước khi reload');
});

// =====================================================================
// M1 — sign/seal pending phải khóa isProcessing chống double-click
// =====================================================================
test('M1: signPendingSeal/sealPendingSeal bọc isProcessing trong finally', () => {
    for (const fn of ['window.signPendingSeal = async', 'window.sealPendingSeal = async']) {
        const start = mainJs.indexOf(fn);
        assert.ok(start > 0, `Không tìm thấy ${fn}`);
        const body = mainJs.slice(start, start + 6000);
        assert.ok(body.includes('isProcessing = true'), `${fn} phải set isProcessing`);
        assert.ok(body.includes('isProcessing = false'), `${fn} phải reset isProcessing`);
        assert.ok(/finally\s*\{[^}]*isProcessing = false/.test(body), `${fn} phải reset trong finally`);
    }
});

// =====================================================================
// M2 — /api/documents/:docId/key phải requireViewer (rank 0 không lấy được)
// =====================================================================
test('M2: endpoint /key yêu cầu requireViewer, không chỉ requireAuth', () => {
    const route = serverJs.slice(serverJs.indexOf("/api/documents/:docId/key"));
    const sig = route.slice(0, 200);
    assert.ok(sig.includes('requireAuth'), '/key phải requireAuth');
    assert.ok(sig.includes('requireViewer'), '/key phải requireViewer — rank 0 bị chặn');
});

// =====================================================================
// M3 — /api/documents/:docId/status phải requireAuth (không caller public)
// =====================================================================
test('M3: endpoint /status yêu cầu đăng nhập', () => {
    const route = serverJs.slice(serverJs.indexOf("/api/documents/:docId/status"));
    const sig = route.slice(0, 200);
    assert.ok(sig.includes('requireAuth'), '/status phải requireAuth');
});

// =====================================================================
// M4 — Gemini forensic phải có timeout, rơi về fallback êm
// =====================================================================
test('M4: lời gọi Gemini trong /api/verify có timeout Promise.race', () => {
    const start = serverJs.indexOf('ai.models.generateContent');
    assert.ok(start > 0, 'Không tìm thấy lời gọi Gemini');
    const around = serverJs.slice(Math.max(0, start - 600), start + 600);
    assert.ok(around.includes('Promise.race'), 'Gemini phải chạy trong Promise.race');
    assert.ok(/setTimeout\(.*10000|10000.*setTimeout/s.test(around), 'phải có timeout 10s');
    assert.ok(around.includes('aiForensicReport'), 'fallback text phải được gán');
});
