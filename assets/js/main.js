import { UI } from './uiHandler.js';
import { Web3Service } from './web3Service.js';
import { ApiService } from './apiService.js';
import { esc } from './sanitize.js';

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
        case 'decrypt':         window.downloadAndDecrypt(d.v, d.name || 'document', d.id); break;
        case 'preview':         window.previewDocument(d.v, d.name || 'document', d.id); break;
        case 'locked':          Swal.fire({ toast: true, position: 'top-end', icon: 'info', title: 'Tài liệu riêng tư — chỉ người tải lên và Admin xem được', background: '#111827', color: '#fff', timer: 2500, showConfirmButton: false }); break;
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
    }
});
document.addEventListener('change', (e) => {
    if (e.target.matches('.row-checkbox')) window.checkSelection();
});

// =====================================================================
// THÔNG BÁO & PHIÊN ĐĂNG NHẬP THEO THIẾT BỊ
// =====================================================================
const NOTIF_ICON = {
    new_device: { icon: 'fa-triangle-exclamation', cls: 'text-yellow-400' },
    new_wallet: { icon: 'fa-user-plus', cls: 'text-purple-400' },
    device_pending: { icon: 'fa-clock', cls: 'text-orange-400' },
    device_approved: { icon: 'fa-circle-check', cls: 'text-emerald-400' },
    doc_revoked: { icon: 'fa-ban', cls: 'text-red-400' },
    session_revoked: { icon: 'fa-shield-halved', cls: 'text-blue-400' },
    system: { icon: 'fa-circle-info', cls: 'text-gray-400' }
};

async function refreshNotifBadge() {
    if (!ApiService.hasValidToken()) return;
    const { unread } = await ApiService.getNotifications();
    const badge = document.getElementById('notif-badge');
    if (!badge) return;
    badge.textContent = unread > 99 ? '99+' : unread;
    badge.classList.toggle('hidden', !unread);
    badge.classList.toggle('flex', !!unread);
}

async function renderNotifPanel() {
    const listEl = document.getElementById('notif-list');
    const sessEl = document.getElementById('session-list');
    if (!listEl || !sessEl) return;
    listEl.innerHTML = '<div class="px-4 py-6 text-center text-gray-600 text-xs">Đang tải...</div>';

    const [{ notifications }, { sessions }] = await Promise.all([
        ApiService.getNotifications(), ApiService.getSessions()
    ]);

    listEl.innerHTML = notifications.length === 0
        ? '<div class="px-4 py-6 text-center text-gray-600 text-xs">Chưa có thông báo nào.</div>'
        : notifications.map(n => {
            const ic = NOTIF_ICON[n.type] || NOTIF_ICON.system;
            return `<div class="px-4 py-3 ${n.read ? 'opacity-60' : 'bg-blue-900/10'}">
                <div class="flex items-start gap-2.5">
                    <i class="fa-solid ${ic.icon} ${ic.cls} mt-0.5 text-xs"></i>
                    <div class="flex-1 min-w-0">
                        <div class="text-xs font-bold text-gray-200">${esc(n.title)}</div>
                        <div class="text-[11px] text-gray-400 mt-0.5 break-words">${esc(n.message)}</div>
                        <div class="text-[10px] text-gray-600 mt-1">${esc(window.formatTimeForce(n.createdAt))}</div>
                    </div>
                    ${n.read ? '' : '<span class="w-2 h-2 rounded-full bg-blue-500 mt-1.5 shrink-0"></span>'}
                </div>
            </div>`;
        }).join('');

    const myDev = ApiService.getDeviceId();
    sessEl.innerHTML = sessions.length === 0
        ? '<div class="text-[11px] text-gray-600">Không có phiên nào.</div>'
        : sessions.map(s => {
            const isPending = s.status === 'pending';
            const actions = s.current ? '' : isPending
                ? `<div class="flex gap-1.5 shrink-0">
                       <button data-act="approve-session" data-v="${esc(s.deviceId)}" class="text-[10px] font-bold text-emerald-400 hover:text-emerald-300 bg-emerald-900/20 border border-emerald-900/50 px-2 py-1 rounded transition">Duyệt</button>
                       <button data-act="kick-session" data-v="${esc(s.deviceId)}" class="text-[10px] font-bold text-red-400 hover:text-red-300 bg-red-900/20 border border-red-900/50 px-2 py-1 rounded transition">Từ chối</button>
                   </div>`
                : `<button data-act="kick-session" data-v="${esc(s.deviceId)}" class="text-[10px] font-bold text-red-400 hover:text-red-300 bg-red-900/20 border border-red-900/50 px-2 py-1 rounded transition shrink-0">Thu hồi</button>`;
            return `<div class="flex items-center justify-between bg-gray-900/50 border ${isPending ? 'border-orange-900/50' : 'border-gray-800'} rounded-lg px-3 py-2">
                <div class="min-w-0">
                    <div class="text-[11px] font-bold text-gray-300 truncate">${esc(s.deviceLabel)}${s.current ? ' <span class="text-emerald-400 text-[9px]">(thiết bị này)</span>' : ''}</div>
                    <div class="text-[10px] ${isPending ? 'text-orange-400' : 'text-gray-600'}">${isPending ? 'Chờ phê duyệt' : 'Hoạt động'}: ${esc(window.formatTimeForce(s.lastSeen))}</div>
                </div>
                ${actions}
            </div>`;
        }).join('');
}

window.kickDeviceSession = async (deviceId) => {
    const ok = await Swal.fire({
        title: 'Thu hồi phiên?', text: 'Thiết bị này sẽ bị đăng xuất ngay và phải ký lại MetaMask để vào.',
        icon: 'warning', showCancelButton: true, confirmButtonText: 'Thu hồi', cancelButtonText: 'Hủy',
        background: '#111827', color: '#fff', confirmButtonColor: '#dc2626'
    });
    if (!ok.isConfirmed) return;
    try {
        await ApiService.revokeSession(deviceId);
        Swal.fire({ title: 'Đã thu hồi', text: 'Phiên trên thiết bị đó đã bị vô hiệu hóa.', icon: 'success', background: '#111827', color: '#fff', timer: 1500, showConfirmButton: false });
        renderNotifPanel();
    } catch (e) {
        Swal.fire({ title: 'Thất bại', text: getShortError(e), icon: 'error', background: '#111827', color: '#fff' });
    }
};

