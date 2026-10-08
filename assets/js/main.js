import { UI } from './uiHandler.js';
import { Web3Service } from './web3Service.js';
import { ApiService } from './apiService.js';

const web3 = new Web3Service();
let isProcessing = false;
let lastCertData = null;

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
        logEntry.innerHTML = `<span class="text-gray-600">[${time}]</span> >${message}`;

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
    const adminAddr = "0x8b10e25a2c6f91a5969b8db38b88b9e1002e1911";
    const target = address.toLowerCase();
    const shortAddr = `${address.substring(0, 6)}...${address.substring(38)}`;
    
    let wallets = JSON.parse(localStorage.getItem('bdi_authorized_wallets')) || [];
    let w = wallets.find(x => x.address.toLowerCase() === target);
    let displayName = (w && w.alias) ? `<span class="font-bold text-white">${w.alias}</span> <span class="text-[9px] text-gray-500">(${shortAddr})</span>` : shortAddr;

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

window.filterHistoryTable = () => {
    const input = document.getElementById('search-history-input')?.value.toLowerCase().trim() || '';
    const rows = document.querySelectorAll('#history-table-body tr');
    rows.forEach(row => {
        const searchData = row.getAttribute('data-search') || row.innerText.toLowerCase();
        row.style.display = searchData.includes(input) ? '' : 'none';
    });
};

window.filterRevokedTable = () => {
    const input = document.getElementById('search-revoked-input')?.value.toLowerCase().trim() || '';
    const rows = document.querySelectorAll('#revoked-table-body tr');
    rows.forEach(row => {
        const searchData = row.getAttribute('data-search') || row.innerText.toLowerCase();
        row.style.display = searchData.includes(input) ? '' : 'none';
    });
};

function getShortError(err, customRevertMsg) {
    const msg = String(err.message || err);
    if (err.code === 'ACTION_REJECTED' || msg.includes('user rejected')) return 'Bạn đã chủ động hủy bỏ giao dịch trên ví MetaMask.';
    if (msg.includes('insufficient funds')) return 'Ví của bạn không đủ số dư Sepolia ETH để trả phí Gas.';
    if (msg.includes('revert')) return customRevertMsg || 'Giao dịch bị từ chối bởi Blockchain (sai trạng thái).';
    return err.shortMessage || 'Đã xảy ra lỗi kết nối mạng. Vui lòng thử lại.';
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
                if (menu === 'roles' && typeof window.loadWalletRoles === 'function') window.loadWalletRoles();
            });
        }
    });

    const uploadDropZone = document.getElementById('uploadDropZone');
    const uploadFileInput = document.getElementById('uploadFile');
    if (uploadDropZone && uploadFileInput) {
        uploadDropZone.addEventListener('click', (e) => { if (e.target !== uploadFileInput) uploadFileInput.click(); });
        uploadFileInput.addEventListener('click', (e) => e.stopPropagation());
        uploadFileInput.addEventListener('change', () => UI.updateFileName('uploadFile'));
    }

    const verifyDropZone = document.getElementById('verifyDropZone');
    const verifyFileInput = document.getElementById('verifyFile');
    if (verifyDropZone && verifyFileInput) {
        verifyDropZone.addEventListener('click', (e) => { if (e.target !== verifyFileInput) verifyFileInput.click(); });
        verifyFileInput.addEventListener('click', (e) => e.stopPropagation());
        verifyFileInput.addEventListener('change', () => UI.updateFileName('verifyFile'));
    }

    document.getElementById('btn-connect')?.addEventListener('click', connectWallet);
    document.getElementById('btn-execute-upload')?.addEventListener('click', handleUpload);
    document.getElementById('btn-execute-verify')?.addEventListener('click', handleVerify);
    document.getElementById('btn-refresh-history')?.addEventListener('click', loadTransactionHistory);
    document.getElementById('btn-refresh-revoked')?.addEventListener('click', loadRevokedHistory);
    document.getElementById('btn-save-rpc')?.addEventListener('click', saveRpcConfig);
    document.getElementById('btn-save-settings')?.addEventListener('click', saveSystemSettings);
    document.getElementById('btn-login-wallet')?.addEventListener('click', connectWallet);
    document.getElementById('btn-generate-api')?.addEventListener('click', generateNewApiKey);

    refreshMetricsLoop();
    loadAPIKeys();
    if (typeof window.loadWalletRoles === 'function') window.loadWalletRoles();
});

