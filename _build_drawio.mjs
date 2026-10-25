// Sinh SoDo_Drawio.drawio — 8 trang sơ đồ tương ứng Hình 2.1–2.8 của báo cáo.
// Mở bằng draw.io desktop hoặc https://app.diagrams.net → File → Open.
// Chay: node _build_drawio.mjs
import fs from 'fs';

// \n → <br> vì draw.io render value như HTML (và \n trong attribute bị chuẩn hóa thành space)
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\n/g, '&lt;br&gt;');
let id = 0;
const nid = () => 'c' + (id++);

// ---------- helpers ----------
function V(value, style, x, y, w, h) {
    return `<mxCell id="${nid()}" value="${esc(value)}" style="${style}" vertex="1" parent="1"><mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/></mxCell>`;
}
function E(src, tgt, style, value = '', pts = null) {
    const arr = pts ? `<Array as="points">${pts.map(p => `<mxPoint x="${p[0]}" y="${p[1]}"/>`).join('')}</Array>` : '';
    return `<mxCell id="${nid()}" value="${esc(value)}" style="${style};edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;" edge="1" parent="1" source="${src}" target="${tgt}"><mxGeometry relative="1" as="geometry">${arr}</mxGeometry></mxCell>`;
}
const ACTOR = 'shape=umlActor;verticalLabelPosition=bottom;verticalAlign=top;html=1;fontSize=11;';
const UC = 'ellipse;whiteSpace=wrap;html=1;fontSize=11;';
const BOUND = 'rounded=0;whiteSpace=wrap;html=1;fontSize=13;align=left;verticalAlign=top;spacingLeft=10;spacingTop=6;fontStyle=1;';
const GEN = 'endArrow=block;endFill=0;html=1;';
const ASSOC = 'endArrow=none;html=1;';
const START = 'ellipse;html=1;fillColor=#000000;';
const FINAL = 'ellipse;html=1;shape=umlFinalState;';
const ACT = 'rounded=1;whiteSpace=wrap;html=1;fontSize=11;arcSize=30;';
const DEC = 'rhombus;whiteSpace=wrap;html=1;fontSize=11;';
const ENDTXT = 'rounded=1;whiteSpace=wrap;html=1;fontSize=11;fontStyle=1;';
const BOX = 'rounded=0;whiteSpace=wrap;html=1;fontSize=12;align=center;';
const BOXHDR = 'swimlane;html=1;fontSize=12;fontStyle=1;align=center;startSize=26;';
const ROW = 'text;html=1;align=left;spacingLeft=6;fontSize=10.5;strokeColor=none;fillColor=none;';
const NOTE = 'shape=note;whiteSpace=wrap;html=1;backgroundOutline=1;darkOpacity=0.05;fontSize=10;align=left;spacingLeft=6;';