// Duyệt thiết bị đang pending — thiết bị kia sẽ tự vào được ở lần poll kế tiếp
window.approveDeviceSession = async (deviceId) => {
    const ok = await Swal.fire({
        title: 'Phê duyệt thiết bị?', text: 'Thiết bị này sẽ được cấp quyền đăng nhập vào ví của bạn.',
        icon: 'question', showCancelButton: true, confirmButtonText: 'Phê duyệt', cancelButtonText: 'Hủy',
        background: '#111827', color: '#fff', confirmButtonColor: '#059669'
    });
    if (!ok.isConfirmed) return;
    try {
        await ApiService.approveSession(deviceId);
        Swal.fire({ title: 'Đã phê duyệt', text: 'Thiết bị đó giờ có thể đăng nhập.', icon: 'success', background: '#111827', color: '#fff', timer: 1500, showConfirmButton: false });
        renderNotifPanel();
    } catch (e) {
        Swal.fire({ title: 'Thất bại', text: getShortError(e), icon: 'error', background: '#111827', color: '#fff' });
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
    listEl.innerHTML = '<div class="px-4 py-6 text-center text-gray-600 text-xs">Đang tải...</div>';
    const wallets = await ApiService.getPendingWallets();
    if (wallets === null) {
        listEl.innerHTML = '<div class="px-4 py-6 text-center text-gray-600 text-xs">Chỉ ADMIN mới xem được.</div>';
        return;
    }
    listEl.innerHTML = wallets.length === 0
        ? '<div class="px-4 py-6 text-center text-gray-600 text-xs">Không có ví nào đang chờ.</div>'
        : wallets.map(w => {
            const contact = [w.email, w.phone].filter(Boolean).join(' · ') || 'Chưa điền liên hệ';
            const time = w.lastActive ? new Date(w.lastActive).toLocaleString('vi-VN') : '—';
            return `
            <div class="px-4 py-3">
                <div class="flex items-start justify-between gap-2">
                    <div class="min-w-0 flex-1">
                        <div class="text-sm font-bold text-white truncate">${esc(w.alias || '— chưa đặt tên —')}</div>
                        <div class="flex items-center gap-1.5 mt-0.5">
                            <span class="font-mono text-[11px] text-blue-400 truncate">${esc(w.address)}</span>
                            <button data-act="copy" data-v="${esc(w.address)}" class="text-gray-500 hover:text-white text-[11px] shrink-0" title="Copy địa chỉ ví"><i class="fa-regular fa-copy"></i></button>
                        </div>
                        <div class="text-[10px] text-gray-500 mt-1 truncate">${esc(contact)}</div>
                        <div class="text-[10px] mt-0.5">
                            <span class="text-amber-400 font-bold">Muốn quyền: ${esc(w.requestedRole || 'chưa chọn')}</span>
                            <span class="text-gray-600"> · ${time}</span>
                        </div>
                    </div>
                    <div class="flex flex-col gap-1.5 shrink-0">
                        <button data-act="approve-pending" data-v="${esc(w.address)}" data-alias="${esc(w.alias || '')}" data-role="${esc(w.requestedRole || '')}" class="bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold px-3 py-1.5 rounded-lg transition">Duyệt</button>
                        <button data-act="reject-pending" data-v="${esc(w.address)}" data-alias="${esc(w.alias || '')}" class="bg-red-900/40 hover:bg-red-800/60 text-red-300 border border-red-800/60 text-[11px] font-bold px-3 py-1.5 rounded-lg transition">Từ chối</button>
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
        box?.classList.add('ring-2', 'ring-emerald-400/70', 'rounded-xl');
        setTimeout(() => box?.classList.remove('ring-2', 'ring-emerald-400/70', 'rounded-xl'), 2500);
        addrEl?.focus();
    }, 120);
    Swal.fire({ toast: true, position: 'top-end', icon: 'info', title: `Đã điền thông tin ví ${alias || address.slice(0,10)+'…'} — chọn quyền rồi bấm Thực thi`, background: '#111827', color: '#fff', timer: 3000, showConfirmButton: false });
};

// Từ chối ví chờ: khóa ví trong DB (status REVOKED) — biến mất khỏi khay chờ,
// hiện trong bảng Quản Lý Ví ở trạng thái TẠM KHÓA, và ví kia thấy "đã bị từ chối"
window.rejectPendingWallet = async function(address, alias) {
    const cf = await Swal.fire({
        title: 'Từ chối ví này?',
        html: `Ví <b>${esc(alias || '')}</b><br><span class="font-mono text-xs">${esc(address)}</span><br>sẽ bị khóa và phải liên hệ Admin để được xem xét lại.`,
        icon: 'warning', showCancelButton: true, confirmButtonText: 'Từ chối', cancelButtonText: 'Hủy',
        confirmButtonColor: '#dc2626', background: '#111827', color: '#fff'
    });
    if (!cf.isConfirmed) return;
    try {
        await ApiService.rejectWallet(address);
        await renderPendingPanel();
        refreshPendingBadge();
        Swal.fire({ title: 'Đã từ chối', icon: 'success', timer: 1500, showConfirmButton: false, background: '#111827', color: '#fff' });
    } catch (e) {
        Swal.fire({ title: 'Thất bại', text: getShortError(e), icon: 'error', background: '#111827', color: '#fff' });
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
UI.updateProgress = function(percent, message, status) {
    if (originalUpdateProgress) {
        originalUpdateProgress.call(UI, percent, message, status);
    }

    const consoleBox = document.getElementById('consoleBox');
    if (consoleBox && message) {
        if (percent === 0 && message === "Hệ thống đang rảnh") return;
        const time = new Date().toLocaleTimeString('vi-VN');
        let colorClass = 'text-gray-400';
        if (status === 'SUCCESS' || status === 'VERIFIED') colorClass = 'text-emerald-400 font-bold';
        else if (status === 'FAILED' || status === 'ERROR' || status === 'REVOKED') colorClass = 'text-red-400 font-bold';
        else if (status === 'SCANNING' || status === 'ANALYZING') colorClass = 'text-yellow-400';
        else colorClass = 'text-blue-300';

        const logEntry = document.createElement('div');
        logEntry.className = `mb-1.5 ${colorClass} font-mono text-[11px] leading-relaxed`;
        logEntry.innerHTML = `<span class="text-gray-600">[${time}]</span> >${esc(message)}`;

        consoleBox.appendChild(logEntry);
        consoleBox.scrollTop = consoleBox.scrollHeight; 
    }
};

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
        inputValue: currentAlias && currentAlias !== 'null' ? currentAlias : '',
        inputPlaceholder: 'VD: User 1, Kế toán trưởng, Nguyễn Văn A...',
        showCancelButton: true,
        confirmButtonText: 'Lưu Tên',
        cancelButtonText: 'Hủy',
        background: '#111827', color: '#fff', confirmButtonColor: '#3b82f6'
    });
    if (newAlias !== undefined) {
        await ApiService.syncWalletData(address, { alias: newAlias.trim() });
        window.loadWalletRoles(); // Load lại bảng Ví
        if (typeof loadTransactionHistory === 'function') loadTransactionHistory(); // Load lại Sổ cái
        Swal.fire({ title: 'Thành công', text: 'Đã cập nhật danh bạ ví.', icon: 'success', background: '#111827', color: '#fff', timer: 1500, showConfirmButton: false });
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
    let displayName = (w && w.alias) ? `<span class="font-bold text-white">${esc(w.alias)}</span> <span class="text-[9px] text-gray-500">(${esc(shortAddr)})</span>` : esc(shortAddr);

    if (target === adminAddr) {
        return `<span class="text-yellow-500 font-bold bg-yellow-900/20 px-1.5 py-0.5 rounded border border-yellow-900/50 mr-1 text-[9px] uppercase">Admin</span><span class="text-gray-400 font-mono">${displayName}</span>`;
    }
    
    return `<span class="text-blue-400 font-mono bg-blue-900/10 px-1.5 py-0.5 rounded border border-blue-900/30">${displayName}</span>`;
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
                timer: 2000, background: '#0b0f19', color: '#fff' 
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

window.filterHistoryTable = () => {
    const input = document.getElementById('search-history-input')?.value.toLowerCase().trim() || '';
    const rows = document.querySelectorAll('#history-table-body tr');
    rows.forEach(row => { row.style.display = matchTableRow(row, input) ? '' : 'none'; });
};

window.filterRevokedTable = () => {
    const input = document.getElementById('search-revoked-input')?.value.toLowerCase().trim() || '';
    const rows = document.querySelectorAll('#revoked-table-body tr');
    rows.forEach(row => { row.style.display = matchTableRow(row, input) ? '' : 'none'; });
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
    const attachDropZone = (zone, input, accent) => {
        if (!zone || !input) return;
        const on = () => { zone.classList.add(accent, 'bg-[#1f2937]'); };
        const off = () => { zone.classList.remove(accent, 'bg-[#1f2937]'); };
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
        uploadDropZone.addEventListener('click', (e) => { if (e.target !== uploadFileInput) uploadFileInput.click(); });
        uploadFileInput.addEventListener('click', (e) => e.stopPropagation());
        uploadFileInput.addEventListener('change', () => UI.updateFileName('uploadFile'));
        attachDropZone(uploadDropZone, uploadFileInput, 'border-blue-500');
    }

    const verifyDropZone = document.getElementById('verifyDropZone');
    const verifyFileInput = document.getElementById('verifyFile');
    if (verifyDropZone && verifyFileInput) {
        verifyDropZone.addEventListener('click', (e) => { if (e.target !== verifyFileInput) verifyFileInput.click(); });
        verifyFileInput.addEventListener('click', (e) => e.stopPropagation());
        verifyFileInput.addEventListener('change', () => UI.updateFileName('verifyFile'));
        attachDropZone(verifyDropZone, verifyFileInput, 'border-emerald-500');
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
        contactBtn.classList.toggle('bg-emerald-600', !saved);
        contactBtn.classList.toggle('hover:bg-emerald-500', !saved);
        contactBtn.classList.toggle('bg-slate-600', saved);
        contactBtn.classList.toggle('hover:bg-slate-500', saved);
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
            Swal.fire({ title: 'Email không hợp lệ', icon: 'warning', background: '#111827', color: '#fff', timer: 1500, showConfirmButton: false });
            return;
        }
        if (phone && !/^\+?[\d\s-]{8,15}$/.test(phone)) {
            Swal.fire({ title: 'Số điện thoại không hợp lệ', icon: 'warning', background: '#111827', color: '#fff', timer: 1500, showConfirmButton: false });
            return;
        }
        try {
            await ApiService.setWalletContact(email, phone);
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
            Swal.fire({ title: 'Đã lưu thông tin', text: 'Admin sẽ nhận diện ví của bạn qua tên và thông tin liên hệ này.', icon: 'success', background: '#111827', color: '#fff', timer: 1800, showConfirmButton: false });
        } catch (e) {
            Swal.fire({ title: 'Thất bại', text: getShortError(e), icon: 'error', background: '#111827', color: '#fff' });
        }
    });
    // Phòng chờ: ví chờ duyệt khai thông tin nhận diện + copy địa chỉ ví
    document.getElementById('btn-gate-copy')?.addEventListener('click', () => {
        const addr = document.getElementById('gate-wallet-address')?.innerText || '';
        if (addr) navigator.clipboard?.writeText(addr).catch(() => {});
    });
    document.getElementById('btn-gate-save')?.addEventListener('click', async () => {
        const alias = (document.getElementById('gate-alias')?.value || '').trim();
        const email = (document.getElementById('gate-email')?.value || '').trim();
        const phone = (document.getElementById('gate-phone')?.value || '').trim();
        const reqRole = document.getElementById('gate-req-role')?.value || '';
        // Bắt buộc đủ cả 4 trường — bỏ trống bất kỳ ô nào thì không gửi được
        if (!alias || !email || !phone || !reqRole) {
            Swal.fire({ title: 'Chưa đủ thông tin', text: 'Vui lòng điền đầy đủ Tên, Email, Số điện thoại và chọn Quyền mong muốn trước khi gửi.', icon: 'warning', background: '#111827', color: '#fff', timer: 2000, showConfirmButton: false });
            return;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            Swal.fire({ title: 'Email không hợp lệ', icon: 'warning', background: '#111827', color: '#fff', timer: 1500, showConfirmButton: false });
            return;
        }
        if (!/^\+?[\d\s-]{8,15}$/.test(phone)) {
            Swal.fire({ title: 'Số điện thoại không hợp lệ', icon: 'warning', background: '#111827', color: '#fff', timer: 1500, showConfirmButton: false });
            return;
        }
        try {
            await ApiService.setWalletContact(email, phone);
            if (web3.currentAccount) {
                const selfUpdate = { requestedRole: reqRole };
                if (alias) selfUpdate.alias = alias;
                await ApiService.syncWalletData(web3.currentAccount, selfUpdate);
                if (alias) {
                    const profileName = document.querySelector('aside .truncate');
                    if (profileName) profileName.innerText = alias;
                }
            }
            document.getElementById('gate-saved-hint')?.classList.remove('hidden');
            Swal.fire({ title: 'Đã lưu thông tin', text: 'Admin sẽ thấy thông tin này trong khay chờ duyệt.', icon: 'success', background: '#111827', color: '#fff', timer: 1800, showConfirmButton: false });
        } catch (e) {
            Swal.fire({ title: 'Thất bại', text: getShortError(e), icon: 'error', background: '#111827', color: '#fff' });
        }
    });
    document.getElementById('btn-execute-upload')?.addEventListener('click', handleUpload);
    document.getElementById('btn-execute-verify')?.addEventListener('click', handleVerify);
    document.getElementById('btn-refresh-history')?.addEventListener('click', loadTransactionHistory);
    document.getElementById('btn-refresh-revoked')?.addEventListener('click', loadRevokedHistory);
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
                    cls = 'text-red-400';
                } else if (rc === null || rc === undefined) {
                    msg = 'Không đọc được quyền on-chain (RPC lỗi).';
                    cls = 'text-gray-500';
                } else {
                    const rank = Number(rc);
                    const roleTxt = { 1: 'Nhập Liệu', 2: 'Quản Lý', 3: 'ADMIN' }[rank];
                    const dbViewer = w && w.role === 'NGƯỜI XEM';
                    msg = rank === 0
                        ? (dbViewer ? `Đang là Người Xem (chỉ đọc) — ${name}${want}` : `Chưa được cấp quyền — ${name}${want}`)
                        : `Đang là ${roleTxt} — ${name}${want}`;
                    cls = rank === 0 && !dbViewer ? 'text-amber-400' : 'text-emerald-400';
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
    if (typeof window.loadWalletRoles === 'function') window.loadWalletRoles();
});

// =====================================================================
// ĐỒNG BỘ SỐ LIỆU DASHBOARD (HÀM TẬP TRUNG)
// =====================================================================
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
        // 1. Lấy dữ liệu On-chain từ Blockchain
        const metrics = await web3.getLiveMetrics();

        // 2. issuerCount lấy theo quyền upload THẬT trên chain (getLiveMetrics)
        // — không đếm từ DB vì ví chờ duyệt có role mặc định gây đếm sai

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
            const hint = document.getElementById('pending-active-hint');
            if (hint) {
                hint.innerHTML = st.activeDevices.length
                    ? `Ví đang có phiên hoạt động trên: <b>${st.activeDevices.map(d => esc(d.label)).join(', ')}</b> — hãy mở máy đó và duyệt.`
                    : `Không còn thiết bị nào khác đang hoạt động — có thể dùng <b>Cách 2 (OTP email)</b>.`;
            }
            if (st.status === 'active') finish(true);
            else if (st.status === 'revoked' || st.status === 'unknown') {
                finish(false);
                Swal.fire({ title: 'Đã bị từ chối', text: 'Phiên đăng nhập này đã bị từ chối/thu hồi.', icon: 'error', background: '#111827', color: '#fff' });
            }
        }, 5000);

        Swal.fire({
            title: 'Thiết bị mới — chờ phê duyệt',
            html: `
                <div class="text-left text-sm text-gray-300 space-y-3">
                    <p>Để bảo mật, thiết bị này phải được xác nhận bằng <b>một trong 2 cách</b>:</p>
                    <div class="bg-gray-800/60 border border-gray-700 rounded-lg p-3">
                        <div class="font-bold text-emerald-400 text-xs mb-1">CÁCH 1 — Từ thiết bị đã đăng nhập</div>
                        <p class="text-xs text-gray-400">Mở hệ thống trên máy đã đăng nhập → bấm chuông 🔔 → mục "Thiết bị đang đăng nhập" → <b>Duyệt</b>. Trang này sẽ tự vào ngay khi được duyệt.</p>
                    </div>
                    <div class="bg-gray-800/60 border border-gray-700 rounded-lg p-3">
                        <div class="font-bold text-blue-400 text-xs mb-1">CÁCH 2 — Mã OTP về email chủ ví</div>
                        <p class="text-xs text-gray-400 mb-2">Gửi mã 6 số về email đã đăng ký. <b>Chỉ dùng khi không còn thiết bị nào hoạt động</b> — nếu ví còn máy online, server sẽ từ chối và bắt dùng Cách 1.</p>
                        <button id="btn-send-otp" class="w-full bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold py-2 rounded transition">Gửi mã OTP về email</button>
                        <div id="otp-input-box" class="hidden mt-2 flex gap-2">
                            <input id="otp-code" maxlength="6" placeholder="••••••" class="flex-1 bg-gray-900 border border-gray-700 rounded px-3 py-2 text-center text-white tracking-[0.4em] font-mono text-sm outline-none focus:border-blue-500">
                            <button id="btn-verify-otp" class="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold px-4 rounded transition">Xác nhận</button>
                        </div>
                        <div id="otp-msg" class="text-[11px] mt-2 hidden"></div>
                    </div>
                    <p id="pending-active-hint" class="text-[11px] text-amber-300/90 text-center"></p>
                    <p class="text-[11px] text-gray-500 text-center"><i class="fa-solid fa-spinner fa-spin mr-1"></i>Đang chờ phê duyệt...</p>
                </div>`,
            background: '#111827', color: '#fff', width: 480,
            showConfirmButton: false, showCancelButton: true, cancelButtonText: 'Hủy',
            allowOutsideClick: false, allowEscapeKey: false,
            didOpen: () => {
                const msg = document.getElementById('otp-msg');
                const showMsg = (t, ok) => { msg.textContent = t; msg.className = `text-[11px] mt-2 ${ok ? 'text-emerald-400' : 'text-red-400'}`; msg.classList.remove('hidden'); };
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
const VIEWER_VISIBLE_NAV = ['nav-verify', 'nav-history', 'nav-revoked', 'nav-settings'];
let guestUnlockTimer = null;
// Ví đang ở phòng chờ/từ chối (rank 0) → tắt mọi vòng lặp nền gọi API nhân sự
// (metrics, bảng ví, API keys, khay admin) để không spam 403 và không đơ trang
let pendingGateActive = false;

function isPendingGateVisible() {
    const t = document.getElementById('tab-pending');
    return t && !t.classList.contains('hidden');
}

// Ví bị Admin từ chối: ẩn form chờ, hiện thông báo từ chối
function applyRejectedGate() {
    pendingGateActive = true;
    document.getElementById('gate-wait-card')?.classList.add('hidden');
    document.getElementById('gate-form-card')?.classList.add('hidden');
    document.getElementById('gate-rejected')?.classList.remove('hidden');
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
        if (me.rejected === true) {
            switchUI('tab-pending');
            applyRejectedGate();
            return;
        }
        const set = (id, v) => { const el = document.getElementById(id); if (el && v) el.value = v; };
        set('gate-alias', me.alias);
        set('gate-email', me.email);
        set('gate-phone', me.phone);
        if (me.requestedRole) set('gate-req-role', me.requestedRole);
        if (me.alias || me.email || me.requestedRole) document.getElementById('gate-saved-hint')?.classList.remove('hidden');
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
    switchUI('tab-history', document.getElementById('nav-history'));
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
                Swal.fire({ title: 'Đã được cấp quyền!', text: 'Admin vừa cấp quyền cho ví của bạn. Hệ thống đã mở đầy đủ chức năng.', icon: 'success', background: '#111827', color: '#fff' });
                if (typeof window.loadWalletRoles === 'function') window.loadWalletRoles();
                return;
            }
            // Rank vẫn 0 nhưng đang ở phòng chờ + DB vừa gán NGƯỜI XEM
            // → chuyển sang chế độ chỉ đọc ngay, không cần đăng nhập lại
            if (rank === 0 && isPendingGateVisible()) {
                const me = await ApiService.getMyWallet();
                if (me && me.rejected === true) {
                    applyRejectedGate();
                } else if (me && me.role === 'NGƯỜI XEM') {
                    applyViewerMode(account);
                    Swal.fire({ title: 'Đã được cấp quyền!', text: 'Bạn được cấp quyền Người Xem — có thể xem và xác thực tài liệu (chỉ đọc).', icon: 'success', background: '#111827', color: '#fff' });
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
                savedBtn.classList.toggle('bg-emerald-600', !hasContact);
                savedBtn.classList.toggle('hover:bg-emerald-500', !hasContact);
                savedBtn.classList.toggle('bg-slate-600', !!hasContact);
                savedBtn.classList.toggle('hover:bg-slate-500', !!hasContact);
                if (aliasIn) aliasIn.disabled = !!hasContact;
                if (emailIn) emailIn.disabled = !!hasContact;
                if (phoneIn) phoneIn.disabled = !!hasContact;
                document.getElementById('contact-saved-hint')?.classList.toggle('hidden', !hasContact);
            }
        } catch (e) {}
    } catch (error) {
        Swal.fire({ title: 'Lỗi Kết Nối', text: getShortError(error, 'Mất kết nối tới ví MetaMask.'), icon: 'error', background: '#111827', color: '#fff' });
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
        return Swal.fire({ title: 'Thiếu dữ liệu', text: 'Vui lòng chọn ít nhất 1 tài liệu!', icon: 'warning', background: '#111827', color: '#fff' });
    }
    if (filesToUpload.length > 100) {
        return Swal.fire({ title: 'Quá giới hạn', text: 'Smart Contract chỉ ghi tối đa 100 tài liệu mỗi lần ký. Vui lòng bớt file ra.', icon: 'warning', background: '#111827', color: '#fff' });
    }

    isProcessing = true;
    UI.updateProgress(10, "Đang quét Pre-check trên Sổ cái...", "SCANNING");
    
    window.uploadQueue = { newFiles: [], revokedFiles: [], activeFiles: [], approvedFiles: [] };
    const contract = web3.contract;

    try {
        if (!contract) throw new Error("Chưa kết nối ví");

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

            const existingDocId = await contract.getDocIdByHash(currentHash);
            
            let fSize = file.size >= 1024 * 1024 ? (file.size / (1024 * 1024)).toFixed(2) + ' MB' : (file.size / 1024).toFixed(2) + ' KB';
            const fileData = { fileObj: file, hash: currentHash, name: file.name, size: fSize, oldId: existingDocId };

            if (existingDocId && existingDocId !== "") {
                const docData = await contract.getDocument(existingDocId);
                const isRevoked = docData[4];
                if (isRevoked) window.uploadQueue.revokedFiles.push(fileData);
                else window.uploadQueue.activeFiles.push(fileData);
            } else {
                window.uploadQueue.newFiles.push(fileData);
            }
        }

        if (skippedDupes.length > 0) {
            Swal.fire({ title: 'File trùng nội dung', text: `Bỏ qua ${skippedDupes.length} tệp trùng nội dung trong cùng lô: ${skippedDupes.slice(0, 3).map(esc).join(', ')}${skippedDupes.length > 3 ? '…' : ''}`, icon: 'info', background: '#111827', color: '#fff' });
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
        Swal.fire({ title: 'Lỗi', text: 'Có lỗi trong quá trình quét đối chiếu!', icon: 'error', background: '#111827', color: '#fff' });
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

    // Render Bảng Đã Xóa
    if (window.uploadQueue.revokedFiles.length > 0) {
        secRevoked.classList.remove('hidden');
        secRevoked.classList.add('flex');
        tbodyRevoked.innerHTML = window.uploadQueue.revokedFiles.map((f, index) => `
            <tr class="border-b border-red-900/20 hover:bg-red-900/30 transition">
                <td class="px-3 py-3 text-center align-middle"><input type="checkbox" class="conflict-cb-revoked rounded bg-gray-900 border-gray-700 text-red-500 cursor-pointer" value="${index}" checked></td>
                <td class="px-3 py-3">
                    <div class="flex justify-between items-start mb-0.5">
                        <span class="font-bold text-red-400 text-xs truncate max-w-[200px]" title="${esc(f.name)}">${esc(f.name)}</span>
                        <span class="text-[10px] text-gray-500 font-mono">${esc(f.size)}</span>
                    </div>
                    <div class="text-[9px] text-gray-500 font-mono truncate max-w-[250px]">ID cũ: ${esc(f.oldId)}</div>
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
            <tr class="border-b border-yellow-900/30 hover:bg-yellow-900/30 transition">
                <td class="px-3 py-3 text-center align-middle"><input type="checkbox" class="conflict-cb-active rounded bg-gray-900 border-gray-700 text-yellow-500 cursor-pointer" value="${index}" checked></td>
                <td class="px-3 py-3">
                    <div class="flex justify-between items-start mb-0.5">
                        <span class="font-bold text-yellow-400 text-xs truncate max-w-[200px]" title="${esc(f.name)}">${esc(f.name)}</span>
                        <span class="text-[10px] text-gray-500 font-mono">${esc(f.size)}</span>
                    </div>
                    <div class="text-[9px] text-gray-500 font-mono truncate max-w-[250px]">ID gốc: ${esc(f.oldId)}</div>
                </td>
            </tr>
        `).join('');
    } else {
        secActive.classList.add('hidden');
        secActive.classList.remove('flex');
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
        document.getElementById('conflict-modal-overlay').classList.add('hidden');
        
        // Gộp file mới + file đã duyệt
        window.uploadQueue.approvedFiles = [...window.uploadQueue.newFiles, ...window.uploadQueue.approvedFiles];
        
        if (window.uploadQueue.approvedFiles.length === 0) {
            Swal.fire({ title: 'Đã hủy', text: 'Không có tài liệu nào được duyệt để tải lên.', icon: 'info', background: '#111827', color: '#fff' });
            isProcessing = false;
            UI.updateProgress(0, "Đã hủy xử lý.", "STANDBY");
        } else {
            promptPasswordAndUpload();
        }
    }
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
    const { value: formValues } = await Swal.fire({
        title: 'BẢO MẬT AES-256',
        html: `<style>
                #swal-vis{width:88%;margin:4px 0 0;padding:9px 12px;border-radius:8px;border:1px solid #374151;background:#1f2937;color:#f3f4f6;font-size:14px;outline:none;cursor:pointer}
                #swal-vis option{color:#111827;background:#ffffff;font-size:14px;padding:8px}
            </style>
            <div class="text-left text-sm text-gray-300 mb-1">Nhập mật khẩu mã hóa cho ${finalFiles.length} tệp tin đã được xét duyệt:</div>
            <input id="swal-key" type="password" placeholder="Nhập khóa bí mật..." class="swal2-input" style="width:88%;margin-top:8px">
            <div class="text-left text-sm text-gray-300 mt-3 mb-1">Chế độ chia sẻ tài liệu:</div>
            <select id="swal-vis">
                <option value="private" selected>🔒 Riêng tư — mình tôi &amp; Admin được xem</option>
                <option value="public">🌐 Công khai — mọi người dùng đều xem được</option>
            </select>`,
        focusConfirm: false,
        background: '#111827', color: '#fff',
        confirmButtonColor: '#2563eb', showCancelButton: true, cancelButtonText: 'Hủy',
        preConfirm: () => ({
            key: document.getElementById('swal-key').value,
            vis: document.getElementById('swal-vis').value
        })
    });

    // Nếu bấm Hủy hoặc không nhập khóa -> Bắt buộc mở khóa hệ thống
    if (!formValues || !formValues.key) {
        isProcessing = false;
        return;
    }

    // Bật khóa chống click đúp
    isProcessing = true;

    //await ÉP HỆ THỐNG CHỜ CHẠY XONG MỚI TIẾP
    await executeUploadCore(finalFiles, formValues.key, formValues.vis);
}

// LUỒNG MÃ HÓA, IPFS VÀ BLOCKCHAIN 
async function executeUploadCore(fileDataArray, secretKey, visibility = 'private') {
    isProcessing = true;
    try {
        // Token JWT hết hạn/đổi ví giữa chừng → xin challenge và ký lại trước khi ghi dữ liệu
        await ApiService.ensureAuth(web3.signer, web3.currentAccount);

        let uploadedDocs = [];
        let leaves = [];

        for (let i = 0; i < fileDataArray.length; i++) {
            const fileItem = fileDataArray[i];
            const file = fileItem.fileObj;
            
            UI.updateProgress(20, `Đang mã hóa file ${i + 1}/${fileDataArray.length}:${file.name}...`, "ENCRYPTING");
            leaves.push("0x" + fileItem.hash);
            
            // AES Mã hóa — build chuỗi nhị phân theo chunk (tránh nổ stack/trễ với file lớn)
            const arrayBuffer = await file.arrayBuffer();
            const uint8Array = new Uint8Array(arrayBuffer);
            let binaryString = '';
            const CHUNK = 0x8000;
            for (let off = 0; off < uint8Array.length; off += CHUNK) {
                binaryString += String.fromCharCode.apply(null, uint8Array.subarray(off, off + CHUNK));
            }

            const encryptedData = CryptoJS.AES.encrypt(btoa(binaryString), secretKey).toString();
            const encryptedBlob = new Blob([encryptedData], { type: 'text/plain' });
            const encryptedFile = new File([encryptedBlob], file.name + '.enc', { type: 'text/plain' });

            UI.updateProgress(40, `Đang đẩy tệp ${i + 1}/${fileDataArray.length} lên mạng IPFS...`, "UPLOADING");
            const uploadData = await ApiService.uploadFileWithProgress(encryptedFile, () => {});
            
            if (!uploadData.success) throw new Error(`Lỗi upload tệp ${file.name}`);
            
            let qrCodeBase64 = '';
            try { qrCodeBase64 = await QRCode.toDataURL(uploadData.documentId, { width: 120, margin: 1 }); } catch (e) {}

            uploadedDocs.push({
                docId: uploadData.documentId,
                fileHash: fileItem.hash,
                ipfsCID: uploadData.ipfsCID,
                fileName: file.name,
                fileSize: fileItem.size,
                qrCode: qrCodeBase64,
                encKey: secretKey, // khóa AES — chỉ gửi lên server bọc trong MongoDB, TUYỆT ĐỐI không đưa vào manifest IPFS
                visibility
            });
        }

        UI.updateProgress(65, "Đang tính toán Merkle Root và chốt lô...", "MERKLE TREE");
        const tree = new window.MerkleTree(leaves, window.keccak256, { sortPairs: true });
        const merkleRoot = tree.getHexRoot();
        const batchId = `BATCH_${Date.now()}`;
        
        // Manifest lên IPFS — lọc BỎ encKey (manifest là public, ai có CID đều đọc được)
        const publicFiles = uploadedDocs.map(({ encKey, ...rest }) => rest);
        const manifestBlob = new Blob([JSON.stringify({ batchId, merkleRoot, timestamp: Date.now(), files: publicFiles })], { type: 'application/json' });
        const manifestUpload = await ApiService.uploadFileWithProgress(new File([manifestBlob], `${batchId}_manifest.json`), () => {});

        UI.updateProgress(85, "Đang chờ chữ ký MetaMask (Ký 1 lần duy nhất cho toàn bộ tệp)...", "SIGNING");
        // Ghi từng docId + fileHash + ipfsURI lên chain trong 1 giao dịch — để verify từng tài liệu hoạt động
        const txHash = await web3.addDocumentsOnChain(
            uploadedDocs.map(d => d.docId),
            uploadedDocs.map(d => d.fileHash),
            uploadedDocs.map(d => `ipfs://${d.ipfsCID}`)
        );
        
        // LƯU DB MONGODB
        const currentWalletAddr = web3.currentAccount ? web3.currentAccount.toLowerCase() : (window.__chainOwner || "");
        const batchData = { batchId, merkleRoot, ipfsCID: manifestUpload.ipfsCID, txHash, timestamp: Date.now(), uploader: currentWalletAddr, files: uploadedDocs };
        
        try {
            await ApiService.saveBatchToDatabase(batchData);

            // Drain các batch "mồ côi" (ghi chain xong nhưng lưu DB lỗi ở phiên trước)
            const orphans = JSON.parse(localStorage.getItem('orphanedBatches') || '[]');
            if (orphans.length) {
                const remain = [];
                for (const ob of orphans) {
                    try { await ApiService.saveBatchToDatabase(ob); }
                    catch (e) { remain.push(ob); }
                }
                localStorage.setItem('orphanedBatches', JSON.stringify(remain));
            }

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
            Swal.fire({ title: 'Lưu ý', text: 'Giao dịch blockchain thành công nhưng lưu vào cơ sở dữ liệu bị lỗi. Hệ thống sẽ thử lưu lại sau.', icon: 'warning', background: '#111827', color: '#fff' });
        }
        
        UI.selectedUploadFiles = []; UI.renderUploadFileList();
        if (typeof window.loadWalletRoles === 'function') window.loadWalletRoles();
        
        UI.updateProgress(100, "Hoàn tất bảo mật & lưu trữ hàng loạt!", "SUCCESS");
        
        // Hiển thị báo cáo thành công
        let batchResultHtml = `<p class="text-xs text-emerald-400 mb-3 font-bold">✓ Merkle Root đã được tính và lưu trong manifest. Ký 1 giao dịch cho ${uploadedDocs.length} tệp!</p><div class="max-h-[200px] overflow-y-auto space-y-2 pr-1 custom-scrollbar mb-4">`;
        uploadedDocs.forEach((doc) => {
            batchResultHtml += `
                <div class="bg-[#0b0f19] border border-gray-800 p-2.5 rounded-lg flex justify-between items-center group">
                    <div class="text-left overflow-hidden">
                        <div class="text-[11px] text-gray-500 font-medium truncate w-56 mb-0.5">${esc(doc.fileName)} (${esc(doc.fileSize)})</div>
                        <div class="text-blue-400 font-mono text-xs truncate w-56">${esc(doc.docId)}</div>
                    </div>
                    <button data-act="copy" data-v="${esc(doc.docId)}" class="text-gray-500 hover:text-white transition bg-gray-800/50 p-2 rounded"><i class="fa-regular fa-copy"></i></button>
                </div>`;
        });
        batchResultHtml += `</div>`;

        Swal.fire({ title: `Khắc Chuỗi Thành Công!`, html: batchResultHtml, background: '#111827', color: '#fff', confirmButtonColor: '#374151' });

    } catch (error) {
        UI.updateProgress(0, "Tiến trình bị hủy.", "FAILED");
        Swal.fire({ title: 'Giao dịch thất bại', text: getShortError(error), icon: 'error', background: '#111827', color: '#fff' });
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
    const docId = document.getElementById('verifyDocId')?.value.trim();
    
    if (!fileInput || fileInput.files.length === 0 || !docId) {
        return Swal.fire({ title: 'Thiếu thông tin', text: 'Vui lòng nhập ID tài liệu và chọn tệp cần kiểm tra!', icon: 'warning', background: '#111827', color: '#fff' });
    }

    isProcessing = true;
    try {
        UI.updateProgress(20, "Đang truy xuất sổ cái Smart Contract...", "QUERYING");
        const docData = await web3.getDocumentFromChain(docId);
        const originalHash = docData[0];

        if (!originalHash) {
            UI.updateProgress(0, "Không tìm thấy dữ liệu.", "NOT FOUND");
            return Swal.fire({ title: 'Lỗi', text: 'Tài liệu này không tồn tại trên chuỗi khối.', icon: 'error', background: '#111827', color: '#fff' });
        }

        UI.updateProgress(50, "Đang băm tệp tin kiểm tra...", "HASHING");
        const currentHash = await web3.hashFile(fileInput.files[0]);

        const timestamp = new Date(Number(docData[2]) * 1000).toLocaleString('vi-VN');
        const uploaderWallet = docData[3];
        
        const traceHTML = `
            <div class="mt-4 p-3 bg-black/40 border border-gray-700 rounded-lg text-left text-xs">
                <p class="text-blue-400 font-bold mb-2 uppercase"><i class="fa-solid fa-fingerprint mr-1"></i> Truy xuất nguồn gốc (Traceability):</p>
                <p class="text-gray-400 mb-1">Ví tạo: <span class="text-emerald-400 font-mono">${esc(uploaderWallet)}</span></p>
                <p class="text-gray-400">Thời gian khắc chuỗi: <span class="text-white">${esc(timestamp)}</span></p>
            </div>`;

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
                    title: 'TÀI LIỆU ĐÃ BỊ THU HỒI!', icon: 'error', background: '#111827', color: '#fff',
                    html: `
                        <div class="text-left text-sm text-gray-300 space-y-3">
                            <p>Mã băm hoàn toàn trùng khớp với bản gốc, tuy nhiên tài liệu này đã bị <b class="text-red-500">VÔ HIỆU HÓA</b> bởi cơ quan phát hành.</p>
                            <div class="bg-red-900/20 border border-red-800 p-3 rounded text-red-400"><b>Lý do thu hồi:</b> ${esc(revocationReason)}</div>
                        </div>
                        ${traceHTML}`,
                    confirmButtonText: 'Đóng', confirmButtonColor: '#dc2626'
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
                    icon: 'success', background: '#111827', color: '#fff',
                    html: `
                        <p class="text-gray-300 text-sm mb-4">Mã băm hoàn toàn trùng khớp với bản gốc trên Blockchain.</p>
                        ${traceHTML}
                        <button data-act="pdf" class="w-full mt-4 bg-emerald-600 hover:bg-emerald-500 text-white py-2 rounded-lg text-sm font-bold shadow-md transition">
                            <i class="fa-solid fa-file-pdf mr-2"></i> Tải Báo Cáo Chứng Thực (PDF)
                        </button>`,
                    confirmButtonText: 'Đóng', confirmButtonColor: '#2563eb'
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
                background: '#111827', color: '#fff',
                confirmButtonColor: '#2563eb', showCancelButton: true, cancelButtonText: 'Hủy đối chiếu'
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
                    <div class="mt-2 mb-4 p-3 bg-red-900/20 border-l-4 border-red-500 rounded-r-lg text-left shadow-lg">
                        <p class="text-red-400 font-bold mb-1 uppercase text-[11px] tracking-wider">
                            <i class="fa-solid fa-robot mr-1"></i> Báo Cáo Pháp Y AI (Forensic)
                        </p>
                        <p class="text-gray-200 text-xs italic leading-relaxed">"${esc(backendResult.aiReport)}"</p>
                    </div>`;
            }

            if (backendResult.differences && backendResult.differences.length > 0) {
                html += '<div class="bg-[#0b0f19] text-gray-300 p-4 rounded-lg text-left font-mono max-h-[300px] overflow-y-auto text-xs mt-3 border border-gray-800 leading-relaxed">';
                backendResult.differences.forEach(p => {
                    // Class tĩnh thay style inline — không còn giá trị nào chui vào attribute
                    const cls = p.added ? 'bg-emerald-800 text-white' : p.removed ? 'bg-red-900 text-white line-through' : 'text-gray-400';
                    html += `<span class="${cls} rounded-sm px-0.5">${esc(p.value)}</span>`;
                });
                html += '</div>';
            } else if (backendResult.imageDiff && /^data:image\//.test(String(backendResult.imageDiff))) {
                // Chỉ chấp nhận data:image URL — chặn javascript:/url lạ trong src
                html += `<div class="mt-3 text-center"><img src="${esc(backendResult.imageDiff)}" class="max-w-full max-h-[300px] border border-red-900 rounded-lg mx-auto shadow-lg bg-[#0b0f19]"></div>`;
            } else if (!backendResult.aiReport) {
                html += `
                    <div class="bg-[#0b0f19] text-gray-300 p-4 rounded-lg text-left text-xs mt-3 border border-gray-800 space-y-3">
                        <p class="text-gray-400">Mã băm không khớp. Không thể tạo bản đồ trực quan (Sai mật khẩu giải mã hoặc lỗi IPFS).</p>
                        <div class="pt-3 font-mono text-[11px] space-y-1">
                            <p class="text-emerald-400 break-all"><b>Hash gốc:</b> ${esc(originalHash)}</p>
                            <p class="text-red-400 break-all"><b>Hash tải lên:</b> ${esc(currentHash)}</p>
                        </div>
                    </div>`;
            }
            html += traceHTML;

            Swal.fire({
                icon: 'error', title: 'PHÁT HIỆN GIẢ MẠO!', 
                text: 'Mã băm không khớp với chuỗi khối!', 
                background: '#111827', color: '#fff',
                showCancelButton: true, confirmButtonText: 'Xem bằng chứng', cancelButtonText: 'Đóng', 
                confirmButtonColor: '#2563eb', cancelButtonColor: '#dc2626', reverseButtons: true
            }).then((res) => {
                UI.updateProgress(0, "Hệ thống đang rảnh", "STANDBY");
                if (res.isConfirmed) {
                    Swal.fire({ 
                        title: 'BÁO CÁO GIÁM ĐỊNH', html: html, 
                        background: '#111827', color: '#fff', width: '700px', confirmButtonColor: '#374151' 
                    }).then(() => {
                        if (fileInput) fileInput.value = '';
                        UI.updateFileName('verifyFile');
                    });
                }
            });
        }
    } catch (err) {
        UI.updateProgress(0, "Lỗi tiến trình giám định.", "ERROR");
        Swal.fire({ title: 'Lỗi xác thực', text: getShortError(err), icon: 'error', background: '#111827', color: '#fff' });
    } finally {
        isProcessing = false;
    }
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
window.revokeDoc = async (docId) => {
    if (isProcessing) return;

    // Token JWT phải còn hạn trước khi quét MongoDB — nếu không getBatchesFromDatabase
    // trả [] làm isBatchFile sai → chỉ ghi on-chain mà không đồng bộ MongoDB (split-brain)
    try {
        await ApiService.ensureAuth(web3.signer, web3.currentAccount);
    } catch (e) {
        return Swal.fire({ title: 'Chưa xác thực', text: 'Vui lòng kết nối ví và ký xác thực trước khi thu hồi.', icon: 'warning', background: '#111827', color: '#fff' });
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
                return Swal.fire({ title: 'Không đủ quyền', text: 'Tài liệu do ví Admin tải lên — chỉ Admin mới được thu hồi.', icon: 'error', background: '#111827', color: '#fff' });
            }
        } catch (e) { /* đọc role lỗi thì để contract tự chặn ở bước giao dịch */ }
    }

    const { value: reason } = await Swal.fire({
        title: 'THU HỒI TÀI LIỆU', text: `Bạn đang vô hiệu hóa tài liệu ID: ${esc(docId)}`, 
        input: 'text', inputPlaceholder: 'Nhập lý do thu hồi (Bắt buộc)...',
        icon: 'warning', showCancelButton: true, confirmButtonText: 'Xác nhận Thu hồi', cancelButtonText: 'Hủy', 
        background: '#111827', color: '#fff', confirmButtonColor: '#dc2626',
        inputValidator: (value) => { if (!value) return 'Vui lòng nhập lý do thu hồi!'; }
    });

    if (reason) {
        isProcessing = true;
        try {
            // 2. GHI THU HỒI LÊN BLOCKCHAIN TRƯỚC — chain là nguồn sự thật cho verify.
            // Ghi chain trước để nếu MetaMask từ chối thì MongoDB cũng không bị ghi nhầm.
            UI.updateProgress(40, "Đang gửi lệnh thu hồi lên Blockchain (duyệt trên MetaMask)...", "REVOKING");
            try {
                await web3.revokeDocument(docId, reason);
            } catch (chainErr) {
                const m = String((chainErr && (chainErr.info?.error?.message || chainErr.message)) || chainErr);
                // Doc không có trên chain (bản ghi off-chain cũ) hoặc đã thu hồi sẵn
                // → vẫn cho phép đồng bộ cờ thu hồi trong MongoDB.
                // Lỗi quyền ("khong co quyen") KHÔNG được nuốt → throw để chặn cả 2 nguồn.
                if (!/khong ton tai|da bi thu hoi/i.test(m)) throw chainErr;
            }

            // 3. ĐỒNG BỘ MONGODB — lịch sử, audit, hoàn trả dung lượng (server tự trừ)
            if (isBatchFile) {
                UI.updateProgress(75, "Đã ghi on-chain! Đang đồng bộ trạng thái vào Database...", "SYNCING");
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
            
            Swal.fire({ title: 'Thành công', text: 'Tài liệu đã bị thu hồi và hoàn trả dung lượng.', icon: 'success', background: '#111827', color: '#fff' });
            
            loadTransactionHistory();
            loadRevokedHistory();
        } catch (err) {
            UI.updateProgress(0, "Lỗi tiến trình.", "ERROR");
            Swal.fire({ title: 'Thất bại', text: getShortError(err, 'Giao dịch bị từ chối hoặc bạn đã hủy ký xác thực.'), icon: 'error', background: '#111827', color: '#fff' });
        } finally { 
            isProcessing = false; 
        }
    }
};

async function loadTransactionHistory() {
    const tbody = document.getElementById('history-table-body');
    if (!tbody) return;
    
    tbody.innerHTML = '<tr><td colspan="6" class="px-4 py-10 text-center text-blue-500"><i class="fa-solid fa-circle-notch fa-spin me-2"></i> Đang quét sổ cái Blockchain...</td></tr>';
    
    try {
        let html = '';
        let stt = 1;
        const seenDocIds = new Set(); // chống render trùng giữa nguồn chain và MongoDB

        // Event DocumentRevoked là nguồn sự thật chắc chắn đã mine —
        // getDocument() trên RPC công cộng có thể trả state cũ/lỗi ngay sau tx.wait()
        const revokedIds = new Set();
        try {
            const revokedEvents = await web3.queryRevokedHistory();
            for (const ev of revokedEvents) revokedIds.add(ev.args[0]);
        } catch (e) {}

        // Lấy batch Mongo trước — cần visibility/uploader để đánh dấu ổ khóa tài liệu riêng tư
        const localBatches = await ApiService.getBatchesFromDatabase();
        const fileMeta = {}; // docId -> { visibility, uploader }
        for (const b of localBatches) {
            for (const f of (b.files || [])) {
                fileMeta[f.docId] = { visibility: f.visibility || 'private', uploader: (b.uploader || '').toLowerCase() };
            }
        }
        // Quyền của ví đang đăng nhập — ADMIN (3) mở được tài liệu private của người khác
        const myAddr = (web3.currentAccount || '').toLowerCase();
        let myRank = 0;
        try { myRank = Number(await web3.getUserRole(myAddr)); } catch (e) {}
        const isLockedDoc = (docId, uploaderAddr) => {
            const meta = fileMeta[docId];
            const vis = meta ? meta.visibility : 'private';
            const owner = (meta && meta.uploader) || (uploaderAddr || '').toLowerCase();
            return vis !== 'public' && owner !== myAddr && myRank < 3;
        };

        // 1. Quét file On-chain
        const events = await web3.queryHistory();
        if (events && events.length > 0) {
            for (let ev of [...events].reverse()) {
                const docId = ev.args[0];
                const hash = ev.args[1];
                const txHash = ev.transactionHash || '';
                let uploader = '---'; 
                let createTime = '---'; 
                let isRevoked = false;
                let ipfsLink = '';
                
                try {
                    const docData = await web3.getDocumentFromChain(docId);
                    uploader = docData[3];
                    createTime = window.formatTimeForce(Number(docData[2]) * 1000); // ÉP CHUẨN GIỜ
                    isRevoked = docData[4];
                    ipfsLink = docData[1].replace('ipfs://', ''); // Lấy chính xác chuỗi CID
                } catch (e) {}
                
                if (isRevoked || revokedIds.has(docId)) continue;
                seenDocIds.add(docId);
                
                let fileName = docId.replace(/_\d+$/, '').replace(/\.enc$/, '');
                const searchPayload = esc(`${docId} ${fileName} ${uploader} ${createTime} ${hash}`.toLowerCase());

                html += `
                <tr class="border-b border-gray-800 hover:bg-[#1f2937] transition" data-search="${searchPayload}" data-uploader="${esc(String(uploader).toLowerCase())}">
                    <td class="px-3 py-2 font-bold text-center text-gray-500">${stt++}</td>
                        <td class="px-3 py-2 font-mono text-blue-400 text-xs">
                            <div class="flex items-center"><span class="truncate max-w-[120px] inline-block" title="${esc(docId)}">${esc(docId)}</span></div>
                            <div class="mt-1 text-[11px] text-gray-400 font-sans truncate max-w-[150px]" title="${esc(fileName)}">File: ${esc(fileName)}</div>
                            <div class="mt-1.5 flex gap-3">
                                <button data-act="copy" data-v="${esc(docId)}" class="text-gray-400 hover:text-white transition text-[11px]"><i class="fa-regular fa-copy mr-1"></i>Copy</button>
                                <button data-act="revoke" data-v="${esc(docId)}" class="text-red-400 hover:text-red-300 transition text-[11px]"><i class="fa-solid fa-ban mr-1"></i>Thu hồi</button>
                            </div>
                        </td>
                    <td class="px-3 py-2 text-xs text-gray-300">
                        <div class="mb-1">${window.getWalletName(uploader)}</div>
                        <div class="text-gray-400 text-[11px] font-medium"><i class="fa-regular fa-clock mr-1"></i>${esc(createTime)}</div>
                    </td>
                    <td class="px-3 py-2 font-mono text-[10px] text-gray-500">
                        <div class="text-gray-400 mb-1 truncate max-w-[150px]" title="${esc(hash)}">${esc(hash)}</div>
                        <div class="flex items-center gap-3">
                            <a href="https://ipfs.io/ipfs/${esc(ipfsLink)}" target="_blank" rel="noopener noreferrer" title="Xem file mã hóa gốc trên IPFS" class="text-emerald-500 hover:text-emerald-400 text-[10px] uppercase font-bold transition">
                                <i class="fa-solid fa-cloud mr-1"></i> IPFS
                            </a>
                            ${isLockedDoc(docId, uploader) ? `
                                <button data-act="locked" title="Tài liệu riêng tư — chỉ người tải lên và Admin xem được" class="text-gray-500 text-[10px] uppercase font-bold bg-gray-800/60 px-2 py-0.5 rounded border border-gray-700 cursor-not-allowed">
                                    <i class="fa-solid fa-lock mr-1"></i> Riêng tư
                                </button>` : `
                                <button data-act="preview" data-v="${esc(ipfsLink)}" data-name="${esc(fileName)}" data-id="${esc(docId)}" title="Xem trực tiếp trong trình duyệt" class="text-emerald-400 hover:text-emerald-300 text-[10px] uppercase font-bold transition bg-emerald-900/20 px-2 py-0.5 rounded border border-emerald-900/50">
                                    <i class="fa-solid fa-eye mr-1"></i> Xem
                                </button>
                                <button data-act="decrypt" data-v="${esc(ipfsLink)}" data-name="${esc(fileName)}" data-id="${esc(docId)}" title="Giải mã và tải tệp gốc về máy" class="text-blue-400 hover:text-blue-300 text-[10px] uppercase font-bold transition bg-blue-900/20 px-2 py-0.5 rounded border border-blue-900/50">
                                    <i class="fa-solid fa-download mr-1"></i> Tải
                                </button>`}
                        </div>
                    </td>
                    <td class="px-3 py-2 text-center">
                        ${txHash ? `<a href="https://sepolia.etherscan.io/tx/${esc(txHash)}" target="_blank" rel="noopener noreferrer" title="Xem giao dịch trên Etherscan" class="text-purple-400 hover:text-purple-300 text-[10px] font-mono font-bold"><span data-txfee="${esc(txHash)}">…</span></a>` : '<span class="text-gray-600 text-[10px]">—</span>'}
                    </td>
                    <td class="px-3 py-2 text-center"><span class="bg-blue-900/40 text-blue-400 px-2 py-1 rounded text-[10px] font-bold uppercase">ON-CHAIN</span></td>
                </tr>`;
            }
        }

        // 2. Quét file Batch (localBatches đã fetch ở trên)
        if (localBatches.length > 0) {
            for (let batch of [...localBatches].reverse()) {
                const createTime = window.formatTimeForce(batch.timestamp);
                const uploader = batch.uploader;
                
                batch.files.forEach(fileDoc => {
                    if (fileDoc.isRevoked || revokedIds.has(fileDoc.docId)) return;
                    if (seenDocIds.has(fileDoc.docId)) return; // đã render ở phần on-chain
                    seenDocIds.add(fileDoc.docId);
                    const searchPayload = esc(`${fileDoc.docId} ${fileDoc.fileName} ${uploader} ${createTime} ${fileDoc.fileHash}`.toLowerCase());

                    html += `
                    <tr class="border-b border-gray-800 hover:bg-[#1f2937] transition" data-search="${searchPayload}" data-uploader="${esc(String(uploader).toLowerCase())}">
                        <td class="px-3 py-2 font-bold text-center text-gray-500">${stt++}</td>
                        <td class="px-3 py-2 font-mono text-blue-400 text-xs">
                            <div class="flex items-center"><span class="truncate max-w-[120px] inline-block" title="${esc(fileDoc.docId)}">${esc(fileDoc.docId)}</span></div>
                            <div class="mt-1 text-[11px] text-gray-400 font-sans truncate max-w-[150px]" title="${esc(fileDoc.fileName)}">File: ${esc(fileDoc.fileName)}</div>
                            <div class="mt-1.5 flex gap-3">
                                <button data-act="copy" data-v="${esc(fileDoc.docId)}" class="text-gray-400 hover:text-white transition text-[11px]"><i class="fa-regular fa-copy mr-1"></i>Copy</button>
                                <button data-act="revoke" data-v="${esc(fileDoc.docId)}" class="text-red-400 hover:text-red-300 transition text-[11px]"><i class="fa-solid fa-ban mr-1"></i>Thu hồi</button>
                            </div>
                        </td>
                        <td class="px-3 py-2 text-xs text-gray-300">
                            <div class="mb-1">${window.getWalletName(uploader)}</div>
                            <div class="text-gray-400 text-[11px] font-medium"><i class="fa-regular fa-clock mr-1"></i>${esc(createTime)}</div>
                        </td>
                        <td class="px-3 py-2 font-mono text-[10px] text-gray-500">
                            <div class="text-gray-400 mb-1 truncate max-w-[150px]" title="${esc(fileDoc.fileHash)}">${esc(fileDoc.fileHash)}</div>
                            <div class="flex items-center gap-3">
                                <a href="https://ipfs.io/ipfs/${esc(fileDoc.ipfsCID)}" target="_blank" rel="noopener noreferrer" title="Xem trên IPFS" class="text-emerald-500 hover:text-emerald-400 text-[10px] uppercase font-bold transition">
                                    <i class="fa-solid fa-cloud mr-1"></i> IPFS
                                </a>
                                ${isLockedDoc(fileDoc.docId, uploader) ? `
                                    <button data-act="locked" title="Tài liệu riêng tư — chỉ người tải lên và Admin xem được" class="text-gray-500 text-[10px] uppercase font-bold bg-gray-800/60 px-2 py-0.5 rounded border border-gray-700 cursor-not-allowed">
                                        <i class="fa-solid fa-lock mr-1"></i> Riêng tư
                                    </button>` : `
                                    <button data-act="preview" data-v="${esc(fileDoc.ipfsCID)}" data-name="${esc(fileDoc.fileName)}" data-id="${esc(fileDoc.docId)}" title="Xem trực tiếp trong trình duyệt" class="text-emerald-400 hover:text-emerald-300 text-[10px] uppercase font-bold transition bg-emerald-900/20 px-2 py-0.5 rounded border border-emerald-900/50">
                                        <i class="fa-solid fa-eye mr-1"></i> Xem
                                    </button>
                                    <button data-act="decrypt" data-v="${esc(fileDoc.ipfsCID)}" data-name="${esc(fileDoc.fileName)}" data-id="${esc(fileDoc.docId)}" class="text-blue-400 hover:text-blue-300 text-[10px] uppercase font-bold transition bg-blue-900/20 px-2 py-0.5 rounded border border-blue-900/50">
                                        <i class="fa-solid fa-download mr-1"></i> Tải
                                    </button>`}
                            </div>
                        </td>
                        <td class="px-3 py-2 text-center">
                            ${batch.txHash ? `<a href="https://sepolia.etherscan.io/tx/${esc(batch.txHash)}" target="_blank" rel="noopener noreferrer" title="Xem giao dịch trên Etherscan" class="text-purple-400 hover:text-purple-300 text-[10px] font-mono font-bold"><span data-txfee="${esc(batch.txHash)}">…</span></a>` : '<span class="text-gray-600 text-[10px]">—</span>'}
                        </td>
                        <td class="px-3 py-2 text-center">
                            <span class="bg-blue-900/40 text-blue-400 px-2 py-1 rounded text-[10px] font-bold uppercase">ON-CHAIN</span>
                        </td>
                    </tr>`;
                });
            }
        }
        tbody.innerHTML = html === '' ? '<tr><td colspan="6" class="px-4 py-10 text-center text-gray-600">Không có tài liệu hợp lệ nào.</td></tr>' : html;
        filterHistoryTable();
        fillTxFees(tbody); // điền phí gas sau khi render — không chặn bảng
    } catch (err) {
        tbody.innerHTML = '<tr><td colspan="6" class="px-4 py-10 text-center text-red-500">Lỗi kết nối RPC. Vui lòng kết nối ví trước.</td></tr>';
    }
}

async function loadRevokedHistory() {
    const tbody = document.getElementById('revoked-table-body');
    if (!tbody) return;
    
    tbody.innerHTML = '<tr><td colspan="5" class="px-4 py-10 text-center text-red-500"><i class="fa-solid fa-circle-notch fa-spin me-2"></i> Đang truy xuất Kho lưu trữ thu hồi...</td></tr>';
    
    try {
        let html = ''; 
        let stt = 1;

        // 1. Quét On-chain
        const events = await web3.queryRevokedHistory();
        if (events && events.length > 0) {
            for (let ev of [...events].reverse()) {
                const docId = ev.args[0]; const revokedBy = ev.args[1]; const reason = ev.args[2];
                let uploader = '---'; let createTime = '---';
                
                try { 
                    const docData = await web3.getDocumentFromChain(docId); 
                    uploader = docData[3]; 
                    createTime = window.formatTimeForce(Number(docData[2]) * 1000); // ÉP CHUẨN GIỜ
                } catch (e) {}
                
                let fileName = docId.replace(/_\d+$/, '').replace(/\.enc$/, '');
                const searchPayload = esc(`${docId} ${fileName} ${uploader} ${revokedBy} ${createTime} ${reason}`.toLowerCase());

                html += `
                <tr class="border-b border-gray-800 bg-red-900/10 hover:bg-red-900/20 transition" data-search="${searchPayload}" data-uploader="${esc(String(uploader).toLowerCase())}">
                    <td class="px-3 py-2 font-bold text-center text-red-500">${stt++}</td>
                    <td class="px-3 py-2 font-mono text-red-400 text-xs">
                    <div class="truncate max-w-[150px]" title="${esc(docId)}">${esc(docId)}</div>
                        <div class="mt-1 text-[11px] text-gray-500 font-sans truncate max-w-[150px]" title="${esc(fileName)}">File: ${esc(fileName)}</div>
                        <button data-act="copy" data-v="${esc(docId)}" class="text-gray-400 hover:text-white transition text-[11px] mt-1.5"><i class="fa-regular fa-copy mr-1"></i>Copy ID</button>
                    </td>
                    <td class="px-3 py-2 text-xs text-gray-300">
                        <div class="mb-1">${window.getWalletName(uploader)}</div>
                        <div class="text-gray-400 text-[11px] font-medium"><i class="fa-regular fa-clock mr-1"></i>${esc(createTime)}</div>
                    </td>
                    <td class="px-3 py-2 text-xs text-gray-300">
                        <div class="text-red-300 font-medium mb-1">${esc(reason)}</div>
                        <div class="flex items-center font-mono text-gray-500 text-[10px]">
                            <span class="mr-1">Bởi:</span> ${window.getWalletName(revokedBy)}
                        </div>
                    </td>
                    <td class="px-3 py-2 text-center"><span class="bg-red-900/40 text-red-400 px-2 py-1 rounded text-[10px] font-bold">REVOKED (ON-CHAIN)</span></td>
                </tr>`;
            }
        }

        // 2. Quét Off-chain Batch
        const localBatches = await ApiService.getBatchesFromDatabase();
        if (localBatches.length > 0) {
            for (let batch of [...localBatches].reverse()) {
                const createTime = window.formatTimeForce(batch.timestamp);
                batch.files.forEach(fileDoc => {
                    if (fileDoc.isRevoked) {
                        const reason = fileDoc.revocationReason || "Vô hiệu hóa nội bộ";
                        const revoker = fileDoc.revokedBy || batch.uploader;
                        const revokeTimeStr = fileDoc.revokedAt ? window.formatTimeForce(fileDoc.revokedAt) : createTime;
                        
                        const searchPayload = esc(`${fileDoc.docId} ${fileDoc.fileName} ${batch.uploader} ${createTime} ${reason}`.toLowerCase());

                        html += `
                        <tr class="border-b border-gray-800 bg-red-900/10 hover:bg-red-900/20 transition" data-search="${searchPayload}" data-uploader="${esc(String(batch.uploader).toLowerCase())}">
                            <td class="px-3 py-2 font-bold text-center text-red-500">${stt++}</td>
                            <td class="px-3 py-2 font-mono text-red-400 text-xs">
                            <div class="truncate max-w-[150px]" title="${esc(fileDoc.docId)}">${esc(fileDoc.docId)}</div>
                                <div class="mt-1 text-[11px] text-gray-500 font-sans truncate max-w-[150px]" title="${esc(fileDoc.fileName)}">File: ${esc(fileDoc.fileName)}</div>
                                <button data-act="copy" data-v="${esc(fileDoc.docId)}" class="text-gray-400 hover:text-white transition text-[11px] mt-1.5"><i class="fa-regular fa-copy mr-1"></i>Copy ID</button>
                            </td>
                            <td class="px-3 py-2 text-xs text-gray-300">
                                <div class="mb-1">${window.getWalletName(batch.uploader)}</div>
                                <div class="text-gray-400 text-[11px] font-medium"><i class="fa-regular fa-clock mr-1"></i>${esc(createTime)}</div>
                            </td>
                            <td class="px-3 py-2 text-xs text-gray-300">
                                <div class="text-red-300 font-medium mb-1">${esc(reason)} <span class="text-[9px] text-gray-500 ml-1">(${esc(revokeTimeStr)})</span></div>
                                <div class="flex items-center font-mono text-gray-500 text-[10px]">
                                    <span class="mr-1">Bởi:</span> ${window.getWalletName(revoker)}
                                </div>
                            </td>
                            <td class="px-3 py-2 text-center">
                                <span class="bg-red-900/40 text-red-400 px-2 py-1 rounded text-[10px] font-bold uppercase">REVOKED (ON-CHAIN)</span>
                            </td>
                        </tr>`;
                    }
                });
            }
        }

        if (html === '') {
            tbody.innerHTML = '<tr><td colspan="5" class="px-4 py-10 text-center text-gray-600">Tuyệt vời. Chưa có tài liệu nào bị thu hồi.</td></tr>';
        } else {
            tbody.innerHTML = html;
            filterRevokedTable();
        }
    } catch (_) { 
        tbody.innerHTML = '<tr><td colspan="5" class="px-4 py-10 text-center text-red-500">Lỗi kết nối RPC.</td></tr>'; 
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
        if (isAuthErr) return tbody.innerHTML = '<tr><td colspan="4" class="px-4 py-10 text-center text-gray-500">Đang chờ đăng nhập ví...</td></tr>';
        return tbody.innerHTML = `<tr><td colspan="4" class="px-4 py-10 text-center text-red-400">${esc(e.message)}</td></tr>`;
    }
    if (keys.length === 0) return tbody.innerHTML = '<tr><td colspan="4" class="px-4 py-10 text-center text-gray-600">Chưa có API Key nào được khởi tạo.</td></tr>';

    tbody.innerHTML = keys.map(k => `
        <tr class="border-b border-gray-800 hover:bg-gray-800/30 transition-colors">
            <td class="px-3 py-2 text-gray-300 text-sm font-medium">${esc(k.name)}</td>
            <td class="px-3 py-2 font-mono text-blue-400 text-xs">${esc(k.prefix)}…</td>
            <td class="px-3 py-2 text-gray-500 text-xs">${esc(new Date(k.createdAt).toLocaleDateString('vi-VN'))}</td>
            <td class="px-3 py-2 text-center">
                ${k.revoked
                    ? '<span class="bg-red-900/30 text-red-400 border border-red-800/50 px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider">Revoked</span>'
                    : `<span class="bg-emerald-900/30 text-emerald-400 border border-emerald-800/50 px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider">Active</span>
                       <button data-act="revoke-key" data-v="${esc(k._id)}" title="Thu hồi key này" class="ml-2 text-red-400 hover:text-red-300 text-[10px] font-bold uppercase transition"><i class="fa-solid fa-ban"></i></button>`}
            </td>
        </tr>
    `).join('');
}

async function generateNewApiKey() {
    const { value: appName } = await Swal.fire({
        title: 'Tạo API Key mới',
        text: 'Nhập tên hệ thống/đối tác cần cấp API Key:',
        input: 'text', inputPlaceholder: 'VD: Trường cấp 3 ABC, Bệnh viện XYZ...',
        background: '#111827', color: '#fff',
        confirmButtonColor: '#2563eb', showCancelButton: true, cancelButtonText: 'Hủy'
    });
    if (!appName || appName.trim() === '') return;

    try {
        const { token } = await ApiService.createApiKey(appName.trim());
        // Hiện key ĐÚNG 1 LẦN — server chỉ lưu hash, không xem lại được
        await Swal.fire({
            title: 'API Key đã tạo — lưu lại ngay!',
            html: `<p class="text-sm text-gray-300 mb-2">Key chỉ hiển thị <b class="text-red-400">một lần duy nhất</b>. Gửi cho đối tác để họ gọi API bằng header <code>x-api-key</code>:</p>
                <div class="flex items-center gap-2 bg-gray-900 border border-gray-700 rounded p-2">
                    <code class="text-emerald-400 text-xs break-all flex-1 text-left">${esc(token)}</code>
                    <button id="copy-new-key" class="text-gray-400 hover:text-white shrink-0"><i class="fa-regular fa-copy"></i></button>
                </div>`,
            icon: 'warning', background: '#0b0f19', color: '#fff',
            didOpen: () => {
                document.getElementById('copy-new-key')?.addEventListener('click', () => window.copyAPIKey(token));
            }
        });
        loadAPIKeys();
    } catch (e) {
        Swal.fire({ icon: 'error', title: 'Lỗi', text: e.message, background: '#0b0f19', color: '#fff' });
    }
}

window.revokeApiKey = async function (id) {
    const ok = await Swal.fire({
        title: 'Thu hồi API Key?',
        text: 'Key sẽ ngừng hoạt động ngay — đối tác không gọi API được nữa.',
        icon: 'warning', showCancelButton: true, confirmButtonText: 'Thu hồi',
        confirmButtonColor: '#dc2626', background: '#111827', color: '#fff', cancelButtonText: 'Hủy'
    });
    if (!ok.isConfirmed) return;
    try {
        await ApiService.revokeApiKey(id);
        loadAPIKeys();
        Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'Đã thu hồi API key', showConfirmButton: false, timer: 2000, background: '#0b0f19', color: '#fff' });
    } catch (e) {
        Swal.fire({ icon: 'error', title: 'Lỗi', text: e.message, background: '#0b0f19', color: '#fff' });
    }
};

function loadRpcConfig() {
    const rpcInput = document.getElementById('rpc-url-input');
    const chainInput = document.getElementById('chain-id-input');
    if (rpcInput) rpcInput.value = localStorage.getItem('custom_rpc_url') || 'http://127.0.0.1:8545';
    if (chainInput) chainInput.value = localStorage.getItem('custom_chain_id') || '31337';
}

function saveRpcConfig() {
    localStorage.setItem('custom_rpc_url', document.getElementById('rpc-url-input').value);
    localStorage.setItem('custom_chain_id', document.getElementById('chain-id-input').value);
    Swal.fire({ title: 'Đã lưu cấu hình', text: 'Vui lòng F5 (tải lại trang) để áp dụng.', icon: 'success', background: '#111827', color: '#fff' });
}

function saveSystemSettings() {
    Swal.fire({ title: 'Đã lưu cài đặt', text: 'Các thiết lập đã được kích hoạt thành công.', icon: 'success', background: '#111827', color: '#fff' });
}

window.selectTemplate = (type) => {
    const tplStandard = document.getElementById('tpl-standard'); const tplMinimal = document.getElementById('tpl-minimal');
    const iconStandard = document.getElementById('icon-standard'); const iconMinimal = document.getElementById('icon-minimal');
    if (type === 'standard') {
        if (tplStandard) tplStandard.className = "border-2 border-blue-600 bg-blue-900/10 rounded-xl p-4 cursor-pointer relative transition duration-200";
        if (iconStandard) iconStandard.classList.remove('hidden');
        if (tplMinimal) tplMinimal.className = "border-2 border-gray-800 bg-[#0b0f19] rounded-xl p-4 cursor-pointer hover:border-gray-600 transition duration-200 relative";
        if (iconMinimal) iconMinimal.classList.add('hidden');
    } else {
        if (tplMinimal) tplMinimal.className = "border-2 border-blue-600 bg-blue-900/10 rounded-xl p-4 cursor-pointer relative transition duration-200";
        if (iconMinimal) iconMinimal.classList.remove('hidden');
        if (tplStandard) tplStandard.className = "border-2 border-gray-800 bg-[#0b0f19] rounded-xl p-4 cursor-pointer hover:border-gray-600 transition duration-200 relative";
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
        tbody.innerHTML = '<tr><td colspan="5" class="px-4 py-10 text-center text-gray-600">Vui lòng kết nối ví MetaMask để xem phân quyền.</td></tr>';
        return;
    }

    tbody.innerHTML = '<tr><td colspan="5" class="px-4 py-10 text-center text-blue-500"><i class="fa-solid fa-circle-notch fa-spin me-2"></i> Đang đồng bộ phân quyền từ Blockchain...</td></tr>';

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
    const latestRankByAddr = {}; // rank mới nhất theo sự kiện — phân biệt "chưa từng được cấp" vs "đã bị tước"
    try {
        if (web3.contract) {
            const roleEvents = await web3.getEventsInChunks(web3.contract.filters.RoleAssigned(), 'role_events');
            for (let ev of roleEvents) latestRankByAddr[String(ev.args[1]).toLowerCase()] = Number(ev.args[2]);
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
                // Rank 0 + chưa từng được cấp rank ≥1 = ví CHỜ DUYỆT (hoặc bị từ chối)
                // → chỉ nằm ở khay chờ; KHÔNG đè DB thành BỊ KHÓA, KHÔNG hiện trong bảng
                const everApproved = (latestRankByAddr[w.address.toLowerCase()] || 0) >= 1;
                if (rCode === 0 && !isViewer && !everApproved) {
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
                    if (!f.isRevoked && f.fileSize) {
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
        return tbody.innerHTML = '<tr><td colspan="5" class="px-4 py-10 text-center text-gray-600">Chưa có dữ liệu ví.</td></tr>';
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
        
        const trendIcon = storageTrend > 0 ? '<i class="fa-solid fa-arrow-trend-up mr-1 text-red-400"></i>' : '<i class="fa-solid fa-arrow-trend-down mr-1 text-emerald-400"></i>';
        const trendColor = storageTrend > 0 ? 'text-red-400' : 'text-emerald-400';
        const zombieClass = daysOffline > 30 ? 'text-red-400 font-bold' : 'text-gray-400';
        const securityBadge = w.securityAlert ? `<span class="mt-1.5 bg-red-900/30 text-red-400 border border-red-800/50 px-2 py-0.5 rounded text-[10px] font-bold flex items-center w-max cursor-help" title="Lịch sử: ${esc(w.securityAlert)}"><i class="fa-solid fa-shield-virus mr-1"></i> Bị Cảnh Cáo</span>` : '<span class="mt-1.5 text-gray-500 text-[10px] flex items-center w-max"><i class="fa-solid fa-check text-emerald-500 mr-1"></i> An toàn</span>';

        // --- XỬ LÝ CỘT 0: CHECKBOX DÀNH CHO ADMIN ---
        // Chỉ vẽ cột checkbox này nếu người đang xem là Admin. Nếu là user thường, cột này sẽ biến mất hoàn toàn.
        // onchange được xử lý bằng event delegation trên .row-checkbox (không inline handler)
        const tdCheckboxHTML = isAdminSystem
            ? `<td class="px-3 py-2 text-center">${isThisRowAdmin ? '' : `<input type="checkbox" value="${esc(w.address)}" class="row-checkbox rounded bg-gray-900 border-gray-700 text-blue-500 cursor-pointer">`}</td>`
            : ``;

        // --- XỬ LÝ CỘT 1: CHỈ HIỂN THỊ TÊN VÀ ID ---
        let displayNameHTML = '';

        if (isThisRowAdmin) {
            displayNameHTML = `<span class="font-bold text-yellow-500 text-[13px] mb-1 uppercase tracking-wider"><i class="fa-solid fa-user-shield mr-1"></i> ADMIN HỆ THỐNG</span>`;
        } else {
            const aliasName = w.alias || '';
            displayNameHTML = aliasName
                ? `<span class="font-bold text-white text-[13px] mb-1">${esc(aliasName)}</span>`
                : `<span class="italic text-gray-600 text-[11px] mb-1">(Chưa đặt tên)</span>`;
        }

        const formattedWalletName = `
            <div class="flex flex-col justify-center">
                ${displayNameHTML}
                <span class="font-mono text-gray-400 text-[11px]">${esc(w.address.substring(0,6))}...${esc(w.address.substring(38))}</span>
            </div>
        `;

        // --- XỬ LÝ CỘT 3: BÁNH RĂNG & TRẠNG THÁI ---
        const activeStatusIcon = isRevoked
            ? '<span class="relative flex h-2 w-2 mr-2"><span class="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span></span><span class="text-red-400 font-bold text-[10px]">TẠM KHÓA</span>'
            : '<span class="relative flex h-2 w-2 mr-2"><span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span><span class="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span></span><span class="text-emerald-400 font-bold text-[10px]">ĐANG HOẠT ĐỘNG</span>';

        // Bánh răng: Đã được chặn sẵn, chỉ hiện nếu là Admin
        const gearBtn = (isAdminSystem && !isThisRowAdmin)
            ? `<button data-act="wallet-settings" data-v="${esc(w.address)}" data-status="${esc(w.status)}" data-role="${esc(w.role)}" data-alias="${esc(w.alias || '')}" class="text-gray-500 hover:text-white transition bg-gray-800 p-1.5 rounded border border-gray-700 hover:bg-gray-700 ml-4 shadow" title="Tùy chọn quản lý"><i class="fa-solid fa-gear"></i></button>`
            : '';

        // Ép % width thành số an toàn — dữ liệu DB không được chui vào attribute style
        const pct = (v) => Math.min(100, Math.max(0, Number(v) || 0));

        return `
        <tr class="border-b border-gray-800 hover:bg-[#1f2937]/30 transition ${isRevoked ? 'opacity-60' : ''}" data-row-addr="${esc((w.address||'').toLowerCase())}">
            ${tdCheckboxHTML}
            <td class="py-1.5 px-2">
                <div class="p-2 cursor-pointer group hover:bg-gray-800 rounded-lg transition-all inline-block w-full" data-act="wallet-preview" data-v="${esc(w.address || '')}" title="Nhấn để xem Hồ Sơ Tài Khoản">
                    ${formattedWalletName}
                </div>
            </td>
            <td class="py-1.5 px-2 pr-4">
                <div class="p-2 cursor-pointer group hover:bg-gray-800 rounded-lg transition-all inline-block w-full max-w-[240px]" data-act="storage" data-v="${esc(w.address || '')}" title="Nhấn để xem chi tiết tài liệu đã up">
                    <div class="w-full bg-gray-900 border border-gray-700/50 rounded-full h-1.5 flex overflow-hidden mb-1 group-hover:ring-1 group-hover:ring-blue-500 transition-all">
                        <div class="bg-blue-500 h-1.5" style="width: ${pct(fileTypes.pdf)}%"></div>
                        <div class="bg-purple-500 h-1.5" style="width: ${pct(fileTypes.img)}%"></div>
                        <div class="bg-orange-500 h-1.5" style="width: ${pct(fileTypes.zip)}%"></div>
                    </div>
                    <div class="flex justify-between items-end mb-1 mt-2">
                        <span class="text-xs text-gray-400 font-bold group-hover:text-white transition">
                            ${esc(storageUsed)} MB <span class="text-gray-600 font-normal group-hover:text-gray-400 transition">/ ${esc(storageLimit)} MB</span>
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
        return Swal.fire({ title: 'Lỗi định dạng', text: 'Địa chỉ ví không hợp lệ!', icon: 'warning', background: '#111827', color: '#fff' });
    }

    // Kiểm tra quyền hiện tại trên chain trước khi mở MetaMask —
    // tránh ký giao dịch vô nghĩa (khóa ví chưa có quyền, cấp lại đúng quyền cũ)
    let currentRank = null;
    try {
        const currentRole = await web3.getUserRole(address);
        if (currentRole === 99) {
            return Swal.fire({ title: 'Không thể thực hiện', text: 'Đây là ví Admin gốc của hệ thống — Smart Contract không cho phép thay đổi quyền của nó.', icon: 'warning', background: '#111827', color: '#fff' });
        }
        if (currentRole !== null && currentRole !== undefined) {
            currentRank = Number(currentRole);
            if (!isViewer && roleLevel === 0 && currentRank === 0) {
                return Swal.fire({ title: 'Không cần khóa', text: 'Ví này chưa từng được cấp quyền nên không có gì để tước. Khóa chỉ áp dụng cho ví đang có quyền.', icon: 'info', background: '#111827', color: '#fff' });
            }
            if (!isViewer && roleLevel === currentRank) {
                const names = { 1: 'Nhập Liệu', 2: 'Quản Lý', 3: 'Admin' };
                return Swal.fire({ title: 'Quyền trùng lặp', text: `Ví này đang giữ sẵn quyền ${esc(names[currentRank])} rồi, không cần cấp lại.`, icon: 'info', background: '#111827', color: '#fff' });
            }
        }
    } catch (e) { /* RPC lỗi thì bỏ qua pre-check, để contract tự chặn */ }

    // Viewer: ví chưa có quyền chain + DB đã là NGƯỜI XEM → trùng lặp
    if (isViewer && currentRank === 0) {
        try {
            const wallets = await ApiService.getAllWallets();
            const w = wallets.find(x => (x.address || '').toLowerCase() === address.toLowerCase());
            if (w && w.role === 'NGƯỜI XEM' && w.status === 'ACTIVE') {
                return Swal.fire({ title: 'Quyền trùng lặp', text: 'Ví này đang là Người Xem rồi, không cần cấp lại.', icon: 'info', background: '#111827', color: '#fff' });
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

        Swal.fire({ title: 'Thành công', text: `Ví đã được cấp quyền: ${esc(roleName)}`, icon: 'success', background: '#111827', color: '#fff' });
        refreshPendingBadge(); // ví vừa duyệt biến mất khỏi khay chờ

        document.getElementById('newRoleAddress').value = '';
        if (document.getElementById('newRoleAlias')) document.getElementById('newRoleAlias').value = '';
        document.getElementById('newRoleLevel').value = '1';
        if (typeof window.loadWalletRoles === 'function') {
            // Chờ bảng ví render xong rồi cuộn tới đúng dòng ví vừa duyệt và nháy
            // sáng — admin thấy ngay ví mới xuất hiện trong bảng TÀI KHOẢN VÍ
            await window.loadWalletRoles();
            const row = document.querySelector(`tr[data-row-addr="${address.toLowerCase()}"]`);
            if (row) {
                row.scrollIntoView({ behavior: 'smooth', block: 'center' });
                row.classList.add('bg-emerald-900/40');
                setTimeout(() => row.classList.remove('bg-emerald-900/40'), 3000);
            }
        }
    } catch (error) {
        Swal.fire({ title: 'Từ chối', text: getShortError(error, 'Chỉ Admin hệ thống mới có quyền thực thi.'), icon: 'error', background: '#111827', color: '#fff' });
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
    const lockColor = isLocked ? "text-emerald-400 hover:bg-emerald-900/30 border-emerald-900/50" : "text-orange-400 hover:bg-orange-900/30 border-orange-900/50";

    const htmlContent = `
        <div class="flex flex-col gap-3 text-sm mt-4">
            <button data-act="cfg-role" data-v="${esc(address)}" data-role="${esc(currentRole)}" class="flex items-center gap-3 p-3 rounded-lg border border-gray-700 bg-gray-800 hover:bg-gray-700 text-gray-200 transition shadow-sm">
                <i class="fa-solid fa-user-shield w-5 text-blue-400"></i> Phân lại quyền ví
            </button>
            <button data-act="cfg-alias" data-v="${esc(address)}" data-alias="${esc(currentAlias || '')}" class="flex items-center gap-3 p-3 rounded-lg border border-gray-700 bg-gray-800 hover:bg-gray-700 text-gray-200 transition shadow-sm">
                <i class="fa-solid fa-pen w-5 text-blue-400"></i> Đổi tên nhân viên
            </button>
            <button data-act="cfg-lock" data-v="${esc(address)}" data-locked="${isLocked ? '1' : '0'}" class="flex items-center gap-3 p-3 rounded-lg border bg-gray-800 transition shadow-sm ${lockColor}">
                <i class="fa-solid ${lockIcon} w-5"></i> ${lockText}
            </button>
            <button data-act="cfg-delete" data-v="${esc(address)}" class="flex items-center gap-3 p-3 rounded-lg border border-red-900/50 bg-red-900/10 hover:bg-red-900/30 text-red-400 transition shadow-sm">
                <i class="fa-solid fa-trash w-5"></i> Xóa vĩnh viễn hệ thống
            </button>
        </div>
    `;

    Swal.fire({
        title: 'TÙY CHỌN TÀI KHOẢN',
        html: htmlContent,
        background: '#111827', color: '#fff',
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
                .swal2-select { background-color: #1f2937 !important; color: #ffffff !important; border: 1px solid #374151 !important; outline: none !important; }
                .swal2-select option { background-color: #1f2937 !important; color: #ffffff !important; }
            </style>
            Chọn cấp độ mới cho ví <b class="font-mono text-blue-400">${esc(address.substring(0,8))}...</b>:
        `,
        input: 'select',
        inputOptions: { '1': 'Quyền Nhập Liệu (Upload)', '2': 'Quyền Quản Lý (Upload + Thu hồi)', 'viewer': 'Quyền Người Xem (chỉ đọc)' },
        inputValue: currentRole === 'QUẢN LÝ' ? '2' : currentRole === 'NGƯỜI XEM' ? 'viewer' : '1',
        showCancelButton: true, confirmButtonText: 'Lưu thay đổi', cancelButtonText: 'Hủy',
        background: '#111827', color: '#fff', confirmButtonColor: '#10b981'
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
            Swal.fire({ title: 'Thành công', text: `Đã cấp: ${esc(roleName)}`, icon: 'success', background: '#111827', color: '#fff', timer: 1500, showConfirmButton: false });
            window.loadWalletRoles();
        } catch (err) {
            Swal.fire({ title: 'Thất bại', text: getShortError(err), icon: 'error', background: '#111827', color: '#fff' });
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
    const colorCode = isLocked ? '#10b981' : '#dc2626';

    const { isConfirmed } = await Swal.fire({
        title: `${esc(actionText)} TÀI KHOẢN?`,
        html: `Bạn đang thực hiện lệnh <b>${esc(actionText)}</b> cho ví <b class="font-mono text-blue-400">${esc(address.substring(0,8))}...</b>.<br><br><i>Hệ thống sẽ gọi MetaMask để ghi nhận trạng thái lên Blockchain.</i>`,
        icon: 'warning', 
        showCancelButton: true, 
        confirmButtonText: `Xác nhận ${esc(actionText)}`, 
        cancelButtonText: 'Hủy lệnh',
        background: '#111827', color: '#fff', confirmButtonColor: colorCode
    });

    if (isConfirmed) {
        if (isProcessing) return;
        isProcessing = true;
        try {
            UI.updateProgress(40, `Đang gửi lệnh ${actionText} lên Blockchain... Vui lòng duyệt trên MetaMask!`, "PROCESSING");
            
            await web3.assignRole(address, roleLevel); 
            await ApiService.syncWalletData(address, { status: statusName, role: roleName });

            UI.updateProgress(100, `Đã ${actionText} thành công!`, "SUCCESS");
            Swal.fire({ title: 'Hoàn tất', text: `Tài khoản đã được ${esc(actionText.toLowerCase())}.`, icon: 'success', background: '#111827', color: '#fff', timer: 1500, showConfirmButton: false });
            
            window.loadWalletRoles();
            window.checkSelection(); // Reset thanh công cụ nếu đang bật
        } catch (err) {
            Swal.fire({ title: 'Bị gián đoạn', text: getShortError(err, 'Lệnh bị hủy do bạn từ chối trên MetaMask hoặc lỗi mạng.'), icon: 'error', background: '#111827', color: '#fff' });
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
        html: `Bạn đang chuẩn bị xóa ví <b class="text-red-400 font-mono">${esc(address.substring(0,8))}...</b>.<br><br><i>Hệ thống sẽ tước quyền trên Blockchain và gỡ tài khoản này khỏi danh bạ quản lý.</i>`,
        icon: 'warning', showCancelButton: true, confirmButtonText: 'Xác nhận Xóa', cancelButtonText: 'Hủy',
        background: '#111827', color: '#fff', confirmButtonColor: '#dc2626'
    });

    if (isConfirmed) {
        if (isProcessing) return;
        isProcessing = true;
        try {
            UI.updateProgress(40, "Đang tước quyền trên Blockchain...", "PROCESSING");
            await web3.assignRole(address, 0); 
            
            // Cập nhật DB nội bộ để ẩn ví đi (Gắn cờ isDeleted)
            let wallets = JSON.parse(localStorage.getItem('bdi_authorized_wallets')) || [];
            let w = wallets.find(x => x.address.toLowerCase() === address.toLowerCase());
            if (w) {
                w.isDeleted = true;
                localStorage.setItem('bdi_authorized_wallets', JSON.stringify(wallets));
            }
            await ApiService.syncWalletData(address, { status: 'DELETED', role: 'ĐÃ XÓA' });

            UI.updateProgress(100, "Đã xóa ví thành công", "SUCCESS");
            Swal.fire({ title: 'Đã xóa', text: 'Tài khoản đã được gỡ khỏi hệ thống.', icon: 'success', background: '#111827', color: '#fff', timer: 1500, showConfirmButton: false });
            window.loadWalletRoles();
        } catch (err) {
            Swal.fire({ title: 'Thất bại', text: getShortError(err, 'Lỗi tước quyền trên chuỗi.'), icon: 'error', background: '#111827', color: '#fff' });
        } finally {
            isProcessing = false;
            setTimeout(() => UI.updateProgress(0, "Hệ thống đang rảnh", "STANDBY"), 3000);
        }
    }
};

// 4. QUICK PREVIEW DRAWER
window.openPreviewDrawer = async function(address) {
    let wallets = await ApiService.getAllWallets();
    let w = wallets.find(x => x.address === address);
    if (!w) return;

    document.getElementById('drawer-content').innerHTML = `
        <div class="p-5 border-b border-gray-800 flex justify-between items-center bg-[#111827]">
            <h3 class="text-white font-bold"><i class="fa-solid fa-user-shield text-blue-500 mr-2"></i> Hồ Sơ Tài Khoản</h3>
            <button data-act="drawer-close" class="text-gray-500 hover:text-white transition"><i class="fa-solid fa-xmark text-lg"></i></button>
        </div>
        <div class="p-5 flex-1 overflow-y-auto space-y-6">
            <div>
                <label class="text-[10px] text-gray-500 font-bold uppercase tracking-wider">TÀI KHOẢN VÍ</label>
                <div class="mt-1">${w.role === 'ADMIN' ? '<span class="text-yellow-500 font-bold text-[10px] bg-yellow-900/20 px-2 py-0.5 rounded border border-yellow-900/50">ADMIN</span>' : `<span class="text-blue-400 font-bold text-[10px] bg-blue-900/20 px-2 py-0.5 rounded border border-blue-900/50">${esc(w.role)}</span>`}</div>
            </div>
            <div class="mt-4">
                <label class="text-[10px] text-gray-500 font-bold uppercase tracking-wider">ĐỊA CHỈ VÍ</label>
                <div class="flex items-center gap-2 mt-1">
                    <div class="font-mono text-blue-400 text-sm bg-gray-900 p-2 rounded border border-gray-800 break-all flex-1">${esc(w.address)}</div>
                    <button data-act="copy" data-v="${esc(w.address)}" class="bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white p-2.5 rounded border border-gray-700 transition" title="Copy địa chỉ ví"><i class="fa-regular fa-copy"></i></button>
                </div>
            </div>
            <div class="grid grid-cols-2 gap-3 mt-4">
                <div class="bg-gray-900 p-3 rounded-lg border border-gray-800 text-center">
                    <div class="text-[10px] text-gray-500 font-bold uppercase mb-1">Đã dùng IPFS</div>
                    <div class="text-xl text-white font-bold">${esc(w.storageUsed)} <span class="text-xs text-gray-500">MB</span></div>
                </div>
                <div class="bg-gray-900 p-3 rounded-lg border border-gray-800 text-center">
                    <div class="text-[10px] text-gray-500 font-bold uppercase mb-1">Xu hướng</div>
                    <div class="text-xl ${w.storageTrend > 0 ? 'text-red-400' : 'text-emerald-400'} font-bold">${esc(w.storageTrend)}%</div>
                </div>
            </div>
            <div>
                <label class="text-[10px] text-gray-500 font-bold uppercase tracking-wider mb-2 block">Cảnh báo bảo mật</label>
                <div class="text-xs p-3 rounded border ${w.securityAlert ? 'bg-red-900/20 border-red-900/50 text-red-400' : 'bg-emerald-900/20 border-emerald-900/50 text-emerald-400'}">
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

window.toggleAllCheckboxes = function(source) {
    const checkboxes = document.querySelectorAll('.row-checkbox'); 
    checkboxes.forEach(cb => cb.checked = source.checked); 
    window.checkSelection();
};

window.checkSelection = function() {
    const checkedBoxes = document.querySelectorAll('#wallet-roles-table-body .row-checkbox:checked'); 
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
        background: '#111827', color: '#fff', confirmButtonColor: '#dc2626'
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
        Swal.fire({ title: 'Hoàn tất', text: `Đã khóa thành công ${esc(successCount)} ví.`, icon: 'success', background: '#111827', color: '#fff' });
    } catch (err) {
        Swal.fire({ title: 'Bị gián đoạn', text: getShortError(err, 'Quá trình bị hủy do bạn từ chối trên MetaMask.'), icon: 'error', background: '#111827', color: '#fff' });
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
        background: '#111827', color: '#fff', confirmButtonColor: '#10b981'
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
        Swal.fire({ title: 'Hoàn tất', text: `Đã khôi phục hoạt động cho ${esc(successCount)} ví.`, icon: 'success', background: '#111827', color: '#fff' });
    } catch (err) {
        Swal.fire({ title: 'Bị gián đoạn', text: getShortError(err, 'Quá trình bị hủy do bạn từ chối trên MetaMask.'), icon: 'error', background: '#111827', color: '#fff' });
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
        inputPlaceholder: 'Nhập nội dung thông báo (VD: Yêu cầu cập nhật chứng từ tháng này)...',
        showCancelButton: true,
        confirmButtonText: '<i class="fa-solid fa-paper-plane mr-1"></i> Gửi thông báo',
        cancelButtonText: 'Hủy',
        background: '#111827', color: '#fff', confirmButtonColor: '#3b82f6'
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
                background: '#111827', color: '#fff',
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
        roleSpan.className = isAdmin ? "text-yellow-500 font-bold text-[10px] bg-yellow-900/20 px-2 py-0.5 rounded border border-yellow-900/50 inline-block" : "text-blue-400 font-bold text-[10px] bg-blue-900/20 px-2 py-0.5 rounded border border-blue-900/50 inline-block";
    }
    
    modal.classList.remove('hidden');
    tbody.innerHTML = '<tr><td colspan="5" class="px-4 py-10 text-center text-blue-500"><i class="fa-solid fa-circle-notch fa-spin me-2"></i> Đang trích xuất dữ liệu sổ cái...</td></tr>';
    
    try {
        let html = ''; let stt = 1;
        const seenDocIds = new Set(); // chống 1 docId render 2 dòng (on-chain + MongoDB)

        // Tra metadata MongoDB trước để bổ sung dung lượng cho dòng on-chain
        const localBatches = await ApiService.getBatchesFromDatabase();
        const mongoByDocId = {};
        for (const b of localBatches) for (const f of (b.files || [])) mongoByDocId[f.docId] = f;

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
                    const mongoFile = mongoByDocId[docId];
                    const sizeText = (mongoFile && mongoFile.fileSize) || '---';
                    let fileName = docId.replace(/_\d+$/, '').replace(/\.enc$/, '');
                    const statusBadge = isRevoked ? '<span class="bg-red-900/40 text-red-400 px-2 py-1 rounded text-[10px] font-bold">BỊ THU HỒI</span>' : '<span class="bg-emerald-900/40 text-emerald-400 px-2 py-1 rounded text-[10px] font-bold uppercase">HỢP LỆ</span>';
                    
                    // Nút xem/tải chỉ hiện nếu file chưa bị thu hồi
                    const downloadBtn = isRevoked ? '' : `<button data-act="preview" data-v="${esc(ipfsLink)}" data-name="${esc(fileName)}" data-id="${esc(docId)}" class="ml-2 text-emerald-400 hover:text-emerald-300 text-[11px] bg-emerald-900/20 px-2 py-1 rounded border border-emerald-900/50 transition" title="Xem trực tiếp"><i class="fa-solid fa-eye mr-1"></i> Xem</button><button data-act="decrypt" data-v="${esc(ipfsLink)}" data-name="${esc(fileName)}" data-id="${esc(docId)}" class="ml-2 text-blue-400 hover:text-blue-300 text-[11px] bg-blue-900/20 px-2 py-1 rounded border border-blue-900/50 transition" title="Tải & Giải mã"><i class="fa-solid fa-download mr-1"></i> Tải về</button>`;

                    html += `
                    <tr class="border-b border-gray-800 hover:bg-[#1f2937] transition ${isRevoked ? 'opacity-50' : ''}">
                        <td class="px-3 py-2 font-bold text-center text-gray-500">${stt++}</td>
                        <td class="px-3 py-2 font-mono text-blue-400 text-xs">
                        <div class="flex items-center">
                        <span class="truncate max-w-[120px]" title="${esc(docId)}">${esc(docId)}</span>
                        <button data-act="copy" data-v="${esc(docId)}" class="ml-2 text-gray-400 hover:text-white"><i class="fa-regular fa-copy"></i></button>
                        </div>
                        <div class="mt-1 text-[11px] text-gray-400 font-sans truncate max-w-[150px]" title="${esc(fileName)}">File: ${esc(fileName)}</div>
                        </td>
                        <td class="px-3 py-2 text-left font-mono text-[11px] text-gray-300">${esc(sizeText)}</td>
                        <td class="px-3 py-2 text-xs text-gray-400">${esc(createTime)}</td>
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
                    const statusBadge = isRevoked ? '<span class="bg-red-900/40 text-red-400 px-2 py-1 rounded text-[10px] font-bold">BỊ THU HỒI</span>' : '<span class="bg-emerald-900/40 text-emerald-400 px-2 py-1 rounded text-[10px] font-bold uppercase">HỢP LỆ</span>';
                    
                    // Nút xem/tải chỉ hiện nếu file chưa bị thu hồi
                    const downloadBtn = isRevoked ? '' : `<button data-act="preview" data-v="${esc(fileDoc.ipfsCID)}" data-name="${esc(fileDoc.fileName)}" data-id="${esc(fileDoc.docId)}" class="ml-2 text-emerald-400 hover:text-emerald-300 text-[11px] bg-emerald-900/20 px-2 py-1 rounded border border-emerald-900/50 transition" title="Xem trực tiếp"><i class="fa-solid fa-eye mr-1"></i> Xem</button><button data-act="decrypt" data-v="${esc(fileDoc.ipfsCID)}" data-name="${esc(fileDoc.fileName)}" data-id="${esc(fileDoc.docId)}" class="ml-2 text-blue-400 hover:text-blue-300 text-[11px] bg-blue-900/20 px-2 py-1 rounded border border-blue-900/50 transition" title="Tải & Giải mã"><i class="fa-solid fa-download mr-1"></i> Tải về</button>`;

                    html += `
                    <tr class="border-b border-gray-800 hover:bg-[#1f2937] transition ${isRevoked ? 'opacity-50' : ''}">
                        <td class="px-3 py-2 font-bold text-center text-gray-500">${stt++}</td>
                        <td class="px-3 py-2 font-mono text-blue-400 text-xs">
                        <div class="flex items-center">
                            <span class="truncate max-w-[120px]" title="${esc(fileDoc.docId)}">${esc(fileDoc.docId)}</span>
                            <button data-act="copy" data-v="${esc(fileDoc.docId)}" class="ml-2 text-gray-400 hover:text-white"><i class="fa-regular fa-copy"></i></button>
                            </div>
                        </td>
                        <td class="px-3 py-2 text-left font-mono text-[11px] text-gray-300">${esc(fileDoc.fileSize || '---')}</td>
                        <td class="px-3 py-2 text-xs text-gray-400">${esc(createTime)}</td>
                        <td class="px-3 py-2 text-center flex justify-center items-center">
                            ${statusBadge} ${downloadBtn}
                        </td>
                    </tr>`;
                });
            }
        }
        
        tbody.innerHTML = html === '' ? '<tr><td colspan="5" class="px-4 py-10 text-center text-gray-500">Ví này chưa tải lên tài liệu nào.</td></tr>' : html;
    } catch (error) {
        tbody.innerHTML = '<tr><td colspan="5" class="px-4 py-10 text-center text-red-500">Lỗi khi truy xuất Blockchain. Hãy chắc chắn bạn đã kết nối ví.</td></tr>';
    }
};
// =====================================================================
// TÍNH NĂNG TẢI VỀ VÀ GIẢI MÃ TÀI LIỆU (VƯỢT TƯỜNG LỬA CORS)
// =====================================================================
// Lấy khóa giải mã: ưu tiên key escrow trên server (uploader hoặc QUẢN LÝ+),
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
        inputPlaceholder: 'Nhập mật khẩu...',
        background: '#111827', color: '#fff',
        confirmButtonColor: '#10b981', showCancelButton: true, cancelButtonText: 'Hủy'
    });
    return secretKey || null;
}

// Tải file mã hóa từ IPFS (nhiều gateway dự phòng) rồi giải mã AES → trả Blob gốc
async function fetchDecryptedBlob(ipfsCID, secretKey, originalFileName) {
    let encryptedText = "";
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

    encryptedText = await response.text();

    UI.updateProgress(70, "Đã vượt tường lửa lấy được tệp. Đang giải mã...", "DECRYPTING");

    // 5. Giải mã dữ liệu
    const decryptedBytes = CryptoJS.AES.decrypt(encryptedText, secretKey);
    const base64File = decryptedBytes.toString(CryptoJS.enc.Utf8);

    if (!base64File) throw new Error("WRONG_PASSWORD");

    UI.updateProgress(90, "Đang khôi phục định dạng...", "PROCESSING");

    // 6. Chuyển đổi dữ liệu để tải
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

    if (cidInvalid(ipfsCID)) { win.close(); return Swal.fire({ title: 'Dữ Liệu Không Hợp Lệ', text: INVALID_CID_MSG, icon: 'error', background: '#111827', color: '#fff' }); }
    if (isProcessing) { win.close(); return; }

    isProcessing = true;
    UI.updateProgress(30, "Đang lấy khóa và tải tệp để xem trước...", "PREVIEWING");
    try {
        const secretKey = await resolveDocKey(docId, originalFileName);
        if (!secretKey) { win.close(); isProcessing = false; return; }

        const { blob, mimeType } = await fetchDecryptedBlob(ipfsCID, secretKey, originalFileName);
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
            // Nạp lib vào tab con (script chạy trong context tab → docx render đúng document)
            const loadLib = (src) => new Promise((res, rej) => {
                const s = win.document.createElement('script');
                s.src = src; s.onload = res; s.onerror = rej;
                win.document.head.appendChild(s);
            });
            await loadLib(`${location.origin}/node_modules/jszip/dist/jszip.min.js`);
            await loadLib(`${location.origin}/node_modules/docx-preview/dist/docx-preview.min.js`);
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
        return Swal.fire({ title: 'Dữ Liệu Không Hợp Lệ', text: INVALID_CID_MSG, icon: 'error', background: '#111827', color: '#fff' });
    }
    if (isProcessing) return;

    const secretKey = await resolveDocKey(docId, originalFileName);
    if (!secretKey) return;

    isProcessing = true;
    UI.updateProgress(30, "Đang kết nối qua trạm trung chuyển...", "DOWNLOADING");
    try {
        const { blob } = await fetchDecryptedBlob(ipfsCID, secretKey, originalFileName);
        saveBlob(blob, originalFileName);
        UI.updateProgress(100, "Truy xuất thành công!", "SUCCESS");
        Swal.fire({
            title: `Đã giải mã "${esc(originalFileName)}"`,
            toast: true, position: 'top-end', timer: 2200, showConfirmButton: false,
            icon: 'success', background: '#111827', color: '#fff'
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
        Swal.fire({ title: 'Lỗi Kết Nối', text: 'Mạng IPFS không phản hồi. Vui lòng kiểm tra lại đường truyền internet.', icon: 'error', background: '#111827', color: '#fff' });
    } else if (error.message === "WRONG_PASSWORD") {
        Swal.fire({ title: 'Sai Mật Khẩu!', text: 'Mật khẩu giải mã không chính xác.', icon: 'error', background: '#111827', color: '#fff' });
    } else {
        Swal.fire({ title: 'Lỗi', text: esc(error.message), icon: 'error', background: '#111827', color: '#fff' });
    }
}
window.closeStorageModal = function() { document.getElementById('storage-modal-overlay').classList.add('hidden'); };