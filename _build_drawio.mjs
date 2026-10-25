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
// HELPERS MỞ RỘNG — use-case phân hệ & sequence diagram
// ================================================================

// use-case phân hệ: actors tự động xếp cột trái/phải, links [[actorIdx|{r:idx}, ucIdx]]
function ucSub(sysTitle, actorsL, actorsR, ucs, links) {
    const c = [];
    const nUC = ucs.length, h = Math.max(nUC * 56 + 60, Math.max(actorsL.length, actorsR.length) * 110 + 60);
    c.push(V(sysTitle, BOUND, 230, 20, 460, h));
    const aIds = actorsL.map((a, i) => { const s = V(a, ACTOR, 40, 40 + i * 110, 40, 80); c.push(s); return s.match(/id="(c\d+)"/)[1]; });
    const rIds = actorsR.map((a, i) => { const s = V(a, ACTOR, 780, 40 + i * 110, 40, 80); c.push(s); return s.match(/id="(c\d+)"/)[1]; });
    const ucIds = ucs.map((u, i) => { const s = V(u, UC, 320, 60 + i * 56, 280, 34); c.push(s); return s.match(/id="(c\d+)"/)[1]; });
    for (const [ai, ui] of links) {
        const src = typeof ai === 'object' && 'r' in ai ? rIds[ai.r] : aIds[ai];
        c.push(E(src, ucIds[ui], ASSOC));
    }
    return c.join('\n');
}

const LIFE = 'shape=umlLifeline;perimeter=lifelinePerimeter;whiteSpace=wrap;html=1;fontSize=11;container=1;collapsible=0;';

// sequence: L = [[tên, x, w]], M = [[fromIdx, toIdx, nhãn, dashed?], ...]
function seqPage(L, M, notes = []) {
    const H = 90 + M.length * 44;
    const c = L.map(([name, x, w]) => V(name, LIFE, x, 30, w || 150, H));
    const ids = c.map(s => s.match(/id="(c\d+)"/)[1]);
    c.forEach(s => {});
    const out = [...c];
    M.forEach(([a, b, label, dashed], i) => {
        const y1 = 70 + i * 44;
        const f = (y1 / H).toFixed(3);
        if (a === b) {
            // self-message: vòng chữ nhật ra khỏi lifeline rồi quay lại ở độ cao thấp hơn
            const cx = L[a][1] + (L[a][2] || 150) / 2;
            const f2 = ((y1 + 26) / H).toFixed(3);
            const st = `endArrow=block;endFill=1;exitX=0.5;exitY=${f};entryX=0.5;entryY=${f2};edgeStyle=orthogonalEdgeStyle;html=1;fontSize=10;`;
            out.push(`<mxCell id="${nid()}" value="${esc(label)}" style="${st}" edge="1" parent="1" source="${ids[a]}" target="${ids[b]}"><mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="${cx + 90}" y="${y1}"/><mxPoint x="${cx + 90}" y="${y1 + 26}"/></Array></mxGeometry></mxCell>`);
        } else {
            const st = `endArrow=block;endFill=${dashed ? 0 : 1};${dashed ? 'dashed=1;' : ''}exitX=0.5;exitY=${f};entryX=0.5;entryY=${f};html=1;fontSize=10;`;
            out.push(`<mxCell id="${nid()}" value="${esc(label)}" style="${st}edgeStyle=none;" edge="1" parent="1" source="${ids[a]}" target="${ids[b]}"><mxGeometry relative="1" as="geometry"/></mxCell>`);
        }
    });
    notes.forEach((n, i) => out.push(V(n, NOTE, 40 + i * 30, H + 60, 300, 60)));
    return out.join('\n');
}

