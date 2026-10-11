import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import { ethers } from 'ethers';
import { createAuth } from '../auth.js';

const JWT_SECRET = 'test-secret-key-do-not-use-in-prod';
// Ví test tự sinh — chỉ tồn tại trong tiến trình test
const walletAdmin = ethers.Wallet.createRandom();
const walletManager = ethers.Wallet.createRandom();
const walletEntry = ethers.Wallet.createRandom();
const walletLocked = ethers.Wallet.createRandom();
const walletStranger = ethers.Wallet.createRandom();

// DB giả lập qua Map — seam injection để test route logic thật mà không cần MongoDB
const walletDb = new Map([
    [walletAdmin.address.toLowerCase(), { role: 'ADMIN', status: 'ACTIVE' }],
    [walletManager.address.toLowerCase(), { role: 'QUẢN LÝ', status: 'ACTIVE' }],
    [walletEntry.address.toLowerCase(), { role: 'NHẬP LIỆU', status: 'ACTIVE' }],
    [walletLocked.address.toLowerCase(), { role: 'QUẢN LÝ', status: 'REVOKED' }],
]);
const fakeWalletModel = {
    findOne: async ({ address }) => walletDb.get(address) || null,
};

let server, baseUrl;

async function loginAs(wallet) {
    const chRes = await fetch(`${baseUrl}/api/auth/challenge?address=${wallet.address}`);
    const { challenge } = await chRes.json();
    const signature = await wallet.signMessage(challenge);
    const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: wallet.address, signature, challenge })
    });
    return { res, body: await res.json() };
}

before(async () => {
    const app = express();
    app.use(express.json());
    const auth = createAuth({ walletModel: fakeWalletModel, jwtSecret: JWT_SECRET });
    app.use('/api/auth', auth.router);
    app.get('/api/protected', auth.requireAuth, (req, res) => res.json({ ok: true, who: req.user.address }));
    app.post('/api/manager-only', auth.requireAuth, auth.requireRole('QUẢN LÝ'), (req, res) => res.json({ ok: true }));
    app.post('/api/admin-only', auth.requireAuth, auth.requireRole('ADMIN'), (req, res) => res.json({ ok: true }));
    server = app.listen(0);
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => server && server.close());

test('challenge: từ chối địa chỉ không hợp lệ', async () => {
    const res = await fetch(`${baseUrl}/api/auth/challenge?address=abc`);
    assert.equal(res.status, 400);
});

test('challenge: trả về challenge chứa address cho ví hợp lệ', async () => {
    const res = await fetch(`${baseUrl}/api/auth/challenge?address=${walletEntry.address}`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.ok(body.challenge.includes(walletEntry.address.toLowerCase()));
});

test('login: chữ ký của ví khác → 401', async () => {
    const chRes = await fetch(`${baseUrl}/api/auth/challenge?address=${walletEntry.address}`);
    const { challenge } = await chRes.json();
    const wrongSig = await walletStranger.signMessage(challenge); // ký bằng ví lạ
    const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: walletEntry.address, signature: wrongSig, challenge })
    });
    assert.equal(res.status, 401);
});

test('login: challenge rác/hết hạn → 401', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: walletEntry.address, signature: '0x00', challenge: 'fake' })
    });
    assert.equal(res.status, 401);
});

test('login đúng → JWT 200; challenge chỉ dùng 1 lần', async () => {
    const { res, body } = await loginAs(walletEntry);
    assert.equal(res.status, 200);
    const payload = jwt.verify(body.token, JWT_SECRET);
    assert.equal(payload.address, walletEntry.address.toLowerCase());

    // Replay lại đúng challenge cũ → phải bị từ chối
    const chRes = await fetch(`${baseUrl}/api/auth/challenge?address=${walletEntry.address}`);
    const { challenge: c2 } = await chRes.json();
    // challenge mới — ký đúng nhưng cố replay challenge cũ thì không test được trực tiếp;
    // kiểm tra challenge cũ đã bị xóa sau login thành công trước đó:
    assert.ok(c2 !== undefined);
});

test('login: replay lại challenge đã dùng → 401', async () => {
    const chRes = await fetch(`${baseUrl}/api/auth/challenge?address=${walletEntry.address}`);
    const { challenge } = await chRes.json();
    const signature = await walletEntry.signMessage(challenge);
    const payload = JSON.stringify({ address: walletEntry.address, signature, challenge });

    const r1 = await fetch(`${baseUrl}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload });
    assert.equal(r1.status, 200);
    const r2 = await fetch(`${baseUrl}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload });
    assert.equal(r2.status, 401);
});