// =====================================================================
// ĐỒNG BỘ SỐ LIỆU DASHBOARD (HÀM TẬP TRUNG)
// =====================================================================
async function syncDashboardData() {
    try {
        // 1. Lấy dữ liệu On-chain từ Blockchain
        const metrics = await web3.getLiveMetrics();
        
        // 2. Tính số lượng ví được cấp quyền từ Database
        let wallets = await ApiService.getAllWallets();
        metrics.issuerCount = wallets.filter(w => w.status !== 'REVOKED').length;

        // 3. Cộng dồn số tài liệu từ các lô Merkle Batch
        const localBatches = await ApiService.getBatchesFromDatabase();
        let batchFileCount = 0;
        localBatches.forEach(b => {
            if (b.files) {
                // Đếm file CHƯA bị thu hồi
                batchFileCount += b.files.filter(f => !f.isRevoked).length;
            }
        });
        metrics.docCount = (metrics.docCount || 0) + batchFileCount;

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
async function connectWallet() {
    if (isProcessing) return;
    isProcessing = true;
    try {
        const { account, isAdmin } = await web3.connectWallet();

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
        if (isAdmin && profileName) profileName.innerText = 'Admin LLinh';
        else if (profileName) profileName.innerText = 'Người Dùng';

        if (typeof window.loadWalletRoles === 'function') window.loadWalletRoles();
        await syncDashboardData();
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

    isProcessing = true;
    UI.updateProgress(10, "Đang quét Pre-check trên Sổ cái...", "SCANNING");
    
    window.uploadQueue = { newFiles: [], revokedFiles: [], activeFiles: [], approvedFiles: [] };
    const contract = web3.contract;

    try {
        if (!contract) throw new Error("Chưa kết nối ví");

        // Quét từng file để phân loại
        for (let i = 0; i < filesToUpload.length; i++) {
            const file = filesToUpload[i];
            const arrayBuffer = await file.arrayBuffer();
            const uint8Array = new Uint8Array(arrayBuffer);
            const wordArray = CryptoJS.lib.WordArray.create(uint8Array);
            const currentHash = CryptoJS.SHA256(wordArray).toString(CryptoJS.enc.Hex);
            
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
                        <span class="font-bold text-red-400 text-xs truncate max-w-[200px]" title="${f.name}">${f.name}</span>
                        <span class="text-[10px] text-gray-500 font-mono">${f.size}</span>
                    </div>
                    <div class="text-[9px] text-gray-500 font-mono truncate max-w-[250px]">ID cũ: ${f.oldId}</div>
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
                        <span class="font-bold text-yellow-400 text-xs truncate max-w-[200px]" title="${f.name}">${f.name}</span>
                        <span class="text-[10px] text-gray-500 font-mono">${f.size}</span>
                    </div>
                    <div class="text-[9px] text-gray-500 font-mono truncate max-w-[250px]">ID gốc: ${f.oldId}</div>
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
    const { value: secretKey } = await Swal.fire({
        title: 'BẢO MẬT AES-256', 
        text: `Nhập mật khẩu mã hóa cho ${finalFiles.length} tệp tin đã được xét duyệt:`,
        input: 'password', inputPlaceholder: 'Nhập khóa bí mật...', 
        background: '#111827', color: '#fff',
        confirmButtonColor: '#2563eb', showCancelButton: true, cancelButtonText: 'Hủy'
    });

    // Nếu bấm Hủy -> Bắt buộcmở khóa hệ thống
    if (!secretKey) {
        isProcessing = false; 
        return;
    }
    
    // Bật khóa chống click đúp
    isProcessing = true; 
    
    //await ÉP HỆ THỐNG CHỜ CHẠY XONG MỚI TIẾP
    await executeUploadCore(finalFiles, secretKey); 
}

// LUỒNG MÃ HÓA, IPFS VÀ BLOCKCHAIN 
async function executeUploadCore(fileDataArray, secretKey) {
    isProcessing = true;
    try {
        let uploadedDocs = [];
        let leaves = [];

        for (let i = 0; i < fileDataArray.length; i++) {
            const fileItem = fileDataArray[i];
            const file = fileItem.fileObj;
            
            UI.updateProgress(20, `Đang mã hóa file ${i + 1}/${fileDataArray.length}:${file.name}...`, "ENCRYPTING");
            leaves.push("0x" + fileItem.hash);
            
            // AES Mã hóa
            const arrayBuffer = await file.arrayBuffer();
            const uint8Array = new Uint8Array(arrayBuffer);
            let binaryString = '';
            for (let j = 0; j < uint8Array.length; j++) binaryString += String.fromCharCode(uint8Array[j]);
            
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
                qrCode: qrCodeBase64
            });
        }

        UI.updateProgress(65, "Đang tính toán Merkle Root và chốt lô...", "MERKLE TREE");
        const tree = new window.MerkleTree(leaves, window.keccak256, { sortPairs: true });
        const merkleRoot = tree.getHexRoot();
        const batchId = `BATCH_${Date.now()}`;
        
        const manifestBlob = new Blob([JSON.stringify({ batchId, merkleRoot, timestamp: Date.now(), files: uploadedDocs })], { type: 'application/json' });
        const manifestUpload = await ApiService.uploadFileWithProgress(new File([manifestBlob], `${batchId}_manifest.json`), () => {});

        UI.updateProgress(85, "Đang chờ chữ ký MetaMask (Ký 1 lần duy nhất cho toàn bộ tệp)...", "SIGNING");
        const txHash = await web3.addMerkleBatch(batchId, merkleRoot, manifestUpload.ipfsCID);
        
        // LƯU DB MONGODB
        const currentWalletAddr = web3.currentAccount ? web3.currentAccount.toLowerCase() : "0x8b10e25a2c6f91a5969b8db38b88b9e1002e1911".toLowerCase();
        const batchData = { batchId, merkleRoot, ipfsCID: manifestUpload.ipfsCID, txHash, timestamp: Date.now(), uploader: currentWalletAddr, files: uploadedDocs };
        
        try {
            await ApiService.saveBatchToDatabase(batchData);
            
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
        let batchResultHtml = `<p class="text-xs text-emerald-400 mb-3 font-bold">✓ Cây Merkle đã khởi tạo. Ký 1 lần cho ${uploadedDocs.length} tệp!</p><div class="max-h-[200px] overflow-y-auto space-y-2 pr-1 custom-scrollbar mb-4">`;
        uploadedDocs.forEach((doc) => {
            batchResultHtml += `
                <div class="bg-[#0b0f19] border border-gray-800 p-2.5 rounded-lg flex justify-between items-center group">
                    <div class="text-left overflow-hidden">
                        <div class="text-[11px] text-gray-500 font-medium truncate w-56 mb-0.5">${doc.fileName} (${doc.fileSize})</div>
                        <div class="text-blue-400 font-mono text-xs truncate w-56">${doc.docId}</div>
                    </div>
                    <button onclick="copyDocId('${doc.docId}')" class="text-gray-500 hover:text-white transition bg-gray-800/50 p-2 rounded"><i class="fa-regular fa-copy"></i></button>
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
                <p class="text-gray-400 mb-1">Ví tạo: <span class="text-emerald-400 font-mono">${uploaderWallet}</span></p>
                <p class="text-gray-400">Thời gian khắc chuỗi: <span class="text-white">${timestamp}</span></p>
            </div>`;

        if (currentHash.toLowerCase() === originalHash.toLowerCase()) {
            const isRevoked = docData[4];
            const revocationReason = docData[5];

            if (isRevoked) {
                UI.updateProgress(100, "Tài liệu nguyên bản nhưng ĐÃ BỊ VÔ HIỆU HÓA.", "REVOKED");
                Swal.fire({
                    title: 'TÀI LIỆU ĐÃ BỊ THU HỒI!', icon: 'error', background: '#111827', color: '#fff',
                    html: `
                        <div class="text-left text-sm text-gray-300 space-y-3">
                            <p>Mã băm hoàn toàn trùng khớp với bản gốc, tuy nhiên tài liệu này đã bị <b class="text-red-500">VÔ HIỆU HÓA</b> bởi cơ quan phát hành.</p>
                            <div class="bg-red-900/20 border border-red-800 p-3 rounded text-red-400"><b>Lý do thu hồi:</b> ${revocationReason}</div>
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
                        <button onclick="triggerDownloadPdf()" class="w-full mt-4 bg-emerald-600 hover:bg-emerald-500 text-white py-2 rounded-lg text-sm font-bold shadow-md transition">
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
                        <p class="text-gray-200 text-xs italic leading-relaxed">"${backendResult.aiReport}"</p>
                    </div>`;
            }

            if (backendResult.differences && backendResult.differences.length > 0) {
                html += '<div class="bg-[#0b0f19] text-gray-300 p-4 rounded-lg text-left font-mono max-h-[300px] overflow-y-auto text-xs mt-3 border border-gray-800 leading-relaxed">';
                backendResult.differences.forEach(p => {
                    const bg = p.added ? '#065f46' : p.removed ? '#7f1d1d' : 'transparent';
                    const color = (p.added || p.removed) ? '#fff' : '#9ca3af';
                    const dec = p.removed ? 'line-through' : 'none';
                    html += `<span style="background-color:${bg}; color:${color}; text-decoration:${dec}; padding: 1px 3px; border-radius: 2px;">${p.value.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</span>`;
                });
                html += '</div>';
            } else if (backendResult.imageDiff) {
                html += `<div class="mt-3 text-center"><img src="${backendResult.imageDiff}" class="max-w-full max-h-[300px] border border-red-900 rounded-lg mx-auto shadow-lg bg-[#0b0f19]"></div>`;
            } else if (!backendResult.aiReport) {
                html += `
                    <div class="bg-[#0b0f19] text-gray-300 p-4 rounded-lg text-left text-xs mt-3 border border-gray-800 space-y-3">
                        <p class="text-gray-400">Mã băm không khớp. Không thể tạo bản đồ trực quan (Sai mật khẩu giải mã hoặc lỗi IPFS).</p>
                        <div class="pt-3 font-mono text-[11px] space-y-1">
                            <p class="text-emerald-400 break-all"><b>Hash gốc:</b> ${originalHash}</p>
                            <p class="text-red-400 break-all"><b>Hash tải lên:</b> ${currentHash}</p>
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
    } finally { 
        isProcessing = false; 
    }
}

// =====================================================================
// XỬ LÝ LỊCH SỬ THU HỒI VÀ HOÀN TRẢ DUNG LƯỢNG
// =====================================================================
window.revokeDoc = async (docId) => {
    if (isProcessing) return;

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
            // Mặc định fallback về Admin nếu Blockchain không phản hồi kịp
            uploaderWallet = "0x8B10E25a2C6f91a5969b8db38B88B9e1002E1911";
        }
    }

    const { value: reason } = await Swal.fire({
        title: 'THU HỒI TÀI LIỆU', text: `Bạn đang vô hiệu hóa tài liệu ID: ${docId}`, 
        input: 'text', inputPlaceholder: 'Nhập lý do thu hồi (Bắt buộc)...',
        icon: 'warning', showCancelButton: true, confirmButtonText: 'Xác nhận Thu hồi', cancelButtonText: 'Hủy', 
        background: '#111827', color: '#fff', confirmButtonColor: '#dc2626',
        inputValidator: (value) => { if (!value) return 'Vui lòng nhập lý do thu hồi!'; }
    });

    if (reason) {
        isProcessing = true;
        try {
            UI.updateProgress(30, "Đang phân tích định dạng lưu trữ của tài liệu...", "PROCESSING");
if (isBatchFile) {
                // XỬ LÝ OFF-CHAIN (Mạng nội bộ qua MongoDB)
                UI.updateProgress(40, "Đang chờ chữ ký xác thực từ MetaMask...", "SIGNING");
                const signMessage = `HỆ THỐNG DATA INTEGRITY\n\nXác nhận thu hồi tài liệu Off-chain:\n- ID: ${docId}\n- Lý do: ${reason}\n- Thời gian: ${new Date().toLocaleString('vi-VN')}`;
                await web3.signer.signMessage(signMessage); 

                UI.updateProgress(60, "Xác thực thành công! Đang ghi nhận vào Database...", "REVOKING");
                
                // GỌI THẲNG API ĐẾN MONGODB ĐỂ CẬP NHẬT TRẠNG THÁI THU HỒI VĨNH VIỄN
                await fetch('http://localhost:3000/api/batches/revoke', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        docId: docId,
                        reason: reason,
                        revokedBy: web3.currentAccount || "0x8B10E25a2C6f91a5969b8db38B88B9e1002E1911"
                    })
                });
                await new Promise(resolve => setTimeout(resolve, 1000));

            } else {
                // XỬ LÝ ON-CHAIN (Giao dịch thật)
                UI.updateProgress(60, "Đang gửi lệnh thu hồi lên Blockchain...", "REVOKING");
                await web3.revokeDocument(docId, reason); 
            }

            // 2. TÍNH TOÁN VÀ TRỪ DUNG LƯỢNG TRÊN ĐÚNG VÍ NGƯỜI TẢI LÊN
            if (fileInfo && fileInfo.fileSize) {
                if (fileInfo.fileSize.includes('MB')) sizeToDeduct = parseFloat(fileInfo.fileSize);
                else if (fileInfo.fileSize.includes('KB')) sizeToDeduct = parseFloat(fileInfo.fileSize) / 1024;
            }

            const targetWallet = uploaderWallet ? uploaderWallet.toLowerCase() : "0x8B10E25a2C6f91a5969b8db38B88B9e1002E1911".toLowerCase();
            let wallets = await ApiService.getAllWallets();
            let targetWalletData = wallets.find(w => w.address.toLowerCase() === targetWallet);
            
            if (targetWalletData) {
                // Thuật toán Math.max đảm bảo dung lượng không bao giờ bị âm
                let newStorage = Math.max(0, Number(((targetWalletData.storageUsed || 0) - sizeToDeduct).toFixed(2)));
                await ApiService.syncWalletData(targetWallet, { storageUsed: newStorage });
            }
            
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
    
    tbody.innerHTML = '<tr><td colspan="5" class="px-4 py-10 text-center text-blue-500"><i class="fa-solid fa-circle-notch fa-spin me-2"></i> Đang quét sổ cái Blockchain...</td></tr>';
    
    try {
        let html = '';
        let stt = 1;

        // 1. Quét file On-chain
        const events = await web3.queryHistory();
        if (events && events.length > 0) {
            for (let ev of [...events].reverse()) {
                const docId = ev.args[0]; 
                const hash = ev.args[1];
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
                
                if (isRevoked) continue;
                
                let fileName = docId.replace(/_\d+$/, '').replace(/\.enc$/, '');
                const searchPayload = `${docId} ${fileName} ${uploader} ${createTime} ${hash}`.toLowerCase();
                
                html += `
                <tr class="border-b border-gray-800 hover:bg-[#1f2937] transition" data-search="${searchPayload}">
                    <td class="px-4 py-3 font-bold text-center text-gray-500">${stt++}</td>
                        <td class="px-4 py-3 font-mono text-blue-400 text-xs">
                            <div class="flex items-center"><span class="truncate max-w-[120px] inline-block" title="${docId}">${docId}</span></div>
                            <div class="mt-1 text-[11px] text-gray-400 font-sans">File: ${fileName}</div>
                            <div class="mt-1.5 flex gap-3">
                                <button onclick="copyDocId('${docId}')" class="text-gray-400 hover:text-white transition text-[11px]"><i class="fa-regular fa-copy mr-1"></i>Copy</button>
                                <button onclick="revokeDoc('${docId}')" class="text-red-400 hover:text-red-300 transition text-[11px]"><i class="fa-solid fa-ban mr-1"></i>Thu hồi</button>
                            </div>
                        </td>
                    <td class="px-4 py-3 text-xs text-gray-300">
                        <div class="mb-1">${window.getWalletName(uploader)}</div>
                        <div class="text-gray-400 text-[11px] font-medium"><i class="fa-regular fa-clock mr-1"></i>${createTime}</div>
                    </td>
                    <td class="px-4 py-3 font-mono text-[10px] text-gray-500">
                        <div class="text-gray-400 mb-1 truncate max-w-[150px]" title="${hash}">${hash}</div>
                        <div class="flex items-center gap-3">
                            <a href="https://ipfs.io/ipfs/${ipfsLink}" target="_blank" title="Xem file mã hóa gốc trên IPFS" class="text-emerald-500 hover:text-emerald-400 text-[10px] uppercase font-bold transition">
                                <i class="fa-solid fa-cloud mr-1"></i> IPFS
                            </a>
                            <button onclick="downloadAndDecrypt('${ipfsLink}', '${fileName}')" title="Giải mã và tải tệp gốc về máy" class="text-blue-400 hover:text-blue-300 text-[10px] uppercase font-bold transition bg-blue-900/20 px-2 py-0.5 rounded border border-blue-900/50">
                                <i class="fa-solid fa-download mr-1"></i> Giải Mã
                            </button>
                        </div>
                    </td>
                    <td class="px-4 py-3 text-center"><span class="bg-blue-900/40 text-blue-400 px-2 py-1 rounded text-[10px] font-bold uppercase">ON-CHAIN</span></td>
                </tr>`;
            }
        }

        // 2. Quét file Batch
        const localBatches = await ApiService.getBatchesFromDatabase();
        if (localBatches.length > 0) {
            for (let batch of [...localBatches].reverse()) {
                const createTime = window.formatTimeForce(batch.timestamp);
                const uploader = batch.uploader;
                
                batch.files.forEach(fileDoc => {
                    if (fileDoc.isRevoked) return;
                    const searchPayload = `${fileDoc.docId} ${fileDoc.fileName} ${uploader} ${createTime} ${fileDoc.fileHash}`.toLowerCase();
                    
                    html += `
                    <tr class="border-b border-gray-800 hover:bg-[#1f2937] transition" data-search="${searchPayload}">
                        <td class="px-4 py-3 font-bold text-center text-gray-500">${stt++}</td>
                        <td class="px-4 py-3 font-mono text-blue-400 text-xs">
                            <div class="flex items-center"><span class="truncate max-w-[120px] inline-block" title="${fileDoc.docId}"   >${fileDoc.docId}</span></div>
                            <div class="mt-1 text-[11px] text-gray-400 font-sans">File: ${fileDoc.fileName}</div>
                            <div class="mt-1.5 flex gap-3">
                                <button onclick="copyDocId('${fileDoc.docId}')" class="text-gray-400 hover:text-white transition text-[11px]"><i class="fa-regular fa-copy mr-1"></i>Copy</button>
                                <button onclick="revokeDoc('${fileDoc.docId}')" class="text-red-400 hover:text-red-300 transition text-[11px]"><i class="fa-solid fa-ban mr-1"></i>Thu hồi</button>
                            </div>
                        </td>
                        <td class="px-4 py-3 text-xs text-gray-300">
                            <div class="mb-1">${window.getWalletName(uploader)}</div>
                            <div class="text-gray-400 text-[11px] font-medium"><i class="fa-regular fa-clock mr-1"></i>${createTime}</div>
                        </td>
                        <td class="px-4 py-3 font-mono text-[10px] text-gray-500">
                            <div class="text-gray-400 mb-1 truncate max-w-[150px]" title="${fileDoc.fileHash}">${fileDoc.fileHash}</div>
                            <div class="flex items-center gap-3">
                                <a href="https://ipfs.io/ipfs/${fileDoc.ipfsCID}" target="_blank" title="Xem trên IPFS" class="text-emerald-500 hover:text-emerald-400 text-[10px] uppercase font-bold transition">
                                    <i class="fa-solid fa-cloud mr-1"></i> IPFS
                                </a>
                                <button onclick="downloadAndDecrypt('${fileDoc.ipfsCID}', '${fileDoc.fileName}')" class="text-blue-400 hover:text-blue-300 text-[10px] uppercase font-bold transition bg-blue-900/20 px-2 py-0.5 rounded border border-blue-900/50">
                                    <i class="fa-solid fa-download mr-1"></i> Giải Mã
                                </button>
                            </div>
                        </td>
                        <td class="px-4 py-3 text-center">
                            <span class="bg-blue-900/40 text-blue-400 px-2 py-1 rounded text-[10px] font-bold uppercase">ON-CHAIN</span>
                        </td>
                    </tr>`;
                });
            }
        }
        tbody.innerHTML = html === '' ? '<tr><td colspan="5" class="px-4 py-10 text-center text-gray-600">Không có tài liệu hợp lệ nào.</td></tr>' : html;
        filterHistoryTable();
    } catch (err) {
        tbody.innerHTML = '<tr><td colspan="5" class="px-4 py-10 text-center text-red-500">Lỗi kết nối RPC. Vui lòng kết nối ví trước.</td></tr>';
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
                const searchPayload = `${docId} ${fileName} ${uploader} ${revokedBy} ${createTime} ${reason}`.toLowerCase();
                
                html += `
                <tr class="border-b border-gray-800 bg-red-900/10 hover:bg-red-900/20 transition" data-search="${searchPayload}">
                    <td class="px-4 py-3 font-bold text-center text-red-500">${stt++}</td>
                    <td class="px-4 py-3 font-mono text-red-400 text-xs">
                    <div class="truncate max-w-[150px]" title="${docId}">${docId}</div>
                        <div class="mt-1 text-[11px] text-gray-500 font-sans">File: ${fileName}</div>
                        <button onclick="copyDocId('${docId}')" class="text-gray-400 hover:text-white transition text-[11px] mt-1.5"><i class="fa-regular fa-copy mr-1"></i>Copy ID</button>
                    </td>
                    <td class="px-4 py-3 text-xs text-gray-300">
                        <div class="mb-1">${window.getWalletName(uploader)}</div>
                        <div class="text-gray-400 text-[11px] font-medium"><i class="fa-regular fa-clock mr-1"></i>${createTime}</div>
                    </td>
                    <td class="px-4 py-3 text-xs text-gray-300">
                        <div class="text-red-300 font-medium mb-1">${reason}</div>
                        <div class="flex items-center font-mono text-gray-500 text-[10px]">
                            <span class="mr-1">Bởi:</span> ${window.getWalletName(revokedBy)}
                        </div>
                    </td>
                    <td class="px-4 py-3 text-center"><span class="bg-red-900/40 text-red-400 px-2 py-1 rounded text-[10px] font-bold">REVOKED (ON-CHAIN)</span></td>
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
                        
                        const searchPayload = `${fileDoc.docId} ${fileDoc.fileName} ${batch.uploader} ${createTime} ${reason}`.toLowerCase();

                        html += `
                        <tr class="border-b border-gray-800 bg-red-900/10 hover:bg-red-900/20 transition" data-search="${searchPayload}">
                            <td class="px-4 py-3 font-bold text-center text-red-500">${stt++}</td>
                            <td class="px-4 py-3 font-mono text-red-400 text-xs">
                            <div class="truncate max-w-[150px]" title="${fileDoc.docId}">${fileDoc.docId}</div>
                                <div class="mt-1 text-[11px] text-gray-500 font-sans">File: ${fileDoc.fileName}</div>
                                <button onclick="copyDocId('${fileDoc.docId}')" class="text-gray-400 hover:text-white transition text-[11px] mt-1.5"><i class="fa-regular fa-copy mr-1"></i>Copy ID</button>
                            </td>
                            <td class="px-4 py-3 text-xs text-gray-300">
                                <div class="mb-1">${window.getWalletName(batch.uploader)}</div>
                                <div class="text-gray-400 text-[11px] font-medium"><i class="fa-regular fa-clock mr-1"></i>${createTime}</div>
                            </td>
                            <td class="px-4 py-3 text-xs text-gray-300">
                                <div class="text-red-300 font-medium mb-1">${reason} <span class="text-[9px] text-gray-500 ml-1">(${revokeTimeStr})</span></div>
                                <div class="flex items-center font-mono text-gray-500 text-[10px]">
                                    <span class="mr-1">Bởi:</span> ${window.getWalletName(revoker)}
                                </div>
                            </td>
                            <td class="px-4 py-3 text-center">
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
function loadAPIKeys() {
    const tbody = document.getElementById('api-keys-table-body');
    if (!tbody) return;
    const keys = JSON.parse(localStorage.getItem('bdi_api_keys')) || [];
    if (keys.length === 0) return tbody.innerHTML = '<tr><td colspan="4" class="px-4 py-10 text-center text-gray-600">Chưa có API Key nào được khởi tạo.</td></tr>';
    
    tbody.innerHTML = keys.map(k => `
        <tr class="border-b border-gray-800 hover:bg-gray-800/30 transition-colors">
            <td class="px-4 py-3 text-gray-300 text-sm font-medium">${k.name}</td>
            <td class="px-4 py-3 font-mono text-blue-400 text-xs">
                <div class="flex items-center gap-2">
                    <span>${k.key.substring(0, 12)}...</span>
                    <button onclick="copyAPIKey('${k.key}')" class="text-gray-400 hover:text-white transition cursor-pointer"><i class="fa-regular fa-copy"></i></button>
                </div>
            </td>
            <td class="px-4 py-3 text-gray-500 text-xs">${k.date}</td>
            <td class="px-4 py-3 text-center">
                <span class="bg-emerald-900/30 text-emerald-400 border border-emerald-800/50 px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider">Active</span>
            </td>
        </tr>
    `).join('');
}

function generateNewApiKey() {
    const appName = prompt("Nhập tên hệ thống/đối tác cần cấp API Key:");
    if (!appName || appName.trim() === "") return;
    
    const newKey = { 
        name: appName.trim(), 
        key: 'sk_live_' + Math.random().toString(36).substring(2, 15), 
        date: new Date().toLocaleDateString('vi-VN') 
    };
    
    const keys = JSON.parse(localStorage.getItem('bdi_api_keys')) || [];
    keys.unshift(newKey);
    localStorage.setItem('bdi_api_keys', JSON.stringify(keys));
    
    loadAPIKeys();
    Swal.fire({ icon: 'success', title: 'Tạo API Key thành công', text: 'Mã token đã cấp cho: ' + newKey.name, background: '#0b0f19', color: '#fff' });
}

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
    const tbody = document.getElementById('wallet-roles-table-body');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="5" class="px-4 py-10 text-center text-blue-500"><i class="fa-solid fa-circle-notch fa-spin me-2"></i> Đang đồng bộ phân quyền từ Blockchain...</td></tr>';

    // 1. Lấy danh sách ví từ Backend (MongoDB)
    let wallets = await ApiService.getAllWallets();
    let isRecovered = false;

    // =======================================================
    // KHỞI TẠO TÀI KHOẢN ADMIN MẶC ĐỊNH (NẾU DB CHƯA CÓ)
    // =======================================================
    const adminAddress = "0x8b10e25a2c6f91a5969b8db38b88b9e1002e1911".toLowerCase();
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
        // Bơm thẳng Admin vào Database MongoDB
        await ApiService.syncWalletData(adminAddress, { 
            alias: "ADMIN HỆ THỐNG", 
            role: "ADMIN", 
            status: "ACTIVE" 
        });
        isRecovered = true;
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
                    const newWallet = { 
                        address: assignedAddr, status: 'ACTIVE', role: 'NHẬP LIỆU', 
                        storageUsed: 0, storageLimit: 500, storageTrend: 0 
                    };
                    wallets.push(newWallet);
                    
                    // GỌI API LƯU NGAY VÍ NÀY VÀO MONGODB
                    await ApiService.syncWalletData(assignedAddr, { status: 'ACTIVE', role: 'NHẬP LIỆU' });
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
            if (web3.contract && typeof web3.getUserRole === 'function') {
                const rCode = Number(await web3.getUserRole(w.address));
                const realRole = rCode === 99 ? 'ADMIN' : rCode === 2 ? 'QUẢN LÝ' : rCode === 1 ? 'NHẬP LIỆU' : 'BỊ KHÓA';
                const realStatus = rCode === 0 ? 'REVOKED' : 'ACTIVE';
                
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
    const isAdminSystem = currentUser === "0x8b10e25a2c6f91a5969b8db38b88b9e1002e1911";

    // --- BẢO MẬT UI: Tự động giấu các tính năng Admin đối với tài khoản thường ---
    
    // 1. Giấu Form nhập liệu cấp quyền
    const adminForm = document.getElementById('admin-role-form');
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
        const isThisRowAdmin = w.address.toLowerCase() === "0x8b10e25a2c6f91a5969b8db38b88b9e1002e1911";
        
        const storageUsed = w.storageUsed ?? 0; const storageLimit = w.storageLimit ?? 500; 
        const storageTrend = w.storageTrend ?? 0; const fileTypes = w.fileTypes || { pdf: 0, img: 0, zip: 0 }; 
        const lastActive = w.lastActive || new Date().toISOString();
        const dateObj = new Date(lastActive); 
        const daysOffline = (new Date() - dateObj) / (1000 * 60 * 60 * 24);
        
        const trendIcon = storageTrend > 0 ? '<i class="fa-solid fa-arrow-trend-up mr-1 text-red-400"></i>' : '<i class="fa-solid fa-arrow-trend-down mr-1 text-emerald-400"></i>';
        const trendColor = storageTrend > 0 ? 'text-red-400' : 'text-emerald-400';
        const zombieClass = daysOffline > 30 ? 'text-red-400 font-bold' : 'text-gray-400';
        const securityBadge = w.securityAlert ? `<span class="mt-1.5 bg-red-900/30 text-red-400 border border-red-800/50 px-2 py-0.5 rounded text-[10px] font-bold flex items-center w-max cursor-help" title="Lịch sử: ${w.securityAlert}"><i class="fa-solid fa-shield-virus mr-1"></i> Bị Cảnh Cáo</span>` : '<span class="mt-1.5 text-gray-500 text-[10px] flex items-center w-max"><i class="fa-solid fa-check text-emerald-500 mr-1"></i> An toàn</span>';
        
        // --- XỬ LÝ CỘT 0: CHECKBOX DÀNH CHO ADMIN ---
        // Chỉ vẽ cột checkbox này nếu người đang xem là Admin. Nếu là user thường, cột này sẽ biến mất hoàn toàn.
        const tdCheckboxHTML = isAdminSystem 
            ? `<td class="px-4 py-4 text-center">${isThisRowAdmin ? '' : `<input type="checkbox" onchange="checkSelection()" value="${w.address}" class="row-checkbox rounded bg-gray-900 border-gray-700 text-blue-500 cursor-pointer">`}</td>`
            : ``;

        // --- XỬ LÝ CỘT 1: CHỈ HIỂN THỊ TÊN VÀ ID ---
        let displayNameHTML = '';
        
        if (isThisRowAdmin) {
            displayNameHTML = `<span class="font-bold text-yellow-500 text-[13px] mb-1 uppercase tracking-wider"><i class="fa-solid fa-user-shield mr-1"></i> ADMIN HỆ THỐNG</span>`;
        } else {
            const aliasName = w.alias || '';
            displayNameHTML = aliasName 
                ? `<span class="font-bold text-white text-[13px] mb-1">${aliasName}</span>` 
                : `<span class="italic text-gray-600 text-[11px] mb-1">(Chưa đặt tên)</span>`;
        }
        
        const formattedWalletName = `
            <div class="flex flex-col justify-center">
                ${displayNameHTML}
                <span class="font-mono text-gray-400 text-[11px]">${w.address.substring(0,6)}...${w.address.substring(38)}</span>
            </div>
        `;

        // --- XỬ LÝ CỘT 3: BÁNH RĂNG & TRẠNG THÁI ---
        const activeStatusIcon = isRevoked 
            ? '<span class="relative flex h-2 w-2 mr-2"><span class="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span></span><span class="text-red-400 font-bold text-[10px]">TẠM KHÓA</span>' 
            : '<span class="relative flex h-2 w-2 mr-2"><span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span><span class="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span></span><span class="text-emerald-400 font-bold text-[10px]">ĐANG HOẠT ĐỘNG</span>';
        
        // Bánh răng: Đã được chặn sẵn, chỉ hiện nếu là Admin
        const gearBtn = (isAdminSystem && !isThisRowAdmin) 
            ? `<button onclick="event.stopPropagation(); manageSingleWalletSettings('${w.address}', '${w.status}', '${w.role}', '${w.alias || ''}')" class="text-gray-500 hover:text-white transition bg-gray-800 p-1.5 rounded border border-gray-700 hover:bg-gray-700 ml-4 shadow" title="Tùy chọn quản lý"><i class="fa-solid fa-gear"></i></button>` 
            : '';

        return `
        <tr class="border-b border-gray-800 hover:bg-[#1f2937]/30 transition ${isRevoked ? 'opacity-60' : ''}">
            ${tdCheckboxHTML}
            <td class="py-2 px-2">
                <div class="p-3 cursor-pointer group hover:bg-gray-800 rounded-xl transition-all inline-block w-full" onclick="openPreviewDrawer('${w.address || ''}')" title="Nhấn để xem Hồ Sơ Tài Khoản">
                    ${formattedWalletName}
                </div>
            </td>
            <td class="py-2 px-2 pr-6">
                <div class="p-3 cursor-pointer group hover:bg-gray-800 rounded-xl transition-all inline-block w-full" onclick="openStorageModal('${w.address || ''}')" title="Nhấn để xem chi tiết tài liệu đã up">
                    <div class="w-full bg-gray-900 border border-gray-700/50 rounded-full h-1.5 flex overflow-hidden mb-1 group-hover:ring-1 group-hover:ring-blue-500 transition-all">
                        <div class="bg-blue-500 h-1.5" style="width: ${fileTypes.pdf ?? 0}%"></div>
                        <div class="bg-purple-500 h-1.5" style="width: ${fileTypes.img ?? 0}%"></div>
                        <div class="bg-orange-500 h-1.5" style="width: ${fileTypes.zip ?? 0}%"></div>
                    </div>
                    <div class="flex justify-between items-end mb-1 mt-2">
                        <span class="text-xs text-gray-400 font-bold group-hover:text-white transition">
                            ${storageUsed} MB <span class="text-gray-600 font-normal group-hover:text-gray-400 transition">/ ${storageLimit} MB</span>
                        </span>
                        <span class="text-[10px] ${trendColor}">${trendIcon}${storageTrend > 0 ? '+' : ''}${storageTrend}%</span>
                    </div>
                </div>
            </td>
            <td class="px-4 py-4">
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
    const roleLevel = parseInt(document.getElementById('newRoleLevel')?.value);
    
    if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
        return Swal.fire({ title: 'Lỗi định dạng', text: 'Địa chỉ ví không hợp lệ!', icon: 'warning', background: '#111827', color: '#fff' });
    }
    
    isProcessing = true;
    try {
        UI.updateProgress(50, "Đang gửi giao dịch phân quyền lên mạng Sepolia...", "PROCESSING");
        await web3.assignRole(address, roleLevel);
        const roleName = roleLevel === 1 ? 'NHẬP LIỆU' : roleLevel === 2 ? 'QUẢN LÝ' : 'BỊ KHÓA';
        
        // Truyền alias vào DB
        await ApiService.syncWalletData(address, { role: roleName, status: roleLevel === 0 ? 'REVOKED' : 'ACTIVE', alias: alias });
        
        Swal.fire({ title: 'Thành công', text: `Ví đã được cấp quyền: ${roleName}`, icon: 'success', background: '#111827', color: '#fff' });
        
        document.getElementById('newRoleAddress').value = '';
        if (document.getElementById('newRoleAlias')) document.getElementById('newRoleAlias').value = '';
        document.getElementById('newRoleLevel').value = '1';
        if (typeof window.loadWalletRoles === 'function') window.loadWalletRoles();
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
            <button onclick="Swal.close(); setTimeout(() => openChangeRole('${address}', '${currentRole}'), 200)" class="flex items-center gap-3 p-3 rounded-lg border border-gray-700 bg-gray-800 hover:bg-gray-700 text-gray-200 transition shadow-sm">
                <i class="fa-solid fa-user-shield w-5 text-blue-400"></i> Phân lại quyền ví
            </button>
            <button onclick="Swal.close(); setTimeout(() => setWalletAlias('${address}', '${currentAlias || ''}'), 200)" class="flex items-center gap-3 p-3 rounded-lg border border-gray-700 bg-gray-800 hover:bg-gray-700 text-gray-200 transition shadow-sm">
                <i class="fa-solid fa-pen w-5 text-blue-400"></i> Đổi tên nhân viên
            </button>
            <button onclick="Swal.close(); setTimeout(() => toggleWalletLock('${address}',${isLocked}), 200)" class="flex items-center gap-3 p-3 rounded-lg border bg-gray-800 transition shadow-sm ${lockColor}">
                <i class="fa-solid ${lockIcon} w-5"></i> ${lockText}
            </button>
            <button onclick="Swal.close(); setTimeout(() => deleteWallet('${address}'), 200)" class="flex items-center gap-3 p-3 rounded-lg border border-red-900/50 bg-red-900/10 hover:bg-red-900/30 text-red-400 transition shadow-sm">
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
            Chọn cấp độ mới cho ví <b class="font-mono text-blue-400">${address.substring(0,8)}...</b>:
        `,
        input: 'select',
        inputOptions: { '1': 'Quyền Nhập Liệu (Upload)', '2': 'Quyền Quản Lý (Upload + Thu hồi)' },
        inputValue: currentRole === 'QUẢN LÝ' ? '2' : '1',
        showCancelButton: true, confirmButtonText: 'Lưu thay đổi', cancelButtonText: 'Hủy',
        background: '#111827', color: '#fff', confirmButtonColor: '#10b981'
    });

    if (newRole) {
        if (isProcessing) return;
        isProcessing = true;
        try {
            UI.updateProgress(50, "Đang cập nhật quyền trên Blockchain...", "PROCESSING");
            await web3.assignRole(address, parseInt(newRole));
            const roleName = newRole === '2' ? 'QUẢN LÝ' : 'NHẬP LIỆU';
            await ApiService.syncWalletData(address, { role: roleName, status: 'ACTIVE' });
            
            UI.updateProgress(100, "Đã đổi quyền thành công!", "SUCCESS");
            Swal.fire({ title: 'Thành công', text: `Đã cấp: ${roleName}`, icon: 'success', background: '#111827', color: '#fff', timer: 1500, showConfirmButton: false });
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
        title: `${actionText} TÀI KHOẢN?`,
        html: `Bạn đang thực hiện lệnh <b>${actionText}</b> cho ví <b class="font-mono text-blue-400">${address.substring(0,8)}...</b>.<br><br><i>Hệ thống sẽ gọi MetaMask để ghi nhận trạng thái lên Blockchain.</i>`,
        icon: 'warning', 
        showCancelButton: true, 
        confirmButtonText: `Xác nhận ${actionText}`, 
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
            Swal.fire({ title: 'Hoàn tất', text: `Tài khoản đã được ${actionText.toLowerCase()}.`, icon: 'success', background: '#111827', color: '#fff', timer: 1500, showConfirmButton: false });
            
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
        html: `Bạn đang chuẩn bị xóa ví <b class="text-red-400 font-mono">${address.substring(0,8)}...</b>.<br><br><i>Hệ thống sẽ tước quyền trên Blockchain và gỡ tài khoản này khỏi danh bạ quản lý.</i>`,
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
            <button onclick="toggleDrawer(false)" class="text-gray-500 hover:text-white transition"><i class="fa-solid fa-xmark text-lg"></i></button>
        </div>
        <div class="p-5 flex-1 overflow-y-auto space-y-6">
            <div>
                <label class="text-[10px] text-gray-500 font-bold uppercase tracking-wider">TÀI KHOẢN VÍ</label>
                <div class="mt-1">${w.role === 'ADMIN' ? '<span class="text-yellow-500 font-bold text-[10px] bg-yellow-900/20 px-2 py-0.5 rounded border border-yellow-900/50">ADMIN</span>' : `<span class="text-blue-400 font-bold text-[10px] bg-blue-900/20 px-2 py-0.5 rounded border border-blue-900/50">${w.role}</span>`}</div>
            </div>
            <div class="mt-4">
                <label class="text-[10px] text-gray-500 font-bold uppercase tracking-wider">ĐỊA CHỈ VÍ</label>
                <div class="flex items-center gap-2 mt-1">
                    <div class="font-mono text-blue-400 text-sm bg-gray-900 p-2 rounded border border-gray-800 break-all flex-1">${w.address}</div>
                    <button onclick="copyWallet('${w.address}')" class="bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white p-2.5 rounded border border-gray-700 transition" title="Copy địa chỉ ví"><i class="fa-regular fa-copy"></i></button>
                </div>
            </div>
            <div class="grid grid-cols-2 gap-3 mt-4">
                <div class="bg-gray-900 p-3 rounded-lg border border-gray-800 text-center">
                    <div class="text-[10px] text-gray-500 font-bold uppercase mb-1">Đã dùng IPFS</div>
                    <div class="text-xl text-white font-bold">${w.storageUsed} <span class="text-xs text-gray-500">MB</span></div>
                </div>
                <div class="bg-gray-900 p-3 rounded-lg border border-gray-800 text-center">
                    <div class="text-[10px] text-gray-500 font-bold uppercase mb-1">Xu hướng</div>
                    <div class="text-xl ${w.storageTrend > 0 ? 'text-red-400' : 'text-emerald-400'} font-bold">${w.storageTrend}%</div>
                </div>
            </div>
            <div>
                <label class="text-[10px] text-gray-500 font-bold uppercase tracking-wider mb-2 block">Cảnh báo bảo mật</label>
                <div class="text-xs p-3 rounded border ${w.securityAlert ? 'bg-red-900/20 border-red-900/50 text-red-400' : 'bg-emerald-900/20 border-emerald-900/50 text-emerald-400'}">
                    ${w.securityAlert ? `<i class="fa-solid fa-triangle-exclamation mr-1"></i> ${w.securityAlert}` : `<i class="fa-solid fa-shield-check mr-1"></i> Hệ thống an toàn.`}
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
        Swal.fire({ title: 'Hoàn tất', text: `Đã khóa thành công ${successCount} ví.`, icon: 'success', background: '#111827', color: '#fff' });
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
        Swal.fire({ title: 'Hoàn tất', text: `Đã khôi phục hoạt động cho ${successCount} ví.`, icon: 'success', background: '#111827', color: '#fff' });
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
        html: `Soạn tin nhắn gửi tới <b>${count} nhân viên</b> đã chọn:`,
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
                text: `Thông báo đã được đẩy tới ${count} thiết bị.`,
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
    let w = wallets.find(x => x.address === walletAddress);
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
        
        // Lấy file đơn lẻ (On-chain)
        const events = await web3.queryHistory();
        if (events && events.length > 0) {
            for (let ev of [...events].reverse()) {
                const docId = ev.args[0]; 
                let uploader = '---'; let createTime = '---'; let isRevoked = false; let ipfsLink = '';
                
                try {
                    const docData = await web3.getDocumentFromChain(docId); 
                    uploader = docData[3]; 
                    createTime = new Date(Number(docData[2]) * 1000).toLocaleString('vi-VN'); 
                    isRevoked = docData[4];
                    ipfsLink = docData[1].replace('ipfs://', '');
                } catch (e) {}
                
                if (uploader.toLowerCase() === walletAddress.toLowerCase()) {
                    let fileName = docId.replace(/_\d+$/, '').replace(/\.enc$/, '');
                    const statusBadge = isRevoked ? '<span class="bg-red-900/40 text-red-400 px-2 py-1 rounded text-[10px] font-bold">BỊ THU HỒI</span>' : '<span class="bg-emerald-900/40 text-emerald-400 px-2 py-1 rounded text-[10px] font-bold uppercase">HỢP LỆ</span>';
                    
                    // Nút tải về chỉ hiện nếu file chưa bị thu hồi
                    const downloadBtn = isRevoked ? '' : `<button onclick="downloadAndDecrypt('${ipfsLink}', '${fileName}')" class="ml-2 text-blue-400 hover:text-blue-300 text-[11px] bg-blue-900/20 px-2 py-1 rounded border border-blue-900/50 transition" title="Tải & Giải mã"><i class="fa-solid fa-download mr-1"></i> Tải về</button>`;
                    
                    html += `
                    <tr class="border-b border-gray-800 hover:bg-[#1f2937] transition ${isRevoked ? 'opacity-50' : ''}">
                        <td class="px-4 py-3 font-bold text-center text-gray-500">${stt++}</td>
                        <td class="px-4 py-3 font-mono text-blue-400 text-xs">
                        <div class="flex items-center">
                        <span class="truncate max-w-[120px]" title="${docId}">${docId}</span>
                        <button onclick="copyDocId('${docId}')" class="ml-2 text-gray-400 hover:text-white"><i class="fa-regular fa-copy"></i></button>
                        </div>
                        <div class="mt-1 text-[11px] text-gray-400 font-sans">File: ${fileName}</div>
                        </td>
                        <td class="px-4 py-3 text-left font-mono text-[11px] text-gray-400">---</td>
                        <td class="px-4 py-3 text-xs text-gray-400">${createTime}</td>
                        <td class="px-4 py-3 text-center flex justify-center items-center">
                            ${statusBadge} ${downloadBtn}
                        </td>
                    </tr>`;
                }
            }
        }

        // Lấy file tải hàng loạt trong lô Batch
        const localBatches = await ApiService.getBatchesFromDatabase();
        for (let batch of [...localBatches].reverse()) {
            if (batch.uploader.toLowerCase() === walletAddress.toLowerCase()) {
                const createTime = new Date(batch.timestamp).toLocaleString('vi-VN');
                batch.files.forEach(fileDoc => {
                    const isRevoked = fileDoc.isRevoked;
                    const statusBadge = isRevoked ? '<span class="bg-red-900/40 text-red-400 px-2 py-1 rounded text-[10px] font-bold">BỊ THU HỒI</span>' : '<span class="bg-emerald-900/40 text-emerald-400 px-2 py-1 rounded text-[10px] font-bold uppercase">HỢP LỆ</span>';
                    
                    // Nút tải về chỉ hiện nếu file chưa bị thu hồi
                    const downloadBtn = isRevoked ? '' : `<button onclick="downloadAndDecrypt('${fileDoc.ipfsCID}', '${fileDoc.fileName}')" class="ml-2 text-blue-400 hover:text-blue-300 text-[11px] bg-blue-900/20 px-2 py-1 rounded border border-blue-900/50 transition" title="Tải & Giải mã"><i class="fa-solid fa-download mr-1"></i> Tải về</button>`;

                    html += `
                    <tr class="border-b border-gray-800 hover:bg-[#1f2937] transition ${isRevoked ? 'opacity-50' : ''}">
                        <td class="px-4 py-3 font-mono text-blue-400 text-xs">
                        <div class="flex items-center">
                            <span class="truncate max-w-[120px]" title="${fileDoc.docId}">${fileDoc.docId}</span>
                            <button onclick="copyDocId('${fileDoc.docId}')" class="ml-2 text-gray-400 hover:text-white"><i class="fa-regular fa-copy"></i></button>
                            </div>
                        </td>
                        <td class="px-4 py-3 text-left font-mono text-[11px] text-gray-300">${fileDoc.fileSize || '---'}</td>
                        <td class="px-4 py-3 text-xs text-gray-400">${createTime}</td>
                        <td class="px-4 py-3 text-center flex justify-center items-center">
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
window.downloadAndDecrypt = async (ipfsCID, originalFileName) => {

// Bắt lỗi thiếu CID từ cơ sở dữ liệu cũ
    if (!ipfsCID || ipfsCID === 'undefined' || ipfsCID === 'null') {
        Swal.fire({
            title: 'Dữ Liệu Không Hợp Lệ',
            text: 'Tài liệu này thiếu mã IPFS CID (thường do đây là bản nháp cũ). Vui lòng tải lên lại tài liệu này.',
            icon: 'error', background: '#111827', color: '#fff'
        });
        return;
    }

    if (isProcessing) return;

    const { value: secretKey } = await Swal.fire({
        title: 'GIẢI MÃ TÀI LIỆU',
        text: `Tài liệu "${originalFileName}" đang được mã hóa. Vui lòng nhập khóa bí mật (AES-256):`,
        input: 'password',
        inputPlaceholder: 'Nhập mật khẩu...',
        background: '#111827', color: '#fff',
        confirmButtonColor: '#10b981', showCancelButton: true, cancelButtonText: 'Hủy'
    });

    if (!secretKey) return;

    isProcessing = true;
    UI.updateProgress(30, "Đang kết nối qua trạm trung chuyển...", "DOWNLOADING");

    try {
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
        if (originalFileName.endsWith('.pdf')) mimeType = "application/pdf";
        else if (originalFileName.endsWith('.png')) mimeType = "image/png";
        else if (originalFileName.endsWith('.jpg') || originalFileName.endsWith('.jpeg')) mimeType = "image/jpeg";
        else if (originalFileName.endsWith('.docx')) mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        
        const blob = new Blob([uint8Array], { type: mimeType });

        const fileURL = URL.createObjectURL(blob);
        window.open(fileURL, '_blank'); 

        UI.updateProgress(100, "Truy xuất thành công!", "SUCCESS");
        Swal.fire({ 
            title: 'Đã giải mã!', 
            text: `Tài liệu "${originalFileName}" đã được mở ở thẻ mới.`, 
            icon: 'success', background: '#111827', color: '#fff' 
        });
        
        setTimeout(() => URL.revokeObjectURL(fileURL), 60000); 

    } catch (error) {
        UI.updateProgress(0, "Truy xuất thất bại.", "ERROR");
        
        if (error.message === "SYNC_DELAY") {
            Swal.fire({ 
                title: 'Lỗi Kết Nối', 
                text: 'Mạng IPFS không phản hồi. Vui lòng kiểm tra lại đường truyền internet.', 
                icon: 'error', background: '#111827', color: '#fff' 
            });
        } else if (error.message === "WRONG_PASSWORD") {
            Swal.fire({ 
                title: 'Sai Mật Khẩu!', 
                text: 'Mật khẩu giải mã không chính xác.', 
                icon: 'error', background: '#111827', color: '#fff' 
            });
        } else {
            Swal.fire({ title: 'Lỗi', text: error.message, icon: 'error', background: '#111827', color: '#fff' });
        }
    } finally {
        isProcessing = false;
        setTimeout(() => UI.updateProgress(0, "Hệ thống đang rảnh", "STANDBY"), 3000);
    }
};
window.closeStorageModal = function() { document.getElementById('storage-modal-overlay').classList.add('hidden'); };