// ================================================================
// UC PHÂN HỆ — 4 trang
// ================================================================
function pageUCVerify() {
    return ucSub('Phân hệ xác thực & tra cứu',
        ['Người kiểm tra\n(công khai)', 'Người dùng ví\n(rank ≥ 0)'],
        [],
        ['Nộp file + documentId\nxác thực', 'Tra cứu tài liệu\ntheo docId / hash', 'Quét mã QR\ntrên giấy chứng nhận', 'Xem diff text +\nheatmap ảnh', 'Xem báo cáo\npháp y AI', 'Tra cứu nội dung\ntương đồng'],
        [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [1, 3], [1, 4], [1, 5]]);
}
function pageUCDocs() {
    return ucSub('Phân hệ quản lý tài liệu',
        ['NHẬP LIỆU\n(rank 1)', 'QUẢN LÝ\n(rank 2)'],
        [],
        ['Upload lô nhiều file\n(kéo-thả)', 'Chọn chế độ Riêng tư /\nCông khai từng file', 'Xem trước tài liệu\n(giải mã client-side)', 'Tải file gốc\n(viết bản sao)', 'Thu hồi tài liệu\nkèm lý do', 'Tạo phiên bản mới\n(thay thế bản cũ)', 'Quản lý hàng đợi\norphaned batches'],
        [[0, 0], [0, 1], [0, 2], [0, 3], [0, 6], [1, 0], [1, 1], [1, 2], [1, 3], [1, 4], [1, 5], [1, 6]]);
}
function pageUCAdmin() {
    return ucSub('Phân hệ quản trị hệ thống',
        ['ADMIN\n(rank 3)', 'Ví bất kỳ'],
        ['Hệ thống\n(SMTP / on-chain)'],
        ['Duyệt ví trong khay chờ\n(gán role on-chain)', 'Khóa / xóa ví\n(assignRole 0)', 'Từ chối đơn\n(chặn 3 lần → 30 phút)', 'Tạo / thu hồi\nAPI key đối tác', 'Thu hồi tài liệu\nđối tác', 'Theo dõi phiên đăng nhập\n+ thông báo', 'Duyệt thiết bị mới\n(step-up ký lại)', 'Thu hồi phiên\nthiết bị khác'],
        [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [1, 5], [1, 6], [1, 7]]);
}
function pageUCPartner() {
    return ucSub('Phân hệ tích hợp đối tác (API key)',
        ['Tổ chức đối tác\n(trường / bệnh viện)'],
        ['ADMIN\n(cấp key)'],
        ['Xin API key\n(sk_live_…)', 'Upload tài liệu\nPOST /v1/documents', 'Verify file\nPOST /v1/verify', 'Liệt kê tài liệu\ncủa mình', 'Tải / giải mã file\nGET /v1/documents/:id', 'Thu hồi tài liệu\nPOST /:id/revoke', 'Dùng chung bằng chứng\n(bản ghi tham chiếu)'],
        [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6], [{ r: 0 }, 0]]);
}