// ================================================================
// TRANG 1 — Hình 2.1: Use-case tổng thể
// ================================================================
function pageUseCase() {
    const c = [];
    // boundary
    c.push(V('Hệ thống xác thực &amp; chống giả mạo dữ liệu số', BOUND, 260, 40, 480, 660));
    // actors trái
    const aPub = V('Người kiểm tra\n(công khai)', ACTOR, 40, 80, 40, 90);
    const aView = V('NGƯỜI XEM\n(rank 0, chỉ đọc)', ACTOR, 40, 210, 40, 90);
    const aIn = V('NHẬP LIỆU\n(rank 1)', ACTOR, 40, 340, 40, 90);
    const aMgr = V('QUẢN LÝ\n(rank 2)', ACTOR, 40, 470, 40, 90);
    const aAdm = V('ADMIN\n(rank 3)', ACTOR, 40, 600, 40, 90);
    const aOrg = V('Tổ chức đối tác\n(API key)', ACTOR, 800, 400, 40, 90);
    c.push(aPub, aView, aIn, aMgr, aAdm, aOrg);
    // generalization: con → cha (mũi tên rỗng)
    const g1 = E(aIn.match(/id="(c\d+)"/)[1], aView.match(/id="(c\d+)"/)[1], GEN, '', [[20, 340], [20, 255]]);
    const g2 = E(aMgr.match(/id="(c\d+)"/)[1], aIn.match(/id="(c\d+)"/)[1], GEN, '', [[20, 470], [20, 385]]);
    const g3 = E(aAdm.match(/id="(c\d+)"/)[1], aMgr.match(/id="(c\d+)"/)[1], GEN, '', [[20, 600], [20, 515]]);
    c.push(g1, g2, g3);
    // use cases
    const ucs = [
        'Xác thực tài liệu (verify)', 'Đăng nhập bằng chữ ký ví', 'Phê duyệt thiết bị / OTP',
        'Xem sổ cái / Tải tài liệu theo quyền', 'Upload tài liệu (AES + on-chain)',
        'Thu hồi tài liệu (trừ tài liệu ADMIN)', 'Phân quyền ví / khóa ví',
        'Cấp / thu hồi API key', 'Upload · Verify · Download qua API'
    ];
    const ucIds = ucs.map((u, i) => {
        const s = V(u, UC, 360, 90 + i * 62, 280, 36);
        c.push(s);
        return s.match(/id="(c\d+)"/)[1];
    });
    const A = (actorXml, idx) => E(actorXml.match(/id="(c\d+)"/)[1], ucIds[idx], ASSOC);
    // Người kiểm tra → verify
    c.push(A(aPub, 0));
    // NGƯỜI XEM → verify, đăng nhập, duyệt thiết bị, xem sổ cái
    [0, 1, 2, 3].forEach(i => c.push(A(aView, i)));
    // NHẬP LIỆU → upload (kế thừa thêm quyền đọc từ NGƯỜI XEM qua generalization)
    c.push(A(aIn, 4));
    // QUẢN LÝ → thu hồi
    c.push(A(aMgr, 5));
    // ADMIN → phân quyền, cấp API key
    c.push(A(aAdm, 6)); c.push(A(aAdm, 7));
    // Đối tác → upload/verify/download qua API
    c.push(A(aOrg, 8));
    // note vai trò kế thừa
    c.push(V('▷ : vai trò kế thừa toàn bộ quyền của cấp dưới', ROW, 300, 655, 360, 24));
    return c.join('\n');
}

// ================================================================
// TRANG 2 — Hình 2.2: Kiến trúc ba tầng
// ================================================================
function pageArch() {
    const c = [];
    const u = V('NGƯỜI DÙNG / ĐỐI TÁC\n\nTrình duyệt + MetaMask          |          Trường / Bệnh viện (API key)\nEthers.js ký · CryptoJS mã hóa tại máy người dùng', BOX + 'fontStyle=1;', 140, 30, 640, 80);
    const b = V('BACKEND Node.js / Express :3000\n\nupload · verify · batches · wallets · apikeys · /api/v1/*\nJWT · phân quyền · quota IPFS · rate limit · chống XSS', BOX + 'fontStyle=1;', 140, 180, 640, 90);
    const ipfs = V('IPFS / Pinata\nfile ciphertext AES-256\n(phân tán)', BOX, 60, 340, 220, 90);
    const eth = V('Ethereum Sepolia\nhash + metadata + trạng thái\n(bất biến — bằng chứng)', BOX, 350, 340, 220, 90);
    const mongo = V('MongoDB\nwallets · batches · sessions\napi keys · khóa bọc', BOX, 640, 340, 220, 90);
    c.push(u, b, ipfs, eth, mongo);
    const uid = u.match(/id="(c\d+)"/)[1], bid = b.match(/id="(c\d+)"/)[1];
    c.push(E(uid, bid, 'endArrow=block;endFill=1;html=1;', 'file + chữ ký (MetaMask) · x-api-key (đối tác)'));
    c.push(E(bid, ipfs.match(/id="(c\d+)"/)[1], 'endArrow=block;endFill=1;html=1;', 'pin ciphertext'));
    c.push(E(bid, eth.match(/id="(c\d+)"/)[1], 'endArrow=block;endFill=1;html=1;', 'ghi / đọc'));
    c.push(E(bid, mongo.match(/id="(c\d+)"/)[1], 'endArrow=block;endFill=1;html=1;', 'metadata'));
    c.push(V('TẦNG TRÌNH BÀY', ROW + 'fontStyle=1;', 20, 60, 110, 20));
    c.push(V('TẦNG NGHIỆP VỤ', ROW + 'fontStyle=1;', 20, 210, 110, 20));
    c.push(V('TẦNG DỮ LIỆU', ROW + 'fontStyle=1;', 20, 370, 110, 20));
    return c.join('\n');
}

