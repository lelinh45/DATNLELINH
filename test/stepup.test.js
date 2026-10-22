import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createAuth } from '../auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const serverJs = read('server.js');
const authJs = read('auth.js');
const apiJs = read('assets/js/apiService.js');
const mainJs = read('assets/js/main.js');
const walletModel = read('models/Wallet.js');

const JWT_SECRET = 'test-secret-stepup';
const walletOwner = ethers.Wallet.createRandom();
const walletAttacker = ethers.Wallet.createRandom();

const fakeWalletModel = {
    findOne: async ({ address }) => walletDb.get(address) || null,
};
const walletDb = new Map([
    [walletOwner.address.toLowerCase(), { role: 'ADMIN', status: 'ACTIVE', roleGranted: true }],
]);

let server, baseUrl, auth;

async function loginAs(wallet) {
    const chRes = await fetch(`${baseUrl}/api/auth/challenge?address=${wallet.address}`);
    const { challenge } = await chRes.json();
    const signature = await wallet.signMessage(challenge);
    const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: wallet.address, signature, challenge })
    });
    return (await res.json()).token;
}

async function stepSign(wallet, token) {
    const res = await fetch(`${baseUrl}/api/auth/step-challenge`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` }
    });
    const { challenge } = await res.json();
    return { stepChallenge: challenge, stepSignature: await wallet.signMessage(challenge) };
}

before(async () => {
    const app = express();
    app.use(express.json());
    auth = createAuth({ walletModel: fakeWalletModel, jwtSecret: JWT_SECRET });
    app.use('/api/auth', auth.router);
    app.post('/api/sensitive', auth.requireAuth, auth.requireStepUp, (req, res) => res.json({ ok: true }));
    server = app.listen(0);
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => server && server.close());

// =====================================================================
// STEP-UP AUTH — functional
// =====================================================================
test('step-challenge: không JWT → 401', async () => {
    const res = await fetch(`${baseUrl}/api/auth/step-challenge`, { method: 'POST' });
    assert.equal(res.status, 401);
});

test('step-challenge: trả challenge gắn đúng địa chỉ ví', async () => {
    const token = await loginAs(walletOwner);
    const res = await fetch(`${baseUrl}/api/auth/step-challenge`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` }
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.ok(body.challenge.includes(walletOwner.address.toLowerCase()));
    assert.ok(body.challenge.includes('XAC NHAN THAO TAC NHAY CAM'));
});

test('route nhạy cảm: chỉ có JWT không chữ ký → 403 STEP_UP_REQUIRED', async () => {
    const token = await loginAs(walletOwner);
    const res = await fetch(`${baseUrl}/api/sensitive`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({})
    });
    const body = await res.json();
    assert.equal(res.status, 403);
    assert.equal(body.code, 'STEP_UP_REQUIRED');
});

test('route nhạy cảm: ký bằng ví KHÁC → 403 (chặn kẻ mượn session)', async () => {
    const token = await loginAs(walletOwner);
    const step = await stepSign(walletAttacker, token); // challenge của owner nhưng kẻ lạ ký
    const res = await fetch(`${baseUrl}/api/sensitive`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(step)
    });
    assert.equal(res.status, 403);
});

test('route nhạy cảm: ký đúng chủ ví → 200; replay → 403 (nonce 1 lần)', async () => {
    const token = await loginAs(walletOwner);
    const step = await stepSign(walletOwner, token);
    const payload = JSON.stringify(step);
    const r1 = await fetch(`${baseUrl}/api/sensitive`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: payload
    });
    assert.equal(r1.status, 200);
    const r2 = await fetch(`${baseUrl}/api/sensitive`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: payload
    });
    assert.equal(r2.status, 403);
});

test('step challenge không đè challenge đăng nhập (key tách biệt)', async () => {
    // Lấy login challenge → lấy step challenge (cần JWT của phiên khác) → login challenge vẫn dùng được
    const chRes = await fetch(`${baseUrl}/api/auth/challenge?address=${walletAttacker.address}`);
    const { challenge } = await chRes.json();
    const ownerToken = await loginAs(walletOwner);
    await fetch(`${baseUrl}/api/auth/step-challenge`, { method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` } });
    // login challenge của attacker phải còn nguyên
    const sig = await walletAttacker.signMessage(challenge);
    const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: walletAttacker.address, signature: sig, challenge })
    });
    assert.equal(res.status, 200);
});

// =====================================================================
// CONSISTENCY — nguồn phải gắn step-up vào đúng 3 endpoint nhạy cảm
// =====================================================================
test('server: /api/sessions/approve + /api/sessions/revoke + /api/wallets/email đều qua requireStepUp', () => {
    for (const route of ["'/api/sessions/approve'", "'/api/sessions/revoke'", "'/api/wallets/email'"]) {
        const i = serverJs.indexOf(`app.post(${route}`);
        assert.ok(i > 0, `thiếu route ${route}`);
        const decl = serverJs.slice(i, i + 120);
        assert.ok(decl.includes('requireStepUp'), `${route} phải qua requireStepUp`);
    }
});

test('server: đổi email có sẵn phải gửi mã về email CŨ (pendingEmail + sendEmailChange)', () => {
    assert.ok(serverJs.includes('pendingEmail'), 'server phải dùng pendingEmail');
    assert.ok(serverJs.includes('mailer.sendEmailChange'), 'phải gửi mã qua sendEmailChange');
    assert.ok(serverJs.includes("'/api/wallets/email/confirm'"), 'phải có endpoint confirm');
    assert.ok(serverJs.includes('verifyOtpHash'), 'confirm phải verify scrypt hash');
});

test('Wallet model: có trường pendingEmail + emailChangeHash/Expires/Attempts', () => {
    for (const f of ['pendingEmail', 'emailChangeHash', 'emailChangeExpires', 'emailChangeAttempts']) {
        assert.ok(walletModel.includes(f), `Wallet thiếu ${f}`);
    }
});

test('auth.js: export requireStepUp + challenge step-up dùng-1-lần', () => {
    assert.ok(authJs.includes('/step-challenge'), 'thiếu route step-challenge');
    assert.ok(authJs.includes('requireStepUp'), 'thiếu middleware requireStepUp');
    assert.ok(authJs.includes("req.user.address + '|step'"), 'step challenge phải key riêng');
    assert.ok(authJs.includes('requireStepUp, getRoleRank'), 'phải export requireStepUp');
});

test('frontend: 3 thao tác nhạy cảm đều gửi stepSignature', () => {
    assert.ok(apiJs.includes('stepUpSign'), 'apiService thiếu stepUpSign');
    for (const fn of ['revokeSession', 'approveSession', 'setWalletContact']) {
        const i = apiJs.indexOf(`async ${fn}`);
        const body = apiJs.slice(i, i + 600);
        assert.ok(body.includes('...step'), `${fn} phải truyền step signature`);
    }
    assert.ok(apiJs.includes('confirmEmailChange'), 'thiếu confirmEmailChange');
    assert.ok(mainJs.includes('await stepUp()'), 'main.js phải ký step-up');
    assert.ok(mainJs.includes('saveContactWithConfirm'), 'main.js phải qua luồng confirm email');
});