// ================================================================
// SEQUENCE — 6 trang
// ================================================================
function pageSeqLogin() {
    return seqPage(
        [['Trình duyệt', 40], ['MetaMask', 220], ['Backend /auth', 400], ['MongoDB', 590], ['SMTP', 780]],
        [
            [0, 2, 'GET /auth/challenge'],
            [2, 3, 'tạo AuthChallenge (TTL 5\')'],
            [2, 0, 'challenge (nonce)', 1],
            [0, 1, 'ký challenge'],
            [1, 0, 'signature', 1],
            [0, 2, 'POST /auth/login {sig, deviceId}'],
            [2, 2, 'xác minh chữ ký\n(ecrecover → địa chỉ ví)'],
            [2, 3, 'tra DeviceSession (deviceId, status)'],
            [2, 4, 'gửi OTP (nếu hết phiên nhưng có email)'],
            [2, 0, 'JWT (active) / pending + thiết bị chặn', 1],
        ],
        ['Thiết bị mới → pending: không cấp JWT, bắn thông báo cho thiết bị cũ duyệt; không còn phiên nào → OTP email (hoặc auto-approve nếu chưa đăng ký email).']);
}
function pageSeqUpload() {
    return seqPage(
        [['Trình duyệt', 30], ['Backend', 210], ['IPFS / Pinata', 390], ['MetaMask + Sepolia', 570], ['MongoDB', 780]],
        [
            [0, 0, 'đọc byte → SHA-256\n→ mã hóa AES-256'],
            [0, 1, 'POST /api/upload (ciphertext)'],
            [1, 2, 'kiểm tra quota → pinFileToIPFS'],
            [2, 1, 'CID', 1],
            [1, 0, '{cid, docId, qrCode}', 1],
            [0, 3, 'addDocuments(ids, hashes, uris)'],
            [3, 0, 'txHash (xác nhận on-chain)', 1],
            [0, 1, 'POST /api/batches (metadata + encKey)'],
            [1, 4, 'wrapKey GCM + lưu Batch'],
            [1, 0, '201 batch đã lưu', 1],
        ],
        ['Phía trình duyệt: đọc byte → SHA-256(file gốc) → AES-256 mã hóa trước khi gửi — plaintext không bao giờ rời máy người dùng.']);
}
function pageSeqVerify() {
    return seqPage(
        [['Người kiểm tra', 40], ['Backend /verify', 230], ['Sepolia (đọc)', 420], ['IPFS gateway', 600], ['Gemini AI', 780]],
        [
            [0, 1, 'POST /api/verify (file + documentId)'],
            [1, 1, 'SHA-256(file nộp)'],
            [1, 2, 'getDocument(documentId)'],
            [2, 1, 'fileHash, isRevoked, lý do…', 1],
            [1, 0, '{match, isRevoked, timestamp}', 1],
            [0, 1, 'hash lệch → xin phân tích'],
            [1, 3, 'tải ciphertext bản gốc'],
            [1, 1, 'giải mã → diff text + heatmap\n+ quét ký tự ngụy trang'],
            [1, 4, 'gửi ngữ cảnh → báo cáo pháp y'],
            [4, 1, 'báo cáo AI', 1],
        ],
        ['Băm file nộp rồi so với hash on-chain; khi lệch: giải mã bản gốc (nếu có quyền) → diff từng ký tự + quét ký tự ngụy trang (Cyrillic/Greek/zero-width) + pixelmatch cho ảnh.']);
}
function pageSeqRevoke() {
    return seqPage(
        [['Người dùng', 40], ['MetaMask + Contract', 220], ['Backend', 430], ['MongoDB', 610], ['Notification', 790]],
        [
            [0, 1, 'revokeDocument(docId, lý do)'],
            [1, 1, 'kiểm tra quyền on-chain\n(uploader / role / admin-doc)'],
            [1, 0, 'txHash — DocumentRevoked', 1],
            [0, 2, 'POST /api/batches/revoke'],
            [2, 3, 'đồng bộ isRevoked + lý do (+ refDocId dùng chung)'],
            [2, 4, 'thông báo cho chủ sở hữu\nkhi người khác thu hồi'],
            [2, 0, '200 — xác nhận đồng bộ', 1],
        ],
        ['Contract kiểm tra quyền on-chain: uploader tự thu hồi, QUẢN LÝ thu hồi của nhập liệu, chỉ ADMIN thu hồi tài liệu ADMIN/đối tác; bản ghi tham chiếu dùng chung cũng chuyển isRevoked.']);
}
function pageSeqPartner() {
    return seqPage(
        [['Hệ thống đối tác', 30], ['Backend /api/v1', 230], ['Sepolia', 430], ['IPFS / Pinata', 610], ['MongoDB', 790]],
        [
            [0, 1, 'POST /v1/documents (x-api-key + file)'],
            [1, 4, 'sha256(token) → tra ApiKey + rate limit'],
            [1, 2, 'getDocIdByHash(ví server, fileHash)'],
            [2, 1, 'trùng → docId gốc (đang hiệu lực)', 1],
            [1, 4, 'tạo PartnerDocument THAM CHIẾU (refDocId)'],
            [1, 0, '{shared: true, documentId, refDocId}', 1],
            [0, 1, 'nội dung mới → upload lần 2'],
            [1, 3, 'AES + pin ciphertext'],
            [1, 2, 'addDocuments (ví server ký)'],
            [1, 4, 'PartnerDocument mới'],
        ],
        ['Trùng byte và đang hiệu lực → không tốn gas/IPFS, chỉ thêm bản ghi tham chiếu cho tổ chức; đã thu hồi → cho đóng dấu lại bình thường.']);
}
function pageSeqApproveWallet() {
    return seqPage(
        [['Ví mới', 40], ['Frontend', 210], ['Backend', 390], ['ADMIN (MetaMask)', 580], ['Contract', 770]],
        [
            [0, 1, 'đăng nhập (ký challenge)'],
            [1, 2, 'GET /wallets/me → role = 0'],
            [0, 1, 'khai alias, email, requestedRole'],
            [1, 2, '/wallets/sync → vào khay chờ'],
            [3, 2, 'GET /wallets/pending (badge 30s)'],
            [3, 4, 'assignRole(ví, role) — ký 1 lần'],
            [4, 3, 'RoleAssigned', 1],
            [0, 1, 'poll 15s → quyền > 0'],
            [1, 0, 'mở toàn bộ chức năng\n(không cần đăng nhập lại)', 1],
        ],
        ['Cấp NGƯỜI XEM cho ví rank 0 chỉ ghi MongoDB (không tốn gas); phán quyết quyền luôn đọc trực tiếp từ contract, không tin DB.']);
}