// ================================================================
// TRANG 3 — Hình 2.3: Luồng upload
// ================================================================
function pageUpload() {
    const c = [];
    const n = [
        V('', START, 180, 10, 20, 20),
        V('Chọn file · quét trùng nội dung\n· nhập khóa AES · chế độ từng file', ACT, 90, 60, 240, 46),
        V('Đọc byte → SHA-256(file gốc)\n→ mã hóa AES-256 (CryptoJS)', ACT, 90, 136, 240, 46),
        V('POST /api/upload\nkiểm tra quota IPFS thật (Pinata)', ACT, 90, 212, 240, 46),
        V('Đủ quota?', DEC, 140, 286, 140, 70),
        V('Pin ciphertext → IPFS\n(CID + mã QR documentId)', ACT, 90, 386, 240, 46),
        V('MetaMask ký addDocuments\nghi hash + CID on-chain', ACT, 90, 462, 240, 46),
        V('Người dùng ký?', DEC, 140, 536, 140, 70),
        V('TX confirm → POST /api/batches\n(metadata + encKey bọc MASTER_KEY)', ACT, 90, 634, 240, 46),
        V('', FINAL, 180, 706, 20, 20),
        V('Trả 403 — hết quota', ENDTXT, 420, 300, 150, 34),
        V('Từ chối ký — hủy', ENDTXT, 420, 550, 150, 34),
    ];
    const ids = n.map(s => s.match(/id="(c\d+)"/)[1]);
    c.push(...n);
    for (let i = 0; i < 4; i++) c.push(E(ids[i], ids[i + 1], 'endArrow=block;endFill=1;html=1;'));
    c.push(E(ids[4], ids[5], 'endArrow=block;endFill=1;html=1;', 'Có'));
    c.push(E(ids[4], ids[10], 'endArrow=block;endFill=1;html=1;', 'Không'));
    c.push(E(ids[5], ids[6], 'endArrow=block;endFill=1;html=1;'));
    c.push(E(ids[6], ids[7], 'endArrow=block;endFill=1;html=1;'));
    c.push(E(ids[7], ids[8], 'endArrow=block;endFill=1;html=1;', 'Có'));
    c.push(E(ids[7], ids[11], 'endArrow=block;endFill=1;html=1;', 'Không'));
    c.push(E(ids[8], ids[9], 'endArrow=block;endFill=1;html=1;'));
    return c.join('\n');
}

