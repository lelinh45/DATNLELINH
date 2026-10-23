// Sinh sơ đồ quan hệ CSDL MongoDB (mũi tên + bản số 1-n, khổ dọc) → _screenshots/so-do-2-7-er.svg
// Chay: node _build_db_diagram.mjs
import fs from 'fs';

const HEADER_H = 28, PK_H = 24, ROW_H = 22;

// attrs: [ten, ghi-chu?, 'FK'|'UK'|undefined]
const ENTITIES = {
    WALLETS: {
        x: 420, y: 420, w: 300, pk: '_id',
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
        x: 40, y: 70, w: 290, pk: '_id',
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
        x: 40, y: 480, w: 290, pk: '_id',
        attrs: [
            ['address', null, 'UK'], ['challenge', 'nonce ký một lần'],
            ['expiresAt', 'TTL — tự xóa'],
        ],
    },
    NOTIFICATIONS: {
        x: 40, y: 710, w: 290, pk: '_id',
        attrs: [
            ['address', null, 'FK'], ['type', '8 loại enum'],
            ['title'], ['message'], ['meta', 'Mixed'], ['read'], ['createdAt'],
        ],
    },
    BATCHES: {
        x: 850, y: 70, w: 270, pk: '_id',
        attrs: [
            ['batchId', null, 'UK'], ['merkleRoot'], ['ipfsCID', 'manifest lô'],
            ['txHash', 'on-chain'], ['uploader', null, 'FK'], ['timestamp'],
        ],
    },
    BATCH_FILES: {
        x: 850, y: 360, w: 290, pk: '_id',
        attrs: [
            ['docId'], ['fileName'], ['fileHash', 'SHA-256'], ['fileSize'],
            ['ipfsCID', 'ciphertext'], ['qrCode', 'docId'],
            ['encKey', 'bọc MASTER_KEY (GCM)'],
            ['visibility', 'private/public'], ['chunkHashes[]', 'CTPH ~16KB/đoạn'],
            ['isRevoked'], ['revocationReason'], ['revokedBy'], ['revokedAt'],
        ],
    },
    API_KEYS: {
        x: 850, y: 800, w: 280, pk: '_id',
        attrs: [
            ['name'], ['keyHash', 'sha256(token)', 'UK'],
            ['prefix', 'sk_live_…'], ['createdBy', null, 'FK'],
            ['revoked'], ['lastUsedAt'],
            ['createdAt, updatedAt', 'timestamps'],
        ],
    },
    PARTNER_DOCUMENTS: {
        x: 420, y: 960, w: 290, pk: '_id',
        attrs: [
            ['docId', null, 'UK'], ['apiKeyId', 'ref thật', 'FK'], ['orgName'],
            ['fileName'], ['fileHash', 'SHA-256'], ['fileSize'], ['ipfsCID'],
            ['encKey', 'bọc MASTER_KEY'], ['txHash', 'server ký thay'],
            ['refDocId', 'trỏ docId gốc khi dùng chung'],
            ['isSharedRef', 'tham chiếu bằng chứng chung'],
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
    s += `<text x="${cx}" y="${e.y + 19}" text-anchor="middle" font-size="13.5" font-weight="bold">${name}</text>`;
    const pkY = e.y + HEADER_H;
    s += `<line x1="${e.x}" y1="${pkY + PK_H}" x2="${e.x + e.w}" y2="${pkY + PK_H}" stroke="#000" stroke-width="1.2"/>`;
    s += `<line x1="${e.x + 36}" y1="${pkY}" x2="${e.x + 36}" y2="${pkY + PK_H}" stroke="#000" stroke-width="1"/>`;
    s += `<text x="${e.x + 18}" y="${pkY + 16}" text-anchor="middle" font-size="11.5">PK</text>`;
    s += `<text x="${e.x + 46}" y="${pkY + 16}" font-size="11.5" font-weight="bold" text-decoration="underline">${e.pk}</text>`;
    e.attrs.forEach(([f, note, kind], i) => {
        const y = pkY + PK_H + i * ROW_H + 16;
        const bold = kind === 'FK' ? ' font-weight="bold"' : '';
        s += `<text x="${e.x + 10}" y="${y}" font-size="11.5"${bold}>${f}${kind === 'UK' ? ' (UK)' : ''}${note ? ` <tspan fill="#777" font-style="italic" font-size="10" font-weight="normal">— ${note}</tspan>` : ''}</text>`;
    });
    return s;
}

// out = hướng RA khỏi cạnh entity chứa đầu mũi tên: 'L' cạnh trái, 'R' phải, 'U' trên, 'D' dưới
const OUT = { L: [-1, 0], R: [1, 0], U: [0, -1], D: [0, 1] };

function arrow(x, y, out) { // mũi tên đặc chỉ VÀO cạnh entity tại (x,y)
    const [dx, dy] = OUT[out], [px, py] = [-dy, dx];
    const bx = x + dx * 11, by = y + dy * 11;
    return `<polygon points="${x},${y} ${bx + px * 6.5},${by + py * 6.5} ${bx - px * 6.5},${by - py * 6.5}" fill="#000"/>`;
}
function path(pts, dashed) {
    return `<path d="M${pts.map(p => p.join(' ')).join(' L')}" fill="none" stroke="#000" stroke-width="1.2"${dashed ? ' stroke-dasharray="6 4"' : ''}/>`;
}
function card(x, y, txt) {
    return `<text x="${x}" y="${y}" font-size="12" font-style="italic">${txt}</text>`;
}

const W = E.WALLETS, DS = E.DEVICE_SESSIONS, AC = E.AUTH_CHALLENGES,
    N = E.NOTIFICATIONS, B = E.BATCHES, BF = E.BATCH_FILES,
    AK = E.API_KEYS, PD = E.PARTNER_DOCUMENTS;

// Mọi cạnh nối ngang/dọc (vuông góc); mũi tên chỉ vào phía "nhiều" (bảng con)
let edges = '';

// WALLETS 1 ——▶ n DEVICE_SESSIONS (gập vuông qua hành lang giữa cột trái và WALLETS)
edges += path([[W.x, 520], [370, 520], [370, 350], [DS.x + DS.w, 350]]);
edges += arrow(DS.x + DS.w, 350, 'R');
edges += card(398, 511, '1') + card(345, 341, 'n');

// WALLETS 1 ——▶ 0..1 AUTH_CHALLENGES (ngang thẳng)
edges += path([[W.x, 530], [AC.x + AC.w, 530]]);
edges += arrow(AC.x + AC.w, 530, 'R');
edges += card(400, 521, '1') + card(345, 548, '0..1');

// WALLETS 1 ——▶ n NOTIFICATIONS (ngang thẳng)
edges += path([[W.x, 760], [N.x + N.w, 760]]);
edges += arrow(N.x + N.w, 760, 'R');
edges += card(400, 751, '1') + card(348, 777, 'n');

// WALLETS 1 ——▶ n BATCHES (gập vuông vào cạnh trái BATCHES)
edges += path([[W.x + W.w, 450], [800, 450], [800, 160], [B.x, 160]]);
edges += arrow(B.x, 160, 'L');
edges += card(726, 441, '1') + card(808, 146, 'n');

// WALLETS 1 ——▶ n API_KEYS (gập vuông vào cạnh trái API_KEYS)
edges += path([[W.x + W.w, 730], [790, 730], [790, 880], [AK.x, 880]]);
edges += arrow(AK.x, 880, 'L');
edges += card(726, 721, '1') + card(812, 871, 'n');

// BATCHES 1 ——▶ n BATCH_FILES (dọc, nét đứt — document nhúng)
edges += path([[B.x + 135, B.y + B.h], [BF.x + 135, BF.y]], true);
edges += arrow(BF.x + 135, BF.y, 'U');
edges += card(B.x + 141, B.y + B.h + 20, '1') + card(BF.x + 145, BF.y - 10, 'n');

// API_KEYS 1 ——▶ n PARTNER_DOCUMENTS (gập vuông vào cạnh phải PD)
edges += path([[AK.x, 960], [800, 960], [800, 1060], [PD.x + PD.w, 1060]]);
edges += arrow(PD.x + PD.w, 1060, 'L');
edges += card(832, 951, '1') + card(724, 1051, 'n');

const CW = 1150, CH = 1350;
const legend = `<g font-size="12" fill="#000">
  <text x="40" y="${CH - 34}">Chú thích: <tspan font-weight="bold" text-decoration="underline">gạch chân</tspan> = khóa chính · <tspan font-weight="bold">chữ đậm</tspan> = trường tham chiếu (quan hệ logic — MongoDB không có khóa ngoại vật lý) · (UK) = unique</text>
  <text x="40" y="${CH - 14}">Mũi tên 1→n đọc "một bản ghi cha có n bản ghi con" · nét đứt = document nhúng trong bảng cha (files[] nằm trong batches)</text>
</g>`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CW} ${CH}" font-family="Times New Roman, Times, serif">
<rect width="${CW}" height="${CH}" fill="#fff"/>
${edges}
${Object.keys(ENTITIES).map(box).join('\n')}
${legend}
</svg>`;

fs.writeFileSync('_screenshots/so-do-2-7-er.svg', svg);
console.log('Saved _screenshots/so-do-2-7-er.svg —', CW + 'x' + CH);
