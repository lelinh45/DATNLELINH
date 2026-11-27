import { UI } from './uiHandler.js?v=20261122';
import { Web3Service } from './web3Service.js?v=20261122';
import { ApiService } from './apiService.js?v=20261122';
import { initDashboard } from './dashboard.js?v=20261122';
import { esc } from './sanitize.js?v=20261122';
import { CONFIG } from './config.js?v=20261122';

const web3 = new Web3Service();
let isProcessing = false;
let lastCertData = null;

// =====================================================================
// EVENT DELEGATION — thay toàn bộ onclick/onchange inline trong HTML sinh
// động. Dữ liệu đi qua data-* (đã qua esc()) → không còn JS trong attribute.
// =====================================================================
const deferAfterSwal = (fn) => { Swal.close(); setTimeout(fn, 200); };
document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const d = el.dataset;
    switch (d.act) {
        case 'copy':            UI.copyToClipboard(d.v || ''); break;
        case 'revoke':          if (d.v) window.revokeDoc(d.v); break;
        case 'lineage':         if (d.v) window.showLineage(d.v); break;
        case 'vis':             if (d.v) window.toggleDocVisibility(d.v, d.vis); break;
        case 'sign':            if (d.v) window.signPendingSeal(d.v); break;
        case 'seal':            if (d.v) window.sealPendingSeal(d.v); break;
        case 'decrypt':         window.downloadAndDecrypt(d.v, d.name || 'document', d.id); break;
        case 'preview':         window.previewDocument(d.v, d.name || 'document', d.id); break;
        case 'locked':          Swal.fire({ toast: true, position: 'top-end', icon: 'info', title: 'Tài liệu riêng tư — chỉ người tải lên xem được', background: 'var(--panel)', color: 'var(--ink)', timer: 2500, showConfirmButton: false }); break;
        case 'pdf':             if (lastCertData) UI.downloadPdfCertificate(lastCertData); break;
        case 'wallet-preview':  if (d.v) window.openPreviewDrawer(d.v); break;
        case 'storage':         if (d.v) window.openStorageModal(d.v); break;
        case 'drawer-close':    window.toggleDrawer(false); break;
        case 'rm-file':         window.removeUploadFile(Number(d.v)); break;
        case 'wallet-settings': e.stopPropagation(); window.manageSingleWalletSettings(d.v, d.status, d.role, d.alias); break;
        // Các nút trong modal tùy chọn ví: đóng Swal hiện tại rồi mới mở dialog kế
        case 'cfg-role':        deferAfterSwal(() => window.openChangeRole(d.v, d.role)); break;
        case 'cfg-alias':       deferAfterSwal(() => window.setWalletAlias(d.v, d.alias)); break;
        case 'cfg-lock':        deferAfterSwal(() => window.toggleWalletLock(d.v, d.locked === '1')); break;
        case 'cfg-delete':      deferAfterSwal(() => window.deleteWallet(d.v)); break;
        case 'approve-pending': window.fillAssignRole(d.v, d.alias, d.role); break;
        case 'reject-pending':  if (d.v) window.rejectPendingWallet(d.v, d.alias); break;
        case 'kick-session':    if (d.v) window.kickDeviceSession(d.v); break;
        case 'approve-session': if (d.v) window.approveDeviceSession(d.v); break;
        case 'revoke-key':      if (d.v) window.revokeApiKey(d.v); break;
        case 'webhook-key':     if (d.v) window.editApiKeyWebhook(d.v, d.url || ''); break;
        case 'expand': {
            // Bảng lịch sử: mở/đóng dòng chi tiết ngay sau dòng tài liệu
            const tr = el.closest('tr');
            const det = tr && tr.nextElementSibling;
            if (det && det.classList.contains('doc-detail')) {
                det.classList.toggle('hidden');
                el.classList.toggle('text-accent', !det.classList.contains('hidden'));
            }
            break;
        }
        case 'pg-prev': case 'pg-next': {
            const tb = document.getElementById(d.t);
            if (tb) paginateTbody(tb, (pgPageById.get(tb.id) || 1) + (d.act === 'pg-next' ? 1 : -1));
            break;
        }
    }
});
document.addEventListener('change', (e) => {
    if (e.target.matches('.row-checkbox')) window.checkSelection();
});

// =====================================================================
// THÔNG BÁO & PHIÊN ĐĂNG NHẬP THEO THIẾT BỊ
// =====================================================================
const NOTIF_ICON = {
    new_device: { icon: 'fa-triangle-exclamation', cls: 'text-warn' },
    new_wallet: { icon: 'fa-user-plus', cls: 'text-violet' },
    device_pending: { icon: 'fa-clock', cls: 'text-warn' },
    device_approved: { icon: 'fa-circle-check', cls: 'text-ok' },
    doc_revoked: { icon: 'fa-ban', cls: 'text-err' },
    session_revoked: { icon: 'fa-shield-halved', cls: 'text-accent' },
    system: { icon: 'fa-circle-info', cls: 'text-muted' }
};

async function refreshNotifBadge() {
    if (!ApiService.hasValidToken()) return;
    // Badge = thông báo chưa đọc + thiết bị đang chờ duyệt — một thiết bị pending
    // chỉ tạo 1 thông báo (chống spam), sau khi đã đọc thì badge vẫn phải còn
    // chừng nào thiết bị đó chưa được duyệt/từ chối.
    const [{ unread }, { sessions }] = await Promise.all([
        ApiService.getNotifications(), ApiService.getSessions()
    ]);
    const pendingN = (sessions || []).filter(s => s.status === 'pending').length;
    const total = unread + pendingN;
    const badge = document.getElementById('notif-badge');
    if (!badge) return;
    badge.textContent = total > 99 ? '99+' : total;
    badge.classList.toggle('hidden', !total);
    badge.classList.toggle('flex', !!total);
}

async function renderNotifPanel() {
    const listEl = document.getElementById('notif-list');
    const sessEl = document.getElementById('session-list');
    if (!listEl || !sessEl) return;
    listEl.innerHTML = '<div class="px-4 py-6 text-center text-faint text-xs">Đang tải...</div>';

    const [{ notifications }, { sessions }] = await Promise.all([
        ApiService.getNotifications(), ApiService.getSessions()
    ]);

    listEl.scrollTop = 0; // luôn neo về thông báo mới nhất (đã sort createdAt desc)
    listEl.innerHTML = notifications.length === 0
        ? '<div class="px-4 py-6 text-center text-faint text-xs">Chưa có thông báo nào.</div>'
        : notifications.map(n => {
            const ic = NOTIF_ICON[n.type] || NOTIF_ICON.system;
            return `<div class="px-4 py-3 ${n.read ? 'opacity-60' : 'bg-accent-soft'}">
                <div class="flex items-start gap-2.5">
                    <i class="fa-solid ${ic.icon} ${ic.cls} mt-0.5 text-xs"></i>
                    <div class="flex-1 min-w-0">
                        <div class="text-xs font-bold text-soft">${esc(n.title)}</div>
                        <div class="text-[11px] text-muted mt-0.5 break-words">${esc(n.message)}</div>
                        <div class="text-[10px] text-faint mt-1">${esc(window.formatTimeForce(n.createdAt))}</div>
                    </div>
                    ${n.read ? '' : '<span class="w-2 h-2 rounded-full bg-accent mt-1.5 shrink-0"></span>'}
                </div>
            </div>`;
        }).join('');

    const myDev = ApiService.getDeviceId();
    sessEl.innerHTML = sessions.length === 0
        ? '<div class="text-[11px] text-faint">Không có phiên nào.</div>'
        : sessions.map(s => {
            const isPending = s.status === 'pending';
            const actions = s.current ? '' : isPending
                ? `<div class="flex gap-1.5 shrink-0">
                       <button data-act="approve-session" data-v="${esc(s.deviceId)}" class="text-[10px] font-bold text-ok hover:text-ok bg-ok-soft border border-ok px-2 py-1 rounded transition">Duyệt</button>
                       <button data-act="kick-session" data-v="${esc(s.deviceId)}" class="text-[10px] font-bold text-err hover:text-err bg-err-soft border border-err px-2 py-1 rounded transition">Từ chối</button>
                   </div>`
                : `<button data-act="kick-session" data-v="${esc(s.deviceId)}" class="text-[10px] font-bold text-err hover:text-err bg-err-soft border border-err px-2 py-1 rounded transition shrink-0">Thu hồi</button>`;
            return `<div class="flex items-center justify-between bg-panel border ${isPending ? 'border-warn' : 'border-line'} rounded-lg px-3 py-2">
                <div class="min-w-0">
                    <div class="text-[11px] font-bold text-soft truncate">${esc(s.deviceLabel)}${s.current ? ' <span class="text-ok text-[9px]">(thiết bị này)</span>' : ''}</div>
                    <div class="text-[10px] ${isPending ? 'text-warn' : 'text-faint'}">${isPending ? 'Chờ phê duyệt' : 'Hoạt động'}: ${esc(window.formatTimeForce(s.lastSeen))}${s.ip ? ` · IP ${esc(s.ip)}` : ''}</div>
                </div>
                ${actions}
            </div>`;
        }).join('');
}

// Step-up auth: các thao tác nhạy cảm (thu hồi/duyệt phiên, đổi email) phải
// ký MetaMask lại tại thời điểm thực hiện — JWT phiên không đủ, chống kẻ
// mượn session sống chiếm quyền ví.
async function stepUp() {
    return ApiService.stepUpSign(web3.signer);
}

// Lưu liên hệ ví. Đổi email khi đã có email cũ → server gửi mã 6 số về
// email CŨ, phải nhập mã mới chuyển thật (pending → confirm).
async function saveContactWithConfirm(email, phone) {
    const res = await ApiService.setWalletContact(email, phone, await stepUp());
    if (res && res.pending) {
        const ask = await Swal.fire({
            title: 'Xác nhận trên email hiện tại',
            html: `Mã 6 số đã gửi về <b>${esc(res.maskedEmail || 'email hiện tại')}</b>.<br>Nhập mã để hoàn tất đổi email.`,
            input: 'text', inputAttributes: { maxlength: '6', inputmode: 'numeric', autocomplete: 'one-time-code' },
            icon: 'info', showCancelButton: true, confirmButtonText: 'Xác nhận', cancelButtonText: 'Để sau',
            background: 'var(--panel)', color: 'var(--ink)'
        });
        if (ask.isConfirmed && ask.value) {
            await ApiService.confirmEmailChange(ask.value.trim());
            res.pending = false;
        }
    }
    return res;
}

window.kickDeviceSession = async (deviceId) => {
    const ok = await Swal.fire({
        title: 'Thu hồi phiên?', text: 'Thiết bị này sẽ bị đăng xuất ngay. Bạn cần ký MetaMask để xác nhận.',
        icon: 'warning', showCancelButton: true, confirmButtonText: 'Thu hồi', cancelButtonText: 'Hủy',
        background: 'var(--panel)', color: 'var(--ink)', confirmButtonColor: 'var(--err)'
    });
    if (!ok.isConfirmed) return;
    try {
        await ApiService.revokeSession(deviceId, await stepUp());
        Swal.fire({ title: 'Đã thu hồi', text: 'Phiên trên thiết bị đó đã bị vô hiệu hóa.', icon: 'success', background: 'var(--panel)', color: 'var(--ink)', timer: 1500, showConfirmButton: false });
        renderNotifPanel();
    } catch (e) {
        Swal.fire({ title: 'Thất bại', text: getShortError(e), icon: 'error', background: 'var(--panel)', color: 'var(--ink)' });
    }
};

// Duyệt thiết bị đang pending — thiết bị kia sẽ tự vào được ở lần poll kế tiếp
window.approveDeviceSession = async (deviceId) => {
    const ok = await Swal.fire({
        title: 'Phê duyệt thiết bị?', text: 'Thiết bị này sẽ được cấp quyền đăng nhập vào ví của bạn. Bạn cần ký MetaMask để xác nhận.',
        icon: 'question', showCancelButton: true, confirmButtonText: 'Phê duyệt', cancelButtonText: 'Hủy',
        background: 'var(--panel)', color: 'var(--ink)', confirmButtonColor: 'var(--ok)'
    });
    if (!ok.isConfirmed) return;
    try {
        await ApiService.approveSession(deviceId, await stepUp());
        Swal.fire({ title: 'Đã phê duyệt', text: 'Thiết bị đó giờ có thể đăng nhập.', icon: 'success', background: 'var(--panel)', color: 'var(--ink)', timer: 1500, showConfirmButton: false });
        renderNotifPanel();
    } catch (e) {
        Swal.fire({ title: 'Thất bại', text: getShortError(e), icon: 'error', background: 'var(--panel)', color: 'var(--ink)' });
    }
};

function initNotificationUI() {
    const btn = document.getElementById('btn-notifications');
    const dd = document.getElementById('notif-dropdown');
    if (!btn || !dd) return;

    btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const willOpen = dd.classList.contains('hidden');
        dd.classList.toggle('hidden');
        if (willOpen) {
            document.getElementById('pending-dropdown')?.classList.add('hidden');
            await renderNotifPanel();
            await ApiService.markNotificationsRead();
            refreshNotifBadge();
        }
    });
    document.getElementById('btn-notif-readall')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        await ApiService.markNotificationsRead();
        renderNotifPanel(); refreshNotifBadge();
    });
    document.addEventListener('click', (e) => {
        if (!dd.classList.contains('hidden') && !dd.contains(e.target) && !btn.contains(e.target)) dd.classList.add('hidden');
    });
    // Poll badge 30s/lần khi đã đăng nhập
    setInterval(refreshNotifBadge, 30000);
    refreshNotifBadge();
}

// =====================================================================
// KHAY VÍ CHỜ CẤP QUYỀN — icon cạnh chuông, chỉ hiện với ví ADMIN
// =====================================================================
async function refreshPendingBadge() {
    if (pendingGateActive) return; // ví ở phòng chờ không gọi API admin
    if (!ApiService.hasValidToken()) return;
    const wallets = await ApiService.getPendingWallets();
    const wrap = document.getElementById('pending-wrap');
    const badge = document.getElementById('pending-badge');
    if (!wrap || !badge) return;
    if (wallets === null) { wrap.style.display = 'none'; return; } // không phải ADMIN → ẩn icon
    wrap.style.display = '';
    badge.textContent = wallets.length > 99 ? '99+' : wallets.length;
    badge.classList.toggle('hidden', wallets.length === 0);
    badge.classList.toggle('flex', wallets.length > 0);
}

async function renderPendingPanel() {
    const listEl = document.getElementById('pending-list');
    if (!listEl) return;
    listEl.innerHTML = '<div class="px-4 py-6 text-center text-faint text-xs">Đang tải...</div>';
    const wallets = await ApiService.getPendingWallets();
    if (wallets === null) {
        listEl.innerHTML = '<div class="px-4 py-6 text-center text-faint text-xs">Chỉ ADMIN mới xem được.</div>';
        return;
    }
    listEl.scrollTop = 0; // neo về ví chờ mới nhất
    listEl.innerHTML = wallets.length === 0
        ? '<div class="px-4 py-6 text-center text-faint text-xs">Không có ví nào đang chờ.</div>'
        : wallets.map(w => {
            const contact = [w.email, w.phone].filter(Boolean).join(' · ') || 'Chưa điền liên hệ';
            const time = w.lastActive ? new Date(w.lastActive).toLocaleString('vi-VN') : '—';
            return `
            <div class="px-4 py-3">
                <div class="flex items-start justify-between gap-2">
                    <div class="min-w-0 flex-1">
                        <div class="text-sm font-bold text-ink truncate">${esc(w.alias || '— chưa đặt tên —')}</div>
                        <div class="flex items-center gap-1.5 mt-0.5">
                            <span class="font-mono text-[11px] text-accent truncate">${esc(w.address)}</span>
                            <button data-act="copy" data-v="${esc(w.address)}" class="text-faint hover:text-ink text-[11px] shrink-0" title="Copy địa chỉ ví"><i class="fa-regular fa-copy"></i></button>
                        </div>
                        <div class="text-[10px] text-faint mt-1 truncate">${esc(contact)}</div>
                        <div class="text-[10px] mt-0.5">
                            <span class="text-warn font-bold">Muốn quyền: ${esc(w.requestedRole || 'chưa chọn')}</span>
                            <span class="text-faint"> · ${time}</span>
                        </div>
                    </div>
                    <div class="flex flex-col gap-1.5 shrink-0">
                        <button data-act="approve-pending" data-v="${esc(w.address)}" data-alias="${esc(w.alias || '')}" data-role="${esc(w.requestedRole || '')}" class="bg-ok hover:brightness-110 text-white text-[11px] font-bold px-3 py-1.5 rounded-lg transition">Duyệt</button>
                        <button data-act="reject-pending" data-v="${esc(w.address)}" data-alias="${esc(w.alias || '')}" class="bg-err-soft hover:brightness-110 text-err border border-err text-[11px] font-bold px-3 py-1.5 rounded-lg transition">Từ chối</button>
                    </div>
                </div>
            </div>`;
        }).join('');
}

// Điền sẵn form cấp quyền từ khay chờ — admin chỉ cần bấm "Thực thi"
window.fillAssignRole = function(address, alias, requestedRole) {
    const addrEl = document.getElementById('newRoleAddress');
    const aliasEl = document.getElementById('newRoleAlias');
    const levelEl = document.getElementById('newRoleLevel');
    if (addrEl) addrEl.value = address;
    if (aliasEl) aliasEl.value = alias || '';
    if (levelEl) levelEl.value = requestedRole === 'QUẢN LÝ' ? '2' : requestedRole === 'NGƯỜI XEM' ? 'viewer' : '1';
    document.getElementById('pending-dropdown')?.classList.add('hidden');
    document.getElementById('nav-roles')?.click();
    // Mở form phân quyền (đang tự thu gọn sau 3s) rồi cuộn tới + nháy sáng
    // để admin thấy rõ thông tin đã được điền sẵn
    window.openRoleForm?.();
    setTimeout(() => {
        addrEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const box = document.getElementById('admin-role-collapse');
        box?.classList.add('ring-2', 'ring-ok', 'rounded-md');
        setTimeout(() => box?.classList.remove('ring-2', 'ring-ok', 'rounded-md'), 2500);
        addrEl?.focus();
    }, 120);
    Swal.fire({ toast: true, position: 'top-end', icon: 'info', title: `Đã điền thông tin ví ${esc(alias || address.slice(0,10)+'…')} — chọn quyền rồi bấm Thực thi`, background: 'var(--panel)', color: 'var(--ink)', timer: 3000, showConfirmButton: false });
};

// Từ chối ví chờ: khóa ví trong DB (status REVOKED) — biến mất khỏi khay chờ,
// hiện trong bảng Quản Lý Ví ở trạng thái TẠM KHÓA, và ví kia thấy "đã bị từ chối"
window.rejectPendingWallet = async function(address, alias) {
    const cf = await Swal.fire({
        title: 'Từ chối ví này?',
        html: `Ví <b>${esc(alias || '')}</b><br><span class="font-mono text-xs">${esc(address)}</span><br>sẽ bị khóa và phải liên hệ Admin để được xem xét lại.`,
        icon: 'warning', showCancelButton: true, confirmButtonText: 'Từ chối', cancelButtonText: 'Hủy',
        confirmButtonColor: 'var(--err)', background: 'var(--panel)', color: 'var(--ink)'
    });
    if (!cf.isConfirmed) return;
    try {
        await ApiService.rejectWallet(address);
        await renderPendingPanel();
        refreshPendingBadge();
        Swal.fire({ title: 'Đã từ chối', icon: 'success', timer: 1500, showConfirmButton: false, background: 'var(--panel)', color: 'var(--ink)' });
    } catch (e) {
        Swal.fire({ title: 'Thất bại', text: getShortError(e), icon: 'error', background: 'var(--panel)', color: 'var(--ink)' });
    }
};

function initPendingWalletsUI() {
    const btn = document.getElementById('btn-pending');
    const dd = document.getElementById('pending-dropdown');
    if (!btn || !dd) return;
    btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const willOpen = dd.classList.contains('hidden');
        dd.classList.toggle('hidden');
        if (willOpen) {
            // Neo thẳng vào tọa độ nút bằng fixed — không phụ thuộc container
            // cha (display/overflow thay đổi vẫn không bị lệch khỏi icon)
            const r = btn.getBoundingClientRect();
            dd.style.position = 'fixed';
            dd.style.top = `${Math.round(r.bottom + 8)}px`;
            dd.style.left = 'auto';
            dd.style.right = `${Math.round(window.innerWidth - r.right)}px`;
            document.getElementById('notif-dropdown')?.classList.add('hidden');
            await renderPendingPanel();
        }
    });
    document.addEventListener('click', (e) => {
        if (!dd.classList.contains('hidden') && !dd.contains(e.target) && !btn.contains(e.target)) dd.classList.add('hidden');
    });
    setInterval(refreshPendingBadge, 30000);
}

// =====================================================================
// ĐỒNG BỘ TIẾN TRÌNH VỚI CỬA SỔ TERMINAL (HỘP ĐEN)
// =====================================================================
const originalUpdateProgress = UI.updateProgress;
let progressIdleTimer = null;
const PROGRESS_TERMINAL = ['SUCCESS', 'VERIFIED', 'FAILED', 'ERROR', 'REVOKED', 'NOT FOUND'];

// Step indicator upload — chỉ map status → bước hiển thị, không đổi flow gọi
const UPLOAD_STEP_BY_STATUS = {
    SCANNING: 1, HASHING: 1, QUERYING: 1, ANALYZING: 1, PROCESSING: 1,
    ENCRYPTING: 2, UPLOADING: 3, 'MERKLE TREE': 4, SIGNING: 4
};
function updateUploadSteps(status) {
    const wrap = document.getElementById('upload-steps');
    if (!wrap) return;
    const steps = wrap.querySelectorAll('.bdi-step');
    if (!steps.length) return;
    const active = status === 'SUCCESS' ? 5 : (UPLOAD_STEP_BY_STATUS[status] || 0);
    steps.forEach((el, i) => {
        const n = i + 1;
        el.classList.toggle('on', n === active);
        el.classList.toggle('done', status === 'SUCCESS' || n < active);
    });
}

// Nhãn bước chi tiết dưới thanh % — chỉ gán "Bước x/5" cho status riêng của upload,
// status dùng chung (HASHING/QUERYING...) chỉ hiện nhãn chung để không gán sai bước.
const PROGRESS_STAGE = {
    SCANNING: 'Đang quét & chuẩn bị dữ liệu', HASHING: 'Đang băm SHA-256',
    QUERYING: 'Đang truy vấn sổ cái', ANALYZING: 'Đang phân tích dữ liệu',
    PROCESSING: 'Đang gửi giao dịch lên Sepolia',
    ENCRYPTING: 'Bước 2/5 · Mã hóa AES từng file',
    UPLOADING: 'Bước 3/5 · Pin nội dung mã hóa lên IPFS',
    'MERKLE TREE': 'Bước 4/5 · Merkle Root + manifest',
    SIGNING: 'Bước 4/5 · Chờ ký 1 giao dịch trên Sepolia',
    SYNCING: 'Đang đồng bộ trạng thái vào Database',
    REVOKING: 'Đang ghi thu hồi lên contract',
    SUCCESS: 'Hoàn tất', VERIFIED: 'Giám định hoàn tất', REVOKED: 'Đã thu hồi',
    FAILED: 'Thất bại', ERROR: 'Lỗi', 'NOT FOUND': 'Không tìm thấy'
};
const WAIT_WALLET_STATUSES = new Set(['SIGNING', 'REVOKING']);

UI.updateProgress = function(percent, message, status) {
    if (originalUpdateProgress) {
        originalUpdateProgress.call(UI, percent, message, status);
    }
    updateUploadSteps(status);

    // Trạng thái chờ ví: bar sọc chạy + badge "CHỜ DUYỆT VÍ" + stage kèm địa chỉ ví
    const isWaiting = WAIT_WALLET_STATUSES.has(status)
        || (status === 'PROCESSING' && /metamask/i.test(String(message || '')));
    const box = document.getElementById('progress-box');
    if (box) box.classList.toggle('waiting', isWaiting);
    const badge = document.getElementById('status-badge');
    if (badge && isWaiting && percent !== 100) {
        badge.innerText = 'CHỜ DUYỆT VÍ';
        badge.className = 'bg-warn-soft text-warn border border-warn text-[10px] px-2 py-0.5 rounded font-bold';
    }
    const stageEl = document.getElementById('progress-stage');
    if (stageEl) {
        let stage = PROGRESS_STAGE[status] || '';
        if (isWaiting && web3 && web3.currentAccount) {
            const a = web3.currentAccount;
            stage += ` · ví ${a.substring(0, 6)}...${a.substring(38)}`;
        }
        stageEl.innerText = stage;
    }

    // Trạng thái kết thúc (100% hoặc lỗi/dừng) → tự trả về "đang rảnh" sau 4s,
    // trừ khi một tiến trình mới đã bắt đầu trước đó (timer bị hủy ở mọi lần gọi).
    if (progressIdleTimer) { clearTimeout(progressIdleTimer); progressIdleTimer = null; }
    if (status !== 'STANDBY' && (percent === 100 || PROGRESS_TERMINAL.includes(status))) {
        progressIdleTimer = setTimeout(() => {
            progressIdleTimer = null;
            UI.updateProgress(0, "Hệ thống đang rảnh", "STANDBY");
        }, 4000);
    }

    const consoleBox = document.getElementById('consoleBox');
    if (consoleBox && message) {
        if (percent === 0 && message === "Hệ thống đang rảnh") return;
        const time = new Date().toLocaleTimeString('vi-VN');
        let colorClass = 'text-muted';
        if (status === 'SUCCESS' || status === 'VERIFIED') colorClass = 'text-ok font-bold';
        else if (status === 'FAILED' || status === 'ERROR' || status === 'REVOKED') colorClass = 'text-err font-bold';
        else if (status === 'SCANNING' || status === 'ANALYZING') colorClass = 'text-warn';
        else colorClass = 'text-accent';

        const logEntry = document.createElement('div');
        logEntry.className = `mb-1.5 ${colorClass} font-mono text-[11px] leading-relaxed`;
        logEntry.innerHTML = `<span class="text-faint">[${time}]</span> >${esc(message)}`;

        consoleBox.appendChild(logEntry);
        consoleBox.scrollTop = consoleBox.scrollHeight; 
    }
};

// Terminal tự bám đáy: khi cột trái render lại (bảng lịch sử, file queue...)
// consoleBox bị co/giãn theo grid items-stretch — trình duyệt giữ nguyên
// scrollTop nên box trông như "nhảy lên giữa". ResizeObserver snap lại về đáy,
// trừ khi user đã tự cuộn lên để đọc log cũ (hủy pin, đến log mới pin lại).
let consolePinned = true;
const _consoleEl = document.getElementById('consoleBox');
if (_consoleEl) {
    _consoleEl.addEventListener('scroll', () => {
        consolePinned = _consoleEl.scrollTop + _consoleEl.clientHeight >= _consoleEl.scrollHeight - 4;
    });
    new ResizeObserver(() => {
        if (consolePinned) _consoleEl.scrollTop = _consoleEl.scrollHeight;
    }).observe(_consoleEl);
}

// =====================================================================
// CÁC HÀM TIỆN ÍCH
// =====================================================================
window.formatTimeForce = function(timestamp) {
    const d = new Date(timestamp);
    if (isNaN(d.getTime())) return '---';
    const hh = d.getHours().toString().padStart(2, '0');
    const mm = d.getMinutes().toString().padStart(2, '0');
    const ss = d.getSeconds().toString().padStart(2, '0');
    const dd = d.getDate().toString().padStart(2, '0');
    const mo = (d.getMonth() + 1).toString().padStart(2, '0');
    return `${hh}:${mm}:${ss} ${dd}/${mo}/${d.getFullYear()}`;
};

// Admin đặt tên nhân viên cho ví
window.setWalletAlias = async function(address, currentAlias) {
    const { value: newAlias } = await Swal.fire({
        title: 'ĐẶT TÊN NHÂN VIÊN',
        input: 'text',
        inputAttributes: { autocomplete: 'off' },
        inputValue: currentAlias && currentAlias !== 'null' ? currentAlias : '',
        inputPlaceholder: 'VD: User 1, Kế toán trưởng, Nguyễn Văn A...',
        showCancelButton: true,
        confirmButtonText: 'Lưu Tên',
        cancelButtonText: 'Hủy',
        background: 'var(--panel)', color: 'var(--ink)', confirmButtonColor: 'var(--accent)'
    });
    if (newAlias !== undefined) {
        await ApiService.syncWalletData(address, { alias: newAlias.trim() });
        window.loadWalletRoles(); // Load lại bảng Ví
        if (typeof loadTransactionHistory === 'function') loadTransactionHistory(); // Load lại Sổ cái
        Swal.fire({ title: 'Thành công', text: 'Đã cập nhật danh bạ ví.', icon: 'success', background: 'var(--panel)', color: 'var(--ink)', timer: 1500, showConfirmButton: false });
    }
};

//Hàm getWalletName ưu tiên hiển thị tên
window.getWalletName = function(address) {
    if (!address) return '---';
    const adminAddr = window.__chainOwner || "0x8b10e25a2c6f91a5969b8db38b88b9e1002e1911";
    const target = address.toLowerCase();
    const shortAddr = `${address.substring(0, 6)}...${address.substring(38)}`;

    let wallets = JSON.parse(localStorage.getItem('bdi_authorized_wallets')) || [];
    let w = wallets.find(x => x.address && x.address.toLowerCase() === target);
    let displayName = (w && w.alias) ? `<span class="font-bold text-ink">${esc(w.alias)}</span> <span class="text-[9px] text-faint">(${esc(shortAddr)})</span>` : esc(shortAddr);

    if (target === adminAddr) {
        return `<span class="text-warn font-bold bg-warn-soft px-1.5 py-0.5 rounded border border-warn mr-1 text-[9px] uppercase">Admin</span><span class="text-muted font-mono">${displayName}</span>`;
    }
    
    return `<span class="text-accent font-mono bg-accent-soft px-1.5 py-0.5 rounded border border-accent-line">${displayName}</span>`;
};

// Nhãn gọn cho cột NGUỒN GỐC: tên (hoặc địa chỉ ngắn) + mã ví rút gọn + cờ ADMIN.
// name === short khi ví chưa đặt alias — cell chỉ hiện 1 lần, không trùng.
window.getWalletLabel = function(address) {
    if (!address) return { name: '---', short: '', isAdmin: false, full: '' };
    const adminAddr = (window.__chainOwner || "0x8b10e25a2c6f91a5969b8db38b88b9e1002e1911").toLowerCase();
    const target = address.toLowerCase();
    const short = `${address.substring(0, 6)}...${address.substring(38)}`;
    let alias = '';
    try {
        const wallets = JSON.parse(localStorage.getItem('bdi_authorized_wallets') || '[]');
        const w = wallets.find(x => x.address && x.address.toLowerCase() === target);
        alias = (w && w.alias) ? w.alias : '';
    } catch (e) {}
    return { name: alias || short, short, isAdmin: target === adminAddr, full: address };
};

// Badge "ĐỐI TÁC · orgName" cho tài liệu upload qua API key đối tác —
// giao dịch on-chain do server ký hộ bằng ví ADMIN nên cần badge phân biệt
window.partnerBadge = (partnerOrgs, docId) => {
    const org = partnerOrgs && partnerOrgs[docId];
    if (!org) return '';
    return `<div class="mt-1"><span class="text-warn font-bold bg-warn-soft px-1.5 py-0.5 rounded border border-warn text-[9px] uppercase" title="Tài liệu upload qua API đối tác — server ký giao dịch hộ bằng ví ADMIN"><i class="fa-solid fa-handshake mr-1"></i>Đối tác · ${esc(org)}</span></div>`;
};

window.copyDocId = (text) => UI.copyToClipboard(text);
window.copyWallet = (wallet) => UI.copyToClipboard(wallet);
window.triggerDownloadPdf = () => { if (lastCertData) UI.downloadPdfCertificate(lastCertData); };

