import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildVersionChain } from '../lineage.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const batchModel = fs.readFileSync(path.join(ROOT, 'models/Batch.js'), 'utf8');

// ===== Dữ liệu giả: chuỗi phiên bản v1 → v2 → v3 + một tài liệu lẻ =====
const FILES = [
    { docId: 'doc-v1', fileName: 'hopdong_v1.pdf', isRevoked: true, replacesDocId: null, timestamp: 1000 },
    { docId: 'doc-v2', fileName: 'hopdong_v2.pdf', isRevoked: false, replacesDocId: 'doc-v1', timestamp: 2000 },
    { docId: 'doc-v3', fileName: 'hopdong_v3.pdf', isRevoked: false, replacesDocId: 'doc-v2', timestamp: 3000 },
    { docId: 'doc-le', fileName: 'bienban.pdf', isRevoked: false, replacesDocId: null, timestamp: 4000 },
];

test('buildVersionChain: docId không tồn tại → null', () => {
    assert.equal(buildVersionChain(FILES, 'doc-khong-co'), null);
});

test('buildVersionChain: query node giữa trả đủ chuỗi đúng thứ tự v1→v2→v3', () => {
    const r = buildVersionChain(FILES, 'doc-v2');
    assert.deepEqual(r.chain.map(n => n.docId), ['doc-v1', 'doc-v2', 'doc-v3']);
    assert.deepEqual(r.chain.map(n => n.version), [1, 2, 3]);
});

test('buildVersionChain: node cuối → isLatest, không có supersededBy', () => {
    const r = buildVersionChain(FILES, 'doc-v3');
    assert.equal(r.isLatest, true);
    assert.equal(r.supersededBy, null);
    assert.equal(r.latest.docId, 'doc-v3');
});

test('buildVersionChain: node giữa → supersededBy là node kế tiếp, latest là cuối chuỗi', () => {
    const r = buildVersionChain(FILES, 'doc-v2');
    assert.equal(r.isLatest, false);
    assert.equal(r.supersededBy.docId, 'doc-v3');
    assert.equal(r.latest.docId, 'doc-v3');
});

test('buildVersionChain: tài liệu lẻ (không phiên bản) → chuỗi 1 node, là latest', () => {
    const r = buildVersionChain(FILES, 'doc-le');
    assert.equal(r.chain.length, 1);
    assert.equal(r.isLatest, true);
    assert.equal(r.supersededBy, null);
});

test('buildVersionChain: vòng lặp replacesDocId không treo vô hạn', () => {
    const cyclic = [
        { docId: 'a', replacesDocId: 'b' },
        { docId: 'b', replacesDocId: 'a' },
    ];
    const r = buildVersionChain(cyclic, 'a');
    assert.ok(r.chain.length <= 2, 'chuỗi phải cắt khi gặp node đã duyệt');
});

// ===== Kiểm tra tĩnh điểm tích hợp =====

test('schema Batch.files[] phải có replacesDocId', () => {
    assert.match(batchModel, /replacesDocId\s*:/, 'files[] thiếu field liên kết phiên bản');
});

test('server phải có route GET /api/documents/:docId/lineage', () => {
    assert.match(server, /app\.get\('\/api\/documents\/:docId\/lineage'/, 'thiếu endpoint truy vết dòng đời');
});

test('/api/verify phải trả supersededBy khi tài liệu đã có bản mới', () => {
    const verifyBlock = server.slice(server.indexOf("app.post('/api/verify'"), server.indexOf("app.get('/api/wallets'"));
    assert.ok(verifyBlock.includes('supersededBy'), 'response verify thiếu cảnh báo bản cũ (supersededBy)');
});

test('/api/batches/revoke phải tự ghi con trỏ on-chain khi thu hồi bản đã bị thay thế', () => {
    const revokeBlock = server.slice(server.indexOf("app.post('/api/batches/revoke'"));
    assert.ok(revokeBlock.includes('replacesDocId') || revokeBlock.includes('Thay thế bởi'),
        'revoke chưa tự điền reason "Thay thế bởi <docId>" cho tài liệu có bản kế nhiệm');
});

// ===== Frontend (main.js / apiService.js) =====

const mainJs = fs.readFileSync(path.join(ROOT, 'assets/js/main.js'), 'utf8');
const apiService = fs.readFileSync(path.join(ROOT, 'assets/js/apiService.js'), 'utf8');

test('frontend: payload upload phải gửi replacesDocId', () => {
    assert.match(mainJs, /replacesDocId/, 'main.js chưa gửi trường liên kết phiên bản');
});

test('frontend: verify phải hiển thị cảnh báo supersededBy (bản cũ)', () => {
    assert.match(mainJs, /supersededBy/, 'main.js chưa xử lý cờ supersededBy từ /api/verify');
});

test('frontend: apiService phải có helper lấy lineage', () => {
    assert.match(apiService, /\/lineage/, 'apiService.js thiếu hàm gọi GET /api/documents/:docId/lineage');
});

test('frontend: dialog revoke phải gợi ý reason "Thay thế bởi" khi doc có bản mới', () => {
    const revokeBlock = mainJs.slice(mainJs.indexOf('window.revokeDoc'));
    assert.match(revokeBlock, /Thay thế bởi/, 'revokeDoc chưa prefill reason con trỏ phiên bản');
});
