import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url)) + '/..';
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

// Dạng token Telegram bot: "<8-12 số>:<35 ký tự>" — pattern chung, KHÔNG nhúng secret thật vào test
const TELEGRAM_TOKEN_RE = /\d{8,12}:[A-Za-z0-9_-]{30,}/;
const PINATA_KEY_ASSIGN_RE = /PINATA_(API|SECRET)_KEY\s*=\s*["'][A-Za-z0-9]{16,}["']/;
const HEX_SECRET_RE = /["'][0-9a-f]{64}["']/;

const SERVER_FILES = ['server.js'];
const CLIENT_FILES = ['assets/js/main.js', 'assets/js/apiService.js', 'index.html'];

test('server.js không chứa Telegram token hardcode', () => {
    const src = read('server.js');
    assert.equal(TELEGRAM_TOKEN_RE.test(src), false, 'Telegram bot token literal còn nằm trong server.js');
});

test('server.js đọc Telegram credentials từ process.env', () => {
    const src = read('server.js');
    assert.ok(src.includes('process.env.TELEGRAM_TOKEN'), 'server.js phải đọc TELEGRAM_TOKEN từ env');
    assert.ok(src.includes('process.env.TELEGRAM_CHAT_ID'), 'server.js phải đọc TELEGRAM_CHAT_ID từ env');
});

test('client không chứa secret nào (Telegram token, Pinata keys, hex secret)', () => {
    for (const f of CLIENT_FILES) {
        const src = read(f);
        assert.equal(TELEGRAM_TOKEN_RE.test(src), false, `${f}: còn Telegram token literal`);
        assert.equal(PINATA_KEY_ASSIGN_RE.test(src), false, `${f}: còn Pinata key literal`);
        assert.equal(HEX_SECRET_RE.test(src), false, `${f}: còn 64-hex secret literal`);
    }
});

test('frontend không gọi thẳng api.telegram.org / api.pinata.cloud', () => {
    for (const f of CLIENT_FILES) {
        const src = read(f);
        assert.ok(!src.includes('api.telegram.org'), `${f}: frontend không được gọi Telegram trực tiếp (lộ token)`);
        assert.ok(!src.includes('api.pinata.cloud'), `${f}: frontend không được pin trực tiếp (lộ secret key)`);
        assert.ok(!src.includes('pinata_secret_api_key'), `${f}: frontend không được gửi pinata_secret_api_key`);
    }
});

test('uploadFileWithProgress đi qua backend (CONFIG.API_BASE), không phải Pinata', () => {
    const src = read('assets/js/apiService.js');
    const start = src.indexOf('uploadFileWithProgress');
    const end = src.indexOf('verifyWithBackend');
    const fnBody = src.slice(start, end);
    assert.ok(fnBody.includes('CONFIG.API_BASE'), 'uploadFileWithProgress phải POST qua CONFIG.API_BASE');
    assert.ok(fnBody.includes('/upload'), 'uploadFileWithProgress phải gọi endpoint /api/upload');
    assert.ok(!fnBody.includes('pinata'), 'uploadFileWithProgress không được chứa tham chiếu Pinata');
});