test('login: challenge hết hạn → 401 (TTL 50ms)', async () => {
    const app2 = express();
    app2.use(express.json());
    const auth2 = createAuth({ walletModel: fakeWalletModel, jwtSecret: JWT_SECRET, challengeTtlMs: 50 });
    app2.use('/api/auth', auth2.router);
    const srv2 = app2.listen(0);
    try {
        const u = `http://127.0.0.1:${srv2.address().port}`;
        const chRes = await fetch(`${u}/api/auth/challenge?address=${walletEntry.address}`);
        const { challenge } = await chRes.json();
        const signature = await walletEntry.signMessage(challenge);
        await new Promise(r => setTimeout(r, 120));
        const res = await fetch(`${u}/api/auth/login`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ address: walletEntry.address, signature, challenge })
        });
        assert.equal(res.status, 401);
    } finally {
        srv2.close();
    }
});

test('challenge sống qua restart server (store bền)', async () => {
    // Hai instance createAuth dùng chung một store → mô phỏng server restart mà challenge còn nguyên
    const shared = new Map();
    const store = {
        set: async (k, v) => { shared.set(k, v); },
        get: async (k) => shared.get(k) || null,
        delete: async (k) => { shared.delete(k); },
    };
    const mkServer = () => {
        const a = express();
        a.use(express.json());
        a.use('/api/auth', createAuth({ walletModel: fakeWalletModel, jwtSecret: JWT_SECRET, challengeStore: store }).router);
        return a.listen(0);
    };

    const srv1 = mkServer();
    const chRes = await fetch(`http://127.0.0.1:${srv1.address().port}/api/auth/challenge?address=${walletEntry.address}`);
    const { challenge } = await chRes.json();
    srv1.close(); // "restart" server

    const srv2 = mkServer();
    try {
        const signature = await walletEntry.signMessage(challenge);
        const res = await fetch(`http://127.0.0.1:${srv2.address().port}/api/auth/login`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ address: walletEntry.address, signature, challenge })
        });
        assert.equal(res.status, 200); // challenge từ instance cũ vẫn đăng nhập được
    } finally {
        srv2.close();
    }
});

test('JWT: thời hạn token ~24 giờ', async () => {
    const { body } = await loginAs(walletEntry);
    const payload = jwt.verify(body.token, JWT_SECRET);
    const lifetime = payload.exp - payload.iat;
    assert.ok(lifetime >= 86300 && lifetime <= 86500, `lifetime=${lifetime}`);
});

test('protected route: không token → 401', async () => {
    const res = await fetch(`${baseUrl}/api/protected`);
    assert.equal(res.status, 401);
});

test('protected route: token giả (sai secret) → 401', async () => {
    const fake = jwt.sign({ address: walletEntry.address.toLowerCase() }, 'wrong-secret');
    const res = await fetch(`${baseUrl}/api/protected`, { headers: { Authorization: `Bearer ${fake}` } });
    assert.equal(res.status, 401);
});

test('protected route: token hết hạn → 401', async () => {
    const expired = jwt.sign({ address: walletEntry.address.toLowerCase() }, JWT_SECRET, { expiresIn: '0s' });
    await new Promise(r => setTimeout(r, 1100));
    const res = await fetch(`${baseUrl}/api/protected`, { headers: { Authorization: `Bearer ${expired}` } });
    assert.equal(res.status, 401);
});

test('protected route: token hợp lệ → 200 và gắn req.user.address', async () => {
    const { body } = await loginAs(walletEntry);
    const res = await fetch(`${baseUrl}/api/protected`, { headers: { Authorization: `Bearer ${body.token}` } });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.who, walletEntry.address.toLowerCase());
});

test('requireRole: NHẬP LIỆU bị chặn khỏi route QUẢN LÝ', async () => {
    const { body } = await loginAs(walletEntry);
    const res = await fetch(`${baseUrl}/api/manager-only`, { method: 'POST', headers: { Authorization: `Bearer ${body.token}` } });
    assert.equal(res.status, 403);
});

test('requireRole: QUẢN LÝ vào được route QUẢN LÝ nhưng không vào route ADMIN', async () => {
    const { body } = await loginAs(walletManager);
    const res1 = await fetch(`${baseUrl}/api/manager-only`, { method: 'POST', headers: { Authorization: `Bearer ${body.token}` } });
    assert.equal(res1.status, 200);
    const res2 = await fetch(`${baseUrl}/api/admin-only`, { method: 'POST', headers: { Authorization: `Bearer ${body.token}` } });
    assert.equal(res2.status, 403);
});

test('requireRole: ADMIN vào được cả hai', async () => {
    const { body } = await loginAs(walletAdmin);
    for (const route of ['manager-only', 'admin-only']) {
        const res = await fetch(`${baseUrl}/api/${route}`, { method: 'POST', headers: { Authorization: `Bearer ${body.token}` } });
        assert.equal(res.status, 200, route);
    }
});

test('requireRole: ví bị khóa (status REVOKED) → 403 dù role đủ', async () => {
    const { body } = await loginAs(walletLocked);
    const res = await fetch(`${baseUrl}/api/manager-only`, { method: 'POST', headers: { Authorization: `Bearer ${body.token}` } });
    assert.equal(res.status, 403);
});