// ================================================================
// TRANG 4 — Hình 2.4: Luồng xác thực
// ================================================================
function pageVerify() {
    const c = [];
    const n = [
        V('', START, 180, 10, 20, 20),
        V('Nộp file + documentId\n(endpoint công khai, không cần đăng nhập)', ACT, 90, 60, 240, 46),
        V('SHA-256(file nộp)\n+ đọc getDocument() on-chain', ACT, 90, 136, 240, 46),
        V('Tồn tại bản ghi?', DEC, 140, 210, 140, 70),
        V('Đã thu hồi?', DEC, 140, 330, 140, 70),
        V('Hash khớp?', DEC, 140, 450, 140, 70),
        V('Tải gốc IPFS → giải mã\n→ diff text + heatmap + báo cáo AI', ACT, 90, 560, 240, 46),
        V('PHÁT HIỆN GIẢ MẠO', ENDTXT + 'fontColor=#c0392b;', 120, 640, 180, 34),
        V('Không có trên chuỗi', ENDTXT, 420, 228, 160, 34),
        V('THU HỒI + lý do', ENDTXT + 'fontColor=#b9770e;', 420, 348, 160, 34),
        V('NGUYÊN VẸN', ENDTXT + 'fontColor=#1e8449;', 420, 468, 160, 34),
    ];
    const ids = n.map(s => s.match(/id="(c\d+)"/)[1]);
    c.push(...n);
    c.push(E(ids[0], ids[1], 'endArrow=block;endFill=1;html=1;'));
    c.push(E(ids[1], ids[2], 'endArrow=block;endFill=1;html=1;'));
    c.push(E(ids[2], ids[3], 'endArrow=block;endFill=1;html=1;'));
    c.push(E(ids[3], ids[8], 'endArrow=block;endFill=1;html=1;', 'Không'));
    c.push(E(ids[3], ids[4], 'endArrow=block;endFill=1;html=1;', 'Có'));
    c.push(E(ids[4], ids[9], 'endArrow=block;endFill=1;html=1;', 'Có'));
    c.push(E(ids[4], ids[5], 'endArrow=block;endFill=1;html=1;', 'Không'));
    c.push(E(ids[5], ids[10], 'endArrow=block;endFill=1;html=1;', 'Khớp'));
    c.push(E(ids[5], ids[6], 'endArrow=block;endFill=1;html=1;', 'Lệch'));
    c.push(E(ids[6], ids[7], 'endArrow=block;endFill=1;html=1;'));
    return c.join('\n');
}

// ================================================================
// TRANG 5 — Hình 2.5: Đăng nhập & duyệt thiết bị
// ================================================================
function pageLogin() {
    const c = [];
    const n = [
        V('', START, 180, 10, 20, 20),
        V('Xin challenge → ký MetaMask\n(gửi chữ ký + deviceId)', ACT, 90, 60, 240, 46),
        V('Server xác minh chữ ký\n(khôi phục địa chỉ ví)', ACT, 90, 136, 240, 46),
        V('Trùng deviceId\ncủa phiên đang sống?', DEC, 140, 210, 150, 76),
        V('Gia hạn phiên ngay\n(cấp JWT — thiết bị cũ quen thuộc)', ACT, 90, 316, 240, 46),
        V('Ví còn phiên hoạt động khác?', DEC, 140, 392, 150, 76),
        V('Thiết bị mới → PENDING\n+ bắn thông báo cho thiết bị cũ', ACT, 90, 498, 240, 46),
        V('Duyệt từ thiết bị cũ\n(chuông thông báo → ký lại MetaMask)', ACT, 90, 574, 240, 46),
        V('', FINAL, 180, 656, 20, 20),
        // nhánh phải: không còn phiên
        V('Ví đã đăng ký email?', DEC, 480, 392, 150, 76),
        V('OTP 6 số qua email\n(5 lần sai, sống 5 phút)', ACT, 460, 498, 200, 46),
        V('Auto-duyệt phiên đầu tiên\n(chưa có email → không có ai để duyệt)', ACT, 460, 574, 200, 46),
        // nhánh fallback
        V('Pending >24h + không còn phiên\nhoạt động + email không khả dụng\n→ tự chuyển active + cảnh báo', NOTE, 460, 650, 220, 60),
    ];
    const ids = n.map(s => s.match(/id="(c\d+)"/)[1]);
    c.push(...n);
    c.push(E(ids[0], ids[1], 'endArrow=block;endFill=1;html=1;'));
    c.push(E(ids[1], ids[2], 'endArrow=block;endFill=1;html=1;'));
    c.push(E(ids[2], ids[3], 'endArrow=block;endFill=1;html=1;'));
    c.push(E(ids[3], ids[4], 'endArrow=block;endFill=1;html=1;', 'Có'));
    c.push(E(ids[3], ids[5], 'endArrow=block;endFill=1;html=1;', 'Không'));
    c.push(E(ids[5], ids[6], 'endArrow=block;endFill=1;html=1;', 'Còn'));
    c.push(E(ids[5], ids[9], 'endArrow=block;endFill=1;html=1;', 'Hết'));
    c.push(E(ids[9], ids[10], 'endArrow=block;endFill=1;html=1;', 'Có'));
    c.push(E(ids[9], ids[11], 'endArrow=block;endFill=1;html=1;', 'Chưa'));
    c.push(E(ids[6], ids[7], 'endArrow=block;endFill=1;html=1;', 'đường chính'));
    c.push(E(ids[7], ids[8], 'endArrow=block;endFill=1;html=1;'));
    c.push(E(ids[10], ids[7], 'endArrow=block;endFill=1;html=1;', 'OTP đúng → active'));
    c.push(E(ids[11], ids[8], 'endArrow=block;endFill=1;html=1;'));
    c.push(E(ids[4], ids[8], 'endArrow=block;endFill=1;html=1;'));
    return c.join('\n');
}