window.downloadBatchReport = () => {
    if (!window.currentBatchReportHTML) return;
    const blob = new Blob([window.currentBatchReportHTML], { type: 'text/html;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `Bao_Cao_Lo_IPFS_${new Date().getTime()}.html`;
    link.click();
    URL.revokeObjectURL(link.href);
};

window.copyAPIKey = function (fullKey) {
    navigator.clipboard.writeText(fullKey).then(() => {
        if (typeof Swal !== 'undefined') {
            Swal.fire({ 
                toast: true, position: 'top-end', icon: 'success', 
                title: 'Đã sao chép API Key!', showConfirmButton: false, 
                timer: 2000, background: 'var(--panel)', color: 'var(--ink)' 
            });
        }
    }).catch(err => console.error('Lỗi khi copy: ', err));
};

// Chuỗi bắt đầu bằng "0x" → lọc CHẶT: chỉ khớp khi trùng toàn bộ địa chỉ ví uploader.
// Chuỗi thường → tìm kiếm mờ (chứa chuỗi) trên docId/tên file/ví/thời gian/hash như cũ.
const matchTableRow = (row, input) => {
    if (input.startsWith('0x')) return (row.getAttribute('data-uploader') || '') === input;
    const searchData = row.getAttribute('data-search') || row.innerText.toLowerCase();
    return searchData.includes(input);
};

// ---- Phân trang client-side: 15 dòng/trang ----
// Dùng class .pg-hidden riêng, KHÔNG đụng style.display (đang do search filter điều khiển).
// Chỉ đếm dòng đang hiển thị (style.display !== 'none') để cộng hưởng đúng với filter.
const PG_PER_PAGE = 15;
const pgPageById = new Map();

function paginateTbody(tbody, page) {
    if (!tbody) return;
    const tbodyId = tbody.id;
    const allRows = Array.from(tbody.querySelectorAll('tr'));
    // "Hiển thị" = qua được filter: search dùng style.display, filter role ví dùng class .hidden.
    // Dòng .doc-detail bám theo trạng thái pg-hidden của dòng cha ngay trước nó.
    const isFilterVisible = r => r.style.display !== 'none' && !r.classList.contains('hidden');
    const visRows = allRows.filter(r => !r.classList.contains('doc-detail') && isFilterVisible(r));
    const pages = Math.max(1, Math.ceil(visRows.length / PG_PER_PAGE));
    const cur = Math.min(Math.max(1, page ?? pgPageById.get(tbodyId) ?? 1), pages);
    pgPageById.set(tbodyId, cur);
    let vi = 0, prevHidden = false;
    allRows.forEach(r => {
        if (r.classList.contains('doc-detail')) { r.classList.toggle('pg-hidden', prevHidden); return; }
        if (!isFilterVisible(r)) { r.classList.remove('pg-hidden'); prevHidden = false; return; }
        prevHidden = Math.floor(vi++ / PG_PER_PAGE) !== cur - 1;
        r.classList.toggle('pg-hidden', prevHidden);
    });
    renderPager(tbody, visRows.length, pages, cur);
}

function renderPager(tbody, visCount, pages, cur) {
    const table = tbody.closest('table');
    if (!table) return;
    let pager = table.parentElement ? table.parentElement.querySelector(':scope > .bdi-pager') : null;
    if (visCount <= PG_PER_PAGE || pages <= 1) {
        if (pager) pager.remove();
        return;
    }
    if (!pager) {
        pager = document.createElement('div');
        pager.className = 'bdi-pager';
        table.insertAdjacentElement('afterend', pager);
    }
    pager.innerHTML =
        `<button type="button" data-act="pg-prev" data-t="${esc(tbody.id)}" ${cur <= 1 ? 'disabled' : ''}>‹ Trước</button>` +
        `<span class="pg-info">Trang ${cur}/${pages} · ${visCount} dòng</span>` +
        `<button type="button" data-act="pg-next" data-t="${esc(tbody.id)}" ${cur >= pages ? 'disabled' : ''}>Sau ›</button>`;
}

// Áp phân trang cho mọi bảng chính — giữ nguyên trang hiện tại (trừ khi truyền page).
window.__paginateAll = (resetToOne = false) => {
    ['history-table-body', 'partner-docs-body', 'revoked-table-body', 'wallet-roles-table-body', 'api-keys-table-body']
        .forEach(id => {
            const tb = document.getElementById(id);
            if (tb) paginateTbody(tb, resetToOne ? 1 : undefined);
        });
};

// Chuyển chế độ sổ cái: tài liệu ví ↔ tài liệu đối tác (API key)
window.switchLedgerTab = (mode) => {
    if (mode === 'partner' && !window.__isAdminWallet) mode = 'wallet'; // chỉ ADMIN mở được pane đối tác
    const w = document.getElementById('ledger-pane-wallet');
    const p = document.getElementById('ledger-pane-partner');
    const bw = document.getElementById('ltab-wallet');
    const bp = document.getElementById('ltab-partner');
    if (!w || !p || !bw || !bp) return;
    const isWallet = mode === 'wallet';
    w.classList.toggle('hidden', !isWallet);
    p.classList.toggle('hidden', isWallet);
    p.classList.toggle('flex', !isWallet);
    const base = 'ledger-tab flex-1 text-xs font-bold px-4 py-2 rounded-lg border transition';
    bw.className = base + (isWallet ? ' bg-accent-soft text-accent border-accent-line' : ' bg-sunken text-muted border-line-strong hover:text-accent');
    // Giữ 'hidden' khi ví không phải ADMIN — className ghi đè toàn bộ nên phải nối lại
    bp.className = (window.__isAdminWallet ? base : 'hidden ' + base)
        + (!isWallet ? ' bg-warn-soft text-warn border-warn' : ' bg-sunken text-muted border-line-strong hover:text-warn');
};

// Lọc tài liệu đối tác theo API key/tổ chức — chip "đang hoạt động"
let activePartnerOrg = 'all';
let partnerOrgCounts = {};
window.selectPartnerOrg = (org) => { activePartnerOrg = org; renderPartnerOrgChips(); filterHistoryTable(); };
function renderPartnerOrgChips() {
    const box = document.getElementById('partner-org-chips');
    if (!box) return;
    const orgs = Object.keys(partnerOrgCounts);
    if (!orgs.length) {
        box.innerHTML = '<span class="text-xs text-faint">Chưa có tài liệu đối tác nào được đóng dấu.</span>';
        return;
    }
    if (!orgs.includes(activePartnerOrg)) activePartnerOrg = 'all';
    const total = orgs.reduce((s, o) => s + partnerOrgCounts[o], 0);
    const cls = (on) => 'text-xs font-bold px-3 py-1.5 rounded-full border transition ' +
        (on ? 'bg-warn-soft text-warn border-warn' : 'bg-sunken text-muted border-line-strong hover:text-warn');
    box.innerHTML = '<span class="text-[10px] text-faint font-bold uppercase mr-1">API Key đang hoạt động:</span>'
        + `<button type="button" data-org="all" class="${cls(activePartnerOrg === 'all')}">Tất cả (${total})</button>`
        + orgs.map(o => `<button type="button" data-org="${esc(o)}" class="${cls(activePartnerOrg === o)}"><i class="fa-solid fa-key mr-1"></i>${esc(o)} (${partnerOrgCounts[o]})</button>`).join('');
    box.querySelectorAll('button[data-org]').forEach(b => b.addEventListener('click', () => selectPartnerOrg(b.dataset.org)));
}

window.filterHistoryTable = () => {
    const input = document.getElementById('search-history-input')?.value.toLowerCase().trim() || '';
    document.querySelectorAll('#history-table-body tr').forEach(row => {
        row.style.display = matchTableRow(row, input) ? '' : 'none';
    });
    // Bảng đối tác: lọc theo ô search VÀ chip tổ chức đang chọn
    document.querySelectorAll('#partner-docs-body tr[data-org]').forEach(row => {
        const orgOk = activePartnerOrg === 'all' || row.dataset.org === activePartnerOrg;
        row.style.display = orgOk && matchTableRow(row, input) ? '' : 'none';
    });
    paginateTbody(document.getElementById('history-table-body'), 1);
    paginateTbody(document.getElementById('partner-docs-body'), 1);
};

window.filterRevokedTable = () => {
    const input = document.getElementById('search-revoked-input')?.value.toLowerCase().trim() || '';
    const rows = document.querySelectorAll('#revoked-table-body tr');
    rows.forEach(row => { row.style.display = matchTableRow(row, input) ? '' : 'none'; });
    const tb = document.getElementById('revoked-table-body');
    if (tb) paginateTbody(tb, 1);
};

function getShortError(err, customRevertMsg) {
    const msg = String(err.message || err);
    if (err.code === 'ACTION_REJECTED' || msg.includes('user rejected')) return 'Bạn đã chủ động hủy bỏ giao dịch trên ví MetaMask.';
    if (msg.includes('insufficient funds')) return 'Ví của bạn không đủ số dư Sepolia ETH để trả phí Gas.';
    if (msg.includes('coalesce')) return 'Tiện ích ví không tương thích. Hãy tắt các ví/extension khác, chỉ để MetaMask rồi tải lại trang.';
    if (msg.includes('revert')) return customRevertMsg || 'Giao dịch bị từ chối bởi Blockchain (sai trạng thái).';
    return esc(err.shortMessage || msg || 'Đã xảy ra lỗi kết nối mạng. Vui lòng thử lại.');
}

// =====================================================================
// KHỞI TẠO HỆ THỐNG & GẮN SỰ KIỆN KHI TRANG TẢI XONG
// =====================================================================
document.addEventListener('DOMContentLoaded', () => {

    // Drawer điều hướng mobile (<1024px): hamburger + overlay
    const appAside = document.querySelector('#app-container > aside');
    const navOverlay = document.getElementById('nav-overlay');
    const setNavOpen = (open) => {
        appAside?.classList.toggle('nav-open', open);
        navOverlay?.classList.toggle('hidden', !open);
    };
    document.getElementById('btn-nav-toggle')?.addEventListener('click', () =>
        setNavOpen(!appAside?.classList.contains('nav-open')));
    navOverlay?.addEventListener('click', () => setNavOpen(false));
    appAside?.querySelectorAll('.menu-item').forEach(a => a.addEventListener('click', () => setNavOpen(false)));

    // Kích hoạt đồng hồ thời gian thực
    const clockEl = document.getElementById('real-time-clock');
    if (clockEl) {
        clockEl.innerText = new Date().toLocaleTimeString('vi-VN', { hour12: false });
        setInterval(() => {
            clockEl.innerText = new Date().toLocaleTimeString('vi-VN', { hour12: false });
        }, 1000);
    }

    const menus = ['upload', 'verify', 'history', 'revoked', 'roles', 'apikeys', 'rpc', 'template', 'settings'];
    menus.forEach(menu => {
        const menuBtn = document.getElementById(`nav-${menu}`) || document.getElementById(`menu-${menu}`);
        if (menuBtn) {
            menuBtn.addEventListener('click', (e) => {
                e.preventDefault();
                if (typeof switchUI === 'function') switchUI(`tab-${menu}`, menuBtn);
                if (menu === 'history') loadTransactionHistory();
                if (menu === 'revoked') loadRevokedHistory();
                if (menu === 'rpc') loadRpcConfig();
                if (menu === 'apikeys') loadAPIKeys();
                if (menu === 'roles' && typeof window.loadWalletRoles === 'function') window.loadWalletRoles();
            });
        }
    });

    // Kéo-thả file vào dropzone: gán dataTransfer.files vào input rồi chạy lại
    // luồng updateFileName sẵn có (giữ nguyên validate giới hạn số tệp)
    const attachDropZone = (zone, input, accent, dragBg = 'bg-accent-soft') => {
        if (!zone || !input) return;
        const on = () => { zone.classList.add(accent, dragBg); };
        const off = () => { zone.classList.remove(accent, dragBg); };
        zone.addEventListener('dragover', (e) => { e.preventDefault(); on(); });
        zone.addEventListener('dragleave', (e) => { if (!zone.contains(e.relatedTarget)) off(); });
        zone.addEventListener('drop', (e) => {
            e.preventDefault(); off();
            if (!e.dataTransfer?.files?.length) return;
            if (input.multiple) {
                input.files = e.dataTransfer.files;
            } else {
                const dt = new DataTransfer();
                dt.items.add(e.dataTransfer.files[0]);
                input.files = dt.files;
            }
            UI.updateFileName(input.id);
        });
    };

    const uploadDropZone = document.getElementById('uploadDropZone');
    const uploadFileInput = document.getElementById('uploadFile');
    if (uploadDropZone && uploadFileInput) {
        // Click vùng trống mở picker; bỏ qua nút (✕ xóa, +Thêm tệp) và vùng danh
        // sách file — để data-act="rm-file" bubble lên document delegation xử lý
        uploadDropZone.addEventListener('click', (e) => {
            if (e.target === uploadFileInput || e.target.closest('button') || e.target.closest('#uploadFileList')) return;
            uploadFileInput.click();
        });
        uploadFileInput.addEventListener('click', (e) => e.stopPropagation());
        uploadFileInput.addEventListener('change', () => UI.updateFileName('uploadFile'));
        attachDropZone(uploadDropZone, uploadFileInput, 'border-accent');
    }

    const verifyDropZone = document.getElementById('verifyDropZone');
    const verifyFileInput = document.getElementById('verifyFile');
    if (verifyDropZone && verifyFileInput) {
        verifyDropZone.addEventListener('click', (e) => { if (e.target !== verifyFileInput && !e.target.closest('button')) verifyFileInput.click(); });
        verifyFileInput.addEventListener('click', (e) => e.stopPropagation());
        verifyFileInput.addEventListener('change', () => UI.updateFileName('verifyFile'));
        attachDropZone(verifyDropZone, verifyFileInput, 'border-ok', 'bg-ok-soft');
    }

    // Thả file trượt khỏi dropzone → chặn trình duyệt mở file thay trang app
    ['dragover', 'drop'].forEach(ev => window.addEventListener(ev, (e) => e.preventDefault()));

    document.getElementById('btn-connect')?.addEventListener('click', connectWallet);
    // Nút liên hệ có 2 trạng thái: "Lưu" (đang nhập) ↔ "Thay đổi" (đã lưu, khóa ô nhập)
    const contactBtn = document.getElementById('btn-save-email');
    const emailInput = document.getElementById('input-wallet-email');
    const phoneInput = document.getElementById('input-wallet-phone');
    const aliasInput = document.getElementById('input-wallet-alias');
    const setContactSavedUI = (saved) => {
        if (!contactBtn) return;
        contactBtn.textContent = saved ? 'Thay đổi' : 'Lưu';
        contactBtn.classList.toggle('bg-ok', !saved);
        contactBtn.classList.toggle('hover:brightness-110', !saved);
        contactBtn.classList.toggle('bg-muted', saved);
        contactBtn.classList.toggle('text-ink', saved);
        contactBtn.classList.toggle('text-white', !saved);
        contactBtn.classList.toggle('hover:bg-faint', saved);
        if (aliasInput) aliasInput.disabled = saved;
        if (emailInput) emailInput.disabled = saved;
        if (phoneInput) phoneInput.disabled = saved;
        document.getElementById('contact-saved-hint')?.classList.toggle('hidden', !saved);
    };
    contactBtn?.addEventListener('click', async () => {
        if (contactBtn.textContent === 'Thay đổi') { setContactSavedUI(false); aliasInput?.focus(); return; }
        const alias = (aliasInput?.value || '').trim();
        const email = (emailInput?.value || '').trim();
        const phone = (phoneInput?.value || '').trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            Swal.fire({ title: 'Email không hợp lệ', icon: 'warning', background: 'var(--panel)', color: 'var(--ink)', timer: 1500, showConfirmButton: false });
            return;
        }
        if (phone && !/^\+?[\d\s-]{8,15}$/.test(phone)) {
            Swal.fire({ title: 'Số điện thoại không hợp lệ', icon: 'warning', background: 'var(--panel)', color: 'var(--ink)', timer: 1500, showConfirmButton: false });
            return;
        }
        try {
            const contactRes = await saveContactWithConfirm(email, phone);
            // Alias do chủ ví tự đặt — giúp Admin nhận diện khi duyệt quyền
            if (web3.currentAccount) {
                const selfUpdate = {};
                if (alias) selfUpdate.alias = alias;
                await ApiService.syncWalletData(web3.currentAccount, selfUpdate);
                if (alias) {
                    const profileName = document.querySelector('aside .truncate');
                    if (profileName) profileName.innerText = alias;
                }
            }
            setContactSavedUI(true);
            Swal.fire({
                title: contactRes?.pending ? 'Chờ xác nhận email' : 'Đã lưu thông tin',
                text: contactRes?.pending ? 'SĐT đã lưu — email sẽ đổi sau khi bạn nhập mã gửi về email hiện tại.' : 'Admin sẽ nhận diện ví của bạn qua tên và thông tin liên hệ này.',
                icon: 'success', background: 'var(--panel)', color: 'var(--ink)', timer: 2200, showConfirmButton: false
            });
        } catch (e) {
            Swal.fire({ title: 'Thất bại', text: getShortError(e), icon: 'error', background: 'var(--panel)', color: 'var(--ink)' });
        }
    });
    // Phòng chờ: ví chờ duyệt khai thông tin nhận diện + copy địa chỉ ví
    document.getElementById('btn-gate-copy')?.addEventListener('click', () => {
        const addr = document.getElementById('gate-wallet-address')?.innerText || '';
        if (addr) navigator.clipboard?.writeText(addr).catch(() => {});
    });
    // Ví bị từ chối muốn xin lại — chỉ mở form khai lại thông tin. Hint "Đã lưu"
    // bị ẩn để tránh hiểu nhầm đã gửi rồi; "đang chờ" cũng chưa hiện vì chưa gửi.
    document.getElementById('btn-gate-rerequest')?.addEventListener('click', () => {
        window.__rerequesting = true;
        document.getElementById('gate-rejected')?.classList.add('hidden');
        document.getElementById('gate-saved-hint')?.classList.add('hidden');
        document.getElementById('gate-prefill-hint')?.classList.add('hidden');
        document.getElementById('gate-form-card')?.classList.remove('hidden');
        const t = document.getElementById('page-title');
        if (t) t.innerText = 'Gửi lại yêu cầu cấp quyền';
    });
    document.getElementById('btn-gate-save')?.addEventListener('click', async () => {
        const alias = (document.getElementById('gate-alias')?.value || '').trim();
        const email = (document.getElementById('gate-email')?.value || '').trim();
        const phone = (document.getElementById('gate-phone')?.value || '').trim();
        const reqRole = document.getElementById('gate-req-role')?.value || '';
        // Bắt buộc đủ cả 4 trường — bỏ trống bất kỳ ô nào thì không gửi được
        if (!alias || !email || !phone || !reqRole) {
            Swal.fire({ title: 'Chưa đủ thông tin', text: 'Vui lòng điền đầy đủ Tên, Email, Số điện thoại và chọn Quyền mong muốn trước khi gửi.', icon: 'warning', background: 'var(--panel)', color: 'var(--ink)', timer: 2000, showConfirmButton: false });
            return;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            Swal.fire({ title: 'Email không hợp lệ', icon: 'warning', background: 'var(--panel)', color: 'var(--ink)', timer: 1500, showConfirmButton: false });
            return;
        }
        if (!/^\+?[\d\s-]{8,15}$/.test(phone)) {
            Swal.fire({ title: 'Số điện thoại không hợp lệ', icon: 'warning', background: 'var(--panel)', color: 'var(--ink)', timer: 1500, showConfirmButton: false });
            return;
        }
        try {
            await saveContactWithConfirm(email, phone);
            if (web3.currentAccount) {
                const selfUpdate = { requestedRole: reqRole };
                if (alias) selfUpdate.alias = alias;
                await ApiService.syncWalletData(web3.currentAccount, selfUpdate);
                if (alias) {
                    const profileName = document.querySelector('aside .truncate');
                    if (profileName) profileName.innerText = alias;
                }
            }
            if (window.__rerequesting) {
                window.__rerequesting = false; // đã gửi lại xong — poll phải hiện lại gate nếu bị từ chối tiếp
                document.getElementById('gate-wait-card')?.classList.remove('hidden'); // giờ mới thật sự "đang chờ duyệt"
            }
            document.getElementById('gate-prefill-hint')?.classList.add('hidden');
            document.getElementById('gate-saved-hint')?.classList.remove('hidden');
            Swal.fire({ title: 'Đã lưu thông tin', text: 'Admin sẽ thấy thông tin này trong khay chờ duyệt.', icon: 'success', background: 'var(--panel)', color: 'var(--ink)', timer: 1800, showConfirmButton: false });
        } catch (e) {
            Swal.fire({ title: 'Thất bại', text: getShortError(e), icon: 'error', background: 'var(--panel)', color: 'var(--ink)' });
        }
    });
    document.getElementById('btn-execute-upload')?.addEventListener('click', handleUpload);
    document.getElementById('btn-execute-verify')?.addEventListener('click', handleVerify);
    document.getElementById('btn-refresh-history')?.addEventListener('click', loadTransactionHistory);
    document.getElementById('btn-refresh-revoked')?.addEventListener('click', loadRevokedHistory);
    document.getElementById('btn-audit')?.addEventListener('click', runAuditReconcile);
    document.getElementById('btn-save-rpc')?.addEventListener('click', saveRpcConfig);
    document.getElementById('btn-save-settings')?.addEventListener('click', saveSystemSettings);
    document.getElementById('btn-login-wallet')?.addEventListener('click', connectWallet);
    // Tra quyền trực tiếp khi admin nhập ví vào form cấp quyền:
    // hiện quyền hiện tại + tên + quyền mong muốn ngay dưới ô nhập
    const roleAddrInput = document.getElementById('newRoleAddress');
    const roleHint = document.getElementById('role-lookup-hint');
    let roleLookupTimer = null;
    roleAddrInput?.addEventListener('input', () => {
        clearTimeout(roleLookupTimer);
        if (roleHint) roleHint.classList.add('hidden');
        const addr = roleAddrInput.value.trim();
        if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) return;
        roleLookupTimer = setTimeout(async () => {
            try {
                const rc = await web3.getUserRole(addr);
                const wallets = await ApiService.getAllWallets();
                const w = wallets.find(x => (x.address || '').toLowerCase() === addr.toLowerCase());
                const name = (w && w.alias) ? w.alias : 'chưa đặt tên';
                const want = (w && w.requestedRole) ? ` · đề nghị ${w.requestedRole}` : '';
                let msg, cls;
                if (rc === 99) {
                    msg = 'Đây là ví Admin gốc của hệ thống — không thể thay đổi quyền.';
                    cls = 'text-err';
                } else if (rc === null || rc === undefined) {
                    msg = 'Không đọc được quyền on-chain (RPC lỗi).';
                    cls = 'text-faint';
                } else {
                    const rank = Number(rc);
                    const roleTxt = { 1: 'Nhập Liệu', 2: 'Quản Lý', 3: 'ADMIN' }[rank];
                    const dbViewer = w && w.role === 'NGƯỜI XEM';
                    msg = rank === 0
                        ? (dbViewer ? `Đang là Người Xem (chỉ đọc) — ${name}${want}` : `Chưa được cấp quyền — ${name}${want}`)
                        : `Đang là ${roleTxt} — ${name}${want}`;
                    cls = rank === 0 && !dbViewer ? 'text-warn' : 'text-ok';
                }
                if (roleHint) {
                    roleHint.textContent = 'ⓘ ' + msg;
                    roleHint.className = `text-[11px] mt-2 ${cls}`;
                    roleHint.classList.remove('hidden');
                }
            } catch (e) {}
        }, 500);
    });

    document.getElementById('btn-generate-api')?.addEventListener('click', generateNewApiKey);

    refreshMetricsLoop();
    initNotificationUI();
    initPendingWalletsUI();
    loadAPIKeys();
    drainOrphanedBatches().then(() => { if (typeof window.loadWalletRoles === 'function') window.loadWalletRoles(); });
    if (typeof window.loadWalletRoles === 'function') window.loadWalletRoles();
});

// =====================================================================
// ĐỒNG BỘ SỐ LIỆU DASHBOARD (HÀM TẬP TRUNG)
// =====================================================================
// Merge số liệu on-chain + MongoDB — dùng chung cho mini-stats và dashboard KPI
// (dashboard.js inject qua ctx.computeMetrics để 2 nơi luôn khớp nhau)
async function computeMergedMetrics() {
    // 1. Lấy dữ liệu On-chain từ Blockchain
    const metrics = await web3.getLiveMetrics();

    // 2. issuerCount: rank ≥1 trên chain (upload) + NGƯỜI XEM được cấp trong DB —
    // label "VÍ ĐƯỢC ỦY QUYỀN" giờ đếm đủ cả 3 vai trò, khớp danh sách popup
    try {
        const ws = await ApiService.getAllWallets();
        const viewers = ws.filter(w => w.status === 'ACTIVE' && w.roleGranted === true && w.role === 'NGƯỜI XEM').length;
        metrics.issuerCount = (metrics.issuerCount || 0) + viewers;
    } catch (e) {}

    // 3. Cộng dồn file MongoDB chưa thu hồi — chỉ file chưa có trong sự kiện
    // on-chain (file vừa upload đã có DocumentAdded rồi, đếm lại sẽ bị gấp đôi)
    const localBatches = await ApiService.getBatchesFromDatabase();
    const onChainIds = new Set();
    try {
        const addedEvents = await web3.queryHistory();
        for (const ev of addedEvents) onChainIds.add(ev.args[0]);
    } catch (e) {}
    let extraCount = 0;
    for (const b of localBatches) {
        for (const f of (b.files || [])) {
            if (!f.isRevoked && !onChainIds.has(f.docId)) extraCount++;
        }
    }
    metrics.docCount = (metrics.docCount || 0) + extraCount;
    return metrics;
}

async function syncDashboardData() {
    if (pendingGateActive) return; // ví ở phòng chờ → không cần metrics, tránh spam 403
    // Chưa login → chỉ hiển thị số liệu on-chain, không gọi API (tránh 401 dồn dập + tốn rate-limit)
    if (!ApiService.hasValidToken()) {
        try {
            const metrics = await web3.getLiveMetrics();
            UI.updateStats(metrics);
        } catch (e) {}
        return;
    }
    try {
        const metrics = await computeMergedMetrics();
        // 4. In ra giao diện
        UI.updateStats(metrics);
        const ipfsCostEl = document.getElementById('stat-ipfs-cost');
        if (ipfsCostEl && metrics.docCount !== undefined) {
            ipfsCostEl.innerText = (metrics.docCount * 0.002).toFixed(3);
        }
    } catch (error) {
        // Bỏ qua nếu lỗi mạng để không làm sập giao diện
    }
}

// Dashboard module — init đúng 1 lần cho mỗi ví đăng nhập
let _dashAccount = null;
function ensureDashboardInit(account, rank) {
    if (!account || _dashAccount === account) return;
    _dashAccount = account;
    initDashboard({
        web3, api: ApiService,
        computeMetrics: computeMergedMetrics,
        isAdmin: window.__isAdminWallet === true,
        account, rank: rank ?? 0,
    });
}

// Tự khởi tạo dashboard khi vào tab mà chưa init — phòng luồng login sót
// hoặc module cache cũ. Không chạy cho ví phòng chờ (pendingGateActive).
document.addEventListener('bdi:tab', (e) => {
    if (e.detail?.tabId === 'tab-dashboard' && web3.currentAccount && !pendingGateActive) {
        ensureDashboardInit(web3.currentAccount, window.__bdiRank ?? 0);
    }
});
// Vòng lặp gọi hàm đồng bộ mỗi 10 giây
async function refreshMetricsLoop() {
    await syncDashboardData();
    setTimeout(refreshMetricsLoop, 10000);
}


// =====================================================================
// KẾT NỐI VÍ METAMASK
// =====================================================================
// Màn chờ phê duyệt thiết bị mới: poll trạng thái 5s/lần + cho phép xác nhận
// bằng OTP email chủ ví. Trả về true khi được duyệt (active), false nếu hủy/từ chối.
function waitForDeviceApproval(account) {
    const deviceId = ApiService.getDeviceId();
    return new Promise((resolve) => {
        let resolved = false;
        const finish = (v, close = true) => {
            if (resolved) return;
            resolved = true;
            if (pollTimer) clearInterval(pollTimer);
            if (close) Swal.close();
            resolve(v);
        };

        let pollTimer = setInterval(async () => {
            const st = await ApiService.checkPendingStatus(account, deviceId);
            // OTP không khả dụng (ví chưa có email / SMTP chết) → khoá khu vực Cách 2, nói rõ lý do
            if (!st.otpAvailable) {
                const btn = document.getElementById('btn-send-otp');
                if (btn && !btn.disabled) {
                    btn.disabled = true;
                    btn.classList.add('opacity-40', 'cursor-not-allowed');
                }
            }
            if (st.status === 'active') finish(true);
            else if (st.status === 'revoked' || st.status === 'unknown') {
                finish(false);
                Swal.fire({ title: 'Đã bị từ chối', text: 'Phiên đăng nhập này đã bị từ chối/thu hồi.', icon: 'error', background: 'var(--panel)', color: 'var(--ink)' });
            }
        }, 5000);

        Swal.fire({
            title: 'Thiết bị mới — chờ phê duyệt',
            html: `
                <div class="text-left text-sm text-soft space-y-3">
                    <p>Để bảo mật, thiết bị này phải được xác nhận bằng <b>một trong 2 cách</b>:</p>
                    <div class="bg-sunken border border-line-strong rounded-lg p-3">
                        <div class="font-bold text-ok text-xs mb-1">CÁCH 1 — Từ thiết bị đã đăng nhập</div>
                        <p class="text-xs text-muted">Mở hệ thống trên máy đã đăng nhập → bấm chuông 🔔 → mục "Thiết bị đang đăng nhập" → <b>Duyệt</b>. Trang này sẽ tự vào ngay khi được duyệt.</p>
                    </div>
                    <div class="bg-sunken border border-line-strong rounded-lg p-3">
                        <div class="font-bold text-accent text-xs mb-1">CÁCH 2 — Mã OTP về email chủ ví</div>
                        <p class="text-xs text-muted mb-2">Gửi mã 6 số về email đã đăng ký — <b>dùng được mọi lúc</b>, không cần thiết bị cũ. Chọn cách nào tiện.</p>
                        <button id="btn-send-otp" class="w-full bg-accent hover:brightness-110 text-white text-xs font-bold py-2 rounded transition">Gửi mã OTP về email</button>
                        <div id="otp-input-box" class="hidden mt-2 flex gap-2">
                            <input id="otp-code" maxlength="6" placeholder="••••••" class="flex-1 bg-panel border border-line-strong rounded px-3 py-2 text-center text-ink tracking-[0.4em] font-mono text-sm outline-none focus:border-accent">
                            <button id="btn-verify-otp" class="bg-ok hover:brightness-110 text-white text-xs font-bold px-4 rounded transition">Xác nhận</button>
                        </div>
                        <div id="otp-msg" class="text-[11px] mt-2 hidden"></div>
                    </div>
                    <p id="pending-active-hint" class="hidden"></p>
                    <p class="text-[11px] text-faint text-center"><i class="fa-solid fa-spinner fa-spin mr-1"></i>Đang chờ phê duyệt...</p>
                </div>`,
            background: 'var(--panel)', color: 'var(--ink)', width: 480,
            showConfirmButton: false, showCancelButton: true, cancelButtonText: 'Hủy',
            allowOutsideClick: false, allowEscapeKey: false,
            didOpen: () => {
                const msg = document.getElementById('otp-msg');
                const showMsg = (t, ok) => { msg.textContent = t; msg.className = `text-[11px] mt-2 ${ok ? 'text-ok' : 'text-err'}`; msg.classList.remove('hidden'); };
                document.getElementById('btn-send-otp').addEventListener('click', async (e) => {
                    const btn = e.currentTarget;
                    btn.disabled = true; btn.textContent = 'Đang gửi...';
                    try {
                        const r = await ApiService.requestOtp(account, deviceId);
                        showMsg(`Đã gửi mã tới ${r.maskedEmail || 'email chủ ví'} — hết hạn sau 5 phút.`, true);
                        document.getElementById('otp-input-box').classList.remove('hidden');
                        btn.textContent = 'Gửi lại mã (sau 60s)';
                        setTimeout(() => { btn.disabled = false; }, 60000);
                    } catch (err) {
                        showMsg(getShortError(err, 'Không gửi được mã'), false);
                        btn.disabled = false; btn.textContent = 'Gửi mã OTP về email';
                    }
                });
                document.getElementById('btn-verify-otp').addEventListener('click', async () => {
                    const code = document.getElementById('otp-code').value.trim();
                    if (!/^\d{6}$/.test(code)) { showMsg('Mã gồm 6 chữ số', false); return; }
                    try {
                        await ApiService.verifyOtp(account, deviceId, code);
                        showMsg('Xác nhận thành công — đang đăng nhập...', true);
                    } catch (err) {
                        showMsg(getShortError(err, 'Xác nhận thất bại'), false);
                    }
                });
            },
            willClose: () => { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }
        }).then((r) => { if (!resolved && r.isDismissed) finish(false, false); });
    });
}

// =====================================================================
// PHÒNG CHỜ + CHẾ ĐỘ NGƯỜI XEM cho ví rank 0 (chưa có quyền on-chain):
// - Chưa được cấp gì → chỉ thấy phòng chờ (không vào được hệ thống)
// - DB gán NGƯỜI XEM → vào được nhưng chỉ đọc
// Poll mở khóa ngay khi Admin duyệt — cả khi cấp viewer lẫn rank cao hơn
// =====================================================================
const VIEWER_VISIBLE_NAV = ['nav-dashboard', 'nav-verify', 'nav-history', 'nav-revoked', 'nav-settings'];
let guestUnlockTimer = null;
// Ví đang ở phòng chờ/từ chối (rank 0) → tắt mọi vòng lặp nền gọi API nhân sự
// (metrics, bảng ví, API keys, khay admin) để không spam 403 và không đơ trang
let pendingGateActive = false;

function isPendingGateVisible() {
    const t = document.getElementById('tab-pending');
    return t && !t.classList.contains('hidden');
}

// Liên hệ admin thật cho ví bị từ chối — thay câu "liên hệ quản trị viên" mơ hồ
let _adminContactCache = undefined;
async function loadAdminContactLine() {
    const el = document.getElementById('gate-admin-contact');
    if (!el) return;
    if (_adminContactCache === undefined) _adminContactCache = (await ApiService.getAdminContact()) || {};
    const a = _adminContactCache;
    const parts = [];
    if (a.alias) parts.push(a.alias);
    if (a.address) parts.push(`ví ${a.address.slice(0, 8)}…${a.address.slice(-4)}`);
    if (a.email) parts.push(`email ${a.email}`);
    if (a.phone) parts.push(`SĐT ${a.phone}`);
    if (parts.length) {
        el.innerText = 'Quản trị viên: ' + parts.join(' · ');
        el.classList.remove('hidden');
    }
}

// Ví bị Admin khóa thủ công: ngõ cụt — không form xin quyền, chỉ admin mở lại.
// Tái dùng khung gate-rejected nhưng đổi nội dung + giấu nút gửi lại
function applyLockedGate(me) {
    pendingGateActive = true;
    document.getElementById('gate-wait-card')?.classList.add('hidden');
    document.getElementById('gate-form-card')?.classList.add('hidden');
    document.getElementById('gate-rejected')?.classList.remove('hidden');
    document.getElementById('gate-blocked-note')?.classList.add('hidden');
    document.getElementById('btn-gate-rerequest')?.classList.add('hidden');
    const h2 = document.getElementById('gate-rejected-title');
    if (h2) h2.innerText = 'Ví này đã bị quản trị viên khóa';
    const p = document.getElementById('gate-rejected-text');
    if (p) p.innerText = 'Quyền truy cập của ví đã bị thu hồi — không thể thực hiện thao tác nào trên hệ thống. Chỉ quản trị viên mới mở khóa được, hãy liên hệ admin nếu cho rằng đây là nhầm lẫn.';
    loadAdminContactLine();
    const title = document.getElementById('page-title');
    if (title) title.innerText = 'Ví bị khóa';
}

// Ví bị Admin từ chối: ẩn form chờ, hiện thông báo từ chối.
// Bị từ chối ≥3 lần → cấm xin lại 30 phút (hiện đồng hồ còn lại thay nút gửi lại)
function applyRejectedGate(me) {
    pendingGateActive = true;
    document.getElementById('gate-wait-card')?.classList.add('hidden');
    document.getElementById('gate-form-card')?.classList.add('hidden');
    document.getElementById('gate-rejected')?.classList.remove('hidden');
    // Khôi phục nội dung mặc định — applyLockedGate đổi text trên cùng khung này
    const h2 = document.getElementById('gate-rejected-title');
    if (h2) h2.innerText = 'Yêu cầu cấp quyền đã bị từ chối';
    const p = document.getElementById('gate-rejected-text');
    if (p) p.innerText = 'Admin đã từ chối cấp quyền cho ví này. Nếu bạn cho rằng đây là nhầm lẫn, gửi lại yêu cầu với thông tin đầy đủ hơn hoặc liên hệ quản trị viên.';
    loadAdminContactLine();
    const blockedLeft = ((me && me.rejectBlockedUntil) || 0) - Date.now();
    const note = document.getElementById('gate-blocked-note');
    const btnRe = document.getElementById('btn-gate-rerequest');
    if (blockedLeft > 0) {
        note?.classList.remove('hidden');
        btnRe?.classList.add('hidden');
        const m = document.getElementById('gate-blocked-mins');
        if (m) m.innerText = `~${Math.ceil(blockedLeft / 60000)} phút`;
    } else {
        note?.classList.add('hidden');
        btnRe?.classList.remove('hidden');
    }
    const title = document.getElementById('page-title');
    if (title) title.innerText = 'Yêu cầu bị từ chối';
}

// Ví chưa được cấp quyền: ẩn TOÀN BỘ nav + mọi tab, chỉ hiện phòng chờ
function applyPendingGate(account, me) {
    pendingGateActive = true;
    document.querySelectorAll('aside .menu-item').forEach(el => { el.style.display = 'none'; });
    const adminHeader = document.getElementById('nav-admin-header');
    const adminNav = document.getElementById('nav-admin-nav');
    if (adminHeader) adminHeader.style.display = 'none';
    if (adminNav) adminNav.style.display = 'none';
    const stats = document.getElementById('dashboard-stats');
    if (stats) stats.style.display = 'none';
    document.getElementById('viewer-banner')?.classList.add('hidden');

    const addrEl = document.getElementById('gate-wallet-address');
    if (addrEl) addrEl.innerText = account;
    if (me) {
        // Ví bị khóa ưu tiên hơn từ chối — ví từng được cấp (có thể mang cờ
        // rejected cũ) chỉ admin mở, KHÔNG hiện form xin quyền (backend chặn revive)
        if (me.status === 'REVOKED' && me.role === 'BỊ KHÓA') {
            switchUI('tab-pending');
            applyLockedGate(me);
            return;
        }
        if (me.rejected === true) {
            switchUI('tab-pending');
            applyRejectedGate(me);
            return;
        }
        // Ví REVOKED trạng thái khác (sync cũ đè nhầm) → cũng là ngõ cụt admin
        if (me.status === 'REVOKED') {
            switchUI('tab-pending');
            applyLockedGate(me);
            return;
        }
        const set = (id, v) => { const el = document.getElementById(id); if (el && v) el.value = v; };
        set('gate-alias', me.alias);
        set('gate-email', me.email);
        set('gate-phone', me.phone);
        if (me.requestedRole) set('gate-req-role', me.requestedRole);
        // Dữ liệu cũ còn trong DB (xóa ví chỉ tombstone) → điền sẵn form nhưng
        // KHÔNG hiện "Đã lưu" — chỉ note trung tính để không hiểu nhầm vừa lưu
        if (me.alias || me.email || me.requestedRole) document.getElementById('gate-prefill-hint')?.classList.remove('hidden');
    }
    switchUI('tab-pending');
    const title = document.getElementById('page-title');
    if (title) title.innerText = 'Chờ cấp quyền';
}

// Chế độ NGƯỜI XEM: rank on-chain = 0 nhưng DB gán role NGƯỜI XEM →
// được xem Truy Xuất + DS Hủy Bỏ + Xác Thực, vẫn không thấy upload/quản trị
function applyViewerMode(account) {
    pendingGateActive = false;
    document.querySelectorAll('aside .menu-item').forEach(el => {
        el.style.display = VIEWER_VISIBLE_NAV.includes(el.id) ? '' : 'none';
    });
    const adminHeader = document.getElementById('nav-admin-header');
    const adminNav = document.getElementById('nav-admin-nav');
    if (adminHeader) adminHeader.style.display = 'none';
    if (adminNav) adminNav.style.display = 'none';
    const stats = document.getElementById('dashboard-stats');
    if (stats) stats.style.display = '';

    document.getElementById('viewer-banner')?.classList.remove('hidden');
    ensureDashboardInit(account, 0);
    switchUI('tab-dashboard', document.getElementById('nav-dashboard'));
}