// ================================================================
// ACTIVITY BỔ SUNG — 3 trang
// ================================================================
function pageActRevoke() {
    const c = [];
    const n = [
        V('', START, 180, 10, 20, 20),
        V('Chọn tài liệu → nhập lý do thu hồi\n(bắt buộc — ghi vĩnh viễn on-chain)', ACT, 90, 60, 240, 46),
        V('MetaMask ký revokeDocument', ACT, 90, 136, 240, 30),
        V('Contract kiểm tra quyền?', DEC, 140, 196, 140, 70),
        V('isRevoked=true + sự kiện\nDocumentRevoked (bất biến)', ACT, 90, 296, 240, 46),
        V('POST /api/batches/revoke\n→ đồng bộ MongoDB', ACT, 90, 372, 240, 46),
        V('Thông báo cho chủ sở hữu\n(khi người khác thu hồi)', ACT, 90, 448, 240, 46),
        V('', FINAL, 180, 524, 20, 20),
        V('Revert — không đủ quyền', ENDTXT, 420, 214, 170, 34),
    ];
    const ids = n.map(s => s.match(/id="(c\d+)"/)[1]);
    c.push(...n);
    c.push(E(ids[0], ids[1], 'endArrow=block;endFill=1;html=1;'));
    c.push(E(ids[1], ids[2], 'endArrow=block;endFill=1;html=1;'));
    c.push(E(ids[2], ids[3], 'endArrow=block;endFill=1;html=1;'));
    c.push(E(ids[3], ids[4], 'endArrow=block;endFill=1;html=1;', 'Đủ'));
    c.push(E(ids[3], ids[8], 'endArrow=block;endFill=1;html=1;', 'Không'));
    c.push(E(ids[4], ids[5], 'endArrow=block;endFill=1;html=1;'));
    c.push(E(ids[5], ids[6], 'endArrow=block;endFill=1;html=1;'));
    c.push(E(ids[6], ids[7], 'endArrow=block;endFill=1;html=1;'));
    c.push(V('Luật contract: uploader/QUẢN LÝ thu hồi được; tài liệu của ADMIN chỉ ADMIN; tài liệu đối tác chỉ ADMIN hoặc chính đối tác (bản tham chiếu dùng chung → 409).', NOTE, 400, 300, 260, 70));
    return c.join('\n');
}
function pageActEmail() {
    const c = [];
    const n = [
        V('', START, 180, 10, 20, 20),
        V('Cài đặt → đổi email', ACT, 90, 60, 240, 30),
        V('POST /auth/step-challenge\n→ ký lại MetaMask (step-up)', ACT, 90, 120, 240, 46),
        V('Chữ ký đúng chủ ví?', DEC, 140, 196, 140, 70),
        V('Ví đã có email cũ?', DEC, 140, 296, 140, 70),
        V('Gửi mã xác nhận 6 số\nvề EMAIL CŨ (TTL 5\', tối đa 5 lần)', ACT, 90, 396, 240, 46),
        V('Nhập mã →\nPOST /wallets/email/confirm', ACT, 90, 472, 240, 46),
        V('Đổi email + thông báo\ncho ví (cảnh báo bảo mật)', ACT, 90, 548, 240, 46),
        V('', FINAL, 180, 624, 20, 20),
        V('403 — step-up thất bại', ENDTXT, 420, 214, 170, 34),
        V('Gán email trực tiếp\n(lần đầu chưa có email)', ACT, 420, 310, 190, 44),
    ];
    const ids = n.map(s => s.match(/id="(c\d+)"/)[1]);
    c.push(...n);
    c.push(E(ids[0], ids[1], 'endArrow=block;endFill=1;html=1;'));
    c.push(E(ids[1], ids[2], 'endArrow=block;endFill=1;html=1;'));
    c.push(E(ids[2], ids[3], 'endArrow=block;endFill=1;html=1;', 'Đúng'));
    c.push(E(ids[2], ids[9], 'endArrow=block;endFill=1;html=1;', 'Sai'));
    c.push(E(ids[3], ids[4], 'endArrow=block;endFill=1;html=1;', 'Có'));
    c.push(E(ids[3], ids[10], 'endArrow=block;endFill=1;html=1;', 'Chưa'));
    c.push(E(ids[4], ids[5], 'endArrow=block;endFill=1;html=1;'));
    c.push(E(ids[5], ids[6], 'endArrow=block;endFill=1;html=1;'));
    c.push(E(ids[10], ids[6], 'endArrow=block;endFill=1;html=1;'));
    c.push(E(ids[6], ids[7], 'endArrow=block;endFill=1;html=1;'));
    return c.join('\n');
}
function pageActPartner() {
    const c = [];
    const n = [
        V('', START, 180, 10, 20, 20),
        V('POST /v1/documents\nx-api-key + file', ACT, 90, 60, 240, 40),
        V('Xác thực key (sha256)\n+ rate limit 60/phút', ACT, 90, 130, 240, 40),
        V('Key hợp lệ?', DEC, 140, 200, 140, 70),
        V('Hash file → tra sổ trùng\nví server on-chain', ACT, 90, 300, 240, 46),
        V('Đã đóng dấu\nvà còn hiệu lực?', DEC, 140, 376, 140, 70),
        V('PartnerDocument THAM CHIẾU\n(refDocId, cùng CID + khóa)\n— không tốn gas / IPFS', ACT, 90, 476, 240, 56),
        V('AES + pin IPFS\n+ addDocuments on-chain\n+ PartnerDocument mới', ACT, 420, 476, 220, 56),
        V('', FINAL, 180, 566, 20, 20),
        V('401 — key sai / thu hồi', ENDTXT, 420, 218, 170, 34),
    ];
    const ids = n.map(s => s.match(/id="(c\d+)"/)[1]);
    c.push(...n);
    c.push(E(ids[0], ids[1], 'endArrow=block;endFill=1;html=1;'));
    c.push(E(ids[1], ids[2], 'endArrow=block;endFill=1;html=1;'));
    c.push(E(ids[2], ids[3], 'endArrow=block;endFill=1;html=1;', 'Đúng'));
    c.push(E(ids[2], ids[9], 'endArrow=block;endFill=1;html=1;', 'Sai'));
    c.push(E(ids[3], ids[4], 'endArrow=block;endFill=1;html=1;'));
    c.push(E(ids[4], ids[5], 'endArrow=block;endFill=1;html=1;', 'Có'));
    c.push(E(ids[4], ids[6], 'endArrow=block;endFill=1;html=1;', 'Không / đã thu hồi'));
    c.push(E(ids[5], ids[7], 'endArrow=block;endFill=1;html=1;'));
    c.push(E(ids[6], ids[7], 'endArrow=block;endFill=1;html=1;', [[530, 570], [240, 570]]));
    return c.join('\n');
}

