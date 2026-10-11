// =====================================================================
// XSS REGRESSION TESTS
// - Unit test hàm esc() (escape HTML entity)
// - Static guard: main.js / uiHandler.js không được chứa
//   1) inline event-handler attribute (onclick=, onchange=, ...)
//   2) biến dữ liệu nội suy thô vào attribute nguy hiểm (title/href/data-*)
//   3) biến dữ liệu nội suy thô trên dòng chứa markup HTML
//   4) biến dữ liệu nội suy thô trong Swal title:/text:/html: (Swal parse HTML)
// =====================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { esc } from '../assets/js/sanitize.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const readSrc = (rel) => readFileSync(path.join(here, '..', rel), 'utf8');
const SOURCES = {
    'main.js': readSrc('assets/js/main.js'),
    'uiHandler.js': readSrc('assets/js/uiHandler.js'),
};

// ---------------------------------------------------------------------
// 1. UNIT TESTS CHO esc()
// ---------------------------------------------------------------------
test('esc() escape đủ 6 ký tự nguy hiểm', () => {
    assert.equal(esc(`&<>"'\``), '&amp;&lt;&gt;&quot;&#39;&#96;');
});

test('esc() trung hòa payload XSS điển hình', () => {
    const out = esc(`<img src=x onerror=alert(1)>`);
    assert.ok(!out.includes('<'), 'phải không còn "<"');
    assert.ok(!out.includes('>'), 'phải không còn ">"');
    assert.equal(out, '&lt;img src=x onerror=alert(1)&gt;');
});

test('esc() escape quote để an toàn trong attribute', () => {
    const out = esc(`" onmouseover="alert(1)`);
    assert.ok(!out.includes('"'));
    assert.equal(out, '&quot; onmouseover=&quot;alert(1)');
});

test('esc() chịu được null/undefined/number', () => {
    assert.equal(esc(null), '');
    assert.equal(esc(undefined), '');
    assert.equal(esc(0), '0');
    assert.equal(esc(12.5), '12.5');
});

test('esc() giữ nguyên chuỗi không chứa ký tự đặc biệt', () => {
    assert.equal(esc('baocao_2024.pdf'), 'baocao_2024.pdf');
    assert.equal(esc('0x8b10e25a2c6f91a5969b8db38b88b9e1002e1911'), '0x8b10e25a2c6f91a5969b8db38b88b9e1002e1911');
});