function exitGuestMode() {
    pendingGateActive = false;
    if (guestUnlockTimer) { clearInterval(guestUnlockTimer); guestUnlockTimer = null; }
    document.querySelectorAll('aside .menu-item').forEach(el => { el.style.display = ''; });
    const adminHeader = document.getElementById('nav-admin-header');
    const adminNav = document.getElementById('nav-admin-nav');
    if (adminHeader) adminHeader.style.display = '';
    if (adminNav) adminNav.style.display = '';
    const stats = document.getElementById('dashboard-stats');
    if (stats) stats.style.display = '';
    document.getElementById('tab-pending')?.classList.add('hidden');
    document.getElementById('viewer-banner')?.classList.add('hidden');
}

// Kiểm tra quyền on-chain của ví: trả 0-3, null khi RPC lỗi (fail-open để
// không khóa nhầm người dùng thật — backend vẫn tự chặn quyền ở mọi API ghi)
async function getMyRoleRank(account) {
    const rc = await web3.getUserRole(account);
    if (rc === 99) return 3;
    if (rc === null || rc === undefined) return null;
    return Number(rc);
}

function startGuestUnlockPoll(account) {
    if (guestUnlockTimer) clearInterval(guestUnlockTimer);
    guestUnlockTimer = setInterval(async () => {
        try {
            const rank = await getMyRoleRank(account);
            if (rank !== null && rank > 0) {
                exitGuestMode();
                // Cấp quyền giữa chừng có thể lên ADMIN — cập nhật cờ + tab đối tác
                window.__isAdminWallet = rank === 3;
                window.__bdiRank = rank;
                document.getElementById('ltab-partner')?.classList.toggle('hidden', rank !== 3);
                Swal.fire({ title: 'Đã được cấp quyền!', text: 'Admin vừa cấp quyền cho ví của bạn. Hệ thống đã mở đầy đủ chức năng.', icon: 'success', background: 'var(--panel)', color: 'var(--ink)' });
                switchUI('tab-dashboard', document.getElementById('nav-dashboard'));
                ensureDashboardInit(account, rank);
                if (typeof window.loadWalletRoles === 'function') window.loadWalletRoles();
                return;
            }
            // Rank vẫn 0 nhưng đang ở phòng chờ + DB vừa gán NGƯỜI XEM
            // → chuyển sang chế độ chỉ đọc ngay, không cần đăng nhập lại
            if (rank === 0 && isPendingGateVisible()) {
                const me = await ApiService.getMyWallet();
                if (me && me.status === 'REVOKED' && me.role === 'BỊ KHÓA') {
                    // Ví vừa bị admin khóa trong lúc đang chờ → chuyển sang màn "bị khóa"
                    applyLockedGate(me);
                } else if (me && me.rejected === true) {
                    // Đang ở form "gửi lại yêu cầu" → không đè form mỗi nhịp poll
                    if (!window.__rerequesting) applyRejectedGate(me);
                } else if (me && me.status === 'REVOKED') {
                    applyLockedGate(me);
                } else if (me && me.role === 'NGƯỜI XEM') {
                    applyViewerMode(account);
                    Swal.fire({ title: 'Đã được cấp quyền!', text: 'Bạn được cấp quyền Người Xem — có thể xem và xác thực tài liệu (chỉ đọc).', icon: 'success', background: 'var(--panel)', color: 'var(--ink)' });
                } else if (!document.getElementById('gate-rejected')?.classList.contains('hidden')) {
                    // Ví từng bị từ chối vừa khai lại thông tin → quay về màn hình chờ
                    document.getElementById('gate-rejected')?.classList.add('hidden');
                    document.getElementById('gate-wait-card')?.classList.remove('hidden');
                    document.getElementById('gate-form-card')?.classList.remove('hidden');
                    const t = document.getElementById('page-title');
                    if (t) t.innerText = 'Chờ cấp quyền';
                }
            }
        } catch (e) {}
    }, 15000);
}

async function connectWallet() {
    if (isProcessing) return;
    isProcessing = true;
    try {
        const { account, isAdmin } = await web3.connectWallet();

        // Đăng nhập backend bằng chữ ký MetaMask (không dùng mật khẩu):
        // server cấp challenge → ví ký → đổi lấy JWT 24h cho mọi API ghi dữ liệu
        const loginRes = await ApiService.loginWithWallet(web3.signer, account);
        if (loginRes && loginRes.pending) {
            // Thiết bị mới → chờ duyệt từ thiết bị cũ hoặc OTP email, rồi ký lại lần nữa
            const approved = await waitForDeviceApproval(account);
            if (!approved) return;
            const retry = await ApiService.loginWithWallet(web3.signer, account);
            if (retry && retry.pending) return;
        }
        refreshNotifBadge();
        refreshPendingBadge();
        loadAPIKeys();

        // Ghi nhận ví vào DB ngay khi login — ví mới lập tức xuất hiện trong
        // bảng Quản Lý Quyền Ví của Admin (lastActive nằm trong whitelist tự-sửa)
        try { await ApiService.syncWalletData(account, { lastActive: Date.now() }); } catch (e) {}

        // Kiểm tra quyền on-chain TRƯỚC KHI mở app — nếu reveal trước, ví chờ
        // duyệt sẽ nhìn thấy UI hệ thống nháy qua trong giây lát rồi mới tới phòng chờ
        const myRank = await getMyRoleRank(account);
        // Chỉ ví ADMIN thấy tab/doc đối tác (API key) — QUẢN LÝ cũng bị ẩn
        window.__isAdminWallet = myRank === 3;
        window.__bdiRank = myRank ?? 0;
        document.getElementById('ltab-partner')?.classList.toggle('hidden', myRank !== 3);
        let me = null;
        if (myRank === 0) {
            try { me = await ApiService.getMyWallet(); } catch (e) {}
        }
        const isPending = myRank === 0 && (!me || me.role !== 'NGƯỜI XEM');

        const loginScreen = document.getElementById('login-screen');
        const appContainer = document.getElementById('app-container');

        if (loginScreen) loginScreen.classList.add('hidden');
        if (appContainer) {
            appContainer.classList.remove('hidden');
            appContainer.classList.add('flex');
        }

        const btnConnect = document.getElementById('btn-connect');
        if (btnConnect) btnConnect.style.display = 'none';

        const sidebarWallet = document.getElementById('sidebar-wallet');
        if (sidebarWallet) {
            sidebarWallet.innerText = `${account.substring(0, 6)}...${account.substring(38)}`;
        }

        const profileName = document.querySelector('aside .truncate');

        // Ví chưa được cấp quyền (rank 0) → phòng chờ/chế độ chỉ đọc — áp TRƯỚC
        // khi phần nặng phía dưới chạy để user không thấy UI sai
        if (myRank === 0) {
            if (me && me.role === 'NGƯỜI XEM') applyViewerMode(account);
            else applyPendingGate(account, me);
            startGuestUnlockPoll(account);
        } else {
            exitGuestMode();
            switchUI('tab-dashboard', document.getElementById('nav-dashboard'));
            ensureDashboardInit(account, myRank);
        }

        // Ví chờ duyệt không cần quét sự kiện on-chain hay bảng ví — tiết kiệm RPC
        if (!isPending) {
            if (typeof window.loadWalletRoles === 'function') window.loadWalletRoles();
            await syncDashboardData();
        }

        // Nạp email + SĐT chủ ví vào ô cài đặt; nếu đã có → khóa ô, nút đổi thành "Thay đổi"
        try {
            if (!me) me = await ApiService.getMyWallet();
            // Sidebar hiển thị tên alias mà admin đã đặt cho ví này;
            // chưa đặt tên thì theo vai trò, còn lại là "Người Dùng"
            if (profileName) {
                const alias = (me && me.alias && me.alias.trim()) || '';
                profileName.innerText = alias || (isAdmin ? 'Admin Hệ Thống' : 'Người Dùng');
            }
            const emailIn = document.getElementById('input-wallet-email');
            const phoneIn = document.getElementById('input-wallet-phone');
            const aliasIn = document.getElementById('input-wallet-alias');
            const savedBtn = document.getElementById('btn-save-email');
            const hasContact = me && (me.email || me.phone || me.alias);
            if (emailIn && me?.email) emailIn.value = me.email;
            if (phoneIn && me?.phone) phoneIn.value = me.phone;
            if (aliasIn && me?.alias) aliasIn.value = me.alias;
            if (savedBtn) {
                savedBtn.textContent = hasContact ? 'Thay đổi' : 'Lưu';
                savedBtn.classList.toggle('bg-ok', !hasContact);
                savedBtn.classList.toggle('hover:brightness-110', !hasContact);
                savedBtn.classList.toggle('bg-muted', !!hasContact);
                savedBtn.classList.toggle('text-ink', !!hasContact);
                savedBtn.classList.toggle('text-white', !hasContact);
                savedBtn.classList.toggle('hover:bg-faint', !!hasContact);
                if (aliasIn) aliasIn.disabled = !!hasContact;
                if (emailIn) emailIn.disabled = !!hasContact;
                if (phoneIn) phoneIn.disabled = !!hasContact;
                document.getElementById('contact-saved-hint')?.classList.toggle('hidden', !hasContact);
            }
        } catch (e) {}
    } catch (error) {
        Swal.fire({ title: 'Lỗi Kết Nối', text: getShortError(error, 'Mất kết nối tới ví MetaMask.'), icon: 'error', background: 'var(--panel)', color: 'var(--ink)' });
    } finally { isProcessing = false; }
}
// =====================================================================
// BIẾN LƯU TRỮ TẠM THỜI CHO BỘ LỌC PRE-CHECK
// =====================================================================
window.uploadQueue = {
    newFiles: [],
    revokedFiles: [],
    activeFiles: [],
    approvedFiles: [] 
};

// =====================================================================
// BƯỚC 1: PRE-CHECK VÀ PHÂN LOẠI TÀI LIỆU
// =====================================================================
async function handleUpload() {
    if (isProcessing) return;
    
    const filesToUpload = UI.selectedUploadFiles;
    if (!filesToUpload || filesToUpload.length === 0) {
        return Swal.fire({ title: 'Thiếu dữ liệu', text: 'Vui lòng chọn ít nhất 1 tài liệu!', icon: 'warning', background: 'var(--panel)', color: 'var(--ink)' });
    }
    if (filesToUpload.length > 100) {
        return Swal.fire({ title: 'Quá giới hạn', text: 'Smart Contract chỉ ghi tối đa 100 tài liệu mỗi lần ký. Vui lòng bớt file ra.', icon: 'warning', background: 'var(--panel)', color: 'var(--ink)' });
    }

    isProcessing = true;
    UI.updateProgress(10, "Đang quét Pre-check trên Sổ cái...", "SCANNING");
    
    window.uploadQueue = { newFiles: [], revokedFiles: [], activeFiles: [], approvedFiles: [] };
    const contract = web3.contract;

    try {
        if (!contract) throw new Error("Chưa kết nối ví");

        // Bản đồ DocumentAddedV2 events CỦA CHÍNH VÍ NÀY — bổ sung cho
        // uploaderHashToDocId vì contract XÓA mapping khi revoke; nhờ vậy
        // tài liệu đã thu hồi vẫn vào bảng đỏ. Bản ghi của ví khác không
        // hiển thị (multi-tenant: mỗi ví một sổ chống trùng riêng).
        // Event v2 args: [0]docId [1]fileHash [2]ipfsURI [3]prevDocId
        // [4]expiresAt [5]signers [6]threshold [7]uploader
        const normHash = h => String(h || '').replace(/^0x/i, '').toLowerCase();
        const myAddr = String(web3.currentAccount || '').toLowerCase();
        const addedMap = {};
        try {
            for (const ev of (await web3.queryHistory() || [])) {
                if (String(ev.args[7] || '').toLowerCase() !== myAddr) continue;
                const h = normHash(ev.args[1]);
                if (h && !addedMap[h]) addedMap[h] = ev.args[0];
            }
        } catch (e) { console.warn('Không đọc được event lịch sử:', e); }

        // Quét từng file để phân loại
        const seenHashes = new Set();   // chống trùng hash trong cùng một lô (contract revert cả lô nếu trùng)
        const skippedDupes = [];
        for (let i = 0; i < filesToUpload.length; i++) {
            const file = filesToUpload[i];
            const arrayBuffer = await file.arrayBuffer();
            const uint8Array = new Uint8Array(arrayBuffer);
            const wordArray = CryptoJS.lib.WordArray.create(uint8Array);
            const currentHash = CryptoJS.SHA256(wordArray).toString(CryptoJS.enc.Hex);

            if (seenHashes.has(currentHash)) { skippedDupes.push(file.name); continue; }
            seenHashes.add(currentHash);

            const existingDocId = await contract.getDocIdByHash(web3.currentAccount, currentHash);
            // mapping trống nhưng event còn → nội dung từng được ghi (đa phần đã thu hồi)
            const lookupId = (existingDocId && existingDocId !== "") ? existingDocId : (addedMap[normHash(currentHash)] || "");

            let fSize = file.size >= 1024 * 1024 ? (file.size / (1024 * 1024)).toFixed(2) + ' MB' : (file.size / 1024).toFixed(2) + ' KB';
            const fileData = { fileObj: file, hash: currentHash, name: file.name, size: fSize, oldId: lookupId };

            if (lookupId) {
                try {
                    const docData = await contract.getDocument(lookupId);
                    const isRevoked = docData[4];
                    fileData.knownDup = true; // đã xử lý qua bảng xung đột — không hỏi lại ở bước kiểm tra sau
                    fileData.oldUploader = String(docData[3] || '');   // ví đã đóng dấu
                    fileData.oldTime = Number(docData[2]) * 1000;      // timestamp on-chain (giây → ms)
                    if (isRevoked) window.uploadQueue.revokedFiles.push(fileData);
                    else window.uploadQueue.activeFiles.push(fileData);
                } catch {
                    window.uploadQueue.newFiles.push(fileData); // RPC lỗi → coi như mới, lớp sau lo tiếp
                }
            } else {
                window.uploadQueue.newFiles.push(fileData);
            }
        }

        if (skippedDupes.length > 0) {
            Swal.fire({ title: 'File trùng nội dung', text: `Bỏ qua ${skippedDupes.length} tệp trùng nội dung trong cùng lô: ${skippedDupes.slice(0, 3).map(esc).join(', ')}${skippedDupes.length > 3 ? '…' : ''}`, icon: 'info', background: 'var(--panel)', color: 'var(--ink)' });
        }

        // Giao diện sau xử lý
        if (window.uploadQueue.revokedFiles.length > 0 || window.uploadQueue.activeFiles.length > 0) {
            UI.updateProgress(0, "Tạm dừng để chờ quyết định duyệt file...", "STANDBY");
            showConflictModal(); // Bật bảng chọn nếu có xung đột
        } else {
            //file mới đẩy thẳng vào danh sách chốt và chạy luôn
            window.uploadQueue.approvedFiles = [...window.uploadQueue.newFiles];
            await promptPasswordAndUpload();
        }

    } catch (err) {
        UI.updateProgress(0, "Lỗi kiểm tra.", "ERROR");
        Swal.fire({ title: 'Lỗi', text: 'Có lỗi trong quá trình quét đối chiếu!', icon: 'error', background: 'var(--panel)', color: 'var(--ink)' });
        isProcessing = false; 
    }
}

// =====================================================================
// BƯỚC 2: LOGIC GIAO DIỆN BẢNG MODAL (UI TỐI ƯU HÓA)
// =====================================================================
function showConflictModal() {
    const modal = document.getElementById('conflict-modal-overlay');
    const secRevoked = document.getElementById('section-revoked-conflict');
    const secActive = document.getElementById('section-active-conflict');
    const tbodyRevoked = document.getElementById('revoked-conflict-tbody');
    const tbodyActive = document.getElementById('active-conflict-tbody');
    const shortA = a => a ? `${a.slice(0, 8)}…${a.slice(-4)}` : '—';

    // Render Bảng Đã Xóa
    if (window.uploadQueue.revokedFiles.length > 0) {
        secRevoked.classList.remove('hidden');
        secRevoked.classList.add('flex');
        tbodyRevoked.innerHTML = window.uploadQueue.revokedFiles.map((f, index) => `
            <tr class="border-b border-err hover:bg-err-soft transition">
                <td class="px-3 py-3 text-center align-middle"><input type="checkbox" class="conflict-cb-revoked rounded bg-panel border-line-strong text-err cursor-pointer" value="${index}" checked></td>
                <td class="px-3 py-3">
                    <div class="flex justify-between items-start mb-0.5">
                        <span class="font-bold text-err text-xs truncate max-w-[200px]" title="${esc(f.name)}">${esc(f.name)}</span>
                        <span class="text-[10px] text-faint font-mono">${esc(f.size)}</span>
                    </div>
                    <div class="text-[9px] text-faint font-mono truncate max-w-[250px]">ID cũ: ${esc(f.oldId)}</div>
                    <div class="text-[9px] text-muted mt-0.5">Đóng dấu bởi ví <span class="font-mono">${esc(shortA(f.oldUploader))}</span> · ${esc(window.formatTimeForce(f.oldTime))}</div>
                </td>
            </tr>
        `).join('');
    } else {
        secRevoked.classList.add('hidden');
        secRevoked.classList.remove('flex');
    }

    // Render Bảng Đang Hoạt Động (Trùng lặp)
    if (window.uploadQueue.activeFiles.length > 0) {
        secActive.classList.remove('hidden');
        secActive.classList.add('flex');
        tbodyActive.innerHTML = window.uploadQueue.activeFiles.map((f, index) => `
            <tr class="border-b border-warn hover:bg-warn-soft transition">
                <td class="px-3 py-3">
                    <div class="flex justify-between items-start mb-0.5">
                        <span class="font-bold text-warn text-xs truncate max-w-[200px]" title="${esc(f.name)}">${esc(f.name)}</span>
                        <span class="text-[10px] text-faint font-mono">${esc(f.size)}</span>
                    </div>
                    <div class="text-[9px] text-faint font-mono truncate max-w-[250px]">ID gốc: ${esc(f.oldId)}</div>
                    <div class="text-[9px] text-muted mt-0.5">Đang được đóng dấu bởi ví <span class="font-mono">${esc(shortA(f.oldUploader))}</span> · ${esc(window.formatTimeForce(f.oldTime))}</div>
                </td>
            </tr>
        `).join('');
    } else {
        secActive.classList.add('hidden');
        secActive.classList.remove('flex');
    }

    // Footer báo số file sạch vẫn sẽ đóng dấu — tránh cảm giác "hủy là mất hết"
    const note = document.getElementById('conflict-clean-note');
    if (note) {
        const n = window.uploadQueue.newFiles.length;
        note.innerText = n > 0
            ? `${n} tài liệu mới không trùng sẽ tiếp tục đóng dấu khi bạn xử lý xong.`
            : 'Không còn tài liệu mới nào ngoài các file bên trên.';
    }

    modal.classList.remove('hidden');
}

// Bật tắt nút Check All trong Modal
window.toggleConflictCheckboxes = function(tbodyId, sourceCb) {
    const classTarget = tbodyId === 'revoked-conflict-tbody' ? '.conflict-cb-revoked' : '.conflict-cb-active';
    document.querySelectorAll(classTarget).forEach(cb => cb.checked = sourceCb.checked);
};

// Xử lý nút Chấp Nhận / Hủy từng bảng
window.resolveConflict = function(type, isAccepted) {
    const classTarget = type === 'revoked' ? '.conflict-cb-revoked' : '.conflict-cb-active';
    const sourceArray = type === 'revoked' ? window.uploadQueue.revokedFiles : window.uploadQueue.activeFiles;
    
    if (isAccepted) {
        // Gom các file được tích chọn vào mảng duyệt cuối cùng
        const checkboxes = document.querySelectorAll(`${classTarget}:checked`);
        checkboxes.forEach(cb => {
            window.uploadQueue.approvedFiles.push(sourceArray[cb.value]);
        });
    }
    
    // Ẩn bảng đã xử lý xong
    document.getElementById(`section-${type}-conflict`).classList.add('hidden');
    
    // Kiểm tra các bảng đã ẩn chưa
    const secRevoked = document.getElementById('section-revoked-conflict');
    const secActive = document.getElementById('section-active-conflict');
    
    if (secRevoked.classList.contains('hidden') && secActive.classList.contains('hidden')) {
        finishConflictResolution();
    }
};

// Chốt modal: file mới + file đã duyệt tiếp tục upload; cột chưa xử lý = bỏ qua
function finishConflictResolution() {
    document.getElementById('conflict-modal-overlay').classList.add('hidden');

    // Gộp file mới + file đã duyệt
    window.uploadQueue.approvedFiles = [...window.uploadQueue.newFiles, ...window.uploadQueue.approvedFiles];

    if (window.uploadQueue.approvedFiles.length === 0) {
        Swal.fire({ title: 'Đã hủy', text: 'Không có tài liệu nào được duyệt để tải lên.', icon: 'info', background: 'var(--panel)', color: 'var(--ink)' });
        isProcessing = false;
        UI.updateProgress(0, "Đã hủy xử lý.", "STANDBY");
    } else {
        promptPasswordAndUpload();
    }
}

// Nút "Tiếp tục tải lên" ở footer — bỏ qua các cột chưa quyết định,
// không để nút hủy giết luôn các file mới sạch đang chờ
window.finishConflicts = function() {
    finishConflictResolution();
};

window.cancelConflict = function() {
    document.getElementById('conflict-modal-overlay').classList.add('hidden');
    window.uploadQueue = { newFiles: [], revokedFiles: [], activeFiles: [], approvedFiles: [] };
    isProcessing = false;
    UI.updateProgress(0, "Đã hủy thao tác.", "STANDBY");
};
// =====================================================================
// BƯỚC 3: NHẬP MẬT KHẨU VÀ CHẠY LUỒNG UPLOAD CỐT LÕI (CORE)
// =====================================================================
async function promptPasswordAndUpload() {
    const finalFiles = window.uploadQueue.approvedFiles;

    // Kiểm tra trùng lần cuối TRƯỚC khi hỏi khóa — file "mới" bất ngờ xuất hiện
    // trên chain sau khi quét (race với uploader khác). File đã duyệt qua bảng
    // xung đột (knownDup) không hỏi lại.
    try {
        const norm = h => String(h || '').replace(/^0x/i, '').toLowerCase();
        const myAddr = String(web3.currentAccount || '').toLowerCase();
        const onChain = {};
        for (const ev of (await web3.queryHistory() || [])) {
            if (String(ev.args[7] || '').toLowerCase() !== myAddr) continue; // DocumentAddedV2: uploader ở args[7]
            const h = norm(ev.args[1]);
            if (h) onChain[h] = ev.args[0];
        }
        // Bản ghi đã thu hồi (isRevoked) không báo — contract cho phép nạp lại
        // nội dung đó, và file đã qua bảng đỏ nếu lớp quét bắt được.
        const dupEntries = [];
        for (const f of finalFiles) {
            const docId = onChain[norm(f.hash)];
            if (!docId || f.knownDup) continue;
            let d = null;
            try { d = await web3.contract.getDocument(docId); } catch {}
            if (d && d[4]) continue;
            dupEntries.push({ f, d, docId });
        }
        if (dupEntries.length) {
            const shortA = a => a ? `${a.slice(0, 8)}…${a.slice(-4)}` : '—';
            const list = dupEntries.map(({ f, d, docId }) => {
                const nameHtml = `<span style="display:block;max-width:22rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600" title="${esc(f.fileObj.name)}">• ${esc(f.fileObj.name)}</span>`;
                return d
                    ? `<div style="margin-bottom:8px">${nameHtml}<span class="text-faint" style="font-size:12px">— ví ${esc(shortA(String(d[3])))} đóng dấu ${esc(window.formatTimeForce(Number(d[2]) * 1000))}</span></div>`
                    : `<div style="margin-bottom:8px">${nameHtml}<span class="text-faint" style="font-size:12px">(đã đóng dấu: ${esc(docId.slice(0, 30))}…)</span></div>`;
            }).join('');
            const remaining = finalFiles.length - dupEntries.length;
            const dupHtml = `<div style="max-width:22rem;margin:0 auto;text-align:left">${dupEntries.length} tệp vừa được chính ví này đóng dấu sau khi bạn chọn (có thể từ thiết bị khác) — blockchain không cho một ví ghi trùng nên các tệp này sẽ bị <b>bỏ qua</b>:<br><br><div style="max-height:10rem;overflow-y:auto;padding-right:6px">${list}</div>${remaining > 0 ? `<br>Tiếp tục với ${remaining} tệp còn lại?` : '<br>Không còn tệp nào để tải lên.'}</div>`;
            const res = await Swal.fire({
                title: 'Phát hiện tài liệu trùng nội dung',
                html: dupHtml,
                icon: 'warning', showCancelButton: remaining > 0, width: 'min(28rem, 92vw)',
                confirmButtonText: remaining > 0 ? 'Bỏ qua & tiếp tục' : 'Đã hiểu', cancelButtonText: 'Hủy',
                background: 'var(--panel)', color: 'var(--ink)'
            });
            if (remaining === 0 || !res.isConfirmed) {
                isProcessing = false;
                UI.updateProgress(0, "Đã hủy — không còn tệp hợp lệ để tải lên", "STANDBY");
                return;
            }
            // Loại file trùng khỏi hàng chờ — contract sẽ revert nếu đưa vào
            for (const { f } of dupEntries) {
                const i = finalFiles.indexOf(f);
                if (i >= 0) finalFiles.splice(i, 1);
            }
        }
    } catch (e) { console.warn('Bỏ qua kiểm tra trùng (RPC lỗi):', e); }

    // Tài liệu đang hoạt động của chính ví này — làm option cho select
    // "đây là bản mới của tài liệu cũ". Server vẫn kiểm tra lại quyền sở hữu.
    const myAddrUp = String(web3.currentAccount || '').toLowerCase();
    const myActiveDocs = [];
    try {
        for (const b of (await ApiService.getBatchesFromDatabase() || [])) {
            if (String(b.uploader || '').toLowerCase() !== myAddrUp) continue;
            for (const f of (b.files || [])) if (!f.isRevoked) myActiveDocs.push(f);
        }
    } catch (e) {}

    // Danh sách file được duyệt — mỗi file chọn chế độ riêng, tùy chọn khóa riêng
    const rowsHtml = finalFiles.map((f, i) => `
        <div class="bdi-file-row" data-i="${Number(i)}" style="display:flex;flex-direction:column;gap:5px;padding:8px;border:1px solid var(--line-strong);border-radius:8px;margin-bottom:6px;background:var(--sunken);text-align:left">
            <div style="display:flex;align-items:center;gap:8px;min-width:0">
                <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--ink)" title="${esc(f.name)}">${esc(f.name)}</span>
                <select class="bdi-vis" style="padding:4px 6px;border-radius:6px;border:1px solid var(--line-strong);background:var(--panel);color:var(--ink);font-size:11px;cursor:pointer;flex-shrink:0">
                    <option value="private" selected>🔒 Riêng tư</option>
                    <option value="public">🌐 Công khai</option>
                </select>
            </div>
            <label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--muted);cursor:pointer;width:fit-content">
                <input type="checkbox" class="bdi-ownkey" style="accent-color:var(--accent);cursor:pointer"> Đặt khóa riêng (không dùng khóa chung)
            </label>
            <input type="password" class="bdi-key" placeholder="Nhập khóa riêng cho tệp này..." autocomplete="new-password" style="display:none;width:100%;box-sizing:border-box;padding:6px 10px;border-radius:6px;border:1px solid var(--line-strong);background:var(--panel);color:var(--ink);font-size:12px;outline:none">
            ${myActiveDocs.length ? `<select class="bdi-replace" title="Nếu đây là phiên bản mới của một tài liệu đã đóng dấu, chọn tài liệu cũ bị thay thế" style="padding:4px 6px;border-radius:6px;border:1px solid var(--line-strong);background:var(--panel);color:var(--ink);font-size:11px;cursor:pointer">
                <option value="">— Không phải bản mới của tài liệu cũ —</option>
                ${myActiveDocs.map(d => `<option value="${esc(d.docId)}">Thay thế: ${esc(d.fileName || d.docId)}</option>`).join('')}
            </select>` : ''}
        </div>`).join('');

    const aesHtml = `<style>
            #swal-vis{width:88%;margin:4px 0 0;padding:9px 12px;border-radius:8px;border:1px solid var(--line-strong);background:var(--panel);color:var(--ink);font-size:14px;outline:none;cursor:pointer}
            #swal-vis option,.bdi-vis option{color:var(--ink);background:var(--panel)}
        </style>
        <div class="text-left text-sm text-soft mb-1">Khóa mã hóa chung cho ${finalFiles.length} tệp đã được xét duyệt:</div>
        <input id="swal-key" type="password" placeholder="Nhập khóa bí mật chung..." class="swal2-input" style="width:88%;margin-top:8px">
        <div class="text-left text-sm text-soft mt-3 mb-1">Chế độ chia sẻ mặc định:</div>
        <select id="swal-vis">
            <option value="private" selected>🔒 Riêng tư — chỉ mình tôi xem được</option>
            <option value="public">🌐 Công khai — mọi người dùng đều xem được</option>
        </select>
        <div class="text-left text-sm text-soft mt-3 mb-1">Hạn hiệu lực (tùy chọn — áp cho toàn bộ tệp trong lô):</div>
        <input id="swal-expires" type="datetime-local" class="swal2-input" style="width:88%;margin-top:4px;color-scheme:dark">
        <div class="text-[11px] text-faint mt-1 text-left">Để trống = không hết hạn. Quá hạn, tài liệu vẫn nguyên vẹn nhưng bị đánh dấu "hết hạn" khi tra cứu.</div>
        <div class="text-left text-sm text-soft mt-3 mb-1">
            <label class="flex items-center gap-2 ${finalFiles.length === 1 ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}" title="${esc(finalFiles.length === 1 ? '' : 'Đa chữ ký chỉ áp dụng cho tải lên từng tài liệu')}">
                <input type="checkbox" id="swal-multisig" class="accent-accent w-4 h-4" ${finalFiles.length === 1 ? '' : 'disabled'}>
                <span>Đa chữ ký (multi-sig) — tài liệu chờ đủ chữ ký mới đóng dấu${finalFiles.length === 1 ? '' : ' — chỉ áp dụng cho 1 tài liệu'}</span>
            </label>
        </div>
        ${finalFiles.length === 1 ? `
        <div id="swal-multisig-fields" style="display:none">
            <input id="swal-signers" type="text" placeholder="Địa chỉ ví người ký (0x…), cách nhau bởi dấu phẩy — tối đa 20" class="swal2-input" style="width:88%;margin-top:6px">
            <input id="swal-threshold" type="number" min="1" max="20" placeholder="Ngưỡng chữ ký tối thiểu (K)" class="swal2-input" style="width:88%;margin-top:6px">
            <div class="text-[11px] text-faint mt-1 text-left">Doc ở trạng thái <b>CHỜ KÝ</b>: mỗi người ký xác nhận EIP-712 trên ứng dụng, đủ K chữ ký thì nộp seal lên chuỗi.</div>
        </div>` : ''}
        <div class="text-left text-sm text-soft mt-3 mb-1 flex items-center gap-2">
            <input type="checkbox" id="swal-selfcustody" class="accent-accent w-4 h-4">
            <span>Tự giữ khóa — <b>server không lưu mật khẩu</b> (tài liệu tối mật)</span>
        </div>
        <div id="swal-selfcustody-fields" style="display:none">
            <input id="swal-selfpass" type="password" placeholder="Mật khẩu riêng (tối thiểu 8 ký tự)..." class="swal2-input" style="width:88%;margin-top:6px">
            <input id="swal-selfpass2" type="password" placeholder="Nhập lại mật khẩu..." class="swal2-input" style="width:88%;margin-top:6px">
            <div class="text-[11px] text-warn mt-1 text-left">⚠ Chế độ này áp cho TOÀN BỘ tệp trong lô. Quên mật khẩu = không thể giải mã file, kể cả admin.</div>
        </div>
        <div class="text-left text-sm text-soft mt-3 mb-1">Tùy chỉnh từng tệp:</div>
        <div style="max-height:11rem;overflow-y:auto;padding-right:4px">${rowsHtml}</div>`;

    const { value: formValues } = await Swal.fire({
        title: 'BẢO MẬT AES-256',
        html: aesHtml,
        width: 'min(32rem, 92vw)',
        focusConfirm: false,
        background: 'var(--panel)', color: 'var(--ink)',
        confirmButtonColor: 'var(--accent)', showCancelButton: true, cancelButtonText: 'Hủy',
        didOpen: () => {
            const selfCb = document.getElementById('swal-selfcustody');
            const selfFields = document.getElementById('swal-selfcustody-fields');
            const toggleSelf = () => { selfFields.style.display = selfCb.checked ? 'block' : 'none'; };
            selfCb.addEventListener('change', toggleSelf);
            toggleSelf();
            const msCb = document.getElementById('swal-multisig');
            const msFields = document.getElementById('swal-multisig-fields');
            if (msCb && msFields) {
                const toggleMs = () => { msFields.style.display = msCb.checked ? 'block' : 'none'; };
                msCb.addEventListener('change', toggleMs);
                toggleMs();
            }
            document.querySelectorAll('.bdi-ownkey').forEach(cb => {
                cb.addEventListener('change', () => {
                    const inp = cb.closest('.bdi-file-row').querySelector('.bdi-key');
                    inp.style.display = cb.checked ? 'block' : 'none';
                    if (cb.checked) inp.focus();
                });
            });
        },
        preConfirm: () => {
            const selfOn = document.getElementById('swal-selfcustody').checked;
            let selfPass = null;
            if (selfOn) {
                selfPass = document.getElementById('swal-selfpass').value;
                const selfPass2 = document.getElementById('swal-selfpass2').value;
                if (!selfPass || selfPass.length < 8) { Swal.showValidationMessage('Mật khẩu tự giữ khóa phải có ít nhất 8 ký tự'); return false; }
                if (selfPass !== selfPass2) { Swal.showValidationMessage('Hai lần nhập mật khẩu không khớp'); return false; }
            }
            const key = document.getElementById('swal-key').value;
            if (!key && !selfOn) { Swal.showValidationMessage('Vui lòng nhập khóa chung'); return false; }
            const vis = document.getElementById('swal-vis').value;
            const perFile = [];
            let missingName = null;
            document.querySelectorAll('.bdi-file-row').forEach(row => {
                const i = Number(row.dataset.i);
                const own = row.querySelector('.bdi-ownkey').checked;
                const k = row.querySelector('.bdi-key').value;
                if (own && !k) missingName = finalFiles[i].name;
                const rep = row.querySelector('.bdi-replace');
                perFile[i] = { key: own ? k : null, vis: row.querySelector('.bdi-vis').value, replaces: rep ? (rep.value || null) : null };
            });
            if (missingName) { Swal.showValidationMessage(`Tệp "${esc(missingName)}" đã chọn khóa riêng nhưng chưa nhập`); return false; }
            // Hạn hiệu lực: datetime-local → epoch giây; trống = 0 = không hết hạn
            const expRaw = document.getElementById('swal-expires').value;
            let expiresAt = 0;
            if (expRaw) {
                const t = Math.floor(new Date(expRaw).getTime() / 1000);
                if (!Number.isFinite(t) || t <= 0) { Swal.showValidationMessage('Hạn hiệu lực không hợp lệ'); return false; }
                expiresAt = t;
            }
            // Multi-sig: chỉ bật được khi đúng 1 file (checkbox bị disable khi batch)
            let multiSig = null;
            const msCb = document.getElementById('swal-multisig');
            if (msCb && msCb.checked && !msCb.disabled) {
                const raw = document.getElementById('swal-signers').value || '';
                const thr = Number(document.getElementById('swal-threshold').value);
                const signers = [...new Set(raw.split(',').map(s => s.trim()).filter(Boolean))];
                if (signers.length === 0) { Swal.showValidationMessage('Đa chữ ký: nhập ít nhất 1 địa chỉ ví người ký'); return false; }
                const badAddr = signers.find(a => !/^0x[0-9a-fA-F]{40}$/.test(a));
                if (badAddr) { Swal.showValidationMessage(`Đa chữ ký: địa chỉ không hợp lệ "${badAddr}"`); return false; }
                if (signers.length > 20) { Swal.showValidationMessage('Đa chữ ký: tối đa 20 người ký (giới hạn contract)'); return false; }
                if (!Number.isInteger(thr) || thr < 1 || thr > signers.length) {
                    Swal.showValidationMessage(`Đa chữ ký: ngưỡng K phải là số nguyên thỏa 1 ≤ K ≤ ${signers.length}`); return false;
                }
                multiSig = { signers: signers.map(a => a.toLowerCase()), threshold: thr };
            }
            return { key, vis, perFile, expiresAt, selfCustody: selfOn ? { enabled: true, pass: selfPass } : null, multiSig };
        }
    });

    // Nếu bấm Hủy hoặc không nhập khóa -> Bắt buộc mở khóa hệ thống
    // (self-custody không cần khóa chung — mật khẩu riêng đã đủ)
    if (!formValues || (!formValues.key && !(formValues.selfCustody && formValues.selfCustody.enabled))) {
        isProcessing = false;
        return;
    }

    // Gắn cài đặt riêng vào từng file — file không đặt khóa riêng dùng khóa chung
    formValues.perFile.forEach((pf, i) => {
        if (pf && finalFiles[i]) {
            finalFiles[i]._key = pf.key;
            finalFiles[i]._vis = pf.vis;
            finalFiles[i]._replacesDocId = pf.replaces || null;
            // Hạn hiệu lực batch-level: cùng 1 giá trị cho mọi file trong lô
            // (0 = không hết hạn). previousDocId on-chain suy ra từ _replacesDocId
            // sau khi qua validatePreviousDocIds trong executeUploadCore.
            finalFiles[i]._expiresAt = Number(formValues.expiresAt) || 0;
        }
    });

    // Bật khóa chống click đúp
    isProcessing = true;

    //await ÉP HỆ THỐNG CHỜ CHẠY XONG MỚI TIẾP
    await executeUploadCore(finalFiles, formValues.key, formValues.vis, formValues.selfCustody, formValues.multiSig || null);
}

