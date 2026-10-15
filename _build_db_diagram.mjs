// Sinh sơ đồ ER kiểu crow's foot cổ điển cho CSDL MongoDB → _screenshots/so-do-2-7-er.svg
// Chay: node _build_db_diagram.mjs
import fs from 'fs';

const HEADER_H = 28, PK_H = 22, ROW_H = 21;

// attrs: [ten, ghi-chu?, 'FK'|'UK'|undefined]
const ENTITIES = {
    WALLETS: {
        x: 350, y: 140, w: 275, pk: '_id',
        attrs: [
            ['address', 'khóa nghiệp vụ', 'UK'],
            ['alias'], ['email', 'nhận OTP thiết bị'], ['phone'],
            ['role', '6 giá trị enum'], ['requestedRole'],
            ['status', 'ACTIVE/REVOKED/DELETED'],
            ['rejected'], ['rejectCount', '≥3 → chặn 30 phút'],
            ['rejectBlockedUntil', 'mốc ms'], ['roleGranted', 'ADMIN gán'],
            ['storageUsed', 'MB'], ['storageLimit', '1024 MB'], ['lastActive'],
        ],
    },
    DEVICE_SESSIONS: {
        x: 30, y: 50, w: 275, pk: '_id',
        attrs: [
            ['address', null, 'FK'], ['deviceId', 'UK cùng address'],
            ['deviceLabel'], ['ip'], ['userAgent'],
            ['status', 'pending/active/revoked'],
            ['createdAt'], ['lastSeen'],
            ['otpHash', 'chỉ lưu hash'], ['otpExpires'], ['otpAttempts'],
            ['otpFailed', 'SMTP chết → chờ 24h'],
        ],
    },
    AUTH_CHALLENGES: {
        x: 30, y: 430, w: 275, pk: '_id',
        attrs: [
            ['address', null, 'UK'], ['challenge', 'nonce ký một lần'],
            ['expiresAt', 'TTL — tự xóa'],
        ],
    },
    NOTIFICATIONS: {
        x: 350, y: 570, w: 275, pk: '_id',
        attrs: [
            ['address', null, 'FK'], ['type', '8 loại enum'],
            ['title'], ['message'], ['meta', 'Mixed'], ['read'], ['createdAt'],
        ],
    },
    BATCHES: {
        x: 725, y: 50, w: 265, pk: '_id',
        attrs: [
            ['batchId', null, 'UK'], ['merkleRoot'], ['ipfsCID', 'manifest lô'],
            ['txHash', 'on-chain'], ['uploader', null, 'FK'], ['timestamp'],
        ],
    },
    BATCH_FILES: {
        x: 725, y: 320, w: 275, pk: '_id',
        attrs: [
            ['docId'], ['fileName'], ['fileHash', 'SHA-256'], ['fileSize'],
            ['ipfsCID', 'ciphertext'], ['qrCode', 'docId'],
            ['encKey', 'bọc MASTER_KEY (GCM)'],
            ['visibility', 'private/public'], ['chunkHashes[]', 'CTPH ~16KB/đoạn'],
            ['isRevoked'], ['revocationReason'], ['revokedBy'], ['revokedAt'],
        ],
    },
    API_KEYS: {
        x: 1100, y: 50, w: 265, pk: '_id',
        attrs: [
            ['name'], ['keyHash', 'sha256(token)', 'UK'],
            ['prefix', 'sk_live_…'], ['createdBy', null, 'FK'],
            ['revoked'], ['lastUsedAt'],
            ['createdAt, updatedAt', 'timestamps'],
        ],
    },
    PARTNER_DOCUMENTS: {
        x: 1100, y: 360, w: 275, pk: '_id',
        attrs: [
            ['docId', null, 'UK'], ['apiKeyId', 'ref thật', 'FK'], ['orgName'],
            ['fileName'], ['fileHash', 'SHA-256'], ['fileSize'], ['ipfsCID'],
            ['encKey', 'bọc MASTER_KEY'], ['txHash', 'server ký thay'],
            ['isRevoked'], ['revocationReason'],
            ['createdAt, updatedAt', 'timestamps'],
        ],
    },
};

const H = n => HEADER_H + PK_H + n * ROW_H;
const E = {};
for (const [name, e] of Object.entries(ENTITIES)) E[name] = { ...e, h: H(e.attrs.length) };

