import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const envExample = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');

test('multer memoryStorage phải có giới hạn fileSize', () => {
    assert.match(server, /limits:\s*\{[^}]*fileSize:/, 'multer thiếu limits.fileSize — có thể bị nạp file khổng lồ vào RAM');
});

test('route upload/verify phải đi qua uploadSingle (trả 413 JSON)', () => {
    assert.ok(server.includes('uploadSingle'), 'thiếu wrapper uploadSingle');
    const uploadSig = server.slice(server.indexOf("app.post('/api/upload'"), server.indexOf("app.post('/api/upload'") + 250);
    const verifySig = server.slice(server.indexOf("app.post('/api/verify'"), server.indexOf("app.post('/api/verify'") + 250);
    assert.ok(uploadSig.includes("uploadSingle('document')"), '/api/upload chưa qua uploadSingle');
    assert.ok(verifySig.includes("uploadSingle('document')"), '/api/verify chưa qua uploadSingle');
});

test('CORS không được dùng wildcard mặc định', () => {
    assert.ok(!/app\.use\(cors\(\)\)/.test(server), 'cors() không tham số = wildcard, chấp nhận mọi origin');
    assert.ok(server.includes('CORS_ORIGINS'), 'thiếu allowlist CORS_ORIGINS');
});

test('/api/auth phải có rate limiter riêng (chống brute-force)', () => {
    assert.ok(server.includes('authLimiter'), 'thiếu authLimiter');
    assert.match(server, /app\.use\('\/api\/auth',\s*authLimiter\)/, 'authLimiter chưa mount lên /api/auth');
});

test('apiLimiter phải đủ rộng cho dashboard polling', () => {
    const m = server.match(/apiLimiter\s*=\s*rateLimit\(\{[^}]*max:\s*(\d+)/);
    assert.ok(m, 'không tìm thấy apiLimiter');
    assert.ok(Number(m[1]) >= 300, `apiLimiter max=${m[1]} quá chặt — dashboard poll ~180 req/15ph sẽ tự khóa`);
});

test('verify phải validate documentId trước khi gọi contract', () => {
    const verifyBlock = server.slice(server.indexOf("app.post('/api/verify'"), server.indexOf("app.get('/api/wallets'"));
    assert.ok(verifyBlock.includes('documentId'), 'route verify thiếu documentId');
    assert.match(verifyBlock, /typeof documentId !== 'string'\s*\|\|/, 'documentId chưa được validate kiểu/định dạng');
});

test('.env.example phải có đủ JWT_SECRET và CORS_ORIGINS', () => {
    assert.ok(envExample.includes('JWT_SECRET='), 'thiếu JWT_SECRET');
    assert.ok(envExample.includes('CORS_ORIGINS='), 'thiếu CORS_ORIGINS');
});
