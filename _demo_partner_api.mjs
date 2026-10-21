// =====================================================================
// DEMO API ĐỐI TÁC (B2B) — giả lập hệ thống của trường/tổ chức đối tác
// gọi sang hệ thống Data Integrity bằng sk_live_... API key.
//
// Cách dùng:
//   set BASE_URL=http://localhost:3000        (hoặc URL Render)
//   set API_KEY=sk_live_xxxxxxxxxxxxxxxx
//
//   node _demo_partner_api.mjs upload ./chung_chi.pdf
//   node _demo_partner_api.mjs verify ./chung_chi.pdf <documentId>
//   node _demo_partner_api.mjs list
//   node _demo_partner_api.mjs download <documentId>
//
// Lưu ý: node >= 18 (fetch/FormData/Blob có sẵn — không cần cài thêm gì).
// =====================================================================
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

let BASE = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
let KEY = process.env.API_KEY || '';
const [cmd, a1, a2] = process.argv.slice(2);

// Chỉ hỏi/chờ khi chạy terminal tương tác (double-click .bat, gõ lệnh tay).
// Khi bị pipe input (CI/script) → bỏ qua hỏi, dùng env đã có.
const interactive = !!process.stdin.isTTY;
const rl = interactive ? readline.createInterface({ input: process.stdin, output: process.stdout }) : null;
const ask = (question) => rl ? new Promise(r => rl.question(question, ans => r(ans.trim()))) : Promise.resolve('');

if (!KEY && cmd !== 'demo') {
    console.error('Thiếu API key. Đặt biến môi trường API_KEY=sk_live_... trước.');
    console.error('  Git Bash: API_KEY=sk_live_... node _demo_partner_api.mjs list');
    console.error('  CMD:      set API_KEY=sk_live_...&& node _demo_partner_api.mjs list');
    process.exit(1);
}

const headers = () => ({ 'x-api-key': KEY });

// fetch + bắt lỗi kết nối thân thiện (server chưa chạy / sai URL)
async function req(url, opts, action) {
    try {
        return await fetch(url, opts);
    } catch (e) {
        console.error(`\n[THẤT BẠI] ${action}: không kết nối được ${BASE}`);
        console.error('  → Nếu demo local: mở terminal khác chạy "node server.js" trước.');
        console.error('  → Nếu demo Render: nhập đúng URL https://<ten>.onrender.com (kiểm tra service đang sống — free plan ngủ sau ~15 phút, chờ 30-60s rồi thử lại).');
        process.exit(1);
    }
}

// Gọi API + xử lý lỗi gọn
async function call(res, action) {
    let data = null;
    try { data = await res.json(); } catch { /* response rỗng/binary */ }
    if (!res.ok) {
        console.error(`\n[THẤT BẠI] ${action}: HTTP ${res.status} — ${(data && data.message) || res.statusText}`);
        process.exit(1);
    }
    return data;
}

// Nhấn Enter để qua bước kế tiếp (demo trình chiếu); pipe input → chạy thẳng
const pause = (label) => rl
    ? new Promise(r => rl.question(`\n>>> ${label} — nhấn ENTER để tiếp tục...`, () => r()))
    : Promise.resolve(console.log(`\n>>> ${label}`));

// Upload 1 file, trả về response { documentId, fileHash, ipfsCID, txHash }
async function doUpload(filePath) {
    const form = new FormData();
    const buf = fs.readFileSync(filePath);
    form.append('document', new Blob([buf]), path.basename(filePath));
    console.log(`Đang upload "${path.basename(filePath)}" (${buf.length} bytes)...`);
    const data = await call(await req(`${BASE}/api/v1/documents`, {
        method: 'POST', headers: headers(), body: form
    }, 'Upload'), 'Upload');
    console.log('documentId :', data.documentId);
    console.log('fileHash   :', data.fileHash);
    console.log('ipfsCID    :', data.ipfsCID);
    console.log('txHash     :', data.txHash);
    console.log(`Etherscan  : https://sepolia.etherscan.io/tx/${data.txHash}`);
    return data;
}

// Verify 1 file với documentId, in kết quả
async function doVerify(filePath, docId) {
    const form = new FormData();
    form.append('document', new Blob([fs.readFileSync(filePath)]), path.basename(filePath));
    form.append('documentId', docId);
    console.log(`Đang verify "${path.basename(filePath)}" vs ${docId}...`);
    const data = await call(await req(`${BASE}/api/v1/verify`, {
        method: 'POST', headers: headers(), body: form
    }, 'Verify'), 'Verify');
    console.log('match      :', data.match ? '✅ KHỚP — nguyên vẹn' : '❌ LỆCH — nội dung đã bị sửa');
    console.log('isRevoked  :', data.isRevoked);
    console.log('timestamp  :', new Date(data.timestamp).toLocaleString('vi-VN'));
    return data;
}