// Drain các batch "mồ côi" (ghi chain xong nhưng lưu DB lỗi) — tự chạy lại
// ngay khi vào app/tab upload, không chờ lần upload kế tiếp. Nhờ merge ở
// server, retry cũng bổ sung encKey vào bản ghi phục hồi thiếu khóa.
// Chỉ drain orphan CỦA VÍ ĐANG ĐĂNG NHẬP — server gán uploader=chủ JWT,
// nếu drain lô của ví khác sẽ gán sai chủ sở hữu (dữ liệu "nhảy" sang ví lạ).
async function drainOrphanedBatches() {
    const orphans = JSON.parse(localStorage.getItem('orphanedBatches') || '[]');
    if (!orphans.length) return;
    const me = (sessionStorage.getItem('bdi_addr') || '').toLowerCase();
    const remain = [];
    for (const ob of orphans) {
        if (me && String(ob.uploader || '').toLowerCase() !== me) { remain.push(ob); continue; }
        try { await ApiService.saveBatchToDatabase(ob); }
        catch (e) { remain.push(ob); }
    }
    localStorage.setItem('orphanedBatches', JSON.stringify(remain));
}

// LUỒNG MÃ HÓA, IPFS VÀ BLOCKCHAIN 
// multiSig = { signers: [addr...], threshold: K } — chỉ hợp lệ khi upload ĐÚNG 1 file
// (UI đã disable checkbox khi batch; đây là lớp chặn thứ hai phòng caller khác).
async function executeUploadCore(fileDataArray, secretKey, visibility = 'private', selfCustody = null, multiSig = null) {
    const isSelfCustody = !!(selfCustody && selfCustody.enabled);
    const useMultiSig = !!(multiSig && fileDataArray.length === 1);
    isProcessing = true;
    try {
        // Token JWT hết hạn/đổi ví giữa chừng → xin challenge và ký lại trước khi ghi dữ liệu
        await ApiService.ensureAuth(web3.signer, web3.currentAccount);

        // (Kiểm tra trùng nội dung đã dời lên trước bước nhập khóa —
        // file qua bảng xung đột được đánh dấu knownDup không hỏi lại)
        let uploadedDocs = [];
        let leaves = [];

        for (let i = 0; i < fileDataArray.length; i++) {
            const fileItem = fileDataArray[i];
            const file = fileItem.fileObj;
            
            // Tiến trình THẬT: mỗi file 1 slot đều trong 15→60.
            // Encrypt ~30% slot chạy theo chunk AES, upload ~70% slot chạy theo byte XHR thật.
            const N = fileDataArray.length;
            const slotW = 45 / N;
            const slotStart = 15 + i * slotW;
            const encStart = slotStart, encEnd = slotStart + slotW * 0.3;
            const upStart = encEnd, upEnd = slotStart + slotW;
            UI.updateProgress(Math.round(encStart), `Đang mã hóa file ${i + 1}/${N}:${file.name}...`, "ENCRYPTING");
            leaves.push("0x" + fileItem.hash);

            // AES Mã hóa — build chuỗi nhị phân theo chunk (tránh nổ stack/trễ với file lớn)
            const arrayBuffer = await file.arrayBuffer();
            const uint8Array = new Uint8Array(arrayBuffer);
            let binaryString = '';
            const CHUNK = 0x8000;
            let lastEncPct = -1;
            for (let off = 0; off < uint8Array.length; off += CHUNK) {
                binaryString += String.fromCharCode.apply(null, uint8Array.subarray(off, off + CHUNK));
                const p = Math.round(encStart + (off / Math.max(1, uint8Array.length)) * (encEnd - encStart));
                if (p !== lastEncPct) { lastEncPct = p; UI.updateProgress(p, `Đang mã hóa file ${i + 1}/${N}:${file.name}...`, "ENCRYPTING"); }
            }

            const fileKey = isSelfCustody ? selfCustody.pass : (fileItem._key || secretKey); // self-custody: mật khẩu riêng cho mọi file, server không escrow
            const encryptedData = CryptoJS.AES.encrypt(btoa(binaryString), fileKey).toString();
            const encryptedBlob = new Blob([encryptedData], { type: 'text/plain' });
            const encryptedFile = new File([encryptedBlob], file.name + '.enc', { type: 'text/plain' });

            UI.updateProgress(Math.round(encEnd), `Đang đẩy tệp ${i + 1}/${N} lên mạng IPFS...`, "UPLOADING");
            const uploadData = await ApiService.uploadFileWithProgress(encryptedFile, (pct) => {
                const p = Math.round(upStart + Math.min(100, Math.max(0, pct)) / 100 * (upEnd - upStart));
                UI.updateProgress(p, `Đang đẩy tệp ${i + 1}/${N} lên IPFS... ${pct}%`, "UPLOADING");
            });
            
            if (!uploadData.success) throw new Error(`Lỗi upload tệp ${file.name}`);
            
            let qrCodeBase64 = '';
            try { qrCodeBase64 = await QRCode.toDataURL(uploadData.documentId, { width: 120, margin: 1 }); } catch (e) {}

            // Fuzzy hash theo đoạn nội dung — phục vụ verify tìm file "sửa nhẹ"
            let chunkHashes = [];
            try { chunkHashes = await web3.computeChunkHashes(file); } catch (e) {}

            uploadedDocs.push({
                docId: uploadData.documentId,
                fileHash: fileItem.hash,
                chunkHashes,
                ipfsCID: uploadData.ipfsCID,
                fileName: file.name,
                fileSize: fileItem.size,
                qrCode: qrCodeBase64,
                encKey: isSelfCustody ? undefined : fileKey, // self-custody: KHÔNG gửi khóa — server không giữ
                selfCustody: isSelfCustody || undefined,
                visibility: fileItem._vis || visibility,
                // Liên kết dòng đời: docId phiên bản cũ mà file này thay thế (nếu có)
                replacesDocId: fileItem._replacesDocId || undefined,
                // Contract v2: hạn hiệu lực (epoch giây, 0 = không) + previousDocId
                // on-chain (điền sau validatePreviousDocIds — chỉ giữ prevId hợp lệ)
                expiresAt: Number(fileItem._expiresAt) || 0,
                previousDocId: '',
                // Multi-sig metadata lưu Mongo để UI biết doc nào CHỜ KÝ
                // (trạng thái sealed thật vẫn đọc từ chain mỗi lần hiển thị)
                requiredSigners: useMultiSig ? multiSig.signers : undefined,
                requiredThreshold: useMultiSig ? multiSig.threshold : undefined
            });
        }

        UI.updateProgress(65, "Đang tính toán Merkle Root và chốt lô...", "MERKLE TREE");
        const tree = new window.MerkleTree(leaves, window.keccak256, { sortPairs: true });
        const merkleRoot = tree.getHexRoot();
        const batchId = `BATCH_${Date.now()}`;
        
        UI.updateProgress(70, "Đang kiểm tra quyền versioning on-chain...", "VERIFYING");
        // Contract _checkPreviousDoc revert TOÀN BỘ batch nếu 1 prevId sai —
        // lọc trước: chỉ gửi prevId mà doc tồn tại on-chain, chưa có successor,
        // và ví hiện tại có quyền kế thừa. Lỗi → gửi '' cho file đó (lineage
        // off-chain replacesDocId vẫn giữ trong MongoDB).
        const prevCandidates = uploadedDocs.map(d => d.replacesDocId || '');
        const validatedPrevIds = await web3.validatePreviousDocIds(prevCandidates);
        uploadedDocs.forEach((d, i) => { d.previousDocId = validatedPrevIds[i] || ''; });

        // Chống trùng prevId TRONG CÙNG batch: contract gán successorOf[prevId]
        // ngay trong vòng lặp addDocumentsV2 → file thứ 2 cùng prevId sẽ thấy
        // "đã có bản mới" và revert cả tx. File đầu giữ prevId, các file sau → ''.
        const seenPrev = new Set();
        uploadedDocs.forEach((d) => {
            if (d.previousDocId) {
                if (seenPrev.has(d.previousDocId)) {
                    console.warn(`[versioning] Bỏ qua previousDocId trùng trong batch cho ${d.docId}: ${d.previousDocId}`);
                    d.previousDocId = '';
                } else {
                    seenPrev.add(d.previousDocId);
                }
            }
        });

        // Manifest lên IPFS SAU khi previousDocId cuối cùng đã chốt — manifest
        // phải phản ánh đúng giá trị ghi on-chain/Mongo. Lọc BỎ encKey (public).
        const publicFiles = uploadedDocs.map(({ encKey, chunkHashes, ...rest }) => rest);
        const manifestBlob = new Blob([JSON.stringify({ batchId, merkleRoot, timestamp: Date.now(), files: publicFiles })], { type: 'application/json' });
        const manifestUpload = await ApiService.uploadFileWithProgress(new File([manifestBlob], `${batchId}_manifest.json`), (pct) => {
            UI.updateProgress(Math.round(75 + Math.min(100, Math.max(0, pct)) / 100 * 7), "Đang lưu manifest lên IPFS...", "MERKLE TREE");
        });

        UI.updateProgress(85, useMultiSig ? "Đang chờ chữ ký MetaMask (Ký 1 lần cho tài liệu đa chữ ký)..." : "Đang chờ chữ ký MetaMask (Ký 1 lần duy nhất cho toàn bộ tệp)...", "SIGNING");
        // Ghi từng docId + fileHash + ipfsURI lên chain trong 1 giao dịch — để verify từng tài liệu hoạt động
        // Contract v2: addDocumentsV2(ids, hashes, uris, prevIds, expiresAts) — sealed ngay.
        // Multi-sig chỉ áp cho upload ĐƠN: addDocumentV2 với requiredSigners/threshold
        // → doc ở trạng thái PENDING, chờ sealDocument sau khi đủ chữ ký EIP-712.
        let txHash;
        if (useMultiSig && uploadedDocs.length === 1) {
            const d = uploadedDocs[0];
            txHash = await web3.addDocumentV2OnChain(
                d.docId, d.fileHash, `ipfs://${d.ipfsCID}`,
                d.previousDocId || '', Number(d.expiresAt) || 0,
                multiSig.signers, multiSig.threshold
            );
        } else {
            txHash = await web3.addDocumentsOnChain(
                uploadedDocs.map(d => d.docId),
                uploadedDocs.map(d => d.fileHash),
                uploadedDocs.map(d => `ipfs://${d.ipfsCID}`),
                uploadedDocs.map(d => d.previousDocId || ''),
                uploadedDocs.map(d => Number(d.expiresAt) || 0)
            );
        }
        
        // LƯU DB MONGODB
        const currentWalletAddr = web3.currentAccount ? web3.currentAccount.toLowerCase() : (window.__chainOwner || "");
        const batchData = { batchId, merkleRoot, ipfsCID: manifestUpload.ipfsCID, txHash, timestamp: Date.now(), uploader: currentWalletAddr, files: uploadedDocs };
        
        try {
            await ApiService.saveBatchToDatabase(batchData);
            await drainOrphanedBatches();

            // Cập nhật dung lượng ví
            let totalMB = 0; fileDataArray.forEach(item => { totalMB += item.fileObj.size / (1024 * 1024); });
            let wallets = await ApiService.getAllWallets();
            let myWallet = wallets.find(w => w.address.toLowerCase() === currentWalletAddr);
            await ApiService.syncWalletData(currentWalletAddr, { storageUsed: Number(((myWallet ? myWallet.storageUsed : 0) + (totalMB || 0.05)).toFixed(2)) });
        } catch (dbError) {
            console.error("Lỗi lưu DB, giao dịch đã lên chain:", dbError);
            const orphaned = JSON.parse(localStorage.getItem('orphanedBatches') || '[]');
            orphaned.push(batchData);
            localStorage.setItem('orphanedBatches', JSON.stringify(orphaned));
            Swal.fire({ title: 'Lưu ý', text: 'Giao dịch blockchain thành công nhưng lưu vào cơ sở dữ liệu bị lỗi. Hệ thống sẽ thử lưu lại sau.', icon: 'warning', background: 'var(--panel)', color: 'var(--ink)' });
        }
        
        UI.selectedUploadFiles = []; UI.renderUploadFileList();
        if (typeof window.loadWalletRoles === 'function') window.loadWalletRoles();
        
        UI.updateProgress(100, "Hoàn tất bảo mật & lưu trữ hàng loạt!", "SUCCESS");
        
        // Hiển thị báo cáo thành công
        let batchResultHtml = `<p class="text-xs text-ok mb-3 font-bold">✓ Merkle Root đã được tính và lưu trong manifest. Ký 1 giao dịch cho ${uploadedDocs.length} tệp!</p>`;
        if (useMultiSig) {
            batchResultHtml += `<p class="text-xs text-warn mb-3 font-bold">⏳ Tài liệu đang <b>CHỜ KÝ</b> — cần ${multiSig.threshold}/${multiSig.signers.length} chữ ký EIP-712. Mỗi người ký mở tab Lịch sử, bấm "Ký xác nhận", rồi ai cũng có thể bấm "Nộp chữ ký lên chain" khi đủ ngưỡng.</p>`;
        }
        batchResultHtml += `<div class="max-h-[200px] overflow-y-auto space-y-2 pr-1 custom-scrollbar mb-4">`;
        uploadedDocs.forEach((doc) => {
            batchResultHtml += `
                <div class="bg-sunken border border-line p-2.5 rounded-lg flex justify-between items-center group">
                    <div class="text-left overflow-hidden">
                        <div class="text-[11px] text-faint font-medium truncate w-56 mb-0.5">${esc(doc.fileName)} (${esc(doc.fileSize)})</div>
                        <div class="text-accent font-mono text-xs truncate w-56">${esc(doc.docId)}</div>
                    </div>
                    <button data-act="copy" data-v="${esc(doc.docId)}" class="text-faint hover:text-ink transition bg-sunken p-2 rounded"><i class="fa-regular fa-copy"></i></button>
                </div>`;
        });
        batchResultHtml += `</div>`;

        Swal.fire({ title: `Khắc Chuỗi Thành Công!`, html: batchResultHtml, background: 'var(--panel)', color: 'var(--ink)', confirmButtonColor: 'var(--faint)' });

    } catch (error) {
        UI.updateProgress(0, "Tiến trình bị hủy.", "FAILED");
        Swal.fire({ title: 'Giao dịch thất bại', text: getShortError(error), icon: 'error', background: 'var(--panel)', color: 'var(--ink)' });
    } finally {
        isProcessing = false;
        setTimeout(() => UI.updateProgress(0, "Hệ thống đang rảnh", "STANDBY"), 3000);
    }
}

// =====================================================================
// XỬ LÝ VERIFY & AI FORENSIC
// =====================================================================
async function handleVerify() {
    if (isProcessing) return;

    const fileInput = document.getElementById('verifyFile');
    let docId = document.getElementById('verifyDocId')?.value.trim();
    const file = fileInput && fileInput.files[0];

    if (!file) {
        return Swal.fire({ title: 'Thiếu thông tin', text: 'Vui lòng chọn tệp cần kiểm tra!', icon: 'warning', background: 'var(--panel)', color: 'var(--ink)' });
    }

    isProcessing = true;
    try {
        // KHÔNG nhập mã → tự tra cứu: băm file → tìm bản ghi trùng nội dung;
        // không có thì tìm theo tên file để phát hiện nội dung bị sửa.
        if (!docId) {
            UI.updateProgress(15, "Đang băm tệp để tự tra cứu mã tài liệu...", "HASHING");
            const fileHashProbe = await web3.hashFile(file);
            UI.updateProgress(30, "Đang tra cứu bản ghi trong hệ thống...", "QUERYING");
            const lk = await ApiService.lookupDocument(fileHashProbe, file.name);

            if (lk && lk.byHash && lk.byHash.length > 0) {
                await verifyByHashMatches(file, fileHashProbe, lk.byHash);
                isProcessing = false;
                return;
            }
            if (lk && lk.byName && lk.byName.length > 0) {
                // Tên giống tài liệu đã đóng dấu nhưng nội dung khác → chạy tiếp
                // luồng đối chiếu hash chuẩn (sẽ rơi vào nhánh PHÁT HIỆN GIẢ MẠO)
                docId = lk.byName[0].docId;
            } else {
                // Fuzzy: tìm bản ghi có NỘI DUNG tương tự (chunk-hash CTPH —
                // file sửa một đoạn vẫn trùng phần lớn đoạn), gộp thêm gợi ý
                // theo tên; người dùng chọn bản để đối chiếu hoặc bỏ qua
                let contentSim = [];
                try {
                    UI.updateProgress(40, "Đang phân tích độ tương đồng nội dung...", "ANALYZING");
                    const ch = await web3.computeChunkHashes(file);
                    const r = await ApiService.lookupSimilar(ch);
                    contentSim = (r && r.matches) || [];
                } catch (e) { console.warn('Lỗi tra độ tương đồng nội dung:', e); }
                const seenIds = new Set(contentSim.map(m => m.docId));
                const nameSim = ((lk && lk.bySimilar) || []).filter(n => !seenIds.has(n.docId));
                const candidates = [...contentSim, ...nameSim];
                if (candidates.length > 0) {
                    const picked = await pickSimilarDoc(file.name, candidates);
                    if (!picked) {
                        UI.updateProgress(0, "Hệ thống đang rảnh", "STANDBY");
                        isProcessing = false;
                        return;
                    }
                    docId = picked;
                } else {
                    UI.updateProgress(0, "Không tìm thấy dữ liệu.", "NOT FOUND");
                    isProcessing = false;
                    return Swal.fire({
                        title: 'KHÔNG TÌM THẤY', icon: 'warning', background: 'var(--panel)', color: 'var(--ink)',
                        html: `<p class="text-sm text-soft">Tệp <b>${esc(file.name)}</b> không khớp nội dung lẫn tên của bất kỳ tài liệu nào đã đóng dấu trên hệ thống.<br><span class="text-faint text-xs">Nếu tài liệu đã đổi tên, hãy nhập mã truy xuất (docId) để đối chiếu trực tiếp.</span></p>`,
                        confirmButtonText: 'Đóng', confirmButtonColor: 'var(--accent)'
                    });
                }
            }
        }

        UI.updateProgress(20, "Đang truy xuất sổ cái Smart Contract...", "QUERYING");
        const docData = await web3.getDocumentFromChain(docId);
        const originalHash = docData[0];

        if (!originalHash) {
            UI.updateProgress(0, "Không tìm thấy dữ liệu.", "NOT FOUND");
            return Swal.fire({ title: 'Lỗi', text: 'Tài liệu này không tồn tại trên chuỗi khối.', icon: 'error', background: 'var(--panel)', color: 'var(--ink)' });
        }

        UI.updateProgress(50, "Đang băm tệp tin kiểm tra...", "HASHING");
        const currentHash = await web3.hashFile(fileInput.files[0]);

        const timestamp = new Date(Number(docData[2]) * 1000).toLocaleString('vi-VN');
        const uploaderWallet = docData[3];
        
        const traceHTML = `
            <div class="mt-4 p-3 bg-sunken border border-line-strong rounded-lg text-left text-xs">
                <p class="text-accent font-bold mb-2 uppercase"><i class="fa-solid fa-fingerprint mr-1"></i> Truy xuất nguồn gốc (Traceability):</p>
                <p class="text-muted mb-1">Ví tạo: <span class="text-ok font-mono">${esc(uploaderWallet)}</span></p>
                <p class="text-muted">Thời gian khắc chuỗi: <span class="text-ink">${esc(timestamp)}</span></p>
            </div>`;

        // Dòng đời phiên bản: tài liệu đã có bản kế nhiệm → cảnh báo "bản cũ"
        // trong mọi kết quả (khớp / thu hồi / sai lệch)
        let supersededHtml = '';
        try {
            const lin = await ApiService.getDocumentLineage(docId);
            if (lin && lin.success && lin.supersededBy) {
                const latestId = (lin.latest && lin.latest.docId) || lin.supersededBy.docId;
                supersededHtml = `<div class="bg-warn-soft border border-warn p-3 rounded text-warn text-sm mt-3 text-left"><i class="fa-solid fa-code-branch mr-1"></i><b>Đây là bản cũ</b> — đã có phiên bản mới thay thế. Bản mới nhất: <span class="font-mono text-xs break-all">${esc(latestId)}</span></div>`;
            }
        } catch (e) {}

        // Contract v2: trạng thái pháp lý on-chain — HẾT HẠN / CHỜ CHỮ KÝ /
        // CÓ BẢN MỚI. Tách biệt hoàn toàn với giả mạo (sai hash): hash khớp
        // nhưng tài liệu hết hạn/chưa seal/vừa bị thay thế vẫn phải cảnh báo.
        // Chữ ký pending nằm off-chain (Mongo) → đếm qua API có auth.
        let chainStateHtml = '';
        try {
            const expiresAtNum = Number(docData[7] || 0);
            const isSealed = !!docData[10];
            const thresholdNum = Number(docData[9] || 0);
            const expired = expiresAtNum > 0 && Date.now() / 1000 > expiresAtNum;
            const successorId = await web3.getSuccessor(docId).catch(() => '');
            const parts = [];
            if (expired) {
                parts.push(`<div class="bg-warn-soft border border-warn p-2.5 rounded text-warn text-xs text-left"><i class="fa-regular fa-calendar-xmark mr-1"></i><b>HẾT HẠN</b> — tài liệu nguyên vẹn nhưng đã quá hạn hiệu lực (${esc(new Date(expiresAtNum * 1000).toLocaleString('vi-VN'))})</div>`);
            }
            if (!isSealed && thresholdNum > 0) {
                let sigInfo = '';
                try {
                    const ss = await ApiService.getSealStatus(docId);
                    if (ss && ss.pendingCount != null) sigInfo = ` — đã nộp ${esc(ss.pendingCount)}/${esc(thresholdNum)} chữ ký`;
                } catch (e) {}
                parts.push(`<div class="bg-warn-soft border border-warn p-2.5 rounded text-warn text-xs text-left"><i class="fa-solid fa-hourglass-half mr-1"></i><b>ĐA CHỮ KÝ — CHƯA SEAL ON-CHAIN</b>${sigInfo}</div>`);
            }
            if (successorId) {
                parts.push(`<div class="bg-info-soft border border-info p-2.5 rounded text-info text-xs text-left"><i class="fa-solid fa-code-branch mr-1"></i><b>ĐÃ CÓ BẢN MỚI KẾ THỪA</b> trên chuỗi: <span class="font-mono break-all">${esc(successorId)}</span></div>`);
            }
            if (parts.length) chainStateHtml = `<div class="mt-3 space-y-1.5 text-left">${parts.join('')}</div>`;
        } catch (e) { console.warn('[verify] đọc trạng thái v2 lỗi:', e); }

        if (currentHash.toLowerCase() === originalHash.toLowerCase()) {
            let isRevoked = docData[4];
            let revocationReason = docData[5];

            // Đối chiếu thêm MongoDB: bắt các tài liệu từng bị thu hồi off-chain
            // (trước khi có dual-write) mà chain chưa phản ánh
            try {
                const st = await ApiService.getDocumentStatus(docId);
                if (st && st.isRevoked && !isRevoked) {
                    isRevoked = true;
                    if (st.revocationReason) revocationReason = st.revocationReason;
                }
            } catch (e) {}

            if (isRevoked) {
                UI.updateProgress(100, "Tài liệu nguyên bản nhưng ĐÃ BỊ VÔ HIỆU HÓA.", "REVOKED");
                Swal.fire({
                    title: 'TÀI LIỆU ĐÃ BỊ THU HỒI!', icon: 'error', background: 'var(--panel)', color: 'var(--ink)',
                    html: `
                        <div class="text-left text-sm text-soft space-y-3">
                            <p>Mã băm hoàn toàn trùng khớp với bản gốc, tuy nhiên tài liệu này đã bị <b class="text-err">VÔ HIỆU HÓA</b> bởi cơ quan phát hành.</p>
                            <div class="bg-err-soft border border-err p-3 rounded text-err"><b>Lý do thu hồi:</b> ${esc(revocationReason)}</div>
                        </div>
                        ${supersededHtml}
                        ${chainStateHtml}
                        ${traceHTML}`,
                    confirmButtonText: 'Đóng', confirmButtonColor: 'var(--err)'
                }).then(() => UI.updateProgress(0, "Hệ thống đang rảnh", "STANDBY"));
            } else {
                UI.updateProgress(100, "Kiểm chứng thành công. Dữ liệu khớp 100%.", "VERIFIED");
                lastCertData = { 
                    docId: docId, fileHash: originalHash, 
                    ipfsCID: docData[1] ? docData[1].replace('ipfs://', '') : 'On-chain Verified', 
                    signerWallet: uploaderWallet, timestamp: timestamp 
                };
                Swal.fire({
                    title: 'KHỚP 100%', text: 'Tài liệu nguyên bản, tính toàn vẹn được bảo toàn.', 
                    icon: 'success', background: 'var(--panel)', color: 'var(--ink)',
                    html: `
                        <p class="text-soft text-sm mb-4">Mã băm hoàn toàn trùng khớp với bản gốc trên Blockchain.</p>
                        ${supersededHtml}
                        ${chainStateHtml}
                        ${traceHTML}
                        <button data-act="pdf" class="w-full mt-4 bg-ok hover:brightness-110 text-white py-2 rounded-lg text-sm font-bold shadow-sm transition">
                            <i class="fa-solid fa-file-pdf mr-2"></i> Tải Báo Cáo Chứng Thực (PDF)
                        </button>`,
                    confirmButtonText: 'Đóng', confirmButtonColor: 'var(--accent)'
                }).then(() => {
                    UI.updateProgress(0, "Hệ thống đang rảnh", "STANDBY");
                    if (fileInput) fileInput.value = '';
                    UI.updateFileName('verifyFile');
                });
            }
        } else {
            UI.updateProgress(80, "Phát hiện giả mạo! Đang tiến hành phân tích sâu...", "ANALYZING");
            
            const { value: secretKey } = await Swal.fire({
                title: 'GIẢI MÃ ĐỂ ĐỐI CHIẾU', 
                text: 'Nếu tài liệu gốc trên hệ thống được bảo mật bằng AES-256, vui lòng nhập khóa bí mật:',
                input: 'password', inputPlaceholder: 'Nhập khóa bí mật...', 
                inputAttributes: { autocomplete: 'new-password' },
                background: 'var(--panel)', color: 'var(--ink)',
                confirmButtonColor: 'var(--accent)', showCancelButton: true, cancelButtonText: 'Hủy đối chiếu'
            });

            if (secretKey === undefined) { 
                UI.updateProgress(0, "Hệ thống đang rảnh", "STANDBY"); 
                isProcessing = false; 
                return; 
            }

            let backendResult = {};
            try { 
                backendResult = await ApiService.verifyWithBackend(fileInput.files[0], docId, secretKey); 
            } catch (err) {}

            UI.updateProgress(100, "Phân tích sai lệch hoàn tất.", "FAILED");
            
            let html = '';
            if (backendResult.aiReport) {
                html += `
                    <div class="mt-2 mb-4 p-3 bg-err-soft border-l-4 border-err rounded-r-lg text-left shadow-sm">
                        <p class="text-err font-bold mb-1 uppercase text-[11px] tracking-wider">
                            <i class="fa-solid fa-robot mr-1"></i> Báo Cáo Pháp Y AI (Forensic)
                        </p>
                        <p class="text-soft text-xs italic leading-relaxed">"${esc(backendResult.aiReport)}"</p>
                    </div>`;
            }

            if (backendResult.anomalies && backendResult.anomalies.length > 0) {
                html += `<div class="mt-3 p-3 bg-warn-soft border-l-4 border-warn rounded-r-lg text-left">
                    <p class="text-warn font-bold mb-1 uppercase text-[11px] tracking-wider">
                        <i class="fa-solid fa-eye-slash mr-1"></i> Phát hiện ký tự ngụy trang (homoglyph)
                    </p>
                    <p class="text-muted text-[11px] mb-2">Các ký tự sau trông giống chữ thường nhưng thuộc bảng mã khác — chiêu trò giả mạo phổ biến:</p>
                    ${backendResult.anomalies.map(a => `
                        <span class="inline-block bg-sunken border border-warn rounded px-2 py-1 mr-1 mb-1 font-mono text-[11px] text-warn">
                            "${esc(a.char)}" = ${esc(a.code)} (${esc(a.name)}) ${a.inNewFile ? '— chèn vào file kiểm tra' : '— trong bản gốc'}
                        </span>`).join('')}
                </div>`;
            }

            if (backendResult.differences && backendResult.differences.length > 0) {
                html += '<div class="bg-sunken text-soft p-4 rounded-lg text-left font-mono max-h-[300px] overflow-auto text-xs mt-3 border border-line leading-relaxed break-words">';
                backendResult.differences.forEach(p => {
                    // Class tĩnh thay style inline — không còn giá trị nào chui vào attribute
                    const cls = p.added ? 'bg-ok-soft text-ok' : p.removed ? 'bg-err-soft text-err line-through' : 'text-muted';
                    html += `<span class="${cls} rounded-sm px-0.5">${esc(p.value)}</span>`;
                });
                html += '</div>';
            } else if (backendResult.imageDiff && /^data:image\//.test(String(backendResult.imageDiff))) {
                // Chỉ chấp nhận data:image URL — chặn javascript:/url lạ trong src
                html += `<div class="mt-3 text-center"><img src="${esc(backendResult.imageDiff)}" class="max-w-full max-h-[300px] border border-err rounded-lg mx-auto shadow-sm bg-sunken"></div>`;
            } else if (!backendResult.aiReport) {
                html += `
                    <div class="bg-sunken text-soft p-4 rounded-lg text-left text-xs mt-3 border border-line space-y-3">
                        <p class="text-muted">Mã băm không khớp. Không thể tạo bản đồ trực quan (Sai mật khẩu giải mã hoặc lỗi IPFS).</p>
                        <div class="pt-3 font-mono text-[11px] space-y-1">
                            <p class="text-ok break-all"><b>Hash gốc:</b> ${esc(originalHash)}</p>
                            <p class="text-err break-all"><b>Hash tải lên:</b> ${esc(currentHash)}</p>
                        </div>
                    </div>`;
            }
            html += supersededHtml + chainStateHtml + traceHTML;

            Swal.fire({
                icon: 'error', title: 'PHÁT HIỆN GIẢ MẠO!',
                text: 'Mã băm không khớp với chuỗi khối!', 
                background: 'var(--panel)', color: 'var(--ink)',
                showCancelButton: true, confirmButtonText: 'Xem bằng chứng', cancelButtonText: 'Đóng', 
                confirmButtonColor: 'var(--accent)', cancelButtonColor: 'var(--err)', reverseButtons: true
            }).then((res) => {
                UI.updateProgress(0, "Hệ thống đang rảnh", "STANDBY");
                if (res.isConfirmed) {
                    Swal.fire({ 
                        title: 'BÁO CÁO GIÁM ĐỊNH', html: html, 
                        background: 'var(--panel)', color: 'var(--ink)', width: 'min(700px, 94vw)', confirmButtonColor: 'var(--faint)' 
                    }).then(() => {
                        if (fileInput) fileInput.value = '';
                        UI.updateFileName('verifyFile');
                    });
                }
            });
        }
    } catch (err) {
        UI.updateProgress(0, "Lỗi tiến trình giám định.", "ERROR");
        Swal.fire({ title: 'Lỗi xác thực', text: getShortError(err), icon: 'error', background: 'var(--panel)', color: 'var(--ink)' });
    } finally {
        isProcessing = false;
    }
}

// Gợi ý tài liệu tương tự để đối chiếu — theo nội dung (chunk-hash, kèm %)
// hoặc theo tên file. Trả docId được chọn, hoặc null nếu người dùng khẳng
// định đây là tài liệu khác.
function pickSimilarDoc(fileName, matches) {
    return new Promise(resolve => {
        let done = false;
        const finish = v => { if (!done) { done = true; resolve(v); } };
        Swal.fire({
            title: 'PHÁT HIỆN TÀI LIỆU TƯƠNG TỰ', icon: 'question',
            background: 'var(--panel)', color: 'var(--ink)',
            html: `
                <p class="text-sm text-soft text-left mb-3">Nội dung tệp <b>${esc(fileName)}</b> không khớp nguyên bản bản ghi nào, nhưng hệ thống tìm thấy các tài liệu tương tự (theo nội dung hoặc tên). Nếu đây là phiên bản đã bị chỉnh sửa của một trong số đó — chọn để đối chiếu:</p>
                <div class="space-y-2 max-h-[280px] overflow-y-auto custom-scrollbar text-left">
                    ${matches.map((m, i) => `
                        <button type="button" class="sim-pick w-full text-left p-3 rounded-lg border border-line-strong hover:border-warn bg-sunken transition" data-i="${esc(String(i))}">
                            <div class="font-bold text-warn text-xs truncate">${esc(m.fileName || m.docId)}</div>
                            <div class="font-mono text-[10px] text-faint truncate">${esc(m.docId)}</div>
                            ${typeof m.score === 'number' ? `<div class="text-[10px] text-info mt-0.5">≈ ${esc(String(m.score))}% nội dung trùng bản gốc</div>` : ''}
                            ${m.isRevoked ? '<div class="text-[10px] text-err mt-0.5">Đã thu hồi</div>' : ''}
                        </button>`).join('')}
                </div>`,
            showConfirmButton: false, showCancelButton: true,
            cancelButtonText: 'Không phải — đây là tài liệu khác',
            cancelButtonColor: 'var(--faint)', allowOutsideClick: false,
            didOpen: () => {
                Swal.getHtmlContainer().querySelectorAll('.sim-pick').forEach(b =>
                    b.addEventListener('click', () => {
                        finish(matches[Number(b.dataset.i)].docId);
                        Swal.close();
                    }));
            }
        }).then(() => finish(null));
    });
}