function box(name) {
    const e = E[name];
    const cx = e.x + e.w / 2;
    let s = '';
    s += `<rect x="${e.x}" y="${e.y}" width="${e.w}" height="${e.h}" fill="#fff" stroke="#000" stroke-width="1.2"/>`;
    s += `<rect x="${e.x}" y="${e.y}" width="${e.w}" height="${HEADER_H}" fill="#b7b7b7" stroke="#000" stroke-width="1.2"/>`;
    s += `<text x="${cx}" y="${e.y + 18}" text-anchor="middle" font-size="13" font-weight="bold">${name}</text>`;
    const pkY = e.y + HEADER_H;
    s += `<line x1="${e.x}" y1="${pkY + PK_H}" x2="${e.x + e.w}" y2="${pkY + PK_H}" stroke="#000" stroke-width="1.2"/>`;
    s += `<line x1="${e.x + 34}" y1="${pkY}" x2="${e.x + 34}" y2="${pkY + PK_H}" stroke="#000" stroke-width="1"/>`;
    s += `<text x="${e.x + 17}" y="${pkY + 15}" text-anchor="middle" font-size="11">PK</text>`;
    s += `<text x="${e.x + 42}" y="${pkY + 15}" font-size="11" font-weight="bold" text-decoration="underline">${e.pk}</text>`;
    e.attrs.forEach(([f, note, kind], i) => {
        const y = pkY + PK_H + i * ROW_H + 15;
        const bold = kind === 'FK' ? ' font-weight="bold"' : '';
        s += `<text x="${e.x + 8}" y="${y}" font-size="11"${bold}>${f}${kind === 'UK' ? ' (UK)' : ''}${note ? ` <tspan fill="#555" font-style="italic" font-weight="normal">${note}</tspan>` : ''}</text>`;
    });
    return s;
}

// out = hướng RA khỏi cạnh entity: 'L' cạnh trái, 'R' cạnh phải, 'U' cạnh trên, 'D' cạnh dưới
const OUT = { L: [-1, 0], R: [1, 0], U: [0, -1], D: [0, 1] };

function markOne(x, y, out) { // || — đúng một
    const [dx, dy] = OUT[out], [px, py] = [-dy, dx];
    let s = '';
    for (const k of [5, 10])
        s += `<line x1="${x + dx * k - px * 7}" y1="${y + dy * k - py * 7}" x2="${x + dx * k + px * 7}" y2="${y + dy * k + py * 7}" stroke="#000" stroke-width="1.4"/>`;
    return s;
}
function foot(x, y, out) { // chân quạt tại đầu "nhiều" — prongs chạm cạnh entity
    const [dx, dy] = OUT[out], [px, py] = [-dy, dx];
    const jx = x + dx * 13, jy = y + dy * 13;
    return `<line x1="${jx}" y1="${jy}" x2="${x + px * 8}" y2="${y + py * 8}" stroke="#000"/>` +
        `<line x1="${jx}" y1="${jy}" x2="${x}" y2="${y}" stroke="#000"/>` +
        `<line x1="${jx}" y1="${jy}" x2="${x - px * 8}" y2="${y - py * 8}" stroke="#000"/>`;
}
function circle(x, y, out, d) {
    const [dx, dy] = OUT[out];
    return `<circle cx="${x + dx * d}" cy="${y + dy * d}" r="4" fill="#fff" stroke="#000"/>`;
}
function markOptOne(x, y, out) { // o| — không hoặc một
    const [dx, dy] = OUT[out], [px, py] = [-dy, dx];
    return `<line x1="${x + dx * 6 - px * 7}" y1="${y + dy * 6 - py * 7}" x2="${x + dx * 6 + px * 7}" y2="${y + dy * 6 + py * 7}" stroke="#000" stroke-width="1.4"/>` +
        circle(x, y, out, 15);
}
function markOptMany(x, y, out) { // o + chân quạt — không hoặc nhiều
    return foot(x, y, out) + circle(x, y, out, 26);
}
function markReqMany(x, y, out) { // | + chân quạt — một hoặc nhiều
    const [dx, dy] = OUT[out], [px, py] = [-dy, dx];
    const k = 26;
    return foot(x, y, out) +
        `<line x1="${x + dx * k - px * 7}" y1="${y + dy * k - py * 7}" x2="${x + dx * k + px * 7}" y2="${y + dy * k + py * 7}" stroke="#000" stroke-width="1.4"/>`;
}
function path(pts, dashed) {
    return `<path d="M${pts.map(p => p.join(' ')).join(' L')}" fill="none" stroke="#000" stroke-width="1.2"${dashed ? ' stroke-dasharray="6 4"' : ''}/>`;
}
function card(x, y, txt) {
    return `<text x="${x}" y="${y}" font-size="11" font-style="italic">${txt}</text>`;
}