switch (cmd) {
    // ---------------------------------------------------------------
    // upload <file> — gửi file plaintext, server tự mã hóa + ghi on-chain
    // ---------------------------------------------------------------
    case 'upload': {
        const filePath = a1;
        if (!filePath || !fs.existsSync(filePath)) {
            console.error('Dùng: node _demo_partner_api.mjs upload <đường_dẫn_file>');
            process.exit(1);
        }
        await doUpload(filePath);
        break;
    }

    // ---------------------------------------------------------------
    // verify <file> <documentId> — băm file rồi so với bản ghi on-chain
    // ---------------------------------------------------------------
    case 'verify': {
        const filePath = a1, docId = a2;
        if (!filePath || !docId || !fs.existsSync(filePath)) {
            console.error('Dùng: node _demo_partner_api.mjs verify <file> <documentId>');
            process.exit(1);
        }
        await doVerify(filePath, docId);
        break;
    }

    // ---------------------------------------------------------------
    // list — liệt kê tài liệu do chính API key này upload
    // ---------------------------------------------------------------
    case 'list': {
        console.log('Đang lấy danh sách tài liệu của đối tác...');
        const data = await call(await req(`${BASE}/api/v1/documents`, { headers: headers() }, 'List'), 'List');
        const docs = data.documents || [];
        console.log(`\n=== ${docs.length} TÀI LIỆU ===`);
        for (const d of docs) {
            console.log(`- ${d.docId}`);
            console.log(`    file: ${d.fileName} (${d.fileSize} bytes)${d.isRevoked ? ' [ĐÃ THU HỒI]' : ''}`);
            console.log(`    tx  : ${d.txHash}`);
        }
        break;
    }

    // ---------------------------------------------------------------
    // download <documentId> — tải file gốc đã giải mã về máy
    // ---------------------------------------------------------------
    case 'download': {
        const docId = a1;
        if (!docId) {
            console.error('Dùng: node _demo_partner_api.mjs download <documentId>');
            process.exit(1);
        }
        console.log(`Đang tải ${docId}...`);
        const res = await req(`${BASE}/api/v1/documents/${encodeURIComponent(docId)}/download`, { headers: headers() }, 'Download');
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            console.error(`\n[THẤT BẠI] HTTP ${res.status} — ${data.message || res.statusText}`);
            process.exit(1);
        }
        const buf = Buffer.from(await res.arrayBuffer());
        const outName = `downloaded_${docId.replace(/[^\w.\-]/g, '_')}`;
        fs.writeFileSync(outName, buf);
        console.log(`\nĐã lưu ${buf.length} bytes → ${outName}`);
        break;
    }

    // ---------------------------------------------------------------
    // demo — chạy cả kịch bản: upload → verify khớp → sửa file → verify
    // lệch → download → list. Chờ ENTER giữa các bước để trình chiếu.
    // ---------------------------------------------------------------
    case 'demo': {
        // Chạy qua .bat (double-click) thường không có env → hỏi tương tác
        if (interactive) {
            const baseAns = await ask(`Server URL [Enter=${BASE} | gõ "2"=Render onrender.com | hoặc dán URL khác]: `);
            if (baseAns === '2') BASE = 'https://blockchain-data-integrity.onrender.com';
            else if (baseAns) BASE = baseAns.replace(/\/$/, '');
            if (!KEY) KEY = await ask('API_KEY (sk_live_...): ');
        }
        if (!KEY) {
            console.error('[LOI] Chua nhap API key. Tao key trong web UI: Quan Ly API Keys -> Tao API Key moi.');
            process.exit(1);
        }
        console.log(`Server : ${BASE}`);
        console.log(`API key: ${KEY.slice(0, 18)}...`);

        const demoFile = '_demo_doitac.txt';
        console.log(`\n===== DEMO API ĐỐI TÁC — server: ${BASE} =====`);

        await pause('Bước 1/5: UPLOAD file văn bản mới (server mã hóa AES + ghi on-chain)');
        fs.writeFileSync(demoFile,
            `CONG HOA XA HOI CHU NGHIA VIET NAM\nCHUNG NHAN DEMO - Doi tac ${new Date().toLocaleDateString('vi-VN')}\nNoi dung goc, chua bi sua.\n`);
        const up = await doUpload(demoFile);
        const docId = up.documentId;

        await pause('Bước 2/5: VERIFY file gốc (phải KHỚP)');
        await doVerify(demoFile, docId);

        await pause('Bước 3/5: SỬA file rồi verify lại (phải LỆCH = phát hiện giả mạo)');
        fs.appendFileSync(demoFile, 'DA SUA: them dong nay sau khi dong dau.\n');
        await doVerify(demoFile, docId);

        await pause('Bước 4/5: DOWNLOAD file gốc đã giải mã từ hệ thống');
        {
            const res = await req(`${BASE}/api/v1/documents/${encodeURIComponent(docId)}/download`, { headers: headers() }, 'Download');
            if (!res.ok) {
                const d = await res.json().catch(() => ({}));
                console.error(`[THẤT BẠI] HTTP ${res.status} — ${d.message || res.statusText}`);
                process.exit(1);
            }
            const buf = Buffer.from(await res.arrayBuffer());
            const outName = `downloaded_${docId.replace(/[^\w.\-]/g, '_')}`;
            fs.writeFileSync(outName, buf);
            console.log(`Đã lưu ${buf.length} bytes → ${outName}`);
        }

        await pause('Bước 5/5: LIST tài liệu của đối tác');
        const data = await call(await req(`${BASE}/api/v1/documents`, { headers: headers() }, 'List'), 'List');
        const docs = data.documents || [];
        console.log(`=== ${docs.length} TÀI LIỆU ===`);
        for (const d of docs) console.log(`- ${d.docId}  (${d.fileName})${d.isRevoked ? ' [ĐÃ THU HỒI]' : ''}`);

        fs.rmSync(demoFile, { force: true });
        console.log('\n===== DEMO HOÀN TẤT =====');
        console.log('File đã sửa (_demo_doitac.txt) đã xóa. File tải về giữ lại để đối chiếu.');
        if (rl) rl.close();
        break;
    }

    default:
        console.log(`Dùng: node _demo_partner_api.mjs <lệnh>
  demo                       Chạy cả kịch bản demo (upload→verify→giả mạo→download)
  upload <file>              Upload tài liệu (server tự mã hóa + ghi on-chain)
  verify <file> <docId>      Xác thực file so với bản ghi blockchain
  list                       Liệt kê tài liệu của đối tác này
  download <docId>           Tải file gốc đã giải mã`);
}