// ---------------------------------------------------------------------
// 2. KHÔNG CÒN INLINE EVENT HANDLER TRONG HTML SINH ĐỘNG
//    (giá trị trong JS-string bên trong attribute là vector XSS mà escape
//    HTML đơn thuần không cứu được — phải dùng data-* + delegation)
// ---------------------------------------------------------------------
const INLINE_HANDLER = /on(?:click|change|input|error|load|focus|blur|mouseover|mouseenter|mouseleave|dblclick|submit|keydown|keyup)\s*=\s*["'`]/i;

for (const [name, src] of Object.entries(SOURCES)) {
    test(`${name}: không còn inline event-handler attribute (onclick=/onchange=/...)`, () => {
        const bad = [];
        src.split('\n').forEach((line, i) => {
            if (INLINE_HANDLER.test(line)) bad.push(`${i + 1}: ${line.trim().slice(0, 100)}`);
        });
        assert.deepEqual(bad, [], `Còn inline handler tại:\n${bad.join('\n')}`);
    });
}

// ---------------------------------------------------------------------
// 3. ATTRIBUTE NGUY HIỂM — mọi ${expr} trong title/href/src/style/
//    value/data-* phải qua esc() hoặc là giá trị allowlist đã-kiểm-soát
// ---------------------------------------------------------------------
const ATTR_ALLOWED = /^(esc\(|searchPayload$|index$|stt\b|pct\(|Number\(|isLocked\b|isThisRowAdmin\b|isRevoked\b)/;
// Bắt đúng giá trị attribute: title="...", href="...", data-*="..."
const ATTR_VALUE = /(?:title|href|src|style|value|data-[a-z-]+)="([^"\n]*)"/g;

// ---------------------------------------------------------------------
// 4. BIẾN DỮ LIỆU THÔ — cấm nội suy trực tiếp trên dòng có markup '<'
// ---------------------------------------------------------------------
const RAW_VAR = /^(w\.|fileDoc\.|file\.|doc\.|f\.|k\.|batch\.|docData\b|backendResult\.|p\.|ev\.args|docId\b|fileName\b|ipfsLink\b|ipfsCID\b|hash\b|reason\b|createTime\b|revokeTimeStr\b|timestamp\b|uploader\b|uploaderWallet\b|revokedBy\b|revoker\b|revocationReason\b|originalHash\b|currentHash\b|originalFileName\b|searchPayload\b|address\b|alias\b|securityAlert\b|role\b|status\b|storageUsed\b|storageLimit\b|storageTrend\b|fileTypes\b|currentRole\b|currentAlias\b|currentStatus\b|actionText\b|roleName\b|statusName\b)/;
const SAFE_EXPR = /esc\(|substring\(|toLocale|formatTimeForce|Number\(|pct\(|\?|getWalletName|\.length\b|isNaN\(|JSON\.|encodeURIComponent/;
// Dòng không phải ngữ cảnh HTML (innerText/log/selector/URL/Error) → bỏ qua
const SKIP_LINE = /UI\.updateProgress\(|UI\.logConsole\(|throw new Error|console\.|innerText|querySelector|getElementById|https?:\/\/|ipfs:\/\/|localStorage|sessionStorage|navigator\.|Blob\(|link\.|import |export |replace\(|DOMParser/;

// ---------------------------------------------------------------------
// 5. SWAL — title:/text:/html:/buttonText đều render HTML → nội suy phải esc
// ---------------------------------------------------------------------
const SWAL_LINE = /(?:title|text|html|footer|confirmButtonText|cancelButtonText)\s*:\s*`/;
const SWAL_ALLOWED = /\besc\b|\.length\b|\?/;

const INTERPOLATION = /\$\{([^{}]*)\}/g;

for (const [name, src] of Object.entries(SOURCES)) {
    test(`${name}: biến dữ liệu trong attribute/markup/Swal đều qua esc() hoặc allowlist`, () => {
        const bad = [];
        src.split('\n').forEach((line, i) => {
            if (!line.includes('${')) return;
            const exprs = [...line.matchAll(INTERPOLATION)].map(m => m[1].trim());
            if (exprs.length === 0) return;

            // a) Nội suy nằm TRONG giá trị attribute nguy hiểm → luôn phải allowlist
            const attrChecked = [];
            for (const m of line.matchAll(ATTR_VALUE)) {
                for (const e of [...m[1].matchAll(INTERPOLATION)].map(x => x[1].trim())) {
                    attrChecked.push(e);
                    if (!ATTR_ALLOWED.test(e)) {
                        bad.push(`${i + 1} [attr] ${e}  ::  ${line.trim().slice(0, 110)}`);
                    }
                }
            }

            const inMarkup = line.includes('<');
            const inSwal = SWAL_LINE.test(line);
            if (!inMarkup && !inSwal) return;
            if (SKIP_LINE.test(line)) return;

            const pending = [...exprs];
            for (const e of attrChecked) {
                const idx = pending.indexOf(e);
                if (idx !== -1) pending.splice(idx, 1); // expr đã qua attr-check → không check lại
            }

            for (const expr of pending) {
                // b) Swal title/text/html parse HTML → nội suy phải esc/map(esc)/length/ternary tĩnh
                if (inSwal && !SWAL_ALLOWED.test(expr)) {
                    bad.push(`${i + 1} [swal] ${expr}  ::  ${line.trim().slice(0, 110)}`);
                }
                // c) Biến dữ liệu thô trên dòng markup (text node / class / fragment)
                else if (inMarkup && RAW_VAR.test(expr) && !SAFE_EXPR.test(expr)) {
                    bad.push(`${i + 1} [markup] ${expr}  ::  ${line.trim().slice(0, 110)}`);
                }
            }
        });
        assert.deepEqual(bad, [], `Nội suy chưa escape:\n${bad.join('\n')}`);
    });
}

// ---------------------------------------------------------------------
// 6. KIỂM CHỨNG CÁC ĐIỂM SỬA CỤ THỂ (chống ai đó revert nhầm)
// ---------------------------------------------------------------------
test('main.js: getWalletName() escape alias từ localStorage', () => {
    assert.ok(SOURCES['main.js'].includes('esc(w.alias)'), 'alias phải qua esc()');
});

test('main.js: imageDiff chỉ chấp nhận data:image/* trước khi gán <img src>', () => {
    assert.ok(/\^data:image\\\//.test(SOURCES['main.js']), 'phải có guard data:image/');
});

test('main.js: IPFS link dùng rel="noopener noreferrer" khi mở tab mới', () => {
    const ipfsLinks = SOURCES['main.js'].match(/target="_blank"/g) || [];
    const safe = SOURCES['main.js'].match(/target="_blank" rel="noopener noreferrer"/g) || [];
    assert.equal(ipfsLinks.length, safe.length, 'mọi target=_blank phải có rel=noopener');
});

test('uiHandler.js: logConsole escape msg và hash', () => {
    assert.ok(SOURCES['uiHandler.js'].includes('esc(msg)'));
    assert.ok(SOURCES['uiHandler.js'].includes('esc(hash)'));
});

test('uiHandler.js: renderUploadFileList escape tên file', () => {
    assert.ok(SOURCES['uiHandler.js'].includes('esc(file.name)'));
});

test('uiHandler.js: qrCode chỉ gán src nếu là data:image/*', () => {
    assert.ok(SOURCES['uiHandler.js'].includes('data:image'), 'phải validate qrEl.src');
});