// =====================================================================
// VERIFY KHÔNG CẦN MÃ — nội dung file khớp 1+ bản ghi đã đóng dấu.
// Mỗi bản ghi vẫn được đối chiếu trên chain (nguồn chuẩn) + MongoDB
// (bắt bản thu hồi off-chain cũ); hiển thị từng bản ghi kèm trạng thái.
// =====================================================================
async function verifyByHashMatches(file, fileHash, matches) {
    const results = [];
    for (const m of matches) {
        try {
            const d = await web3.getDocumentFromChain(m.docId);
            if (!d[0]) continue; // không có trên chain — bản ghi MongoDB mồ côi, bỏ qua
            let revoked = !!d[4];
            let reason = d[5] || '';
            try {
                const st = await ApiService.getDocumentStatus(m.docId);
                if (st && st.isRevoked && !revoked) {
                    revoked = true;
                    if (st.revocationReason) reason = st.revocationReason;
                }
            } catch (e) {}
            results.push({
                docId: m.docId, uploader: d[3],
                timestamp: new Date(Number(d[2]) * 1000).toLocaleString('vi-VN'),
                ipfsCID: d[1] ? d[1].replace('ipfs://', '') : '',
                revoked, reason
            });
        } catch (e) {}
    }

    const fileInput = document.getElementById('verifyFile');
    if (results.length === 0) {
        UI.updateProgress(0, "Không tìm thấy dữ liệu.", "NOT FOUND");
        return Swal.fire({ title: 'Lỗi', text: 'Bản ghi tồn tại trong MongoDB nhưng không đọc được trên chuỗi khối.', icon: 'error', background: 'var(--panel)', color: 'var(--ink)' });
    }

    const anyActive = results.some(r => !r.revoked);
    const rowsHtml = results.map(r => `
        <div class="p-3 rounded-lg border ${r.revoked ? 'border-err bg-err-soft' : 'border-ok bg-ok-soft'} text-left">
            <div class="flex items-center justify-between gap-2">
                <span class="font-mono text-[11px] text-soft truncate" title="${esc(r.docId)}">${esc(r.docId)}</span>
                <span class="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded ${r.revoked ? 'bg-err-soft text-err' : 'bg-ok-soft text-ok'}">${r.revoked ? 'ĐÃ THU HỒI' : 'NGUYÊN BẢN'}</span>
            </div>
            <p class="text-[10px] text-faint mt-1">Ví tạo: <span class="font-mono text-muted">${esc(r.uploader)}</span> · ${esc(r.timestamp)}</p>
            ${r.revoked && r.reason ? `<p class="text-[10px] text-err mt-1">Lý do thu hồi: ${esc(r.reason)}</p>` : ''}
        </div>`).join('');

    const firstActive = results.find(r => !r.revoked);
    if (firstActive) {
        lastCertData = {
            docId: firstActive.docId, fileHash: fileHash,
            ipfsCID: firstActive.ipfsCID || 'On-chain Verified',
            signerWallet: firstActive.uploader, timestamp: firstActive.timestamp
        };
    }

    UI.updateProgress(100, anyActive ? "Kiểm chứng thành công. Dữ liệu khớp 100%." : "Tài liệu nguyên bản nhưng đã bị vô hiệu hóa.", anyActive ? "VERIFIED" : "REVOKED");
    Swal.fire({
        title: anyActive ? 'KHỚP 100%' : 'TÀI LIỆU ĐÃ BỊ THU HỒI!',
        icon: anyActive ? 'success' : 'error', background: 'var(--panel)', color: 'var(--ink)',
        html: `
            <p class="text-soft text-sm mb-3">Mã băm của tệp khớp ${results.length > 1 ? `${results.length} bản ghi` : 'bản ghi'} trên Blockchain${matches.length > results.length ? ' (một số bản ghi không đọc được trên chuỗi)' : ''}:</p>
            <div class="space-y-2 max-h-[300px] overflow-y-auto custom-scrollbar">${rowsHtml}</div>
            ${firstActive ? `<button data-act="pdf" class="w-full mt-4 bg-ok hover:brightness-110 text-white py-2 rounded-lg text-sm font-bold shadow-sm transition">
                <i class="fa-solid fa-file-pdf mr-2"></i> Tải Báo Cáo Chứng Thực (PDF)
            </button>` : ''}`,
        confirmButtonText: 'Đóng', confirmButtonColor: 'var(--accent)'
    }).then(() => {
        UI.updateProgress(0, "Hệ thống đang rảnh", "STANDBY");
        if (fileInput) { fileInput.value = ''; UI.updateFileName('verifyFile'); }
    });
}

// Điền phí gas (ETH) cho từng ô data-txfee — dedupe theo txHash, chạy sau render
async function fillTxFees(tbody) {
    const spans = tbody.querySelectorAll('[data-txfee]');
    const uniq = new Map();
    spans.forEach(s => {
        const h = s.dataset.txfee;
        if (!uniq.has(h)) uniq.set(h, []);
        uniq.get(h).push(s);
    });
    for (const [txHash, els] of uniq) {
        const fee = await web3.getTxFeeEth(txHash).catch(() => null);
        els.forEach(s => { s.textContent = fee ? `${fee} ETH` : 'xem tx'; });
    }
}
// =====================================================================
// XỬ LÝ LỊCH SỬ THU HỒI VÀ HOÀN TRẢ DUNG LƯỢNG
// =====================================================================
// Đổi chế độ Công khai ↔ Riêng tư cho file CỦA CHÍNH MÌNH (server cũng
// chặn nếu không phải uploader); tài liệu đã thu hồi không đổi được.
window.toggleDocVisibility = async (docId, currentVis) => {
    const next = currentVis === 'public' ? 'private' : 'public';
    const r = await Swal.fire({
        title: 'ĐỔI CHẾ ĐỘ HIỂN THỊ',
        html: `<p class="text-sm text-soft">Chuyển tài liệu sang
            <b>${next === 'public' ? '🌐 Công khai — mọi ví đăng nhập xem được' : '🔒 Riêng tư — chỉ bạn xem được'}</b>?<br>
            <span class="text-faint text-xs">${next === 'private' ? 'Lưu ý: ai đã tải/giải mã khi file còn công khai vẫn giữ bản gốc.' : 'Khóa giải mã sẽ được cấp cho mọi ví đăng nhập.'}</span></p>`,
        icon: 'question', background: 'var(--panel)', color: 'var(--ink)',
        showCancelButton: true, confirmButtonText: 'Đổi chế độ', cancelButtonText: 'Hủy', confirmButtonColor: 'var(--accent)'
    });
    if (!r.isConfirmed) return;
    try { await ApiService.ensureAuth(web3.signer, web3.currentAccount); } catch (e) {
        return Swal.fire({ title: 'Chưa xác thực', text: 'Vui lòng kết nối ví trước.', icon: 'warning', background: 'var(--panel)', color: 'var(--ink)' });
    }
    const res = await ApiService.setDocumentVisibility(docId, next);
    if (!res.ok) {
        return Swal.fire({ title: 'Không đổi được', text: res.message || 'Lỗi máy chủ', icon: 'error', background: 'var(--panel)', color: 'var(--ink)' });
    }
    Swal.fire({ toast: true, position: 'top-end', icon: 'success',
        title: next === 'public' ? 'Đã chuyển sang Công khai' : 'Đã chuyển sang Riêng tư',
        background: 'var(--panel)', color: 'var(--ink)', timer: 2200, showConfirmButton: false });
    loadTransactionHistory();
};

// ---- Multi-sig (contract v2): ký EIP-712 & nộp seal cho doc PENDING ----
// Ký: client ký typed-data → POST /api/documents/:id/signature (server
// ecrecover verify + kiểm tra signer/requiredSigners/duplicate trước khi lưu
// Mongo). Seal: ai cũng gọi được — contract tự đếm chữ ký hợp lệ.
window.signPendingSeal = async (docId) => {
    if (isProcessing) return;
    if (!web3.currentAccount || !web3.signer) {
        return Swal.fire({ title: 'Chưa kết nối ví', text: 'Kết nối MetaMask bằng ví nằm trong danh sách người ký của tài liệu.', icon: 'warning', background: 'var(--panel)', color: 'var(--ink)' });
    }
    isProcessing = true;
    try {
        await ApiService.ensureAuth(web3.signer, web3.currentAccount);
        const doc = await web3.getDocumentV2(docId);
        if (doc.sealed) {
            return Swal.fire({ title: 'Đã đóng dấu', text: 'Tài liệu này đã sealed trên chuỗi.', icon: 'info', background: 'var(--panel)', color: 'var(--ink)' });
        }
        if (!(Number(doc.requiredThreshold) > 0)) {
            return Swal.fire({ title: 'Không phải đa chữ ký', text: 'Tài liệu này không yêu cầu chữ ký đa bên.', icon: 'info', background: 'var(--panel)', color: 'var(--ink)' });
        }
        const my = String(web3.currentAccount).toLowerCase();
        if (!doc.requiredSigners.some(a => String(a).toLowerCase() === my)) {
            return Swal.fire({ title: 'Không thuộc danh sách ký', text: 'Ví đang kết nối không nằm trong requiredSigners của tài liệu.', icon: 'warning', background: 'var(--panel)', color: 'var(--ink)' });
        }
        const ok = await Swal.fire({
            title: 'Ký xác nhận tài liệu?',
            html: `Tài liệu <b class="font-mono">${esc(docId)}</b> đang chờ <b>${esc(doc.requiredThreshold)}</b> chữ ký.<br>Chữ ký EIP-712 cam kết toàn bộ metadata on-chain — không thể sửa sau khi ký.`,
            icon: 'question', showCancelButton: true, confirmButtonText: 'Ký bằng MetaMask', cancelButtonText: 'Hủy',
            background: 'var(--panel)', color: 'var(--ink)'
        });
        if (!ok.isConfirmed) return;
        const signature = await web3.signDocumentSeal(docId, doc.fileHash, doc.ipfsURI, doc.expiresAt, doc.previousDocId);
        const res = await ApiService.submitDocumentSignature(docId, signature, web3.currentAccount);
        await Swal.fire({
            title: res.reachedThreshold ? 'Đủ chữ ký!' : 'Đã lưu chữ ký',
            html: `${esc(res.message)}<br><span class="text-xs text-muted">Tiến độ: <b>${esc(res.count)}/${esc(res.threshold)}</b></span>`,
            icon: res.reachedThreshold ? 'success' : 'info', background: 'var(--panel)', color: 'var(--ink)'
        });
        loadTransactionHistory();
    } catch (e) {
        Swal.fire({ title: 'Ký thất bại', text: getShortError(e), icon: 'error', background: 'var(--panel)', color: 'var(--ink)' });
    } finally {
        isProcessing = false;
    }
};

window.sealPendingSeal = async (docId) => {
    if (isProcessing) return;
    if (!web3.currentAccount) {
        return Swal.fire({ title: 'Chưa kết nối ví', text: 'Cần kết nối MetaMask để gửi giao dịch sealDocument lên chuỗi.', icon: 'warning', background: 'var(--panel)', color: 'var(--ink)' });
    }
    isProcessing = true;
    try {
        await ApiService.ensureAuth(web3.signer, web3.currentAccount);
        const data = await ApiService.getDocumentSignatures(docId);
        if (!data || !data.signatures || data.signatures.length === 0) {
            return Swal.fire({ title: 'Chưa có chữ ký', text: 'Chưa có chữ ký EIP-712 nào được nộp cho tài liệu này.', icon: 'info', background: 'var(--panel)', color: 'var(--ink)' });
        }
        if (data.sealed) {
            return Swal.fire({ title: 'Đã đóng dấu', text: 'Tài liệu này đã sealed trên chuỗi.', icon: 'info', background: 'var(--panel)', color: 'var(--ink)' });
        }
        const threshold = Number(data.threshold) || data.signatures.length;
        const ok = await Swal.fire({
            title: 'Nộp seal lên chuỗi?',
            html: `Gộp <b>${esc(data.signatures.length)}</b> chữ ký đã lưu và gọi <b>sealDocument</b> — cần tối thiểu <b>${esc(threshold)}</b> chữ ký hợp lệ.<br><span class="text-xs text-muted">Ai cũng có thể thực hiện; contract tự xác minh từng chữ ký.</span>`,
            icon: 'question', showCancelButton: true, confirmButtonText: 'Gửi giao dịch', cancelButtonText: 'Hủy',
            background: 'var(--panel)', color: 'var(--ink)'
        });
        if (!ok.isConfirmed) return;
        const sigs = data.signatures.map(s => s.signature);
        const txHash = await web3.sealDocumentOnChain(docId, sigs);
        await Swal.fire({
            title: 'Đã đóng dấu!',
            html: `Tài liệu <b class="font-mono">${esc(docId)}</b> đã sealed.<br><a href="https://sepolia.etherscan.io/tx/${esc(txHash)}" target="_blank" rel="noopener noreferrer" class="text-accent font-mono text-xs break-all">${esc(txHash)}</a>`,
            icon: 'success', background: 'var(--panel)', color: 'var(--ink)'
        });
        loadTransactionHistory();
    } catch (e) {
        Swal.fire({ title: 'Seal thất bại', text: getShortError(e), icon: 'error', background: 'var(--panel)', color: 'var(--ink)' });
    } finally {
        isProcessing = false;
    }
};

window.revokeDoc = async (docId) => {
    if (isProcessing) return;

    // Token JWT phải còn hạn trước khi quét MongoDB — nếu không getBatchesFromDatabase
    // trả [] làm isBatchFile sai → chỉ ghi on-chain mà không đồng bộ MongoDB (split-brain)
    try {
        await ApiService.ensureAuth(web3.signer, web3.currentAccount);
    } catch (e) {
        return Swal.fire({ title: 'Chưa xác thực', text: 'Vui lòng kết nối ví và ký xác thực trước khi thu hồi.', icon: 'warning', background: 'var(--panel)', color: 'var(--ink)' });
    }

    // 1. TÌM CHÍNH XÁC CHỦ SỞ HỮU FILE VÀ KÍCH THƯỚC FILE
    let isBatchFile = false;
    let fileInfo = null;
    let sizeToDeduct = 0.05; // Mặc định thu hồi sẽ trả lại 50KB nếu không tìm thấy size cũ
    let uploaderWallet = ""; // Biến lưu địa chỉ ví của người đã up file này

    const localBatches = await ApiService.getBatchesFromDatabase();
    for (let batch of localBatches) {
        let found = batch.files.find(f => f.docId === docId);
        if (found) {
            isBatchFile = true;
            fileInfo = found;
            uploaderWallet = batch.uploader; // Lấy đúng ví của người tạo lô
            break;
        }
    }

    // Tài liệu đã có bản kế nhiệm → gợi ý sẵn lý do "Thay thế bởi <docId>".
    // Chuỗi này ghi vào revocationReason ON-CHAIN — trở thành con trỏ bất biến
    // v1→v2, ai verify bản cũ đều thấy bản thay thế.
    let suggestedReason = '';
    for (const b of localBatches) {
        const succ = (b.files || []).find(f => f.replacesDocId === docId);
        if (succ) { suggestedReason = `Thay thế bởi ${succ.docId}`; break; }
    }

    // Nếu không phải lô nội bộ, quét mạng Blockchain để tìm chủ nhân
    if (!isBatchFile) {
        try {
            const docData = await web3.getDocumentFromChain(docId);
            uploaderWallet = docData[3]; // Vị trí số [3] trên Smart Contract là địa chỉ ví
        } catch (e) {
            // Fallback về owner contract nếu Blockchain không phản hồi kịp
            uploaderWallet = window.__chainOwner || "0x8B10E25a2C6f91a5969b8db38B88B9e1002E1911";
        }
    }

    // Tài liệu của ví ADMIN chỉ ADMIN được thu hồi — chặn ngay tại UI,
    // khỏi mở MetaMask rồi mới bị contract từ chối (tốn gas lãng)
    if (uploaderWallet && web3.contract && web3.currentAccount) {
        try {
            const [upRole, myRole] = await Promise.all([
                web3.contract.userRoles(uploaderWallet),
                web3.contract.userRoles(web3.currentAccount)
            ]);
            if (Number(upRole) === 3 && Number(myRole) < 3) {
                return Swal.fire({ title: 'Không đủ quyền', text: 'Tài liệu do ví Admin tải lên — chỉ Admin mới được thu hồi.', icon: 'error', background: 'var(--panel)', color: 'var(--ink)' });
            }
        } catch (e) { /* đọc role lỗi thì để contract tự chặn ở bước giao dịch */ }
    }

    const { value: reason } = await Swal.fire({
        title: 'THU HỒI TÀI LIỆU', text: `Bạn đang vô hiệu hóa tài liệu ID: ${esc(docId)}`,
        input: 'text', inputAttributes: { autocomplete: 'off' },
        inputValue: suggestedReason || '',
        inputPlaceholder: 'Nhập lý do thu hồi (Bắt buộc)...',
        icon: 'warning', showCancelButton: true, confirmButtonText: 'Xác nhận Thu hồi', cancelButtonText: 'Hủy', 
        background: 'var(--panel)', color: 'var(--ink)', confirmButtonColor: 'var(--err)',
        inputValidator: (value) => { if (!value) return 'Vui lòng nhập lý do thu hồi!'; }
    });

    if (reason) {
        isProcessing = true;
        try {
            // 2. GHI THU HỒI LÊN BLOCKCHAIN TRƯỚC — chain là nguồn sự thật cho verify.
            // Ghi chain trước để nếu MetaMask từ chối thì MongoDB cũng không bị ghi nhầm.
            UI.updateProgress(40, "Đang gửi lệnh thu hồi lên Blockchain (duyệt trên MetaMask)...", "REVOKING");
            let onChainDone = false;
            try {
                await web3.revokeDocument(docId, reason);
                onChainDone = true;
            } catch (chainErr) {
                const m = String((chainErr && (chainErr.info?.error?.message || chainErr.message)) || chainErr);
                // Doc không có trên chain (bản ghi off-chain cũ / merkle-batch contract cũ)
                // hoặc đã thu hồi sẵn → vẫn cho phép đồng bộ cờ thu hồi trong MongoDB.
                // Lỗi quyền ("khong co quyen") KHÔNG được nuốt → throw để chặn cả 2 nguồn.
                if (!/khong ton tai|da bi thu hoi/i.test(m)) throw chainErr;
            }

            // 3. ĐỒNG BỘ MONGODB — lịch sử, audit, hoàn trả dung lượng (server tự trừ)
            if (isBatchFile) {
                UI.updateProgress(75, onChainDone
                    ? "Đã ghi on-chain! Đang đồng bộ trạng thái vào Database..."
                    : "Không có bản ghi trên contract hiện tại — đồng bộ cờ thu hồi vào Database...", "SYNCING");
                // JWT đi kèm header — server tự lấy revokedBy từ token, không tin body
                await ApiService.revokeBatchFile(docId, reason);
                await new Promise(resolve => setTimeout(resolve, 800));
            }

            // Dung lượng uploader đã được server tự trừ trong /batches/revoke (off-chain)
            // — không trừ ở client: user thường/Quản lý không có quyền ghi storage ví người khác.

            // Vẽ lại toàn bộ số liệu trên màn hình
            if (typeof window.loadWalletRoles === 'function') window.loadWalletRoles();
            await syncDashboardData();

            UI.updateProgress(100, "Thu hồi hoàn tất!", "SUCCESS");
            
            Swal.fire({
                title: 'Thành công', icon: 'success', background: 'var(--panel)', color: 'var(--ink)',
                text: onChainDone
                    ? 'Tài liệu đã bị thu hồi trên Blockchain và hoàn trả dung lượng.'
                    : 'Tài liệu này không có bản ghi trên contract hiện tại — đã ghi cờ thu hồi trong Database (off-chain).'
            });
            
            loadTransactionHistory();
            loadRevokedHistory();
        } catch (err) {
            UI.updateProgress(0, "Lỗi tiến trình.", "ERROR");
            Swal.fire({ title: 'Thất bại', text: getShortError(err, 'Giao dịch bị từ chối hoặc bạn đã hủy ký xác thực.'), icon: 'error', background: 'var(--panel)', color: 'var(--ink)' });
        } finally { 
            isProcessing = false; 
        }
    }
};

// Truy vết dòng đời phiên bản — chuỗi v1→v2→v3 kèm trạng thái từng bản
window.showLineage = async (docId) => {
    const r = await ApiService.getDocumentLineage(docId);
    if (!r || !r.success) {
        return Swal.fire({ title: 'Không có dữ liệu', text: 'Không tìm thấy dòng đời của tài liệu này.', icon: 'info', background: 'var(--panel)', color: 'var(--ink)' });
    }
    const arrow = '<div class="text-center text-violet text-xs py-0.5"><i class="fa-solid fa-arrow-down"></i></div>';
    const rows = r.chain.map(n => `
        <div class="flex items-center gap-3 ${n.docId === docId ? '' : 'opacity-70'}">
            <span class="bg-violet-soft text-violet px-2 py-0.5 rounded text-[10px] font-bold w-10 text-center flex-shrink-0">v${n.version}</span>
            <div class="min-w-0 flex-1 text-left">
                <div class="text-xs text-soft truncate" title="${esc(n.fileName || '')}">${esc(n.fileName || '(không tên)')}</div>
                <div class="text-[10px] font-mono text-faint truncate">${esc(n.docId)}${n.docId === docId ? ' — đang xem' : ''}</div>
            </div>
            ${n.isRevoked ? '<span class="text-err text-[10px] font-bold flex-shrink-0">THU HỒI</span>' : '<span class="text-ok text-[10px] font-bold flex-shrink-0">HỢP LỆ</span>'}
        </div>`).join(arrow);
    Swal.fire({
        title: 'DÒNG ĐỜI TÀI LIỆU',
        html: `
            <div class="space-y-1 mt-2">
${rows}
            </div>
            ${r.supersededBy ? `<div class="mt-3 p-2.5 bg-warn-soft border border-warn rounded text-warn text-xs text-left">Tài liệu đang xem là <b>bản cũ</b> — bản mới nhất: <span class="font-mono">${esc(r.latest.docId)}</span></div>` : ''}`,
        background: 'var(--panel)', color: 'var(--ink)', confirmButtonColor: 'var(--faint)', confirmButtonText: 'Đóng', width: 'min(34rem, 92vw)'
    });
};

// Audit đối soát on-chain ↔ MongoDB — chỉ ADMIN (server cũng chặn).
// Hiện stats + danh sách lệch + nút khôi phục bản ghi thiếu từ chain.
window.runAuditReconcile = async function() {
    const btn = document.getElementById('btn-audit');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin me-1"></i> Đang đối soát…'; }
    try {
        const d = await ApiService.getAuditReconcile();
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-scale-balanced me-1"></i> Đối soát'; }
        if (!d.success) throw new Error(d.message || 'Lỗi đối soát');
        const s = d.stats || {};
        const row = (label, val, cls) => `<div class="flex justify-between text-xs py-1 border-b border-line"><span class="text-muted">${label}</span><b class="${cls || 'text-ink'}">${val}</b></div>`;
        const list = (title, arr, render) => arr && arr.length
            ? `<p class="text-[10px] font-bold uppercase text-faint mt-3 mb-1">${title} (${arr.length})</p>
               <div class="max-h-36 overflow-y-auto custom-scrollbar bg-sunken rounded p-2 space-y-1">${arr.slice(0, 50).map(render).join('')}</div>` : '';
        const orphanIds = (d.orphansOnChain || []).map(o => o.docId);
        const html = `
            <div class="text-left max-h-[55vh] overflow-y-auto custom-scrollbar pr-1">
                ${row('Bản ghi MongoDB', s.mongoDocs ?? '—')}
                ${row('Đã đối chiếu trên chain', `${s.checked ?? 0}${s.unchecked ? ' (+' + s.unchecked + ' chưa kiểm)' : ''}`)}
                ${row('Lệch dữ liệu', s.mismatches ?? 0, (s.mismatches ? 'text-err' : 'text-ok'))}
                ${row('Mongo có nhưng chain không', s.missingOnChain ?? 0, (s.missingOnChain ? 'text-warn' : 'text-ok'))}
                ${row('Chain có nhưng Mongo thiếu', s.orphansOnChain ?? 0, (s.orphansOnChain ? 'text-warn' : 'text-ok'))}
                ${s.chainScanComplete === false ? '<p class="text-[10px] text-warn mt-2"><i class="fa-solid fa-triangle-exclamation mr-1"></i>Quét event chain chưa hết do RPC giới hạn — danh sách orphan có thể thiếu.</p>' : ''}
                ${list('Lệch field', d.mismatches, m => `<div class="font-mono text-[10px] text-soft break-all">${esc(m.docId)} <span class="text-faint">${esc(m.field)}: mongo=${esc(String(m.mongo))} ≠ chain=${esc(String(m.chain))}</span></div>`)}
                ${list('Thiếu trên chain', d.missingOnChain, id => `<div class="font-mono text-[10px] text-soft break-all">${esc(id)}</div>`)}
                ${list('Orphan trên chain', d.orphansOnChain, o => `<div class="font-mono text-[10px] text-soft break-all">${esc(o.docId)} <span class="text-faint">· ${esc(o.uploader)}</span></div>`)}
            </div>`;
        const r = await Swal.fire({
            title: 'ĐỐI SOÁT ON-CHAIN ↔ MONGODB', html, width: 'min(720px, 92vw)',
            background: 'var(--panel)', color: 'var(--ink)',
            showCancelButton: orphanIds.length > 0, confirmButtonText: 'Đóng',
            cancelButtonText: `<i class="fa-solid fa-database mr-1"></i> Khôi phục ${Math.min(orphanIds.length, 100)} bản ghi thiếu`,
            cancelButtonColor: '#d97706', showConfirmButton: true
        });
        if (r.dismiss === Swal.DismissReason.cancel && orphanIds.length) {
            const rr = await ApiService.reindexAudit(orphanIds);
            Swal.fire({ title: 'Re-index xong', html: `<p class="text-sm">Đã khôi phục <b>${rr.reindexed ?? 0}</b> bản ghi vào batch <span class="font-mono text-xs">${esc(rr.batchId || '')}</span></p><p class="text-[11px] text-faint mt-1">Metadata tối thiểu — bấm "Làm mới" để thấy trong sổ cái.</p>`, icon: 'success', background: 'var(--panel)', color: 'var(--ink)' });
            loadTransactionHistory();
        }
    } catch (e) {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-scale-balanced me-1"></i> Đối soát'; }
        Swal.fire({ title: 'Đối soát lỗi', text: getShortError(e), icon: 'error', background: 'var(--panel)', color: 'var(--ink)' });
    }
};