// ================================================================
// TRANG 6 — Hình 2.6: Đăng ký ví mới → phòng chờ → khay chờ Admin
// ================================================================
function pageRegister() {
    const c = [];
    const n = [
        V('', START, 160, 10, 20, 20),
        V('Ví mới đăng nhập\n(ký challenge + /wallets/sync)', ACT, 70, 60, 200, 46),
        V('Quyền on-chain\nuserRoles(address)?', DEC, 110, 134, 130, 70),
        V('PHÒNG CHỜ — khai alias,\nemail, SĐT, quyền mong muốn', ACT, 70, 260, 200, 46),
        V('Vào KHAY CHỜ của Admin\n(badge đếm, poll 30s)', ACT, 70, 336, 200, 46),
        V('Admin quyết định?', DEC, 110, 412, 130, 70),
        V('DUYỆT → ký assignRole on-chain\n(viewer: chỉ ghi MongoDB)', ACT, 70, 538, 200, 46),
        V('Ví vào hệ thống\n(poll 15s — không cần đăng nhập lại)', ACT, 70, 614, 200, 46),
        V('', FINAL, 160, 690, 20, 20),
        // nhánh phải
        V('TỪ CHỐI → ví nhận trạng thái\nbị từ chối + nút "Gửi lại"', ACT, 380, 420, 210, 46),
        V('Bị từ chối ≥3 lần\n→ chặn gửi lại 30 phút (429)', NOTE, 380, 500, 210, 50),
        V('rank ≥ 1 hoặc viewer →\nvào thẳng hệ thống', ACT, 380, 148, 200, 46),
    ];
    const ids = n.map(s => s.match(/id="(c\d+)"/)[1]);
    c.push(...n);
    c.push(E(ids[0], ids[1], 'endArrow=block;endFill=1;html=1;'));
    c.push(E(ids[1], ids[2], 'endArrow=block;endFill=1;html=1;'));
    c.push(E(ids[2], ids[11], 'endArrow=block;endFill=1;html=1;', '> 0'));
    c.push(E(ids[2], ids[3], 'endArrow=block;endFill=1;html=1;', '= 0'));
    c.push(E(ids[3], ids[4], 'endArrow=block;endFill=1;html=1;'));
    c.push(E(ids[4], ids[5], 'endArrow=block;endFill=1;html=1;'));
    c.push(E(ids[5], ids[6], 'endArrow=block;endFill=1;html=1;', 'Duyệt'));
    c.push(E(ids[5], ids[9], 'endArrow=block;endFill=1;html=1;', 'Từ chối'));
    c.push(E(ids[6], ids[7], 'endArrow=block;endFill=1;html=1;'));
    c.push(E(ids[7], ids[8], 'endArrow=block;endFill=1;html=1;'));
    c.push(E(ids[11], ids[8], 'endArrow=block;endFill=1;html=1;'));
    c.push(E(ids[9], ids[3], 'endArrow=block;endFill=1;html=1;', 'gửi lại', [[480, 380], [170, 380]]));
    return c.join('\n');
}