// ================================================================
// CLASS DIAGRAM — models + contract
// ================================================================
function pageClass() {
    const ents = [];
    ents.push(ent('«model» Wallet', ['+address: String (UK)', '+alias, email, phone', '+role, requestedRole, roleGranted', '+status: ACTIVE/REVOKED/DELETED', '+rejected, rejectCount…', '+storageUsed / storageLimit'], 60, 40, 300));
    ents.push(ent('«model» Batch', ['+batchId (UK), merkleRoot', '+ipfsCID, txHash', '+uploader → Wallet', '+files[] : Document nhúng'], 60, 320, 300));
    ents.push(ent('«embedded» FileItem', ['+docId, fileName, fileHash', '+ipfsCID, qrCode, encKey(GCM)', '+visibility, chunkHashes[]', '+replacesDocId → FileItem', '+isRevoked, revocationReason'], 440, 300, 300));
    ents.push(ent('«model» DeviceSession', ['+address → Wallet', '+deviceId, status', '+otpHash(scrypt), otpExpires', '+otpAttempts, otpFailed', '+lastSeen'], 440, 40, 300));
    ents.push(ent('«model» ApiKey', ['+keyHash = sha256(token)', '+prefix sk_live_…, revoked', '+createdBy → Wallet'], 60, 600, 300));
    ents.push(ent('«model» PartnerDocument', ['+docId (UK)', '+apiKeyId → ApiKey', '+orgName, fileHash, ipfsCID', '+encKey, txHash (server ký)', '+refDocId → on-chain docId', '+isSharedRef'], 440, 560, 300));
    ents.push(ent('«contract» DataIntegrity (Solidity)', ['+addDocuments(ids,hashes,uris)', '+getDocument(id) → tuple', '+revokeDocument(id,reason)', '+assignRole(addr,role)', '+userRoles(addr) → uint8', '«event» DocumentAdded / Revoked'], 820, 40, 300));
    ents.push(ent('«model» AuthChallenge\n«model» Notification', ['+address, challenge, expiresAt(TTL)', '+type, title, message, read'], 820, 340, 300));
    const [W, B, F, DS, AK, PD, SC, X] = ents.map(e => e.id);
    const cells = ents.map(e => e.xml).join('\n');
    const REL = 'endArrow=open;endFill=0;html=1;dashed=0;';
    const edges = [
        `<mxCell id="${nid()}" value="1 — n" style="${REL}" edge="1" parent="1" source="${DS}" target="${W}"><mxGeometry relative="1" as="geometry"/></mxCell>`,
        `<mxCell id="${nid()}" value="uploader" style="${REL}" edge="1" parent="1" source="${B}" target="${W}"><mxGeometry relative="1" as="geometry"/></mxCell>`,
        `<mxCell id="${nid()}" value="files[] nhúng" style="${REL}dashed=1;" edge="1" parent="1" source="${B}" target="${F}"><mxGeometry relative="1" as="geometry"/></mxCell>`,
        `<mxCell id="${nid()}" value="createdBy" style="${REL}" edge="1" parent="1" source="${AK}" target="${W}"><mxGeometry relative="1" as="geometry"/></mxCell>`,
        `<mxCell id="${nid()}" value="apiKeyId" style="${REL}" edge="1" parent="1" source="${PD}" target="${AK}"><mxGeometry relative="1" as="geometry"/></mxCell>`,
        `<mxCell id="${nid()}" value="docId / refDocId / uploader" style="${REL}dashed=1;" edge="1" parent="1" source="${B}" target="${SC}"><mxGeometry relative="1" as="geometry"/></mxCell>`,
        `<mxCell id="${nid()}" value="docId on-chain" style="${REL}dashed=1;" edge="1" parent="1" source="${PD}" target="${SC}"><mxGeometry relative="1" as="geometry"/></mxCell>`,
    ];
    return cells + '\n' + edges.join('\n');
}