async function loadTransactionHistory() {
    const tbody = document.getElementById('history-table-body');
    if (!tbody) return;
    const auditBtn = document.getElementById('btn-audit');
    if (auditBtn) auditBtn.classList.toggle('hidden', !window.__isAdminWallet);
    
    tbody.innerHTML = '<tr><td colspan="7" class="px-4 py-10 text-center text-accent"><i class="fa-solid fa-circle-notch fa-spin me-2"></i> Đang quét sổ cái Blockchain...</td></tr>';
    // Tiến độ quét block thật từ getEventsInChunks — lần đầu vào origin
    // (cache localStorage rỗng) phải quét hàng trăm chunk, cần thấy % để
    // không tưởng app bị treo.
    const scanTd = tbody.querySelector('td');
    const scanPct = (to, latest) => {
        if (scanTd && latest > 0) {
            const pct = Math.min(99, Math.round((to / latest) * 100));
            scanTd.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin me-2"></i> Đang quét mạng lưới... ${pct}%`;
        }
    };
    
    try {
        let html = '';
        let stt = 1;
        let partnerHtml = ''; // bảng riêng cho tài liệu đối tác (API key)
        let pStt = 1;
        partnerOrgCounts = {};
        const seenDocIds = new Set(); // chống render trùng giữa nguồn chain và MongoDB

        // Event DocumentRevoked là nguồn sự thật chắc chắn đã mine —
        // getDocument() trên RPC công cộng có thể trả state cũ/lỗi ngay sau tx.wait()
        const revokedIds = new Set();
        try {
            const revokedEvents = await web3.queryRevokedHistory(scanPct);
            for (const ev of revokedEvents) revokedIds.add(ev.args[0]);
        } catch (e) {}

        // Lấy batch Mongo trước — cần visibility/uploader để đánh dấu ổ khóa tài liệu riêng tư
        const localBatches = await ApiService.getBatchesFromDatabase();
        // Map docId -> orgName: tài liệu đối tác upload qua API key được server
        // ký on-chain hộ bằng ví ADMIN — cần badge để không nhầm là doc của ADMIN
        const partnerOrgs = await ApiService.getPartnerDocs();
        const fileMeta = {}; // docId -> { visibility, uploader }
        for (const b of localBatches) {
            for (const f of (b.files || [])) {
                fileMeta[f.docId] = { visibility: f.visibility || 'private', uploader: (b.uploader || '').toLowerCase() };
            }
        }
        // File private chỉ uploader mở được — quyền riêng tư là cá nhân
        // tuyệt đối, kể cả ADMIN cũng thấy nút khóa trên file của ví khác
        const myAddr = (web3.currentAccount || '').toLowerCase();
        const isLockedDoc = (docId, uploaderAddr) => {
            const meta = fileMeta[docId];
            const vis = meta ? meta.visibility : 'private';
            const owner = (meta && meta.uploader) || (uploaderAddr || '').toLowerCase();
            return vis !== 'public' && owner !== myAddr;
        };
        const isOwnDoc = (docId, uploaderAddr) => {
            const meta = fileMeta[docId];
            const owner = (meta && meta.uploader) || (uploaderAddr || '').toLowerCase();
            return owner === myAddr;
        };
        // Nút Thu hồi khớp luật contract revokeDocument:
        // ADMIN thu hồi mọi doc; QUẢN LÝ thu hồi doc của ví không phải ADMIN;
        // NHẬP LIỆU/NGƯỜI XEM không thu hồi (kể cả doc mình up).
        const myRank = await getMyRoleRank(myAddr);
        const upRankCache = {};
        const uploaderRankOf = async (addr) => {
            const a = (addr || '').toLowerCase();
            if (!a) return null;
            if (a === myAddr) return myRank;
            if (!(a in upRankCache)) {
                const r = await web3.getUserRole(a);
                upRankCache[a] = (r === null || r === undefined) ? null : (r === 99 ? 3 : Number(r));
            }
            return upRankCache[a];
        };
        const canRevokeDoc = async (uploaderAddr) => {
            if (myRank === 3) return true;
            if (myRank !== 2) return false;
            return (await uploaderRankOf(uploaderAddr)) !== 3;
        };
        // Bản đồ dòng đời phiên bản từ replacesDocId (MongoDB):
        // verOf = số thứ tự phiên bản, succOf = docId bản kế nhiệm (nếu đã bị thay thế)
        const predOf = {}, succOf = {};
        for (const b of localBatches) for (const f of (b.files || [])) {
            if (f.replacesDocId) { predOf[f.docId] = f.replacesDocId; succOf[f.replacesDocId] = f.docId; }
        }
        const verOf = (id) => {
            let v = 1, cur = id;
            const seen = new Set([id]);
            while (predOf[cur] && !seen.has(predOf[cur])) { cur = predOf[cur]; seen.add(cur); v++; }
            return v;
        };
        const verBadge = (docId) => {
            const v = verOf(docId), next = succOf[docId];
            if (v <= 1 && !next) return '';
            const stale = next ? ' · cũ' : '';
            return `<span class="bg-violet-soft text-violet px-1.5 py-0.5 rounded text-[9px] font-bold ml-1 whitespace-nowrap" title="${esc('Phiên bản ' + v + (next ? ' — đã có bản mới thay thế' : ''))}">v${v}${stale}</span>`;
        };
        const hasLineage = (docId) => verOf(docId) > 1 || !!succOf[docId];

        // 1. Quét file On-chain
        const events = await web3.queryHistory(scanPct);
        if (events && events.length > 0) {
            for (let ev of [...events].reverse()) {
                const docId = ev.args[0];
                const hash = ev.args[1];
                const txHash = ev.transactionHash || '';
                let uploader = '---';
                let createTime = '---';
                let isRevoked = false;
                let ipfsLink = '';
                // Contract v2 multi-sig: doc PENDING (chưa sealed, threshold>0)
                let isPendingSeal = false;
                let myCanSign = false;

                try {
                    const docData = await web3.getDocumentFromChain(docId);
                    uploader = docData[3];
                    createTime = window.formatTimeForce(Number(docData[2]) * 1000); // ÉP CHUẨN GIỜ
                    isRevoked = docData[4];
                    ipfsLink = docData[1].replace('ipfs://', ''); // Lấy chính xác chuỗi CID
                    // [8]=requiredSigners[], [9]=requiredThreshold, [10]=isSealed
                    const sealSigners = Array.isArray(docData[8]) ? docData[8].map(String) : [];
                    const sealThreshold = Number(docData[9] || 0);
                    isPendingSeal = !docData[10] && sealThreshold > 0 && sealSigners.length > 0;
                    myCanSign = isPendingSeal && sealSigners.some(a => String(a).toLowerCase() === myAddr);
                } catch (e) {}
                
                if (isRevoked || revokedIds.has(docId)) continue;
                seenDocIds.add(docId);
                
                let fileName = docId.replace(/_\d+$/, '').replace(/\.enc$/, '');
                const searchPayload = esc(`${docId} ${fileName} ${uploader} ${createTime} ${hash} ${partnerOrgs[docId] || ''}`.toLowerCase());

                // Tài liệu đối tác (API key) → bảng riêng, không lẫn sổ cái ví:
                // chỉ hiện metadata, không nút Xem/Tải — không ai (kể cả ADMIN)
                // mở được nội dung ngoài tổ chức sở hữu key.
                const org = partnerOrgs[docId];
                if (org && !window.__isAdminWallet) continue; // doc đối tác: ví thường/QUẢN LÝ không thấy
                if (org) {
                    partnerOrgCounts[org] = (partnerOrgCounts[org] || 0) + 1;
                    partnerHtml += `
                    <tr class="border-b border-line hover:bg-hover transition" data-search="${searchPayload}" data-uploader="${esc(String(uploader).toLowerCase())}" data-org="${esc(org)}">
                        <td class="px-3 py-2 font-bold text-center text-faint">${pStt++}</td>
                        <td class="px-3 py-2 font-mono text-accent text-xs">
                            <div class="truncate max-w-[150px]" title="${esc(docId)}">${esc(docId)}</div>
                            <div class="mt-1 text-[11px] text-muted font-sans truncate max-w-[150px]" title="${esc(fileName)}">File: ${esc(fileName)}</div>
                            <button data-act="copy" data-v="${esc(docId)}" class="text-muted hover:text-ink transition text-[11px] mt-1"><i class="fa-regular fa-copy mr-1"></i>Copy</button>
                        </td>
                        <td class="px-3 py-2 text-xs text-soft">
                            ${window.partnerBadge(partnerOrgs, docId)}
                            <div class="text-muted text-[11px] font-medium mt-1"><i class="fa-regular fa-clock mr-1"></i>${esc(createTime)}</div>
                        </td>
                        <td class="px-3 py-2 font-mono text-[10px] text-faint">
                            <div class="text-muted mb-1 truncate max-w-[150px]" title="${esc(hash)}">${esc(hash)}</div>
                            <div class="flex items-center gap-3">
                                <a href="https://ipfs.io/ipfs/${esc(ipfsLink)}" target="_blank" rel="noopener noreferrer" title="File mã hóa trên IPFS" class="text-ok hover:text-ok text-[10px] uppercase font-bold transition">
                                    <i class="fa-solid fa-cloud mr-1"></i> IPFS
                                </a>
                                <span class="text-warn text-[10px] uppercase font-bold bg-warn-soft px-2 py-0.5 rounded border border-warn" title="Chỉ tổ chức sở hữu API key tải về tại cổng /partner">
                                    <i class="fa-solid fa-lock mr-1"></i> Chỉ tổ chức mở được
                                </span>
                            </div>
                        </td>
                        <td class="px-3 py-2 text-center">
                            ${txHash ? `<a href="https://sepolia.etherscan.io/tx/${esc(txHash)}" target="_blank" rel="noopener noreferrer" title="Xem giao dịch trên Etherscan" class="text-violet hover:text-violet text-[10px] font-mono font-bold whitespace-nowrap"><span data-txfee="${esc(txHash)}">…</span></a>` : '<span class="text-faint text-[10px]">—</span>'}
                        </td>
                        <td class="px-3 py-2 text-center"><span class="bg-warn-soft text-warn px-2 py-1 rounded text-[10px] font-bold uppercase whitespace-nowrap">ĐỐI TÁC</span></td>
                    </tr>`;
                    continue;
                }

                const canRevoke = await canRevokeDoc(uploader);
                const wl = window.getWalletLabel(uploader);
                html += `
                <tr class="border-b border-line hover:bg-hover transition" data-search="${searchPayload}" data-uploader="${esc(String(uploader).toLowerCase())}">
                    <td class="px-3 py-2 font-bold text-center text-faint">${stt++}</td>
                        <td class="px-3 py-2 font-mono text-accent text-xs">
                            <div class="flex items-center gap-1.5">
                                <i class="fa-solid ${fileMeta[docId] && fileMeta[docId].visibility === 'public' ? 'fa-globe text-ok' : 'fa-lock text-faint'} text-[10px] shrink-0" title="${esc(fileMeta[docId] && fileMeta[docId].visibility === 'public' ? 'Công khai' : 'Riêng tư')}"></i>
                                <span class="truncate max-w-[110px] inline-block" title="${esc(docId)}">${esc(docId)}</span>${verBadge(docId)}
                            </div>
                        </td>
                    <td class="px-3 py-2 text-xs text-soft">
                        <div class="flex items-center gap-1.5 min-w-0">
                            <span class="truncate max-w-[110px]" title="${esc(wl.name !== wl.short ? wl.name + ' (' + wl.full + ')' : wl.full)}">${esc(wl.name)}</span>
                            ${wl.name !== wl.short ? `<span class="text-[9px] text-faint font-mono shrink-0">${esc(wl.short)}</span>` : ''}
                        </div>
                    </td>
                    <td class="px-3 py-2 font-mono text-[10px] text-faint">
                        <div class="text-muted truncate max-w-[150px]" title="${esc(hash)}">${esc(hash)}</div>
                    </td>
                    <td class="px-3 py-2 text-center">
                        ${txHash ? `<a href="https://sepolia.etherscan.io/tx/${esc(txHash)}" target="_blank" rel="noopener noreferrer" title="Xem giao dịch trên Etherscan" class="text-violet hover:text-violet text-[10px] font-mono font-bold whitespace-nowrap"><span data-txfee="${esc(txHash)}">…</span></a>` : '<span class="text-faint text-[10px]">—</span>'}
                    </td>
                    <td class="px-3 py-2 text-center"><span class="bg-accent-soft text-accent px-2 py-1 rounded text-[10px] font-bold uppercase whitespace-nowrap">ON-CHAIN</span></td>
                    <td class="px-2 py-2 text-center w-10">
                        <button data-act="expand" title="Xem chi tiết tài liệu" class="text-faint hover:text-accent transition"><i class="fa-solid fa-circle-info text-[12px]"></i></button>
                    </td>
                </tr>
                <tr class="doc-detail hidden border-b border-line" data-search="${searchPayload}" data-uploader="${esc(String(uploader).toLowerCase())}">
                    <td colspan="7" class="px-3 py-2 bg-sunken/40">
                        <div class="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                            <span class="text-[11px] text-muted font-sans" title="${esc(fileName)}"><i class="fa-regular fa-file mr-1"></i>${esc(fileName)}</span>
                            <span class="text-[10px] text-faint whitespace-nowrap"><i class="fa-regular fa-clock mr-1"></i>${esc(createTime)}</span>
                            <span class="text-[9px] ${fileMeta[docId] && fileMeta[docId].visibility === 'public' ? 'text-ok' : 'text-faint'}"><i class="fa-solid ${fileMeta[docId] && fileMeta[docId].visibility === 'public' ? 'fa-globe' : 'fa-lock'} mr-1"></i>${fileMeta[docId] && fileMeta[docId].visibility === 'public' ? 'Công khai' : 'Riêng tư'}</span>
                            <span class="flex gap-3 ml-auto flex-wrap">
                                <a href="https://ipfs.io/ipfs/${esc(ipfsLink)}" target="_blank" rel="noopener noreferrer" title="Xem file mã hóa gốc trên IPFS" class="text-ok hover:text-ok text-[11px] font-bold transition"><i class="fa-solid fa-cloud mr-1"></i>IPFS</a>
                                ${isLockedDoc(docId, uploader) ? `
                                    <button data-act="locked" title="Tài liệu riêng tư — chỉ người tải lên xem được" class="text-faint text-[11px] uppercase font-bold bg-sunken px-2 py-0.5 rounded border border-line-strong cursor-not-allowed">
                                        <i class="fa-solid fa-lock mr-1"></i> Riêng tư
                                    </button>` : `
                                    <button data-act="preview" data-v="${esc(ipfsLink)}" data-name="${esc(fileName)}" data-id="${esc(docId)}" title="Xem trực tiếp trong trình duyệt" class="text-ok hover:text-ok text-[11px] font-bold transition bg-ok-soft px-2 py-0.5 rounded border border-ok">
                                        <i class="fa-solid fa-eye mr-1"></i> Xem
                                    </button>
                                    <button data-act="decrypt" data-v="${esc(ipfsLink)}" data-name="${esc(fileName)}" data-id="${esc(docId)}" title="Giải mã và tải tệp gốc về máy" class="text-accent hover:text-accent text-[11px] font-bold transition bg-accent-soft px-2 py-0.5 rounded border border-accent-line">
                                        <i class="fa-solid fa-download mr-1"></i> Tải
                                    </button>`}
                                <button data-act="copy" data-v="${esc(docId)}" class="text-muted hover:text-ink transition text-[11px]"><i class="fa-regular fa-copy mr-1"></i>Copy</button>
                                ${hasLineage(docId) ? `<button data-act="lineage" data-v="${esc(docId)}" title="Xem chuỗi phiên bản v1→v2→…" class="text-violet hover:text-violet transition text-[11px]"><i class="fa-solid fa-code-branch mr-1"></i>Dòng đời</button>` : ''}
                                ${isPendingSeal ? `
                                <span class="bg-warn-soft text-warn px-2 py-0.5 rounded text-[9px] font-bold uppercase whitespace-nowrap" title="Đa chữ ký — chờ đủ chữ ký EIP-712 mới đóng dấu"><i class="fa-solid fa-hourglass-half mr-1"></i>Chờ ký</span>
                                ${myCanSign ? `<button data-act="sign" data-v="${esc(docId)}" title="Ký xác nhận EIP-712 bằng ví đang kết nối" class="text-ok hover:text-ok transition text-[11px] font-bold bg-ok-soft px-2 py-0.5 rounded border border-ok"><i class="fa-solid fa-pen-fancy mr-1"></i>Ký xác nhận</button>` : ''}
                                <button data-act="seal" data-v="${esc(docId)}" title="Gộp các chữ ký đã nộp và đóng dấu lên chuỗi (ai cũng gọi được khi đủ ngưỡng)" class="text-violet hover:text-violet transition text-[11px] font-bold bg-violet-soft px-2 py-0.5 rounded border border-violet"><i class="fa-solid fa-stamp mr-1"></i>Nộp seal</button>` : ''}
                                ${isOwnDoc(docId, uploader) ? `<button data-act="vis" data-v="${esc(docId)}" data-vis="${esc((fileMeta[docId] && fileMeta[docId].visibility) || 'private')}" title="Đổi chế độ Công khai / Riêng tư" class="text-info hover:text-info transition text-[11px]"><i class="fa-solid fa-arrow-right-arrow-left mr-1"></i>Chế độ</button>` : ''}
                                ${canRevoke ? `<button data-act="revoke" data-v="${esc(docId)}" class="text-err hover:text-err transition text-[11px]"><i class="fa-solid fa-ban mr-1"></i>Thu hồi</button>` : ''}
                            </span>
                        </div>
                    </td>
                </tr>`;
            }
        }

        // 2. Quét file Batch (localBatches đã fetch ở trên)
        if (localBatches.length > 0) {
            for (let batch of [...localBatches].reverse()) {
                const createTime = window.formatTimeForce(batch.timestamp);
                const uploader = batch.uploader;
                const batchCanRevoke = await canRevokeDoc(uploader);
                const wl = window.getWalletLabel(uploader);

                batch.files.forEach(fileDoc => {
                    if (fileDoc.isRevoked || revokedIds.has(fileDoc.docId)) return;
                    if (seenDocIds.has(fileDoc.docId)) return; // đã render ở phần on-chain
                    seenDocIds.add(fileDoc.docId);
                    const searchPayload = esc(`${fileDoc.docId} ${fileDoc.fileName} ${uploader} ${createTime} ${fileDoc.fileHash}`.toLowerCase());

                    html += `
                    <tr class="border-b border-line hover:bg-hover transition" data-search="${searchPayload}" data-uploader="${esc(String(uploader).toLowerCase())}">
                        <td class="px-3 py-2 font-bold text-center text-faint">${stt++}</td>
                        <td class="px-3 py-2 font-mono text-accent text-xs">
                            <div class="flex items-center gap-1.5">
                                <i class="fa-solid ${fileDoc.visibility === 'public' ? 'fa-globe text-ok' : 'fa-lock text-faint'} text-[10px] shrink-0" title="${esc(fileDoc.visibility === 'public' ? 'Công khai' : 'Riêng tư')}"></i>
                                <span class="truncate max-w-[110px] inline-block" title="${esc(fileDoc.docId)}">${esc(fileDoc.docId)}</span>${verBadge(fileDoc.docId)}
                            </div>
                        </td>
                        <td class="px-3 py-2 text-xs text-soft">
                            <div class="flex items-center gap-1.5 min-w-0">
                                <span class="truncate max-w-[110px]" title="${esc(wl.name !== wl.short ? wl.name + ' (' + wl.full + ')' : wl.full)}">${esc(wl.name)}</span>
                                ${wl.name !== wl.short ? `<span class="text-[9px] text-faint font-mono shrink-0">${esc(wl.short)}</span>` : ''}
                            </div>
                        </td>
                        <td class="px-3 py-2 font-mono text-[10px] text-faint">
                            <div class="text-muted truncate max-w-[150px]" title="${esc(fileDoc.fileHash)}">${esc(fileDoc.fileHash)}</div>
                        </td>
                        <td class="px-3 py-2 text-center">
                            ${batch.txHash ? `<a href="https://sepolia.etherscan.io/tx/${esc(batch.txHash)}" target="_blank" rel="noopener noreferrer" title="Xem giao dịch trên Etherscan" class="text-violet hover:text-violet text-[10px] font-mono font-bold whitespace-nowrap"><span data-txfee="${esc(batch.txHash)}">…</span></a>` : '<span class="text-faint text-[10px]">—</span>'}
                        </td>
                        <td class="px-3 py-2 text-center">
                            <span class="bg-accent-soft text-accent px-2 py-1 rounded text-[10px] font-bold uppercase whitespace-nowrap">ON-CHAIN</span>
                        </td>
                        <td class="px-2 py-2 text-center w-10">
                            <button data-act="expand" title="Xem chi tiết tài liệu" class="text-faint hover:text-accent transition"><i class="fa-solid fa-circle-info text-[12px]"></i></button>
                        </td>
                    </tr>
                    <tr class="doc-detail hidden border-b border-line" data-search="${searchPayload}" data-uploader="${esc(String(uploader).toLowerCase())}">
                        <td colspan="7" class="px-3 py-2 bg-sunken/40">
                            <div class="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                                <span class="text-[11px] text-muted font-sans" title="${esc(fileDoc.fileName)}"><i class="fa-regular fa-file mr-1"></i>${esc(fileDoc.fileName)}</span>
                                <span class="text-[10px] text-faint whitespace-nowrap"><i class="fa-regular fa-clock mr-1"></i>${esc(createTime)}</span>
                                <span class="text-[9px] ${fileDoc.visibility === 'public' ? 'text-ok' : 'text-faint'}"><i class="fa-solid ${fileDoc.visibility === 'public' ? 'fa-globe' : 'fa-lock'} mr-1"></i>${fileDoc.visibility === 'public' ? 'Công khai' : 'Riêng tư'}</span>
                                <span class="flex gap-3 ml-auto flex-wrap">
                                    <a href="https://ipfs.io/ipfs/${esc(fileDoc.ipfsCID)}" target="_blank" rel="noopener noreferrer" title="Xem trên IPFS" class="text-ok hover:text-ok text-[11px] font-bold transition"><i class="fa-solid fa-cloud mr-1"></i>IPFS</a>
                                    ${isLockedDoc(fileDoc.docId, uploader) ? `
                                        <button data-act="locked" title="Tài liệu riêng tư — chỉ người tải lên xem được" class="text-faint text-[11px] uppercase font-bold bg-sunken px-2 py-0.5 rounded border border-line-strong cursor-not-allowed">
                                            <i class="fa-solid fa-lock mr-1"></i> Riêng tư
                                        </button>` : `
                                        <button data-act="preview" data-v="${esc(fileDoc.ipfsCID)}" data-name="${esc(fileDoc.fileName)}" data-id="${esc(fileDoc.docId)}" title="Xem trực tiếp trong trình duyệt" class="text-ok hover:text-ok text-[11px] font-bold transition bg-ok-soft px-2 py-0.5 rounded border border-ok">
                                            <i class="fa-solid fa-eye mr-1"></i> Xem
                                        </button>
                                        <button data-act="decrypt" data-v="${esc(fileDoc.ipfsCID)}" data-name="${esc(fileDoc.fileName)}" data-id="${esc(fileDoc.docId)}" class="text-accent hover:text-accent text-[11px] font-bold transition bg-accent-soft px-2 py-0.5 rounded border border-accent-line">
                                            <i class="fa-solid fa-download mr-1"></i> Tải
                                        </button>`}
                                    <button data-act="copy" data-v="${esc(fileDoc.docId)}" class="text-muted hover:text-ink transition text-[11px]"><i class="fa-regular fa-copy mr-1"></i>Copy</button>
                                    ${hasLineage(fileDoc.docId) ? `<button data-act="lineage" data-v="${esc(fileDoc.docId)}" title="Xem chuỗi phiên bản v1→v2→…" class="text-violet hover:text-violet transition text-[11px]"><i class="fa-solid fa-code-branch mr-1"></i>Dòng đời</button>` : ''}
                                    ${isOwnDoc(fileDoc.docId, uploader) ? `<button data-act="vis" data-v="${esc(fileDoc.docId)}" data-vis="${esc(fileDoc.visibility || 'private')}" title="Đổi chế độ Công khai / Riêng tư" class="text-info hover:text-info transition text-[11px]"><i class="fa-solid fa-arrow-right-arrow-left mr-1"></i>Chế độ</button>` : ''}
                                    ${batchCanRevoke ? `<button data-act="revoke" data-v="${esc(fileDoc.docId)}" class="text-err hover:text-err transition text-[11px]"><i class="fa-solid fa-ban mr-1"></i>Thu hồi</button>` : ''}
                                </span>
                            </div>
                        </td>
                    </tr>`;
                });
            }
        }
        tbody.innerHTML = html === '' ? '<tr><td colspan="7" class="px-4 py-10 text-center text-faint">Không có tài liệu hợp lệ nào.</td></tr>' : html;
        // Bảng riêng tài liệu đối tác + chip chọn API key/tổ chức
        const pBody = document.getElementById('partner-docs-body');
        if (pBody) pBody.innerHTML = partnerHtml ||
            '<tr><td colspan="6" class="px-4 py-10 text-center text-faint">Chưa có tài liệu đối tác nào.</td></tr>';
        renderPartnerOrgChips();
        filterHistoryTable();
        fillTxFees(tbody); // điền phí gas sau khi render — không chặn bảng
        if (pBody) fillTxFees(pBody);
    } catch (err) {
        tbody.innerHTML = '<tr><td colspan="7" class="px-4 py-10 text-center text-err">Lỗi kết nối RPC. Vui lòng kết nối ví trước.</td></tr>';
    }
}

async function loadRevokedHistory() {
    const tbody = document.getElementById('revoked-table-body');
    if (!tbody) return;
    
    tbody.innerHTML = '<tr><td colspan="6" class="px-4 py-10 text-center text-err"><i class="fa-solid fa-circle-notch fa-spin me-2"></i> Đang truy xuất Kho lưu trữ thu hồi...</td></tr>';
    const scanTd = tbody.querySelector('td');
    const scanPct = (to, latest) => {
        if (scanTd && latest > 0) {
            const pct = Math.min(99, Math.round((to / latest) * 100));
            scanTd.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin me-2"></i> Đang quét mạng lưới... ${pct}%`;
        }
    };
    
    try {
        let html = ''; 
        let stt = 1;
        const seenRevoked = new Set(); // on-chain + DB cùng đánh dấu 1 tài liệu — chỉ render 1 dòng
        const partnerOrgs = await ApiService.getPartnerDocs(); // badge ĐỐI TÁC
        const localBatches = await ApiService.getBatchesFromDatabase();

        // 1. Quét On-chain
        const events = await web3.queryRevokedHistory(scanPct);
        if (events && events.length > 0) {
            for (let ev of [...events].reverse()) {
                const docId = ev.args[0]; const revokedBy = ev.args[1]; const reason = ev.args[2];
                if (seenRevoked.has(docId)) continue;
                seenRevoked.add(docId);
                if (partnerOrgs[docId]) continue; // doc đối tác không lẫn vào kho thu hồi của ví
                let uploader = '---'; let createTime = '---'; let revokeTime = '';
                
                try { 
                    const docData = await web3.getDocumentFromChain(docId); 
                    uploader = docData[3]; 
                    createTime = window.formatTimeForce(Number(docData[2]) * 1000); // ÉP CHUẨN GIỜ
                } catch (e) {}
                // Thời điểm thu hồi = timestamp block chứa event DocumentRevoked
                try {
                    const blk = await web3.provider.getBlock(ev.blockNumber);
                    if (blk && blk.timestamp) revokeTime = window.formatTimeForce(blk.timestamp * 1000);
                } catch (e) {}
                
                let fileName = docId.replace(/_\d+$/, '').replace(/\.enc$/, '');
                const searchPayload = esc(`${docId} ${fileName} ${uploader} ${revokedBy} ${createTime} ${reason}`.toLowerCase());

                html += `
                <tr class="border-b border-line bg-err-soft hover:bg-err-soft transition" data-search="${searchPayload}" data-uploader="${esc(String(uploader).toLowerCase())}">
                    <td class="px-3 py-2 font-bold text-center text-err">${stt++}</td>
                    <td class="px-3 py-2 font-mono text-err text-xs">
                    <div class="truncate max-w-[150px]" title="${esc(docId)}">${esc(docId)}</div>
                    </td>
                    <td class="px-3 py-2 text-xs text-soft">
                        <div>${window.getWalletName(uploader)}</div>
                        ${window.partnerBadge(partnerOrgs, docId)}
                    </td>
                    <td class="px-3 py-2 text-xs text-soft">
                        <div class="text-err font-medium mb-1">${esc(reason)}</div>
                        <div class="flex items-center font-mono text-faint text-[10px]">
                            <span class="mr-1">Bởi:</span> ${window.getWalletName(revokedBy)}
                        </div>
                    </td>
                    <td class="px-3 py-2 text-center"><span class="bg-err-soft text-err px-2 py-1 rounded text-[10px] font-bold">REVOKED (ON-CHAIN)</span></td>
                    <td class="px-2 py-2 text-center w-10">
                        <button data-act="expand" title="Xem chi tiết tài liệu" class="text-faint hover:text-accent transition"><i class="fa-solid fa-circle-info text-[12px]"></i></button>
                    </td>
                </tr>
                <tr class="doc-detail hidden border-b border-line" data-search="${searchPayload}" data-uploader="${esc(String(uploader).toLowerCase())}">
                    <td colspan="6" class="px-3 py-2 bg-sunken/40">
                        <div class="flex items-center gap-x-4 flex-nowrap overflow-hidden">
                            <span class="text-[11px] text-muted font-sans truncate max-w-[200px]" title="${esc(fileName)}"><i class="fa-regular fa-file mr-1"></i>${esc(fileName)}</span>
                            ${revokeTime ? `<span class="text-[10px] text-faint whitespace-nowrap shrink-0"><i class="fa-regular fa-clock mr-1"></i>Ngày thu hồi: ${esc(revokeTime)}</span>` : ''}
                            <span class="flex gap-3 ml-auto shrink-0">
                                <button data-act="copy" data-v="${esc(docId)}" class="text-muted hover:text-ink transition text-[11px]"><i class="fa-regular fa-copy mr-1"></i>Copy</button>
                            </span>
                        </div>
                    </td>
                </tr>`;
            }
        }

        // 2. Quét Off-chain Batch
        if (localBatches.length > 0) {
            for (let batch of [...localBatches].reverse()) {
                const createTime = window.formatTimeForce(batch.timestamp);
                batch.files.forEach(fileDoc => {
                    if (fileDoc.isRevoked && !seenRevoked.has(fileDoc.docId)) {
                        seenRevoked.add(fileDoc.docId);
                        const reason = fileDoc.revocationReason || "Vô hiệu hóa nội bộ";
                        const revoker = fileDoc.revokedBy || batch.uploader;
                        const revokeTimeStr = fileDoc.revokedAt ? window.formatTimeForce(fileDoc.revokedAt) : createTime;
                        
                        const searchPayload = esc(`${fileDoc.docId} ${fileDoc.fileName} ${batch.uploader} ${createTime} ${reason}`.toLowerCase());

                        html += `
                        <tr class="border-b border-line bg-err-soft hover:bg-err-soft transition" data-search="${searchPayload}" data-uploader="${esc(String(batch.uploader).toLowerCase())}">
                            <td class="px-3 py-2 font-bold text-center text-err">${stt++}</td>
                            <td class="px-3 py-2 font-mono text-err text-xs">
                            <div class="truncate max-w-[150px]" title="${esc(fileDoc.docId)}">${esc(fileDoc.docId)}</div>
                            </td>
                            <td class="px-3 py-2 text-xs text-soft">
                                <div>${window.getWalletName(batch.uploader)}</div>
                            </td>
                            <td class="px-3 py-2 text-xs text-soft">
                                <div class="text-err font-medium mb-1">${esc(reason)} <span class="text-[9px] text-faint ml-1">(${esc(revokeTimeStr)})</span></div>
                                <div class="flex items-center font-mono text-faint text-[10px]">
                                    <span class="mr-1">Bởi:</span> ${window.getWalletName(revoker)}
                                </div>
                            </td>
                            <td class="px-3 py-2 text-center">
                                <span class="bg-err-soft text-err px-2 py-1 rounded text-[10px] font-bold uppercase">REVOKED (ON-CHAIN)</span>
                            </td>
                            <td class="px-2 py-2 text-center w-10">
                                <button data-act="expand" title="Xem chi tiết tài liệu" class="text-faint hover:text-accent transition"><i class="fa-solid fa-circle-info text-[12px]"></i></button>
                            </td>
                        </tr>
                        <tr class="doc-detail hidden border-b border-line" data-search="${searchPayload}" data-uploader="${esc(String(batch.uploader).toLowerCase())}">
                            <td colspan="6" class="px-3 py-2 bg-sunken/40">
                                <div class="flex items-center gap-x-4 flex-nowrap overflow-hidden">
                                    <span class="text-[11px] text-muted font-sans truncate max-w-[200px]" title="${esc(fileDoc.fileName)}"><i class="fa-regular fa-file mr-1"></i>${esc(fileDoc.fileName)}</span>
                                    <span class="text-[10px] text-faint whitespace-nowrap shrink-0"><i class="fa-regular fa-clock mr-1"></i>Ngày thu hồi: ${esc(revokeTimeStr)}</span>
                                    <span class="flex gap-3 ml-auto shrink-0">
                                        <button data-act="copy" data-v="${esc(fileDoc.docId)}" class="text-muted hover:text-ink transition text-[11px]"><i class="fa-regular fa-copy mr-1"></i>Copy</button>
                                    </span>
                                </div>
                            </td>
                        </tr>`;
                    }
                });
            }
        }

        if (html === '') {
            tbody.innerHTML = '<tr><td colspan="6" class="px-4 py-10 text-center text-faint">Tuyệt vời. Chưa có tài liệu nào bị thu hồi.</td></tr>';
        } else {
            tbody.innerHTML = html;
            filterRevokedTable();
        }
    } catch (_) { 
        tbody.innerHTML = '<tr><td colspan="6" class="px-4 py-10 text-center text-err">Lỗi kết nối RPC.</td></tr>'; 
    }
}
// =====================================================================
// API KEYS VÀ CẤU HÌNH
// =====================================================================
async function loadAPIKeys() {
    if (pendingGateActive) return; // ví ở phòng chờ không gọi API admin
    const tbody = document.getElementById('api-keys-table-body');
    if (!tbody) return;
    let keys = [];
    try {
        keys = await ApiService.listApiKeys();
    } catch (e) {
        const isAuthErr = /token|xác thực|đăng nhập|401|403/i.test(String(e.message || ''));
        if (isAuthErr) return tbody.innerHTML = '<tr><td colspan="4" class="px-4 py-10 text-center text-faint">Đang chờ đăng nhập ví...</td></tr>';
        return tbody.innerHTML = `<tr><td colspan="4" class="px-4 py-10 text-center text-err">${esc(e.message)}</td></tr>`;
    }
    if (keys.length === 0) return tbody.innerHTML = '<tr><td colspan="4" class="px-4 py-10 text-center text-faint">Chưa có API Key nào được khởi tạo.</td></tr>';

    tbody.innerHTML = keys.map(k => {
        const whOn = !!k.webhookUrl;
        const whTitle = whOn ? 'Webhook cảnh báo giả mạo (đã đặt)' : 'Webhook cảnh báo giả mạo';
        const whCls = whOn ? 'text-ok' : 'text-faint hover:text-accent';
        return `
        <tr class="border-b border-line hover:bg-hover transition-colors">
            <td class="px-3 py-2 text-soft text-sm font-medium">${esc(k.name)}</td>
            <td class="px-3 py-2 font-mono text-accent text-xs">${esc(k.prefix)}…</td>
            <td class="px-3 py-2 text-faint text-xs">${esc(new Date(k.createdAt).toLocaleDateString('vi-VN'))}</td>
            <td class="px-3 py-2 text-center">
                ${k.revoked
                    ? '<span class="bg-err-soft text-err border border-err px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider">Revoked</span>'
                    : `<span class="bg-ok-soft text-ok border border-ok px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider">Active</span>
                       <button data-act="revoke-key" data-v="${esc(k._id)}" title="Thu hồi key này" class="ml-2 text-err hover:text-err text-[10px] font-bold uppercase transition"><i class="fa-solid fa-ban"></i></button>
                       <button data-act="webhook-key" data-v="${esc(k._id)}" data-url="${esc(k.webhookUrl || '')}" title="${esc(whTitle)}" class="ml-1 ${esc(whCls)} text-[10px] font-bold uppercase transition"><i class="fa-solid fa-bolt"></i></button>`}
            </td>
        </tr>
    `;
    }).join('');
    paginateTbody(tbody);
}

async function generateNewApiKey() {
    const { value: appName } = await Swal.fire({
        title: 'Tạo API Key mới',
        text: 'Nhập tên hệ thống/đối tác cần cấp API Key:',
        input: 'text', inputAttributes: { autocomplete: 'off' },
        inputPlaceholder: 'VD: Trường cấp 3 ABC, Bệnh viện XYZ...',
        background: 'var(--panel)', color: 'var(--ink)',
        confirmButtonColor: 'var(--accent)', showCancelButton: true, cancelButtonText: 'Hủy'
    });
    if (!appName || appName.trim() === '') return;

    try {
        const { token } = await ApiService.createApiKey(appName.trim());
        // Hiện key ĐÚNG 1 LẦN — server chỉ lưu hash, không xem lại được
        await Swal.fire({
            title: 'API Key đã tạo — lưu lại ngay!',
            html: `<p class="text-sm text-soft mb-2">Key chỉ hiển thị <b class="text-err">một lần duy nhất</b>. Gửi cho đối tác để họ gọi API bằng header <code>x-api-key</code>:</p>
                <div class="flex items-center gap-2 bg-panel border border-line-strong rounded p-2">
                    <code class="text-ok text-xs break-all flex-1 text-left">${esc(token)}</code>
                    <button id="copy-new-key" class="text-muted hover:text-ink shrink-0"><i class="fa-regular fa-copy"></i></button>
                </div>`,
            icon: 'warning', background: 'var(--panel)', color: 'var(--ink)',
            didOpen: () => {
                document.getElementById('copy-new-key')?.addEventListener('click', () => window.copyAPIKey(token));
            }
        });
        loadAPIKeys();
    } catch (e) {
        Swal.fire({ icon: 'error', title: 'Lỗi', text: e.message, background: 'var(--panel)', color: 'var(--ink)' });
    }
}

// Đặt/xóa webhook nhận cảnh báo tamper_attempt (ký HMAC-SHA256 trong header X-Signature)
window.editApiKeyWebhook = async function (id, currentUrl) {
    const { value: url, isConfirmed } = await Swal.fire({
        title: 'Webhook cảnh báo giả mạo',
        html: `<p class="text-xs text-muted text-left mb-2">Khi có file nộp verify bị sửa so với bản gốc on-chain của tài liệu thuộc API key này, hệ thống POST sự kiện <code>tamper_attempt</code> kèm chữ ký <code>X-Signature: sha256=…</code> (HMAC theo MASTER_KEY). Để trống để tắt.</p>`,
        input: 'url', inputValue: currentUrl || '', inputPlaceholder: 'https://partner.example.com/webhook',
        showCancelButton: true, confirmButtonText: 'Lưu', cancelButtonText: 'Hủy',
        background: 'var(--panel)', color: 'var(--ink)'
    });
    if (!isConfirmed) return;
    try {
        await ApiService.setApiKeyWebhook(id, (url || '').trim());
        Swal.fire({ title: 'Đã lưu webhook', icon: 'success', timer: 1200, showConfirmButton: false, background: 'var(--panel)', color: 'var(--ink)' });
        loadAPIKeys();
    } catch (e) {
        Swal.fire({ title: 'Lỗi', text: getShortError(e), icon: 'error', background: 'var(--panel)', color: 'var(--ink)' });
    }
};

window.revokeApiKey = async function (id) {
    const ok = await Swal.fire({
        title: 'Thu hồi API Key?',
        text: 'Key sẽ ngừng hoạt động ngay — đối tác không gọi API được nữa.',
        icon: 'warning', showCancelButton: true, confirmButtonText: 'Thu hồi',
        confirmButtonColor: 'var(--err)', background: 'var(--panel)', color: 'var(--ink)', cancelButtonText: 'Hủy'
    });
    if (!ok.isConfirmed) return;
    try {
        await ApiService.revokeApiKey(id);
        loadAPIKeys();
        Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'Đã thu hồi API key', showConfirmButton: false, timer: 2000, background: 'var(--panel)', color: 'var(--ink)' });
    } catch (e) {
        Swal.fire({ icon: 'error', title: 'Lỗi', text: e.message, background: 'var(--panel)', color: 'var(--ink)' });
    }
};

function loadRpcConfig() {
    const rpcInput = document.getElementById('rpc-url-input');
    const chainInput = document.getElementById('chain-id-input');
    if (rpcInput) rpcInput.value = localStorage.getItem('custom_rpc_url') || CONFIG.RPC_URL;
    if (chainInput) chainInput.value = localStorage.getItem('custom_chain_id') || '11155111';
}

function saveRpcConfig() {
    localStorage.setItem('custom_rpc_url', document.getElementById('rpc-url-input').value);
    localStorage.setItem('custom_chain_id', document.getElementById('chain-id-input').value);
    Swal.fire({ title: 'Đã lưu cấu hình', text: 'Vui lòng F5 (tải lại trang) để áp dụng.', icon: 'success', background: 'var(--panel)', color: 'var(--ink)' });
}

function saveSystemSettings() {
    Swal.fire({ title: 'Đã lưu cài đặt', text: 'Các thiết lập đã được kích hoạt thành công.', icon: 'success', background: 'var(--panel)', color: 'var(--ink)' });
}

window.selectTemplate = (type) => {
    const tplStandard = document.getElementById('tpl-standard'); const tplMinimal = document.getElementById('tpl-minimal');
    const iconStandard = document.getElementById('icon-standard'); const iconMinimal = document.getElementById('icon-minimal');
    if (type === 'standard') {
        if (tplStandard) tplStandard.className = "border-2 border-accent bg-accent-soft rounded-md p-4 cursor-pointer relative transition duration-200";
        if (iconStandard) iconStandard.classList.remove('hidden');
        if (tplMinimal) tplMinimal.className = "border-2 border-line bg-sunken rounded-md p-4 cursor-pointer hover:border-line-strong transition duration-200 relative";
        if (iconMinimal) iconMinimal.classList.add('hidden');
    } else {
        if (tplMinimal) tplMinimal.className = "border-2 border-accent bg-accent-soft rounded-md p-4 cursor-pointer relative transition duration-200";
        if (iconMinimal) iconMinimal.classList.remove('hidden');
        if (tplStandard) tplStandard.className = "border-2 border-line bg-sunken rounded-md p-4 cursor-pointer hover:border-line-strong transition duration-200 relative";
        if (iconStandard) iconStandard.classList.add('hidden');
    }
};

window.selectWalletRow = function(address, roleLevel) {
    if (window.selectedWalletForEdit === address) {
        window.selectedWalletForEdit = null;
        document.getElementById('newRoleAddress').value = '';
        document.getElementById('newRoleLevel').value = '1';
    } else {
        window.selectedWalletForEdit = address;
        document.getElementById('newRoleAddress').value = address;
        document.getElementById('newRoleLevel').value = roleLevel;
    }
    window.loadWalletRoles();
};

// =====================================================================
// HỆ THỐNG QUẢN TRỊ ADMIN VÀ TÍNH TOÁN BẢNG
// =====================================================================
window.sortConfig = { key: 'address', direction: 'asc' };

window.sortWalletTable = function(key) {
    window.sortConfig.direction = (window.sortConfig.key === key && window.sortConfig.direction === 'asc') ? 'desc' : 'asc';
    window.sortConfig.key = key;
    window.loadWalletRoles();
};