// ================================================================
// TRANG 7 — Hình 2.7: ER MongoDB
// ================================================================
function ent(title, rows, x, y, w) {
    const h = 26 + rows.length * 20 + 6;
    let s = `<mxCell id="${nid()}" value="${esc(title)}" style="swimlane;html=1;fontSize=12;fontStyle=1;align=center;startSize=26;childLayout=stackLayout;" vertex="1" parent="1"><mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/></mxCell>`;
    // trả id của container để nối edge
    const cid = s.match(/id="(c\d+)"/)[1];
    const rowCells = rows.map(r => `<mxCell id="${nid()}" value="${esc(r)}" style="text;html=1;align=left;spacingLeft=6;fontSize=10.5;strokeColor=none;" vertex="1" parent="${cid}"><mxGeometry width="${w}" height="20" as="geometry"/></mxCell>`).join('');
    return { xml: s + rowCells, id: cid, h };
}

function pageER() {
    const ents = [];
    ents.push(ent('WALLETS', ['_id (PK)', 'address (UK)', 'alias, email, phone', 'role, requestedRole, roleGranted', 'status: ACTIVE/REVOKED/DELETED', 'rejected, rejectCount, rejectBlockedUntil', 'storageUsed / storageLimit (MB)'], 480, 380, 260));
    ents.push(ent('DEVICE_SESSIONS', ['_id (PK)', 'address (FK)', 'deviceId (UK cùng address)', 'deviceLabel, ip, userAgent', 'status: pending/active/revoked', 'otpHash, otpExpires, otpAttempts, otpFailed', 'createdAt, lastSeen'], 40, 60, 270));
    ents.push(ent('AUTH_CHALLENGES', ['_id (PK)', 'address (UK)', 'challenge (nonce 1 lần)', 'expiresAt (TTL — tự xóa)'], 40, 420, 270));
    ents.push(ent('NOTIFICATIONS', ['_id (PK)', 'address (FK)', 'type, title, message', 'meta, read, createdAt'], 40, 610, 270));
    ents.push(ent('BATCHES', ['_id (PK)', 'batchId (UK)', 'merkleRoot', 'ipfsCID (manifest lô)', 'txHash, uploader (FK)', 'timestamp'], 900, 60, 250));
    ents.push(ent('BATCH_FILES (nhúng trong batches)', ['docId', 'fileName, fileHash (SHA-256)', 'fileSize, ipfsCID, qrCode', 'encKey (bọc MASTER_KEY, GCM)', 'visibility: private/public', 'chunkHashes[], replacesDocId', 'isRevoked, revocationReason'], 860, 330, 320));
    ents.push(ent('API_KEYS', ['_id (PK)', 'name', 'keyHash = sha256(token) (UK)', 'prefix, createdBy (FK)', 'revoked, lastUsedAt'], 900, 700, 260));
    ents.push(ent('PARTNER_DOCUMENTS', ['_id (PK)', 'docId (UK)', 'apiKeyId (FK → ApiKey)', 'orgName, fileName, fileHash', 'ipfsCID, fileSize, encKey', 'txHash (server ký thay)', 'refDocId, isSharedRef', 'isRevoked, revocationReason'], 480, 840, 300));
    const [W, DS, AC, N, B, BF, AK, PD] = ents.map(e => e.id);
    const cells = ents.map(e => e.xml).join('\n');
    const ER = 'edgeStyle=entityRelationEdgeStyle;html=1;startArrow=ERone;endArrow=ERmany;startFill=0;endFill=0;';
    const edges = [
        `<mxCell id="${nid()}" value="1 — n" style="${ER}" edge="1" parent="1" source="${W}" target="${DS}"><mxGeometry relative="1" as="geometry"/></mxCell>`,
        `<mxCell id="${nid()}" value="1 — 0..1" style="${ER}" edge="1" parent="1" source="${W}" target="${AC}"><mxGeometry relative="1" as="geometry"/></mxCell>`,
        `<mxCell id="${nid()}" value="1 — n" style="${ER}" edge="1" parent="1" source="${W}" target="${N}"><mxGeometry relative="1" as="geometry"/></mxCell>`,
        `<mxCell id="${nid()}" value="1 — n" style="${ER}" edge="1" parent="1" source="${W}" target="${B}"><mxGeometry relative="1" as="geometry"/></mxCell>`,
        `<mxCell id="${nid()}" value="1 — n" style="${ER}" edge="1" parent="1" source="${W}" target="${AK}"><mxGeometry relative="1" as="geometry"/></mxCell>`,
        `<mxCell id="${nid()}" value="1 — n (nhúng)" style="${ER}dashed=1;" edge="1" parent="1" source="${B}" target="${BF}"><mxGeometry relative="1" as="geometry"/></mxCell>`,
        `<mxCell id="${nid()}" value="1 — n" style="${ER}" edge="1" parent="1" source="${AK}" target="${PD}"><mxGeometry relative="1" as="geometry"/></mxCell>`,
    ];
    const note = V('Quan hệ logic qua trường dữ liệu — MongoDB không có khóa ngoại vật lý.\nrefDocId trỏ tới docId của bản ghi gốc khi đối tác dùng chung một bằng chứng on-chain.\nfiles[] là mảng document NHÚNG trong batches (nét đứt).', NOTE, 40, 800, 380, 80);
    return cells + '\n' + edges.join('\n') + '\n' + note;
}

