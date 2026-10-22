import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const apiService = fs.readFileSync(path.join(ROOT, 'assets/js/apiService.js'), 'utf8');
const main = fs.readFileSync(path.join(ROOT, 'assets/js/main.js'), 'utf8');

// Badge "ĐỐI TÁC" phân biệt tài liệu upload qua API key (server ký hộ
// bằng ví ADMIN) với tài liệu ADMIN tự upload trên sổ cái.

test('server: có route GET /api/partner-docs', () => {
    assert.match(server, /app\.get\('\/api\/partner-docs'/);
});

test('server: /api/partner-docs yêu cầu đăng nhập + quyền xem', () => {
    const block = server.match(/app\.get\('\/api\/partner-docs'[\s\S]*?\}\);/)?.[0] || '';
    assert.match(block, /requireAuth/);
    assert.match(block, /requireViewer/);
});

test('server: /api/partner-docs trả map docId -> orgName từ PartnerDocument', () => {
    const block = server.match(/app\.get\('\/api\/partner-docs'[\s\S]*?\}\);/)?.[0] || '';
    assert.match(block, /PartnerDocument\.find/);
    assert.match(block, /partners\[d\.docId\]\s*=\s*d\.orgName/);
});

test('frontend: apiService có helper getPartnerDocs gọi /partner-docs kèm JWT', () => {
    assert.match(apiService, /getPartnerDocs/);
    const block = apiService.match(/getPartnerDocs[\s\S]*?\},/)?.[0] || '';
    assert.match(block, /\/partner-docs/);
    assert.match(block, /authHeaders\(\)/);
});

test('frontend: sổ cái render badge Đối tác qua window.partnerBadge', () => {
    assert.match(main, /window\.partnerBadge\s*=/);
    assert.match(main, /Đối tác ·/);
    assert.match(main, /partnerBadge\(partnerOrgs, docId\)/);
});

test('frontend: cả bảng đang hoạt động lẫn bảng đã thu hồi đều nạp partner map', () => {
    // loadTransactionHistory + loadRevokedHistory (+ openStorageModal) — chỗ nào
    // render doc cũng cần map để nhận diện tài liệu đối tác
    const fetches = main.match(/ApiService\.getPartnerDocs\(\)/g) || [];
    assert.ok(fetches.length >= 2, `cần >=2 chỗ nạp partner map, có ${fetches.length}`);
});

// ===== Cổng đối tác partner.html: login bằng API key, không cần ví =====

const partnerHtml = fs.readFileSync(path.join(ROOT, 'partner.html'), 'utf8');

test('server: có route GET /partner phục vụ cổng đối tác', () => {
    assert.match(server, /app\.get\('\/partner'/);
    assert.match(server, /partner\.html/);
});

test('partner portal: gọi API bằng header x-api-key', () => {
    assert.match(partnerHtml, /'x-api-key'/);
    // key giữ trong sessionStorage — không lưu localStorage/server
    assert.match(partnerHtml, /sessionStorage/);
});

test('partner portal: dùng đủ 4 endpoint /api/v1', () => {
    for (const ep of ['/api/v1/documents', '/api/v1/verify', '/download']) {
        assert.ok(partnerHtml.includes(ep), `thiếu ${ep}`);
    }
});