window.loadWalletRoles = async function() {
    if (pendingGateActive) return; // ví ở phòng chờ không tải/đồng bộ bảng ví (tránh 403 + đè DB)
    const tbody = document.getElementById('wallet-roles-table-body');
    if (!tbody) return;

    // Chưa đăng nhập (chưa có JWT) thì không gọi API — tránh 401 dồn dập lúc mở trang
    if (!ApiService.hasValidToken()) {
        tbody.innerHTML = '<tr><td colspan="5" class="px-4 py-10 text-center text-faint">Vui lòng kết nối ví MetaMask để xem phân quyền.</td></tr>';
        return;
    }

    tbody.innerHTML = '<tr><td colspan="5" class="px-4 py-10 text-center text-accent"><i class="fa-solid fa-circle-notch fa-spin me-2"></i> Đang đồng bộ phân quyền từ Blockchain...</td></tr>';

    // 1. Lấy danh sách ví từ Backend (MongoDB)
    let wallets = await ApiService.getAllWallets();
    let isRecovered = false;

    // =======================================================
    // KHỞI TẠO TÀI KHOẢN ADMIN MẶC ĐỊNH (NẾU DB CHƯA CÓ)
    // =======================================================
    // Owner lấy từ chính contract (nguồn sự thật) — không hardcode địa chỉ;
    // fallback địa chỉ deploy hiện tại chỉ khi contract chưa kết nối được.
    let adminAddress = "0x8b10e25a2c6f91a5969b8db38b88b9e1002e1911";
    if (web3.contract) {
        try { adminAddress = await web3.contract.owner(); } catch (e) {}
    }
    adminAddress = adminAddress.toLowerCase(); // owner() trả checksum → phải hạ chữ trước khi so sánh
    window.__chainOwner = adminAddress; // cache để getWalletName dùng
    let hasAdmin = wallets.find(w => w.address.toLowerCase() === adminAddress);
    
    if (!hasAdmin) {
        // Bơm Admin vào danh sách hiển thị
        wallets.push({
            address: adminAddress,
            alias: "ADMIN HỆ THỐNG",
            role: "ADMIN",
            status: "ACTIVE",
            storageUsed: 0,
            storageLimit: 500,
            storageTrend: 0
        });
        // Bơm thẳng Admin vào Database MongoDB — chỉ Admin gọi được (server check rank),
        // user thường sẽ nhận 403 → bỏ qua êm, không để treo bảng
        try {
            await ApiService.syncWalletData(adminAddress, { 
                alias: "ADMIN HỆ THỐNG", 
                role: "ADMIN", 
                status: "ACTIVE" 
            });
            isRecovered = true;
        } catch (e) {
            console.log("Bỏ qua bơm admin vào DB (không đủ quyền):", e.message);
        }
    }
    // =======================================================

    // 2. KHÔI PHỤC TỪ BLOCKCHAIN & ĐẨY VÀO MONGODB
    try {
        if (web3.contract) {
            const roleEvents = await web3.getEventsInChunks(web3.contract.filters.RoleAssigned(), 'role_events');
            for (let ev of roleEvents) {
                const assignedAddr = ev.args[1]; 
                
                // Nếu tìm thấy ví trên Blockchain mà MongoDB chưa có
                if (!wallets.find(w => w.address.toLowerCase() === assignedAddr.toLowerCase())) {
                    // Event RoleAssigned cũ có thể trỏ ví ĐÃ BỊ XÓA (role on-chain = 0)
                    // → kiểm tra role thực trên chain trước, không hồi sinh ví đã xóa.
                    const onChainRole = await web3.getUserRole(assignedAddr);
                    const rNum = onChainRole === null ? -1 : Number(onChainRole);
                    if (rNum <= 0) continue; // 0 = đã xóa/thu hồi; -1 = RPC lỗi → không đoán quyền

                    const roleName = (onChainRole === 99 || rNum === 3) ? 'ADMIN'
                        : rNum === 2 ? 'QUẢN LÝ' : 'NHẬP LIỆU';
                    const newWallet = {
                        address: assignedAddr, status: 'ACTIVE', role: roleName,
                        storageUsed: 0, storageLimit: 500, storageTrend: 0
                    };
                    wallets.push(newWallet);

                    // GỌI API LƯU NGAY VÍ NÀY VÀO MONGODB
                    await ApiService.syncWalletData(assignedAddr, { status: 'ACTIVE', role: roleName });
                    isRecovered = true;
                }
            }
        }
    } catch (e) {
        console.warn("Chưa thể khôi phục event từ mạng lưới.");
    }

    // 3. ĐỐI CHIẾU QUYỀN THỰC TẾ & LƯU LẠI VÀO MONGODB
    for (let w of wallets) {
        try {
            if (w.status === 'DELETED') continue; // không đụng tombstone của ví đã xóa
            if (web3.contract && typeof web3.getUserRole === 'function') {
                const rRaw = await web3.getUserRole(w.address);
                if (rRaw === null || rRaw === undefined) continue; // RPC lỗi → giữ nguyên, không sync role đoán được
                const rCode = Number(rRaw);
                // Ví NGƯỜI XEM giữ rank 0 trên chain — không để sync đè thành BỊ KHÓA
                const isViewer = rCode === 0 && w.role === 'NGƯỜI XEM';
                // Chờ duyệt = rank 0 + DB đang ACTIVE (đồng nhất /wallets/pending) —
                // kể cả ví bị xóa/khóa rồi khai lại: DB nói "đang xin" thì là chờ duyệt,
                // KHÔNG nhìn lịch sử chain (ví từng được cấp có event rank ≥1 cũ sẽ
                // bị nhánh dưới đè nhầm thành BỊ KHÓA — bug "ví nhảy xuống Bị khóa").
                // Rejected mà chưa từng được cấp cũng coi là pending — tự khai lại
                // mới quay về khay chờ, không bị đè BỊ KHÓA khiến lọt vào bảng.
                const isPendingWallet = w.status === 'ACTIVE' || (w.rejected === true && w.roleGranted !== true);
                if (rCode === 0 && !isViewer && isPendingWallet) {
                    w.__pending = true;
                    continue;
                }
                const realRole = isViewer ? 'NGƯỜI XEM'
                    : (rCode === 99 || rCode === 3) ? 'ADMIN' : rCode === 2 ? 'QUẢN LÝ' : rCode === 1 ? 'NHẬP LIỆU' : 'BỊ KHÓA';
                const realStatus = isViewer ? 'ACTIVE' : rCode === 0 ? 'REVOKED' : 'ACTIVE';
                
                // Cập nhật lại quyền nếu Blockchain báo khác với Database
                if(w.role !== realRole || w.status !== realStatus) {
                    w.role = realRole;
                    w.status = realStatus;
                    await ApiService.syncWalletData(w.address, { role: realRole, status: realStatus });
                }
            }
        } catch (e) {
            console.log("Chưa thể đồng bộ quyền ví:", w.address);
        }
    }

    // 4. THUẬT TOÁN TỰ ĐỘNG PHỤC HỒI DUNG LƯỢNG (SELF-HEALING)
    try {
        const allBatches = await ApiService.getBatchesFromDatabase(); // Lấy từ DB
        let realStorageMap = {};
        
        if (allBatches && allBatches.length > 0) {
            allBatches.forEach(batch => {
                const owner = batch.uploader.toLowerCase();
                if (!realStorageMap[owner]) realStorageMap[owner] = 0;
                
                batch.files.forEach(f => {
                    // Tính cả file đã thu hồi — ciphertext vẫn pin trên IPFS,
                    // vẫn chiếm quota Pinata (khớp công thức phía server)
                    if (f.fileSize) {
                        let size = 0;
                        if (f.fileSize.includes('MB')) size = parseFloat(f.fileSize);
                        else if (f.fileSize.includes('KB')) size = parseFloat(f.fileSize) / 1024;
                        realStorageMap[owner] += size;
                    }
                });
            });
        }

        // Ghi đè dung lượng thực tế vào Database
        for (let w of wallets) {
            const actualStorage = Number((realStorageMap[w.address.toLowerCase()] || 0).toFixed(2));
            if(w.storageUsed !== actualStorage) {
                w.storageUsed = actualStorage;
                await ApiService.syncWalletData(w.address, { storageUsed: actualStorage }); 
            }
        }
    } catch (e) {
        console.log("Lỗi đồng bộ dung lượng:", e);
    }

    if (typeof syncDashboardData === 'function') await syncDashboardData();

    // Ví chờ duyệt/bị từ chối (rank 0, chưa từng có quyền) → không hiện trong
    // bảng ví đã cấp quyền — chúng nằm riêng ở khay "ví mới chờ cấp quyền"
    wallets = wallets.filter(w => !w.__pending);

    // Lưu snapshot ví để getWalletName tra alias cho bảng lịch sử/drawer
    try {
        localStorage.setItem('bdi_authorized_wallets',
            JSON.stringify(wallets.map(w => ({ address: w.address, alias: w.alias || '' }))));
    } catch (e) {}

    if (wallets.length === 0) {
        return tbody.innerHTML = '<tr><td colspan="5" class="px-4 py-10 text-center text-faint">Chưa có dữ liệu ví.</td></tr>';
    }

    // 5. SẮP XẾP BẢNG
    try {
        wallets.sort((a, b) => {
            if (a.role === 'ADMIN' && b.role !== 'ADMIN') return -1;
            if (b.role === 'ADMIN' && a.role !== 'ADMIN') return 1;
            let key = window.sortConfig?.key || 'address'; let direction = window.sortConfig?.direction || 'asc';
            let valA = a[key] || ''; let valB = b[key] || '';
            if (key === 'lastActive') { valA = new Date(valA).getTime() || 0; valB = new Date(valB).getTime() || 0; }
            if (valA < valB) return direction === 'asc' ? -1 : 1;
            if (valA > valB) return direction === 'asc' ? 1 : -1;
            return 0;
        });
    } catch (e) {}

// 5. HIỂN THỊ HTML VÀ PHÂN QUYỀN GIAO DIỆN (UI RBAC)
    const currentUser = (web3.currentAccount || "").toLowerCase();
    // Quyền admin lấy từ contract (owner=99 hoặc userRoles=3) — không hardcode địa chỉ
    let myRoleRaw = null;
    if (web3.contract && currentUser) {
        try { myRoleRaw = await web3.getUserRole(currentUser); } catch (e) {}
    }
    const myRoleNum = myRoleRaw === null ? -1 : Number(myRoleRaw);
    const isAdminSystem = myRoleRaw === 99 || myRoleNum === 3;

    // --- BẢO MẬT UI: Tự động giấu các tính năng Admin đối với tài khoản thường ---
    
    // 1. Giấu Form nhập liệu cấp quyền (ẩn cả thanh bấm collapse)
    const adminForm = document.getElementById('admin-role-form');
    const adminSection = document.getElementById('admin-role-section');
    if (adminSection) adminSection.classList.toggle('hidden', !isAdminSystem);
    if (adminForm) {
        if (isAdminSystem) {
            adminForm.classList.remove('hidden');
            adminForm.classList.add('grid');
        } else {
            adminForm.classList.add('hidden');
            adminForm.classList.remove('grid');
        }
    }

    // 2. Giấu Tiêu đề "Hệ thống Phân Quyền Quản Trị..."
    const adminTitle = document.querySelector('#tab-roles label');
    if (adminTitle && adminTitle.innerText.includes('Admin')) {
        adminTitle.parentElement.style.display = isAdminSystem ? 'flex' : 'none';
    }

    // 3. Giấu Tiêu đề cột Checkbox (Nút Select All)
    const selectAllTh = document.getElementById('selectAll');
    if (selectAllTh) {
        selectAllTh.parentElement.style.display = isAdminSystem ? '' : 'none';
    }
    // -------------------------------------------------------------------------

    // ĐÃ BỔ SUNG: filter(w => !w.isDeleted) để tự động giấu đi các tài khoản đã bị XÓA
    tbody.innerHTML = wallets.filter(w => !w.isDeleted).map(w => {
        const isRevoked = w.status === 'REVOKED'; 
        const isThisRowAdmin = w.role === 'ADMIN';
        
        const storageUsed = w.storageUsed ?? 0; const storageLimit = w.storageLimit ?? 500; 
        const storageTrend = w.storageTrend ?? 0; const fileTypes = w.fileTypes || { pdf: 0, img: 0, zip: 0 }; 
        const lastActive = w.lastActive || new Date().toISOString();
        const dateObj = new Date(lastActive); 
        const daysOffline = (new Date() - dateObj) / (1000 * 60 * 60 * 24);
        
        const trendIcon = storageTrend > 0 ? '<i class="fa-solid fa-arrow-trend-up mr-1 text-err"></i>' : '<i class="fa-solid fa-arrow-trend-down mr-1 text-ok"></i>';
        const trendColor = storageTrend > 0 ? 'text-err' : 'text-ok';
        const zombieClass = daysOffline > 30 ? 'text-err font-bold' : 'text-muted';
        const securityBadge = w.securityAlert ? `<span class="mt-1.5 bg-err-soft text-err border border-err px-2 py-0.5 rounded text-[10px] font-bold flex items-center w-max cursor-help" title="Lịch sử: ${esc(w.securityAlert)}"><i class="fa-solid fa-shield-virus mr-1"></i> Bị Cảnh Cáo</span>` : '<span class="mt-1.5 text-faint text-[10px] flex items-center w-max"><i class="fa-solid fa-check text-ok mr-1"></i> An toàn</span>';

        // --- XỬ LÝ CỘT 0: CHECKBOX DÀNH CHO ADMIN ---
        // Chỉ vẽ cột checkbox này nếu người đang xem là Admin. Nếu là user thường, cột này sẽ biến mất hoàn toàn.
        // onchange được xử lý bằng event delegation trên .row-checkbox (không inline handler)
        const tdCheckboxHTML = isAdminSystem
            ? `<td class="px-3 py-2 text-center">${isThisRowAdmin ? '' : `<input type="checkbox" value="${esc(w.address)}" class="row-checkbox rounded bg-panel border-line-strong text-accent cursor-pointer">`}</td>`
            : ``;

        // --- XỬ LÝ CỘT 1: CHỈ HIỂN THỊ TÊN VÀ ID ---
        let displayNameHTML = '';

        if (isThisRowAdmin) {
            displayNameHTML = `<span class="font-bold text-warn text-[13px] mb-1 uppercase tracking-wider whitespace-nowrap"><i class="fa-solid fa-user-shield mr-1"></i> ADMIN HỆ THỐNG</span>`;
        } else {
            const aliasName = w.alias || '';
            displayNameHTML = aliasName
                ? `<span class="font-bold text-ink text-[13px] mb-1 whitespace-nowrap">${esc(aliasName)}</span>`
                : `<span class="italic text-faint text-[11px] mb-1">(Chưa đặt tên)</span>`;
        }

        // Badge quyền hiện ngay dưới tên — trước đây quyền giấu trong menu bánh răng
        const ROLE_BADGE = {
            'QUẢN LÝ': 'bg-violet-soft text-violet border-violet',
            'NHẬP LIỆU': 'bg-accent-soft text-accent border-accent-line',
            'NGƯỜI XEM': 'bg-info-soft text-info border-info',
            'BỊ KHÓA': 'bg-err-soft text-err border-err',
            'ĐÃ XÓA': 'bg-sunken text-faint border-line-strong'
        };
        const roleBadge = !isThisRowAdmin && w.role
            ? `<span class="w-max px-2 py-0.5 rounded text-[10px] font-bold border ${ROLE_BADGE[w.role] || 'bg-sunken text-muted border-line-strong'}">${esc(w.role)}</span>`
            : '';

        const formattedWalletName = `
            <div class="flex flex-col justify-center gap-0.5">
                ${displayNameHTML}
                ${roleBadge}
                <span class="font-mono text-muted text-[11px]">${esc(w.address.substring(0,6))}...${esc(w.address.substring(38))}</span>
            </div>
        `;

        // --- XỬ LÝ CỘT 3: BÁNH RĂNG & TRẠNG THÁI ---
        const activeStatusIcon = isRevoked
            ? '<span class="relative flex h-2 w-2 mr-2"><span class="relative inline-flex rounded-full h-2 w-2 bg-err"></span></span><span class="text-err font-bold text-[10px]">TẠM KHÓA</span>'
            : '<span class="relative flex h-2 w-2 mr-2"><span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-ok opacity-75"></span><span class="relative inline-flex rounded-full h-2 w-2 bg-ok"></span></span><span class="text-ok font-bold text-[10px]">ĐANG HOẠT ĐỘNG</span>';

        // Bánh răng: Đã được chặn sẵn, chỉ hiện nếu là Admin
        const gearBtn = (isAdminSystem && !isThisRowAdmin)
            ? `<button data-act="wallet-settings" data-v="${esc(w.address)}" data-status="${esc(w.status)}" data-role="${esc(w.role)}" data-alias="${esc(w.alias || '')}" class="text-faint hover:text-ink transition bg-sunken p-1.5 rounded border border-line-strong hover:bg-hover ml-4 shadow" title="Tùy chọn quản lý"><i class="fa-solid fa-gear"></i></button>`
            : '';

        // Ép % width thành số an toàn — dữ liệu DB không được chui vào attribute style
        const pct = (v) => Math.min(100, Math.max(0, Number(v) || 0));

        return `
        <tr class="border-b border-line hover:bg-hover transition ${isRevoked ? 'opacity-60' : ''}" data-row-addr="${esc((w.address||'').toLowerCase())}" data-row-role="${esc(w.role || '')}">
            ${tdCheckboxHTML}
            <td class="py-1.5 px-2">
                <div class="p-2 cursor-pointer group hover:bg-hover rounded-lg transition-all inline-block w-full" data-act="wallet-preview" data-v="${esc(w.address || '')}" title="Nhấn để xem Hồ Sơ Tài Khoản">
                    ${formattedWalletName}
                </div>
            </td>
            <td class="py-1.5 px-2 pr-4">
                <div class="p-2 cursor-pointer group hover:bg-hover rounded-lg transition-all inline-block w-full max-w-[240px]" data-act="storage" data-v="${esc(w.address || '')}" title="Nhấn để xem chi tiết tài liệu đã up">
                    <div class="w-full bg-panel border border-line-strong rounded-full h-1.5 flex overflow-hidden mb-1 group-hover:ring-1 group-hover:ring-accent transition-all">
                        <div class="bg-accent h-1.5" style="width: ${pct(fileTypes.pdf)}%"></div>
                        <div class="bg-violet h-1.5" style="width: ${pct(fileTypes.img)}%"></div>
                        <div class="bg-warn h-1.5" style="width: ${pct(fileTypes.zip)}%"></div>
                    </div>
                    <div class="flex justify-between items-end mb-1 mt-2">
                        <span class="text-xs text-muted font-bold group-hover:text-ink transition">
                            ${esc(storageUsed)} MB <span class="text-faint font-normal group-hover:text-muted transition">/ ${esc(storageLimit)} MB</span>
                        </span>
                        <span class="text-[10px] ${trendColor}">${trendIcon}${storageTrend > 0 ? '+' : ''}${esc(storageTrend)}%</span>
                    </div>
                </div>
            </td>
            <td class="px-3 py-2">
                <div class="flex items-center mb-1">
                    <div class="flex items-center w-28">${activeStatusIcon}</div>
                    ${gearBtn}
                </div>
                <div class="text-xs ${zombieClass} mb-1" title="Đăng nhập cuối">
                    <i class="fa-regular fa-clock mr-1"></i> ${isNaN(dateObj.getTime()) ? '---' : dateObj.toLocaleDateString('vi-VN')}
                </div>
                ${securityBadge}
            </td>
        </tr>`;
    }).join('');
    // Giữ nguyên chip lọc đang chọn sau mỗi lần render lại bảng (poll/refresh)
    window.filterWalletTable(__walletRoleFilter || 'ALL');
};

window.handleAssignRole = async function() {
    if (isProcessing) return;
    const address = document.getElementById('newRoleAddress')?.value.trim();
    const alias = document.getElementById('newRoleAlias')?.value.trim(); // Lấy tên nhân viên
    const rawLevel = document.getElementById('newRoleLevel')?.value;
    // 'viewer' = quyền chỉ đọc: rank on-chain giữ 0, DB đánh dấu NGƯỜI XEM
    const isViewer = rawLevel === 'viewer';
    const roleLevel = isViewer ? 0 : parseInt(rawLevel);

    if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
        return Swal.fire({ title: 'Lỗi định dạng', text: 'Địa chỉ ví không hợp lệ!', icon: 'warning', background: 'var(--panel)', color: 'var(--ink)' });
    }

    // Kiểm tra quyền hiện tại trên chain trước khi mở MetaMask —
    // tránh ký giao dịch vô nghĩa (khóa ví chưa có quyền, cấp lại đúng quyền cũ)
    let currentRank = null;
    try {
        const currentRole = await web3.getUserRole(address);
        if (currentRole === 99) {
            return Swal.fire({ title: 'Không thể thực hiện', text: 'Đây là ví Admin gốc của hệ thống — Smart Contract không cho phép thay đổi quyền của nó.', icon: 'warning', background: 'var(--panel)', color: 'var(--ink)' });
        }
        if (currentRole !== null && currentRole !== undefined) {
            currentRank = Number(currentRole);
            if (!isViewer && roleLevel === 0 && currentRank === 0) {
                return Swal.fire({ title: 'Không cần khóa', text: 'Ví này chưa từng được cấp quyền nên không có gì để tước. Khóa chỉ áp dụng cho ví đang có quyền.', icon: 'info', background: 'var(--panel)', color: 'var(--ink)' });
            }
            if (!isViewer && roleLevel === currentRank) {
                const names = { 1: 'Nhập Liệu', 2: 'Quản Lý', 3: 'Admin' };
                return Swal.fire({ title: 'Quyền trùng lặp', text: `Ví này đang giữ sẵn quyền ${esc(names[currentRank])} rồi, không cần cấp lại.`, icon: 'info', background: 'var(--panel)', color: 'var(--ink)' });
            }
        }
    } catch (e) { /* RPC lỗi thì bỏ qua pre-check, để contract tự chặn */ }

    // Viewer: ví chưa có quyền chain + DB đã là NGƯỜI XEM → trùng lặp
    if (isViewer && currentRank === 0) {
        try {
            const wallets = await ApiService.getAllWallets();
            const w = wallets.find(x => (x.address || '').toLowerCase() === address.toLowerCase());
            if (w && w.role === 'NGƯỜI XEM' && w.status === 'ACTIVE') {
                return Swal.fire({ title: 'Quyền trùng lặp', text: 'Ví này đang là Người Xem rồi, không cần cấp lại.', icon: 'info', background: 'var(--panel)', color: 'var(--ink)' });
            }
        } catch (e) {}
    }

    isProcessing = true;
    try {
        // Viewer chỉ cần ghi DB khi ví chưa có quyền chain; ví đang có quyền
        // vẫn phải ký assignRole(0) để tước quyền on-chain trước
        const needTx = !isViewer || (currentRank === null || currentRank > 0);
        if (needTx) {
            UI.updateProgress(50, "Đang gửi giao dịch phân quyền lên mạng Sepolia...", "PROCESSING");
            await web3.assignRole(address, roleLevel);
        }
        const roleName = isViewer ? 'NGƯỜI XEM'
            : roleLevel === 3 ? 'ADMIN' : roleLevel === 2 ? 'QUẢN LÝ' : roleLevel === 1 ? 'NHẬP LIỆU' : 'BỊ KHÓA';

        // Truyền alias vào DB
        await ApiService.syncWalletData(address, { role: roleName, status: roleLevel === 0 && !isViewer ? 'REVOKED' : 'ACTIVE', alias: alias });

        Swal.fire({ title: 'Thành công', text: `Ví đã được cấp quyền: ${esc(roleName)}`, icon: 'success', background: 'var(--panel)', color: 'var(--ink)' });
        refreshPendingBadge(); // ví vừa duyệt biến mất khỏi khay chờ

        document.getElementById('newRoleAddress').value = '';
        if (document.getElementById('newRoleAlias')) document.getElementById('newRoleAlias').value = '';
        document.getElementById('newRoleLevel').value = '1';
        if (typeof window.loadWalletRoles === 'function') {
            // Chờ bảng ví render xong rồi cuộn tới đúng dòng ví vừa duyệt và nháy
            // sáng — admin thấy ngay ví mới xuất hiện trong bảng TÀI KHOẢN VÍ
            await window.loadWalletRoles();
            const row = document.querySelector(`tr[data-row-addr="${esc(address.toLowerCase())}"]`);
            if (row) {
                row.scrollIntoView({ behavior: 'smooth', block: 'center' });
                row.classList.add('bg-ok-soft');
                setTimeout(() => row.classList.remove('bg-ok-soft'), 3000);
            }
        }
    } catch (error) {
        Swal.fire({ title: 'Từ chối', text: getShortError(error, 'Chỉ Admin hệ thống mới có quyền thực thi.'), icon: 'error', background: 'var(--panel)', color: 'var(--ink)' });
    } finally {
        isProcessing = false;
        UI.updateProgress(0, "Hệ thống đang rảnh", "STANDBY");
    }
};
// =====================================================================
// MENU TÙY CHỌN & CÁC CHỨC NĂNG QUẢN LÝ TÀI KHOẢN (BÁNH RĂNG CƯA)
// =====================================================================

// 1. Giao diện Menu Bánh răng cưa
window.manageSingleWalletSettings = function(address, currentStatus, currentRole, currentAlias) {
    const isLocked = currentStatus === 'REVOKED';
    const lockText = isLocked ? "Mở khóa tài khoản" : "Khóa tài khoản (Tạm dừng)";
    const lockIcon = isLocked ? "fa-unlock" : "fa-lock";
    const lockColor = isLocked ? "text-ok hover:bg-ok-soft border-ok" : "text-warn hover:bg-warn-soft border-warn";

    const htmlContent = `
        <div class="flex flex-col gap-3 text-sm mt-4">
            <button data-act="cfg-role" data-v="${esc(address)}" data-role="${esc(currentRole)}" class="flex items-center gap-3 p-3 rounded-lg border border-line-strong bg-sunken hover:bg-hover text-soft transition shadow-sm">
                <i class="fa-solid fa-user-shield w-5 text-accent"></i> Phân lại quyền ví
            </button>
            <button data-act="cfg-alias" data-v="${esc(address)}" data-alias="${esc(currentAlias || '')}" class="flex items-center gap-3 p-3 rounded-lg border border-line-strong bg-sunken hover:bg-hover text-soft transition shadow-sm">
                <i class="fa-solid fa-pen w-5 text-accent"></i> Đổi tên nhân viên
            </button>
            <button data-act="cfg-lock" data-v="${esc(address)}" data-locked="${isLocked ? '1' : '0'}" class="flex items-center gap-3 p-3 rounded-lg border bg-sunken transition shadow-sm ${lockColor}">
                <i class="fa-solid ${lockIcon} w-5"></i> ${lockText}
            </button>
            <button data-act="cfg-delete" data-v="${esc(address)}" class="flex items-center gap-3 p-3 rounded-lg border border-err bg-err-soft hover:bg-err-soft text-err transition shadow-sm">
                <i class="fa-solid fa-trash w-5"></i> Xóa vĩnh viễn hệ thống
            </button>
        </div>
    `;

    Swal.fire({
        title: 'TÙY CHỌN TÀI KHOẢN',
        html: htmlContent,
        background: 'var(--panel)', color: 'var(--ink)',
        showConfirmButton: false, showCloseButton: true,
    });
};
// 2. Chức năng Đổi Quyền (Đã fix lỗi chữ trắng nền trắng)
window.openChangeRole = async function(address, currentRole) {
    const { value: newRole } = await Swal.fire({
        title: 'ĐỔI QUYỀN TÀI KHOẢN',
        html: `
            <style>
                /* Ép màu nền tối và chữ trắng cho ô Select và các Lựa chọn */
                .swal2-select { background-color: var(--panel) !important; color: var(--ink) !important; border: 1px solid var(--line-strong) !important; outline: none !important; }
                .swal2-select option { background-color: var(--panel) !important; color: var(--ink) !important; }
            </style>
            Chọn cấp độ mới cho ví <b class="font-mono text-accent">${esc(address.substring(0,8))}...</b>:
        `,
        input: 'select',
        inputOptions: { '1': 'Quyền Nhập Liệu (Upload)', '2': 'Quyền Quản Lý (Upload + Thu hồi)', 'viewer': 'Quyền Người Xem (chỉ đọc)' },
        inputValue: currentRole === 'QUẢN LÝ' ? '2' : currentRole === 'NGƯỜI XEM' ? 'viewer' : '1',
        showCancelButton: true, confirmButtonText: 'Lưu thay đổi', cancelButtonText: 'Hủy',
        background: 'var(--panel)', color: 'var(--ink)', confirmButtonColor: 'var(--ok)'
    });

    if (newRole) {
        if (isProcessing) return;
        isProcessing = true;
        try {
            UI.updateProgress(50, "Đang cập nhật quyền trên Blockchain...", "PROCESSING");
            // Viewer: chỉ ký assignRole(0) khi ví đang giữ quyền chain; rank 0 sẵn thì bỏ qua tx
            const rc = await web3.getUserRole(address);
            if (newRole !== 'viewer' || (rc === null || Number(rc) > 0)) {
                await web3.assignRole(address, newRole === 'viewer' ? 0 : parseInt(newRole));
            }
            const roleName = newRole === 'viewer' ? 'NGƯỜI XEM' : newRole === '2' ? 'QUẢN LÝ' : 'NHẬP LIỆU';
            await ApiService.syncWalletData(address, { role: roleName, status: 'ACTIVE' });
            
            UI.updateProgress(100, "Đã đổi quyền thành công!", "SUCCESS");
            Swal.fire({ title: 'Thành công', text: `Đã cấp: ${esc(roleName)}`, icon: 'success', background: 'var(--panel)', color: 'var(--ink)', timer: 1500, showConfirmButton: false });
            window.loadWalletRoles();
        } catch (err) {
            Swal.fire({ title: 'Thất bại', text: getShortError(err), icon: 'error', background: 'var(--panel)', color: 'var(--ink)' });
        } finally {
            isProcessing = false;
            setTimeout(() => UI.updateProgress(0, "Hệ thống đang rảnh", "STANDBY"), 3000);
        }
    }
};
// 3. Chức năng Khóa/Mở Khóa chuyên dụng cho 1 ví (Gọi trực tiếp Web3)
window.toggleWalletLock = async function(address, isLocked) {
    const actionText = isLocked ? "MỞ KHÓA" : "KHÓA";
    const roleLevel = isLocked ? 1 : 0; // 1: Nhập liệu (Mở), 0: Tước quyền (Khóa)
    const roleName = isLocked ? 'NHẬP LIỆU' : 'BỊ KHÓA';
    const statusName = isLocked ? 'ACTIVE' : 'REVOKED';
    const colorCode = isLocked ? 'var(--ok)' : 'var(--err)';

    const { isConfirmed } = await Swal.fire({
        title: `${esc(actionText)} TÀI KHOẢN?`,
        html: `Bạn đang thực hiện lệnh <b>${esc(actionText)}</b> cho ví <b class="font-mono text-accent">${esc(address.substring(0,8))}...</b>.<br><br><i>Hệ thống sẽ gọi MetaMask để ghi nhận trạng thái lên Blockchain.</i>`,
        icon: 'warning', 
        showCancelButton: true, 
        confirmButtonText: `Xác nhận ${esc(actionText)}`, 
        cancelButtonText: 'Hủy lệnh',
        background: 'var(--panel)', color: 'var(--ink)', confirmButtonColor: colorCode
    });

    if (isConfirmed) {
        if (isProcessing) return;
        isProcessing = true;
        try {
            UI.updateProgress(40, `Đang gửi lệnh ${actionText} lên Blockchain... Vui lòng duyệt trên MetaMask!`, "PROCESSING");
            
            await web3.assignRole(address, roleLevel); 
            await ApiService.syncWalletData(address, { status: statusName, role: roleName });

            UI.updateProgress(100, `Đã ${actionText} thành công!`, "SUCCESS");
            Swal.fire({ title: 'Hoàn tất', text: `Tài khoản đã được ${esc(actionText.toLowerCase())}.`, icon: 'success', background: 'var(--panel)', color: 'var(--ink)', timer: 1500, showConfirmButton: false });
            
            window.loadWalletRoles();
            window.checkSelection(); // Reset thanh công cụ nếu đang bật
        } catch (err) {
            Swal.fire({ title: 'Bị gián đoạn', text: getShortError(err, 'Lệnh bị hủy do bạn từ chối trên MetaMask hoặc lỗi mạng.'), icon: 'error', background: 'var(--panel)', color: 'var(--ink)' });
            UI.updateProgress(0, "Giao dịch thất bại.", "FAILED");
        } finally {
            isProcessing = false;
            setTimeout(() => UI.updateProgress(0, "Hệ thống đang rảnh", "STANDBY"), 3000);
        }
    }
};

// 4. Chức năng Xóa Tài khoản
window.deleteWallet = async function(address) {
    const { isConfirmed } = await Swal.fire({
        title: 'XÓA TÀI KHOẢN?',
        html: `Bạn đang chuẩn bị xóa ví <b class="text-err font-mono">${esc(address.substring(0,8))}...</b>.<br><br><i>Hệ thống sẽ tước quyền trên Blockchain và gỡ tài khoản này khỏi danh bạ quản lý.</i>`,
        icon: 'warning', showCancelButton: true, confirmButtonText: 'Xác nhận Xóa', cancelButtonText: 'Hủy',
        background: 'var(--panel)', color: 'var(--ink)', confirmButtonColor: 'var(--err)'
    });

    if (isConfirmed) {
        if (isProcessing) return;
        isProcessing = true;
        try {
            UI.updateProgress(40, "Đang tước quyền trên Blockchain...", "PROCESSING");
            await web3.assignRole(address, 0); 
            
            // Cập nhật DB nội bộ để ẩn ví đi — MongoDB là nguồn sự thật;
            // snapshot localStorage chỉ giữ {address, alias} cho getWalletName
            await ApiService.syncWalletData(address, { status: 'DELETED', role: 'ĐÃ XÓA' });

            UI.updateProgress(100, "Đã xóa ví thành công", "SUCCESS");
            Swal.fire({ title: 'Đã xóa', text: 'Tài khoản đã được gỡ khỏi hệ thống.', icon: 'success', background: 'var(--panel)', color: 'var(--ink)', timer: 1500, showConfirmButton: false });
            window.loadWalletRoles();
        } catch (err) {
            Swal.fire({ title: 'Thất bại', text: getShortError(err, 'Lỗi tước quyền trên chuỗi.'), icon: 'error', background: 'var(--panel)', color: 'var(--ink)' });
        } finally {
            isProcessing = false;
            setTimeout(() => UI.updateProgress(0, "Hệ thống đang rảnh", "STANDBY"), 3000);
        }
    }
};

// 3b. POPUP "VÍ ĐƯỢC ỦY QUYỀN" — bấm card thống kê → chọn vai trò → xem danh sách ví
const ROLE_LIST_META = {
    'NHẬP LIỆU': { color: 'text-accent', badge: 'bg-accent-soft text-accent border-accent-line', icon: 'fa-pen-to-square' },
    'QUẢN LÝ': { color: 'text-violet', badge: 'bg-violet-soft text-violet border-violet', icon: 'fa-user-tie' },
    'NGƯỜI XEM': { color: 'text-info', badge: 'bg-info-soft text-info border-info', icon: 'fa-eye' }
};
let __roleModalWallets = [];

window.openRoleModal = async function () {
    const overlay = document.getElementById('role-modal-overlay');
    if (!overlay) return;
    overlay.classList.remove('hidden');
    overlay.onclick = (e) => { if (e.target === overlay) window.closeRoleModal(); };
    showView('roles');
    try {
        __roleModalWallets = await ApiService.getAllWallets();
    } catch (e) {
        __roleModalWallets = [];
    }
    // Chỉ đếm ví đang ACTIVE và quyền do admin gán (roleGranted) —
    // loại ví pending (role mặc định NHẬP LIỆU) và ví bị khóa/từ chối
    const granted = __roleModalWallets.filter(w => w.status === 'ACTIVE' && w.roleGranted === true && ROLE_LIST_META[w.role]);
    const countOf = (role) => granted.filter(w => w.role === role).length;
    const setCnt = (id, n) => { const el = document.getElementById(id); if (el) el.innerText = `${n} ví`; };
    setCnt('role-count-nl', countOf('NHẬP LIỆU'));
    setCnt('role-count-ql', countOf('QUẢN LÝ'));
    setCnt('role-count-nx', countOf('NGƯỜI XEM'));
    // Nút "Tất cả" = tổng ví được ủy quyền + admin gốc (admin cũng được cấp sẵn)
    const adminCount = __roleModalWallets.filter(w => w.status === 'ACTIVE' && w.role === 'ADMIN').length;
    setCnt('role-count-all', granted.length + adminCount);
};

function showView(which) {
    document.getElementById('role-view-roles').classList.toggle('hidden', which !== 'roles');
    document.getElementById('role-view-roles').classList.toggle('flex', which === 'roles');
    const list = document.getElementById('role-view-list');
    list.classList.toggle('hidden', which !== 'list');
    list.classList.toggle('flex', which === 'list');
}
window.showRolePicker = () => showView('roles');