// ================================================================
// TRANG 8 — Hình 2.8: Key escrow
// ================================================================
function pageEscrow() {
    const c = [];
    const brow = V('TRÌNH DUYỆT\n\nngười dùng nhập\nmật khẩu AES', BOX, 60, 80, 160, 90);
    const srv = V('SERVER\n\nwrapKey():\nAES-256-GCM + MASTER_KEY', BOX, 340, 80, 200, 90);
    const db = V('MONGODB\n\nfiles.encKey\n"iv:ct:tag"', BOX, 660, 80, 180, 90);
    const srv2 = V('SERVER\n\nunwrapKey()\nkiểm tra uploader / role / visibility', BOX, 340, 300, 200, 90);
    const brow2 = V('TRÌNH DUYỆT\n\nnhận khóa (HTTPS)\n→ giải mã client-side', BOX, 60, 300, 160, 90);
    c.push(brow, srv, db, srv2, brow2);
    const idOf = s => s.match(/id="(c\d+)"/)[1];
    const AW = 'endArrow=block;endFill=1;html=1;';
    c.push(E(idOf(brow), idOf(srv), AW, 'encKey (khóa thô)'));
    c.push(E(idOf(srv), idOf(db), AW, 'blob bọc'));
    c.push(E(idOf(brow2), idOf(srv2), AW, 'GET /documents/:id/key'));
    c.push(E(idOf(srv2), idOf(brow2), AW, 'đủ quyền → trả encKey'));
    c.push(V('Không đủ quyền → 403 (kể cả ADMIN với tài liệu riêng tư của ví khác)', NOTE, 300, 430, 280, 50));
    return c.join('\n');
}

// ================================================================
const pages = [
    ['H2.1 — Use-case tổng thể', pageUseCase],
    ['H2.2 — Kiến trúc ba tầng', pageArch],
    ['H2.3 — Luồng upload', pageUpload],
    ['H2.4 — Luồng xác thực', pageVerify],
    ['H2.5 — Đăng nhập & duyệt thiết bị', pageLogin],
    ['H2.6 — Đăng ký ví mới', pageRegister],
    ['H2.7 — ER MongoDB', pageER],
    ['H2.8 — Key escrow', pageEscrow],
];

const diagrams = pages.map(([name, fn], i) => {
    id = i * 1000; // id an toàn từng trang
    return `<diagram id="pg${i}" name="${esc(name)}"><mxGraphModel dx="800" dy="600" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" pageScale="1" math="0" shadow="0"><root><mxCell id="0"/><mxCell id="1" parent="0"/>${fn()}</root></mxGraphModel></diagram>`;
});

fs.writeFileSync('SoDo_Drawio.drawio', `<mxfile host="app.diagrams.net" modified="2026-10-25T00:00:00.000Z" agent="Devin" version="24.0.0">\n${diagrams.join('\n')}\n</mxfile>`);
console.log('Saved SoDo_Drawio.drawio —', pages.length, 'trang:', pages.map(p => p[0]).join(' | '));