// ================================================================
// DEPLOYMENT
// ================================================================
function pageDeploy() {
    const c = [];
    const node = (t, x, y, w, h) => V(t, 'shape=cube;size=12;whiteSpace=wrap;html=1;fontSize=11;fontStyle=1;align=center;', x, y, w, h);
    const n1 = node('Trình duyệt người dùng\n(HTML + Ethers.js + CryptoJS)\nMetaMask extension', 40, 60, 220, 90);
    const n2 = node('Render Web Service\nNode.js / Express :PORT\nserve index.html + /api/*', 380, 60, 240, 90);
    const n3 = node('MongoDB Atlas M0\n7 collections', 380, 240, 240, 80);
    const n4 = node('Pinata / IPFS\nciphertext + manifest', 700, 60, 220, 90);
    const n5 = node('Ethereum Sepolia\ncontract DataIntegrity\n(qua RPC endpoint)', 700, 240, 220, 90);
    const n6 = node('SMTP / Nodemailer\nOTP email', 60, 240, 200, 80);
    const n7 = node('Đối tác\n(REST + x-api-key)', 40, 400, 200, 80);
    c.push(n1, n2, n3, n4, n5, n6, n7);
    const idOf = s => s.match(/id="(c\d+)"/)[1];
    const L = 'endArrow=open;endFill=0;html=1;dashed=1;';
    c.push(E(idOf(n1), idOf(n2), L, 'HTTPS — same origin'));
    c.push(E(idOf(n1), idOf(n5), L, 'ký & ghi giao dịch (Ethers.js)'));
    c.push(E(idOf(n2), idOf(n3), L, 'Mongoose'));
    c.push(E(idOf(n2), idOf(n4), L, 'pin API + gateway'));
    c.push(E(idOf(n2), idOf(n5), L, 'đọc + ký thay cho đối tác'));
    c.push(E(idOf(n2), idOf(n6), L, 'OTP'));
    c.push(E(idOf(n7), idOf(n2), L, 'x-api-key'));
    c.push(V('Cấu hình qua biến môi trường Render: MONGO_URI (Atlas), PRIVATE_KEY (ví server ký), PINATA_*, CONTRACT_ADDRESS, RPC_URL, JWT_SECRET, MASTER_KEY, SMTP_*.', NOTE, 300, 420, 380, 60));
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
    ['UC — Xác thực & tra cứu', pageUCVerify],
    ['UC — Quản lý tài liệu', pageUCDocs],
    ['UC — Quản trị hệ thống', pageUCAdmin],
    ['UC — Đối tác API', pageUCPartner],
    ['SEQ — Đăng nhập challenge', pageSeqLogin],
    ['SEQ — Upload tài liệu', pageSeqUpload],
    ['SEQ — Verify công khai', pageSeqVerify],
    ['SEQ — Thu hồi tài liệu', pageSeqRevoke],
    ['SEQ — Đối tác upload (shared ref)', pageSeqPartner],
    ['SEQ — Phê duyệt ví mới', pageSeqApproveWallet],
    ['ACT — Thu hồi tài liệu', pageActRevoke],
    ['ACT — Đổi email (step-up)', pageActEmail],
    ['ACT — Đối tác upload', pageActPartner],
    ['CLASS — Models & Contract', pageClass],
    ['DEPLOY — Triển khai', pageDeploy],
];

const diagrams = pages.map(([name, fn], i) => {
    id = i * 1000; // id an toàn từng trang
    return `<diagram id="pg${i}" name="${esc(name)}"><mxGraphModel dx="800" dy="600" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" pageScale="1" math="0" shadow="0"><root><mxCell id="0"/><mxCell id="1" parent="0"/>${fn()}</root></mxGraphModel></diagram>`;
});

fs.writeFileSync('SoDo_Drawio.drawio', `<mxfile host="app.diagrams.net" modified="2026-10-25T00:00:00.000Z" agent="Devin" version="24.0.0">\n${diagrams.join('\n')}\n</mxfile>`);
console.log('Saved SoDo_Drawio.drawio —', pages.length, 'trang:', pages.map(p => p[0]).join(' | '));