window.showRoleList = function (role) {
    // Admin/quản lý: nhảy thẳng xuống tab Quản Lý Quyền Ví và áp đúng chip lọc —
    // xem trong bảng chung để thao tác tiếp được luôn (hồ sơ, dung lượng, menu quản lý)
    const navRoles = document.getElementById('nav-roles');
    if (navRoles && navRoles.style.display !== 'none') {
        window.closeRoleModal();
        navRoles.click();
        window.filterWalletTable(role);
        setTimeout(() => {
            document.querySelector('.wallet-filter')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 60);
        return;
    }
    // Ví chỉ-đọc (không có tab quản lý): xem danh sách ngay trong popup
    const meta = role === 'ALL'
        ? { color: 'text-soft', badge: 'bg-sunken text-soft border-line-strong', icon: 'fa-users' }
        : ROLE_LIST_META[role];
    if (!meta) return;
    document.getElementById('role-list-title').innerHTML =
        `<i class="fa-solid ${meta.icon} mr-1.5 ${meta.color}"></i><span class="${meta.color}">${role === 'ALL' ? 'TẤT CẢ' : esc(role)}</span>`;
    // TẤT CẢ = mọi ví đã được cấp (kể cả admin gốc) — loại ví chờ duyệt
    // (ACTIVE nhưng roleGranted=false), không lộ ví chưa duyệt cho người xem.
    const grantedAll = w => w.roleGranted === true || w.role === 'ADMIN';
    const rows = __roleModalWallets.filter(w => w.status === 'ACTIVE' && grantedAll(w) && (role === 'ALL' || w.role === role));
    const badgeOf = (r) => ROLE_LIST_META[r]?.badge || meta.badge;
    const body = document.getElementById('role-list-body');
    body.innerHTML = rows.length === 0
        ? `<div class="h-full flex flex-col items-center justify-center text-faint gap-2 py-10">
               <i class="fa-solid fa-users-slash text-2xl"></i>
               <p class="text-xs">${role === 'ALL' ? 'Chưa có ví nào được ủy quyền' : `Chưa có ví nào được cấp quyền ${esc(role)}`}</p>
           </div>`
        : rows.map(w => `
           <div class="flex items-center justify-between px-3.5 py-2.5 rounded-lg bg-sunken border border-line-strong hover:border-line-strong transition">
               <div class="min-w-0">
                   <p class="text-[13px] font-bold text-ink truncate">${esc(w.alias || '(Chưa đặt tên)')}</p>
                   <p class="font-mono text-[10px] text-faint">${esc(w.address)}</p>
               </div>
               <span class="shrink-0 ml-3 w-max px-2 py-0.5 rounded text-[10px] font-bold border ${badgeOf(w.role)}">${esc(w.role)}</span>
           </div>`).join('');
    showView('list');
};

window.closeRoleModal = function () {
    const overlay = document.getElementById('role-modal-overlay');
    if (overlay) overlay.classList.add('hidden');
};

// 4. QUICK PREVIEW DRAWER
window.openPreviewDrawer = async function(address) {
    let wallets = await ApiService.getAllWallets();
    let w = wallets.find(x => x.address === address);
    if (!w) return;

    document.getElementById('drawer-content').innerHTML = `
        <div class="p-5 border-b border-line flex justify-between items-center bg-sunken">
            <h3 class="text-ink font-bold"><i class="fa-solid fa-user-shield text-accent mr-2"></i> Hồ Sơ Tài Khoản</h3>
            <button data-act="drawer-close" class="text-faint hover:text-ink transition"><i class="fa-solid fa-xmark text-lg"></i></button>
        </div>
        <div class="p-5 flex-1 overflow-y-auto space-y-6">
            <div>
                <label class="text-[10px] text-faint font-bold uppercase tracking-wider">TÀI KHOẢN VÍ</label>
                <div class="mt-1">${w.role === 'ADMIN' ? '<span class="text-warn font-bold text-[10px] bg-warn-soft px-2 py-0.5 rounded border border-warn">ADMIN</span>' : `<span class="text-accent font-bold text-[10px] bg-accent-soft px-2 py-0.5 rounded border border-accent-line">${esc(w.role)}</span>`}</div>
            </div>
            <div class="mt-4">
                <label class="text-[10px] text-faint font-bold uppercase tracking-wider">ĐỊA CHỈ VÍ</label>
                <div class="flex items-center gap-2 mt-1">
                    <div class="font-mono text-accent text-sm bg-panel p-2 rounded border border-line break-all flex-1">${esc(w.address)}</div>
                    <button data-act="copy" data-v="${esc(w.address)}" class="bg-sunken hover:bg-hover text-muted hover:text-ink p-2.5 rounded border border-line-strong transition" title="Copy địa chỉ ví"><i class="fa-regular fa-copy"></i></button>
                </div>
            </div>
            <div class="grid grid-cols-2 gap-3 mt-4">
                <div class="bg-panel p-3 rounded-lg border border-line text-center">
                    <div class="text-[10px] text-faint font-bold uppercase mb-1">Đã dùng IPFS</div>
                    <div class="text-xl text-ink font-bold">${esc(w.storageUsed)} <span class="text-xs text-faint">MB</span></div>
                </div>
                <div class="bg-panel p-3 rounded-lg border border-line text-center">
                    <div class="text-[10px] text-faint font-bold uppercase mb-1">Xu hướng</div>
                    <div class="text-xl ${w.storageTrend > 0 ? 'text-err' : 'text-ok'} font-bold">${esc(w.storageTrend)}%</div>
                </div>
            </div>
            <div>
                <label class="text-[10px] text-faint font-bold uppercase tracking-wider mb-2 block">Cảnh báo bảo mật</label>
                <div class="text-xs p-3 rounded border ${w.securityAlert ? 'bg-err-soft border-err text-err' : 'bg-ok-soft border-ok text-ok'}">
                    ${w.securityAlert ? `<i class="fa-solid fa-triangle-exclamation mr-1"></i> ${esc(w.securityAlert)}` : `<i class="fa-solid fa-shield-check mr-1"></i> Hệ thống an toàn.`}
                </div>
            </div>
        </div>
    `;
    window.toggleDrawer(true);
};

window.toggleDrawer = function(isOpen) {
    const drawer = document.getElementById('preview-drawer'); 
    const overlay = document.getElementById('preview-drawer-overlay');
    if (isOpen) {
        overlay.classList.remove('hidden'); 
        setTimeout(() => overlay.classList.remove('opacity-0'), 10); 
        drawer.classList.remove('translate-x-full');
    } else {
        overlay.classList.add('opacity-0'); 
        drawer.classList.add('translate-x-full'); 
        setTimeout(() => overlay.classList.add('hidden'), 300);
    }
};

// =====================================================================
// BỘ LỌC VAI TRÒ — ẩn/hiện hàng theo quyền, giữ nguyên mọi thao tác trong hàng
// =====================================================================
let __walletRoleFilter = 'ALL';
const WALLET_FILTER_STYLE = {
    'ALL':        { on: 'bg-hover text-ink border-line-strong',          off: 'bg-sunken text-muted border-line-strong hover:text-ink' },
    'NHẬP LIỆU':  { on: 'bg-accent-soft text-accent border-accent',    off: 'bg-sunken text-muted border-line-strong hover:text-accent' },
    'QUẢN LÝ':    { on: 'bg-violet-soft text-violet border-violet', off: 'bg-sunken text-muted border-line-strong hover:text-violet' },
    'NGƯỜI XEM':  { on: 'bg-info-soft text-info border-info',       off: 'bg-sunken text-muted border-line-strong hover:text-info' },
    'BỊ KHÓA':    { on: 'bg-err-soft text-err border-err',       off: 'bg-sunken text-muted border-line-strong hover:text-err' }
};

window.filterWalletTable = function(role) {
    __walletRoleFilter = role;
    document.querySelectorAll('#wallet-roles-table-body tr').forEach(tr => {
        const match = (role === 'ALL') || (tr.dataset.rowRole === role);
        tr.classList.toggle('hidden', !match);
        // Hàng bị ẩn không được giữ trạng thái tích — tránh thao tác hàng loạt nhầm ví không thấy
        if (!match) {
            const cb = tr.querySelector('.row-checkbox');
            if (cb) cb.checked = false;
        }
    });
    document.querySelectorAll('.wallet-filter').forEach(btn => {
        const s = WALLET_FILTER_STYLE[btn.dataset.filter] || WALLET_FILTER_STYLE['ALL'];
        btn.className = 'wallet-filter px-3 py-1 rounded-lg text-[11px] font-bold border transition ' +
            (btn.dataset.filter === role ? s.on : s.off);
    });
    paginateTbody(document.getElementById('wallet-roles-table-body'), 1);
    window.checkSelection();
};

window.toggleAllCheckboxes = function(source) {
    // Chỉ tích các hàng đang hiển thị — hàng bị lọc ẩn không tham gia thao tác hàng loạt
    const checkboxes = document.querySelectorAll('#wallet-roles-table-body tr:not(.hidden) .row-checkbox'); 
    checkboxes.forEach(cb => cb.checked = source.checked); 
    window.checkSelection();
};

window.checkSelection = function() {
    const checkedBoxes = document.querySelectorAll('#wallet-roles-table-body tr:not(.hidden) .row-checkbox:checked'); 
    const actionBar = document.getElementById('batch-action-bar');
    
    document.getElementById('selected-count').innerText = checkedBoxes.length;
    
    // YÊU CẦU CỦA BẠN: Hiện thanh công cụ khi tích chọn (Thông thường là từ 1 ví trở lên là dùng được thao tác hàng loạt)
    if (checkedBoxes.length > 0) { 
        // Xóa trạng thái tàng hình -> Hiện ra
        actionBar.classList.remove('translate-y-[150%]', 'opacity-0', 'pointer-events-none'); 
        actionBar.classList.add('translate-y-0', 'opacity-100', 'pointer-events-auto'); 
    } else { 
        // Khi không chọn ví nào (0 ví) -> Trượt xuống và Tàng hình
        actionBar.classList.remove('translate-y-0', 'opacity-100', 'pointer-events-auto'); 
        actionBar.classList.add('translate-y-[150%]', 'opacity-0', 'pointer-events-none'); 
        
        const selectAllBtn = document.getElementById('selectAll');
        if (selectAllBtn) selectAllBtn.checked = false; 
    }
};

// =====================================================================
// KHÓA HÀNG LOẠT (ON-CHAIN + OFF-CHAIN)
// =====================================================================
window.lockSelectedWallets = async function() {
    if (isProcessing) return;
    const checkedBoxes = document.querySelectorAll('#wallet-roles-table-body .row-checkbox:checked');
    if (checkedBoxes.length === 0) return;              
    const selectedAddresses = Array.from(checkedBoxes).map(cb => cb.value);
    
    // Cảnh báo người dùng về việc MetaMask sẽ hỏi nhiều lần
    const { isConfirmed } = await Swal.fire({
        title: 'KHÓA VÍ HÀNG LOẠT',
        html: `Bạn đang khóa <b>${selectedAddresses.length} ví</b>.<br><br><i>Lưu ý: Vì lý do bảo mật Blockchain, MetaMask sẽ bật lên yêu cầu bạn xác nhận giao dịch cho từng ví một. Vui lòng ấn "Xác nhận" liên tục cho đến khi hoàn tất.</i>`,
        icon: 'warning', showCancelButton: true, confirmButtonText: 'Bắt đầu Khóa', cancelButtonText: 'Hủy',
        background: 'var(--panel)', color: 'var(--ink)', confirmButtonColor: 'var(--err)'
    });

    if (!isConfirmed) return;

    isProcessing = true;
    let successCount = 0;
    
    try {
        UI.updateProgress(30, `Đang khóa ${selectedAddresses.length} ví... Vui lòng duyệt trên MetaMask!`, "PROCESSING");
        
        // Vòng lặp khóa từng ví trên Blockchain rồi đồng bộ vào Database
        for (let addr of selectedAddresses) {
            await web3.assignRole(addr, 0); // Lệnh 0 = Tước Quyền (Khóa)
            await ApiService.syncWalletData(addr, { status: 'REVOKED', role: 'BỊ KHÓA' });
            successCount++;
        }
        
        UI.updateProgress(100, "Đã khóa thành công toàn bộ!", "SUCCESS");
        Swal.fire({ title: 'Hoàn tất', text: `Đã khóa thành công ${esc(successCount)} ví.`, icon: 'success', background: 'var(--panel)', color: 'var(--ink)' });
    } catch (err) {
        Swal.fire({ title: 'Bị gián đoạn', text: getShortError(err, 'Quá trình bị hủy do bạn từ chối trên MetaMask.'), icon: 'error', background: 'var(--panel)', color: 'var(--ink)' });
    } finally {
        isProcessing = false;
        window.loadWalletRoles(); 
        document.getElementById('selectAll').checked = false; 
        window.checkSelection();
        setTimeout(() => UI.updateProgress(0, "Hệ thống đang rảnh", "STANDBY"), 3000);
    }
};

// =====================================================================
// MỞ KHÓA HÀNG LOẠT (ON-CHAIN + OFF-CHAIN)
// =====================================================================
window.unlockSelectedWallets = async function() {
    if (isProcessing) return;
    const checkedBoxes = document.querySelectorAll('.row-checkbox:checked');
    if (checkedBoxes.length === 0) return;
    
    const selectedAddresses = Array.from(checkedBoxes).map(cb => cb.value);

    const { isConfirmed } = await Swal.fire({
        title: 'MỞ KHÓA HÀNG LOẠT',
        html: `Bạn sẽ khôi phục <b>Quyền Nhập Liệu</b> cho <b>${selectedAddresses.length} ví</b>.<br><br><i>Hệ thống sẽ gọi MetaMask để ghi đè quyền lên Blockchain.</i>`,
        icon: 'info', showCancelButton: true, confirmButtonText: 'Mở Khóa Ngay', cancelButtonText: 'Hủy',
        background: 'var(--panel)', color: 'var(--ink)', confirmButtonColor: 'var(--ok)'
    });

    if (!isConfirmed) return;

    isProcessing = true;
    let successCount = 0;

    try {
        UI.updateProgress(30, `Đang mở khóa ${selectedAddresses.length} ví... Vui lòng duyệt trên MetaMask!`, "PROCESSING");
        
        for (let addr of selectedAddresses) {
            await web3.assignRole(addr, 1); // Lệnh 1 = Quyền Nhập Liệu (Active)
            await ApiService.syncWalletData(addr, { status: 'ACTIVE', role: 'NHẬP LIỆU' });
            successCount++;
        }
        
        UI.updateProgress(100, "Đã mở khóa thành công!", "SUCCESS");
        Swal.fire({ title: 'Hoàn tất', text: `Đã khôi phục hoạt động cho ${esc(successCount)} ví.`, icon: 'success', background: 'var(--panel)', color: 'var(--ink)' });
    } catch (err) {
        Swal.fire({ title: 'Bị gián đoạn', text: getShortError(err, 'Quá trình bị hủy do bạn từ chối trên MetaMask.'), icon: 'error', background: 'var(--panel)', color: 'var(--ink)' });
    } finally {
        isProcessing = false;
        window.loadWalletRoles(); 
        document.getElementById('selectAll').checked = false; 
        window.checkSelection();
        setTimeout(() => UI.updateProgress(0, "Hệ thống đang rảnh", "STANDBY"), 3000);
    }
};

// =====================================================================
// GỬI THÔNG BÁO HÀNG LOẠT CHO NGƯỜI DÙNG
// =====================================================================
window.sendBulkNotification = async function() {
    if (isProcessing) return;
    const checkedBoxes = document.querySelectorAll('#wallet-roles-table-body .row-checkbox:checked');
    if (checkedBoxes.length === 0) return;
    
    const count = checkedBoxes.length;

    const { value: message } = await Swal.fire({
        title: 'GỬI THÔNG BÁO ĐIỀU HÀNH',
        html: `Soạn tin nhắn gửi tới <b>${esc(count)} nhân viên</b> đã chọn:`,
        input: 'textarea',
        inputAttributes: { autocomplete: 'off' },
        inputPlaceholder: 'Nhập nội dung thông báo (VD: Yêu cầu cập nhật chứng từ tháng này)...',
        showCancelButton: true,
        confirmButtonText: '<i class="fa-solid fa-paper-plane mr-1"></i> Gửi thông báo',
        cancelButtonText: 'Hủy',
        background: 'var(--panel)', color: 'var(--ink)', confirmButtonColor: 'var(--accent)'
    });

    if (message) {
        // Giả lập thời gian gửi qua mạng lưới
        UI.updateProgress(50, `Đang đẩy thông báo đến ${count} tài khoản...`, "PROCESSING");
        
        setTimeout(() => {
            UI.updateProgress(100, "Đã gửi thông báo thành công!", "SUCCESS");
            Swal.fire({
                title: 'Đã gửi!',
                text: `Thông báo đã được đẩy tới ${esc(count)} thiết bị.`,
                icon: 'success',
                background: 'var(--panel)', color: 'var(--ink)',
                timer: 2000, showConfirmButton: false
            });
            
            // Tự động bỏ tích các ô sau khi gửi xong cho gọn gàng
            const selectAllBtn = document.getElementById('selectAll');
            if (selectAllBtn) {
                selectAllBtn.checked = false;
                window.toggleAllCheckboxes(selectAllBtn);
            }
            setTimeout(() => UI.updateProgress(0, "Hệ thống đang rảnh", "STANDBY"), 2000);
        }, 1000);
    }
};
// =====================================================================
// BẢNG MODAL CHI TIẾT TÀI LIỆU CỦA VÍ (Đã thêm nút Tải & Giải mã)
// =====================================================================
window.openStorageModal = async function(walletAddress) {
    const modal = document.getElementById('storage-modal-overlay'); 
    const tbody = document.getElementById('storage-modal-tbody');
    
    let wallets = await ApiService.getAllWallets();
    let w = wallets.find(x => x.address && x.address.toLowerCase() === walletAddress.toLowerCase());
    let roleName = w ? w.role : 'KHÔNG RÕ';
    let isAdmin = roleName === 'ADMIN';

    document.getElementById('storage-modal-wallet').innerText = walletAddress;
    const roleSpan = document.getElementById('storage-modal-role');
    if (roleSpan) {
        roleSpan.innerText = roleName;
        roleSpan.className = isAdmin ? "text-warn font-bold text-[10px] bg-warn-soft px-2 py-0.5 rounded border border-warn inline-block" : "text-accent font-bold text-[10px] bg-accent-soft px-2 py-0.5 rounded border border-accent-line inline-block";
    }
    
    modal.classList.remove('hidden');
    tbody.innerHTML = '<tr><td colspan="5" class="px-4 py-10 text-center text-accent"><i class="fa-solid fa-circle-notch fa-spin me-2"></i> Đang trích xuất dữ liệu sổ cái...</td></tr>';
    
    try {
        let html = ''; let stt = 1;
        const seenDocIds = new Set(); // chống 1 docId render 2 dòng (on-chain + MongoDB)

        // Tra metadata MongoDB trước để bổ sung dung lượng cho dòng on-chain
        const localBatches = await ApiService.getBatchesFromDatabase();
        const mongoByDocId = {};
        for (const b of localBatches) for (const f of (b.files || [])) mongoByDocId[f.docId] = f;

        // Map docId -> orgName: nhận diện tài liệu ĐỐI TÁC đang nằm trong sổ cái
        // của ví server (uploader = ADMIN). Áp cùng luật với sổ cái chính:
        // chỉ ví ADMIN thấy; không ai mở nội dung ngoài tổ chức sở hữu key.
        const partnerOrgs = await ApiService.getPartnerDocs();
        const myAddr = (web3.currentAccount || '').toLowerCase();
        const isAdminViewer = window.__isAdminWallet === true;
        // File private chỉ chủ ví mở — kể cả ADMIN xem hồ sơ ví khác cũng chỉ thấy khóa
        const lockChip = `<span class="ml-2 text-faint text-[11px] uppercase font-bold bg-sunken px-2 py-1 rounded border border-line-strong" title="Tài liệu riêng tư — chỉ người tải lên xem được"><i class="fa-solid fa-lock mr-1"></i>Riêng tư</span>`;
        const partnerChip = `<span class="ml-2 text-warn text-[11px] uppercase font-bold bg-warn-soft px-2 py-1 rounded border border-warn" title="Chỉ tổ chức sở hữu API key tải về tại cổng /partner"><i class="fa-solid fa-lock mr-1"></i>Chỉ tổ chức mở được</span>`;
        const locked = (docUploader, vis) => (vis || 'private') !== 'public' && docUploader.toLowerCase() !== myAddr;

        // Lấy file đơn lẻ (On-chain)
        const events = await web3.queryHistory();
        if (events && events.length > 0) {
            for (let ev of [...events].reverse()) {
                const docId = ev.args[0];
                if (seenDocIds.has(docId)) continue;
                let uploader = '---'; let createTime = '---'; let isRevoked = false; let ipfsLink = '';

                try {
                    const docData = await web3.getDocumentFromChain(docId);
                    uploader = docData[3];
                    createTime = new Date(Number(docData[2]) * 1000).toLocaleString('vi-VN');
                    isRevoked = docData[4];
                    ipfsLink = docData[1].replace('ipfs://', '');
                } catch (e) {}

                if (uploader.toLowerCase() === walletAddress.toLowerCase()) {
                    seenDocIds.add(docId);
                    const org = partnerOrgs[docId];
                    if (org && !isAdminViewer) continue; // doc đối tác: không phải ADMIN → ẩn luôn
                    const mongoFile = mongoByDocId[docId];
                    const sizeText = (mongoFile && mongoFile.fileSize) || '---';
                    let fileName = docId.replace(/_\d+$/, '').replace(/\.enc$/, '');
                    const statusBadge = isRevoked ? '<span class="bg-err-soft text-err px-2 py-1 rounded text-[10px] font-bold">BỊ THU HỒI</span>' : '<span class="bg-ok-soft text-ok px-2 py-1 rounded text-[10px] font-bold uppercase">HỢP LỆ</span>';
                    const orgBadge = org ? `<div class="mt-1">${window.partnerBadge(partnerOrgs, docId)}</div>` : '';

                    // Nút xem/tải: thu hồi → ẩn; doc đối tác → khóa tổ chức; private của ví khác → khóa
                    const downloadBtn = isRevoked ? '' : org ? partnerChip : locked(uploader, mongoFile && mongoFile.visibility) ? lockChip
                        : `<button data-act="preview" data-v="${esc(ipfsLink)}" data-name="${esc(fileName)}" data-id="${esc(docId)}" class="ml-2 text-ok hover:text-ok text-[11px] bg-ok-soft px-2 py-1 rounded border border-ok transition" title="Xem trực tiếp"><i class="fa-solid fa-eye mr-1"></i> Xem</button><button data-act="decrypt" data-v="${esc(ipfsLink)}" data-name="${esc(fileName)}" data-id="${esc(docId)}" class="ml-2 text-accent hover:text-accent text-[11px] bg-accent-soft px-2 py-1 rounded border border-accent-line transition" title="Tải & Giải mã"><i class="fa-solid fa-download mr-1"></i> Tải về</button>`;

                    html += `
                    <tr class="border-b border-line hover:bg-hover transition ${isRevoked ? 'opacity-50' : ''}">
                        <td class="px-3 py-2 font-bold text-center text-faint">${stt++}</td>
                        <td class="px-3 py-2 font-mono text-accent text-xs">
                        <div class="flex items-center">
                        <span class="truncate max-w-[120px]" title="${esc(docId)}">${esc(docId)}</span>
                        <button data-act="copy" data-v="${esc(docId)}" class="ml-2 text-muted hover:text-ink"><i class="fa-regular fa-copy"></i></button>
                        </div>
                        <div class="mt-1 text-[11px] text-muted font-sans truncate max-w-[150px]" title="${esc(fileName)}">File: ${esc(fileName)}</div>
                        ${orgBadge}
                        </td>
                        <td class="px-3 py-2 text-left font-mono text-[11px] text-soft">${esc(sizeText)}</td>
                        <td class="px-3 py-2 text-xs text-muted">${esc(createTime)}</td>
                        <td class="px-3 py-2 text-center flex justify-center items-center">
                            ${statusBadge} ${downloadBtn}
                        </td>
                    </tr>`;
                }
            }
        }

        // Lấy file tải hàng loạt trong lô Batch — bỏ qua docId đã có từ on-chain
        for (let batch of [...localBatches].reverse()) {
            if (batch.uploader.toLowerCase() === walletAddress.toLowerCase()) {
                const createTime = new Date(batch.timestamp).toLocaleString('vi-VN');
                batch.files.forEach(fileDoc => {
                    if (seenDocIds.has(fileDoc.docId)) return;
                    seenDocIds.add(fileDoc.docId);
                    const isRevoked = fileDoc.isRevoked;
                    const statusBadge = isRevoked ? '<span class="bg-err-soft text-err px-2 py-1 rounded text-[10px] font-bold">BỊ THU HỒI</span>' : '<span class="bg-ok-soft text-ok px-2 py-1 rounded text-[10px] font-bold uppercase">HỢP LỆ</span>';

                    // Nút xem/tải: thu hồi → ẩn; private của ví khác → khóa (kể cả ADMIN)
                    const downloadBtn = isRevoked ? '' : locked(batch.uploader, fileDoc.visibility) ? lockChip
                        : `<button data-act="preview" data-v="${esc(fileDoc.ipfsCID)}" data-name="${esc(fileDoc.fileName)}" data-id="${esc(fileDoc.docId)}" class="ml-2 text-ok hover:text-ok text-[11px] bg-ok-soft px-2 py-1 rounded border border-ok transition" title="Xem trực tiếp"><i class="fa-solid fa-eye mr-1"></i> Xem</button><button data-act="decrypt" data-v="${esc(fileDoc.ipfsCID)}" data-name="${esc(fileDoc.fileName)}" data-id="${esc(fileDoc.docId)}" class="ml-2 text-accent hover:text-accent text-[11px] bg-accent-soft px-2 py-1 rounded border border-accent-line transition" title="Tải & Giải mã"><i class="fa-solid fa-download mr-1"></i> Tải về</button>`;

                    html += `
                    <tr class="border-b border-line hover:bg-hover transition ${isRevoked ? 'opacity-50' : ''}">
                        <td class="px-3 py-2 font-bold text-center text-faint">${stt++}</td>
                        <td class="px-3 py-2 font-mono text-accent text-xs">
                        <div class="flex items-center">
                            <span class="truncate max-w-[120px]" title="${esc(fileDoc.docId)}">${esc(fileDoc.docId)}</span>
                            <button data-act="copy" data-v="${esc(fileDoc.docId)}" class="ml-2 text-muted hover:text-ink"><i class="fa-regular fa-copy"></i></button>
                            </div>
                        </td>
                        <td class="px-3 py-2 text-left font-mono text-[11px] text-soft">${esc(fileDoc.fileSize || '---')}</td>
                        <td class="px-3 py-2 text-xs text-muted">${esc(createTime)}</td>
                        <td class="px-3 py-2 text-center flex justify-center items-center">
                            ${statusBadge} ${downloadBtn}
                        </td>
                    </tr>`;
                });
            }
        }
        
        tbody.innerHTML = html === '' ? '<tr><td colspan="5" class="px-4 py-10 text-center text-faint">Ví này chưa tải lên tài liệu nào.</td></tr>' : html;
    } catch (error) {
        tbody.innerHTML = '<tr><td colspan="5" class="px-4 py-10 text-center text-err">Lỗi khi truy xuất Blockchain. Hãy chắc chắn bạn đã kết nối ví.</td></tr>';
    }
};
// =====================================================================
// TÍNH NĂNG TẢI VỀ VÀ GIẢI MÃ TÀI LIỆU (VƯỢT TƯỜNG LỬA CORS)
// =====================================================================
// Lấy khóa giải mã: ưu tiên key escrow trên server (public: mọi ví đăng
// nhập; private: chỉ uploader — kể cả ADMIN không mở được file người khác),
// tài liệu cũ chưa có key lưu trữ thì fallback hỏi mật khẩu như trước.
async function resolveDocKey(docId, originalFileName) {
    if (docId) {
        try {
            await ApiService.ensureAuth(web3.signer, web3.currentAccount);
            const k = await ApiService.getDocumentKey(docId);
            if (k) return k;
        } catch (e) { /* không có quyền/chưa login → hỏi mật khẩu thủ công */ }
    }
    const { value: secretKey } = await Swal.fire({
        title: 'GIẢI MÃ TÀI LIỆU',
        text: `Tài liệu "${esc(originalFileName)}" đang được mã hóa. Vui lòng nhập khóa bí mật (AES-256):`,
        input: 'password',
        inputAttributes: { autocomplete: 'new-password' },
        inputPlaceholder: 'Nhập mật khẩu...',
        background: 'var(--panel)', color: 'var(--ink)',
        confirmButtonColor: 'var(--ok)', showCancelButton: true, cancelButtonText: 'Hủy'
    });
    return secretKey || null;
}

// Bước 1: chỉ TẢI ciphertext từ IPFS (nhiều gateway dự phòng)
async function fetchEncryptedText(ipfsCID) {
    let response = null;

    // ĐƯỜNG DẪN GỐC TỚI CỔNG VIP CỦA BẠN TRÊN PINATA
    const pinataUrl = `https://azure-above-donkey-104.mypinata.cloud/ipfs/${ipfsCID}`;

    // 1. Thử lấy trực tiếp (Sẽ bị Block nếu chạy ở Localhost)
    try { response = await fetch(pinataUrl); } catch (e) {}

    // 2. VƯỢT TƯỜNG LỬA: Dùng API AllOrigins để ép trình duyệt nhả file
    if (!response || !response.ok) {
        const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(pinataUrl)}`;
        try { response = await fetch(proxyUrl); } catch (e) {}
    }

    // 3. Dự phòng 2: Trạm Cloudflare đi qua Proxy
    if (!response || !response.ok) {
        const fallbackUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent('https://cloudflare-ipfs.com/ipfs/' + ipfsCID)}`;
        try { response = await fetch(fallbackUrl); } catch (e) {}
    }

    // 4. Lỗi thực sự nếu cả 3 cách đều thất bại
    if (!response || !response.ok) {
        throw new Error("SYNC_DELAY");
    }

    return await response.text();
}

// Bước 2: giải mã AES → Blob gốc (tách riêng để nhập lại khóa không phải tải lại file)
function decryptToBlob(encryptedText, secretKey, originalFileName) {
    UI.updateProgress(70, "Đã vượt tường lửa lấy được tệp. Đang giải mã...", "DECRYPTING");

    const decryptedBytes = CryptoJS.AES.decrypt(encryptedText, secretKey);
    const base64File = decryptedBytes.toString(CryptoJS.enc.Utf8);

    if (!base64File) throw new Error("WRONG_PASSWORD");

    UI.updateProgress(90, "Đang khôi phục định dạng...", "PROCESSING");
    const binaryString = atob(base64File);
    const uint8Array = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        uint8Array[i] = binaryString.charCodeAt(i);
    }

    let mimeType = "application/octet-stream";
    const fname = (originalFileName || '').toLowerCase();
    if (fname.endsWith('.pdf')) mimeType = "application/pdf";
    else if (fname.endsWith('.png')) mimeType = "image/png";
    else if (fname.endsWith('.jpg') || fname.endsWith('.jpeg')) mimeType = "image/jpeg";
    else if (fname.endsWith('.txt') || fname.endsWith('.csv')) mimeType = "text/plain";
    else if (fname.endsWith('.docx')) mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

    return { blob: new Blob([uint8Array], { type: mimeType }), mimeType };
}

// Tải ciphertext 1 lần rồi giải mã — sai khóa cho nhập lại tối đa 3 lần
// (khóa escrow có thể không khớp nếu tệp từng được tải lên với khóa khác)
async function retrieveDecryptedBlob(ipfsCID, secretKey, originalFileName) {
    const encryptedText = await fetchEncryptedText(ipfsCID);
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            return decryptToBlob(encryptedText, secretKey, originalFileName);
        } catch (e) {
            if (e.message !== 'WRONG_PASSWORD' || attempt === 2) throw e;
            const { value: retryKey } = await Swal.fire({
                title: 'Sai Khóa Giải Mã',
                text: 'Khóa không khớp với tệp này. Nếu tệp được mã hóa bằng khóa khác lúc tải lên, hãy nhập khóa đó:',
                input: 'password',
                inputAttributes: { autocomplete: 'new-password' },
                inputPlaceholder: 'Nhập lại khóa AES...',
                background: 'var(--panel)', color: 'var(--ink)',
                confirmButtonColor: 'var(--ok)', showCancelButton: true, cancelButtonText: 'Hủy'
            });
            if (!retryKey) throw e;
            secretKey = retryKey;
        }
    }
}

// Tải file về máy bằng anchor download — KHÔNG dùng window.open sau await
// vì trình duyệt chặn popup khi đã hết "user activation".
function saveBlob(blob, fileName) {
    const fileURL = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = fileURL;
    a.download = fileName || 'document';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(fileURL), 60000);
}

const INVALID_CID_MSG = 'Tài liệu này thiếu mã IPFS CID (thường do đây là bản nháp cũ). Vui lòng tải lên lại tài liệu này.';
const cidInvalid = (c) => !c || c === 'undefined' || c === 'null';

// XEM TRỰC TIẾP: mở tab trắng ĐỒNG BỘ ngay khi click (né popup-blocker),
// rồi decrypt và điều hướng tab đó tới blob URL sau.
window.previewDocument = async (ipfsCID, originalFileName, docId) => {
    const win = window.open('', '_blank');
    if (!win) return window.downloadAndDecrypt(ipfsCID, originalFileName, docId); // popup bị chặn → tải về

    if (cidInvalid(ipfsCID)) { win.close(); return Swal.fire({ title: 'Dữ Liệu Không Hợp Lệ', text: INVALID_CID_MSG, icon: 'error', background: 'var(--panel)', color: 'var(--ink)' }); }
    if (isProcessing) { win.close(); return; }

    isProcessing = true;
    UI.updateProgress(30, "Đang lấy khóa và tải tệp để xem trước...", "PREVIEWING");
    try {
        const secretKey = await resolveDocKey(docId, originalFileName);
        if (!secretKey) { win.close(); isProcessing = false; return; }

        const { blob, mimeType } = await retrieveDecryptedBlob(ipfsCID, secretKey, originalFileName);
        const url = URL.createObjectURL(blob);
        if (/^(application\/pdf|image\/|text\/)/.test(mimeType)) {
            win.location = url; // trình duyệt render PDF/ảnh/text trực tiếp
        } else if ((originalFileName || '').toLowerCase().endsWith('.docx')) {
            // DOCX: trình duyệt không đọc được → render gần form Word bằng docx-preview
            const arrayBuffer = await blob.arrayBuffer();
            win.document.open();
            win.document.write(`<!DOCTYPE html><html lang="vi"><head><meta charset="utf-8">
                <title>${esc(originalFileName)}</title>
                <style>
                    body { margin: 0; background: #525659; }
                    .bdi-banner { position: sticky; top: 0; font-family: system-ui, sans-serif; font-size: 12px; color: #d1d5db; background: #111827; padding: 10px 20px; display:flex; justify-content:space-between; z-index: 99; }
                    .bdi-banner b { color:#10b981; }
                    .docx-wrapper { background: #525659; }
                </style>
            </head><body>
                <div class="bdi-banner"><span>🔐 Xem trước tài liệu đã giải mã — <b>${esc(originalFileName)}</b></span><span>DataIntegrity</span></div>
                <div id="docx-view"></div>
            </body></html>`);
            win.document.close();
            // Nạp lib vào tab con (script chạy trong context tab → docx render đúng document).
            // Server chỉ serve /assets → nguồn chính là assets/vendor, fallback CDN pin đúng version.
            const loadLib = (srcs) => new Promise((res, rej) => {
                const tryNext = (i) => {
                    if (i >= srcs.length) return rej(new Error('Không tải được thư viện xem DOCX'));
                    const s = win.document.createElement('script');
                    s.src = srcs[i];
                    s.onload = res;
                    s.onerror = () => tryNext(i + 1);
                    win.document.head.appendChild(s);
                };
                tryNext(0);
            });
            await loadLib([
                `${location.origin}/assets/vendor/jszip.min.js`,
                'https://cdn.jsdelivr.net/npm/jszip@3.10.2/dist/jszip.min.js'
            ]);
            await loadLib([
                `${location.origin}/assets/vendor/docx-preview.min.js`,
                'https://cdn.jsdelivr.net/npm/docx-preview@0.4.1/dist/docx-preview.min.js'
            ]);
            await win.docx.renderAsync(arrayBuffer, win.document.getElementById('docx-view'), null, {
                className: 'docx-wrapper', inWrapper: true, breakPages: true
            });
        } else {
            win.close();
            saveBlob(blob, originalFileName); // định dạng không xem được → tải về
        }
        UI.updateProgress(100, "Truy xuất thành công!", "SUCCESS");
    } catch (error) {
        win.close();
        handleRetrieveError(error);
    } finally {
        isProcessing = false;
        setTimeout(() => UI.updateProgress(0, "Hệ thống đang rảnh", "STANDBY"), 3000);
    }
};

window.downloadAndDecrypt = async (ipfsCID, originalFileName, docId) => {
    if (cidInvalid(ipfsCID)) {
        return Swal.fire({ title: 'Dữ Liệu Không Hợp Lệ', text: INVALID_CID_MSG, icon: 'error', background: 'var(--panel)', color: 'var(--ink)' });
    }
    if (isProcessing) return;

    const secretKey = await resolveDocKey(docId, originalFileName);
    if (!secretKey) return;

    isProcessing = true;
    UI.updateProgress(30, "Đang kết nối qua trạm trung chuyển...", "DOWNLOADING");
    try {
        const { blob } = await retrieveDecryptedBlob(ipfsCID, secretKey, originalFileName);
        saveBlob(blob, originalFileName);
        UI.updateProgress(100, "Truy xuất thành công!", "SUCCESS");
        Swal.fire({
            title: `Đã giải mã "${esc(originalFileName)}"`,
            toast: true, position: 'top-end', timer: 2200, showConfirmButton: false,
            icon: 'success', background: 'var(--panel)', color: 'var(--ink)'
        });
    } catch (error) {
        handleRetrieveError(error);
    } finally {
        isProcessing = false;
        setTimeout(() => UI.updateProgress(0, "Hệ thống đang rảnh", "STANDBY"), 3000);
    }
};

function handleRetrieveError(error) {
    UI.updateProgress(0, "Truy xuất thất bại.", "ERROR");
    if (error.message === "SYNC_DELAY") {
        Swal.fire({ title: 'Lỗi Kết Nối', text: 'Mạng IPFS không phản hồi. Vui lòng kiểm tra lại đường truyền internet.', icon: 'error', background: 'var(--panel)', color: 'var(--ink)' });
    } else if (error.message === "WRONG_PASSWORD") {
        Swal.fire({ title: 'Sai Mật Khẩu!', text: 'Mật khẩu giải mã không chính xác.', icon: 'error', background: 'var(--panel)', color: 'var(--ink)' });
    } else {
        Swal.fire({ title: 'Lỗi', text: esc(error?.message || String(error)), icon: 'error', background: 'var(--panel)', color: 'var(--ink)' });
    }
}
window.closeStorageModal = function() { document.getElementById('storage-modal-overlay').classList.add('hidden'); };