const W = E.WALLETS, DS = E.DEVICE_SESSIONS, AC = E.AUTH_CHALLENGES,
    N = E.NOTIFICATIONS, B = E.BATCHES, BF = E.BATCH_FILES,
    AK = E.API_KEYS, PD = E.PARTNER_DOCUMENTS;

// Mọi cạnh nối ngang hoặc dọc thẳng (không đường chéo); nhãn bản số ở hai đầu
let edges = '';
// WALLETS 1 — 0..N DEVICE_SESSIONS (ngang, cạnh trái W ↔ cạnh phải DS)
edges += path([[W.x, 200], [DS.x + DS.w, 200]]);
edges += markOne(W.x, 200, 'L') + markOptMany(DS.x + DS.w, 200, 'R');
edges += card(339, 191, '1') + card(319, 190, 'N');
// WALLETS 1 — 0..1 AUTH_CHALLENGES (ngang)
edges += path([[W.x, 450], [AC.x + AC.w, 450]]);
edges += markOne(W.x, 450, 'L') + markOptOne(AC.x + AC.w, 450, 'R');
edges += card(339, 441, '1') + card(306, 468, '0..1');
// WALLETS 1 — 0..N NOTIFICATIONS (dọc, cạnh dưới W ↔ cạnh trên N)
edges += path([[W.x + 137, W.y + W.h], [N.x + 137, N.y]]);
edges += markOne(W.x + 137, W.y + W.h, 'D') + markOptMany(N.x + 137, N.y, 'U');
edges += card(W.x + 142, W.y + W.h + 16, '1') + card(N.x + 142, N.y - 24, 'N');
// WALLETS 1 — 0..N BATCHES (ngang, cạnh phải W ↔ cạnh trái B)
edges += path([[W.x + W.w, 180], [B.x, 180]]);
edges += markOne(W.x + W.w, 180, 'R') + markOptMany(B.x, 180, 'L');
edges += card(631, 171, '1') + card(707, 168, 'N');
// WALLETS 1 — 0..N API_KEYS (ngang thẳng qua hành lang giữa BATCHES và BATCH_FILES)
edges += path([[W.x + W.w, 235], [AK.x, 235]]);
edges += markOne(W.x + W.w, 235, 'R') + markOptMany(AK.x, 235, 'L');
edges += card(631, 226, '1') + card(1078, 226, 'N');
// BATCHES 1 — 1..N BATCH_FILES (dọc, nét đứt — document nhúng)
edges += path([[B.x + 132, B.y + B.h], [BF.x + 132, BF.y]], true);
edges += markOne(B.x + 132, B.y + B.h, 'D') + markReqMany(BF.x + 132, BF.y, 'U');
edges += card(B.x + 137, B.y + B.h + 16, '1') + card(BF.x + 145, BF.y - 6, '1..N');
// API_KEYS 1 — 0..N PARTNER_DOCUMENTS (dọc)
edges += path([[AK.x + 132, AK.y + AK.h], [PD.x + 132, PD.y]]);
edges += markOne(AK.x + 132, AK.y + AK.h, 'D') + markOptMany(PD.x + 132, PD.y, 'U');
edges += card(AK.x + 137, AK.y + AK.h + 16, '1') + card(PD.x + 137, PD.y - 24, 'N');

const CW = 1420, CH = 800;
const legend = `<g font-size="11" fill="#000">
  <text x="30" y="${CH - 14}">Chú thích: <tspan font-weight="bold" text-decoration="underline">gạch chân</tspan> = khóa chính · <tspan font-weight="bold">chữ đậm</tspan> = trường tham chiếu (quan hệ logic — MongoDB không có khóa ngoại vật lý) · || = đúng một · o| = không hoặc một · o+quạt = không hoặc nhiều · |+quạt = một hoặc nhiều · nét đứt = document nhúng · (UK) = unique</text>
</g>`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CW} ${CH}" font-family="Times New Roman, Times, serif">
<rect width="${CW}" height="${CH}" fill="#fff"/>
${edges}
${Object.keys(ENTITIES).map(box).join('\n')}
${legend}
</svg>`;

fs.writeFileSync('_screenshots/so-do-2-7-er.svg', svg);
console.log('Saved _screenshots/so-do-2-7-er.svg —', CW + 'x' + CH);
