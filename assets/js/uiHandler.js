export const UI = {
    switchMenu(menuName) {
        const menus = ['upload', 'verify', 'history', 'revoked', 'apikeys', 'rpc', 'template', 'settings'];
        const titles = {
            'upload': 'Mã Hóa & Lưu Trữ Phi Tập Trung',
            'verify': 'Giám Định Tính Toàn Vẹn',
            'history': 'Sổ Cái Lịch Sử Giao Dịch',
            'revoked': 'Kho Lưu Trữ Tài Liệu Vô Hiệu Hóa',
            'apikeys': 'Quản Lý API Keys & Tích Hợp',
            'rpc': 'Cấu Hình Mạng Blockchain (RPC Node)',
            'template': 'Tùy Biến Mẫu Chứng Nhận Số',
            'settings': 'Cài Đặt Hệ Thống & Cảnh Báo'
        };
        const titleEl = document.getElementById('page-title');
        if (titleEl) titleEl.innerText = titles[menuName] || '';

        menus.forEach(menu => {
            const content = document.getElementById(`tab-${menu}`);
            const btn = document.getElementById(`menu-${menu}`);
            if (!content || !btn) return;

            if (menu === menuName) {
                content.classList.remove('hidden');
                btn.classList.remove('text-gray-400', 'text-red-400', 'hover:bg-gray-800');
                btn.classList.add('bg-blue-600/10', 'text-blue-400');
            } else {
                content.classList.add('hidden');
                btn.classList.remove('bg-blue-600/10', 'text-blue-400');
                btn.classList.add('text-gray-400', 'hover:bg-gray-800');
            }
        });
    },

    updateProgress(percent, text, status = 'PROCESSING') {
        const bar = document.getElementById('progress-bar');
        const textEl = document.getElementById('progress-text');
        const percentEl = document.getElementById('progress-percent');
        const badge = document.getElementById('status-badge');

        if (bar) bar.style.width = `${percent}%`;
        if (percentEl) percentEl.innerText = `${percent}%`;
        if (textEl) textEl.innerText = text;

        if (badge) {
            badge.innerText = status;
            if (percent === 100) {
                badge.className = "bg-emerald-900/30 text-emerald-400 border border-emerald-800 text-[10px] px-2 py-0.5 rounded font-bold";
            } else if (percent === 0) {
                badge.className = "bg-gray-800 text-gray-300 border border-gray-700 text-[10px] px-2 py-0.5 rounded font-bold";
            } else {
                badge.className = "bg-blue-900/30 text-blue-400 border border-blue-800 text-[10px] px-2 py-0.5 rounded font-bold animate-pulse";
            }
        }
    },

    logConsole(msg, type = 'info', hash = '') {
        const box = document.getElementById('consoleBox');
        if (!box) return;
        const color = type === 'error' ? 'text-red-400' : type === 'success' ? 'text-emerald-400' : type === 'warning' ? 'text-yellow-400' : 'text-blue-400';
        const hashDisplay = hash ? `<br><span class="text-gray-600 ml-4">> <span class="text-blue-500/70 font-mono">${hash}</span></span>` : '';
        box.innerHTML += `<div class="mb-1"><span class="text-gray-600">[${new Date().toLocaleTimeString()}]</span> <span class="${color}">${msg}</span>${hashDisplay}</div>`;
        box.scrollTop = box.scrollHeight;
    },

    // --- BƯỚC 2: QUẢN LÝ DANH SÁCH FILE UPLOAD (BATCH) ---
    selectedUploadFiles: [], // Mảng lưu trữ các file chuẩn bị upload

    updateFileName(inputId) {
        const input = document.getElementById(inputId);
        const isUpload = inputId === 'uploadFile'; 
        
        if (isUpload) {
            // Logic cho form Tải lên hàng loạt (Thêm vào mảng)
            if (input && input.files && input.files.length > 0) {
                const newFiles = Array.from(input.files);
                // Gộp file mới vào mảng cũ (không làm mất file đã chọn trước đó)
                this.selectedUploadFiles = [...this.selectedUploadFiles, ...newFiles];
                // Reset thẻ input để có thể chọn lại chính file đó nếu lỡ xóa
                input.value = ''; 
            }
            this.renderUploadFileList();
        } else {
            // Logic cho form Giám định (Chỉ 1 file)
            const emptyState = document.getElementById('verifyEmptyState');
            const filledState = document.getElementById('verifyFilledState');
            const nameDisplay = document.getElementById('verifyFileNameDisplay');
            const sizeDisplay = document.getElementById('verifyFileSizeDisplay');
            
            if (input && input.files && input.files.length > 0) {
                const file = input.files[0];
                const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
                const sizeKB = (file.size / 1024).toFixed(2);
                const sizeText = file.size > 1024 * 1024 ? `${sizeMB} MB` : `${sizeKB} KB`;

                if(nameDisplay) nameDisplay.innerText = file.name;
                if(sizeDisplay) sizeDisplay.innerText = sizeText;

                if(emptyState) emptyState.classList.add('hidden');
                if(filledState) {
                    filledState.classList.remove('hidden');
                    filledState.classList.add('flex');
                }
            } else {
                if(emptyState) emptyState.classList.remove('hidden');
                if(filledState) {
                    filledState.classList.add('hidden');
                    filledState.classList.remove('flex');
                }
            }
        }
    },

    renderUploadFileList() {
        const emptyState = document.getElementById('uploadEmptyState');
        const filledState = document.getElementById('uploadFilledState');
        const fileListContainer = document.getElementById('uploadFileList');
        const countDisplay = document.getElementById('uploadFileCount');

        if (this.selectedUploadFiles.length > 0) {
            if(emptyState) emptyState.classList.add('hidden');
            if(filledState) {
                filledState.classList.remove('hidden');
                filledState.classList.add('flex');
            }
            if(countDisplay) countDisplay.innerText = this.selectedUploadFiles.length;

            if(fileListContainer) {
                fileListContainer.innerHTML = this.selectedUploadFiles.map((file, index) => {
                    const sizeText = file.size > 1024 * 1024 ? (file.size / (1024 * 1024)).toFixed(2) + ' MB' : (file.size / 1024).toFixed(2) + ' KB';
                    return `
                        <div class="flex items-center justify-between bg-gray-800/40 p-2.5 rounded-lg border border-gray-700 hover:border-gray-500 transition group">
                            <div class="flex items-center gap-3 overflow-hidden">
                                <i class="fa-solid fa-file-lines text-blue-400 text-lg"></i>
                                <div class="flex flex-col text-left truncate">
                                    <span class="text-xs font-bold text-gray-200 truncate" title="${file.name}">${file.name}</span>
                                    <span class="text-[10px] text-gray-500 font-mono">${sizeText}</span>
                                </div>
                            </div>
                            <button type="button" onclick="window.removeUploadFile(${index})" class="text-gray-500 hover:text-red-400 px-2 py-1 transition rounded hover:bg-red-900/30" title="Loại bỏ file này">
                                <i class="fa-solid fa-xmark"></i>
                            </button>
                        </div>
                    `;
                }).join('');
            }
        } else {
            if(emptyState) emptyState.classList.remove('hidden');
            if(filledState) {
                filledState.classList.add('hidden');
                filledState.classList.remove('flex');
            }
        }
    },

    copyToClipboard(text) {
        navigator.clipboard.writeText(text).then(() => {
            Swal.mixin({
                toast: true, position: 'top-end', showConfirmButton: false, timer: 1500, background: '#111827', color: '#fff'
            }).fire({ icon: 'success', title: 'Đã sao chép vào bộ nhớ tạm!' });
        });
    },

    updateStats(metrics) {
        if (!metrics) return;
        const totalDocsEl = document.getElementById('stat-total-docs');
        const totalIssuersEl = document.getElementById('stat-total-issuers');
        const latencyEl = document.getElementById('stat-rpc-latency');

        if (totalDocsEl) totalDocsEl.innerText = metrics.docCount.toLocaleString();
        if (totalIssuersEl) totalIssuersEl.innerText = metrics.issuerCount.toLocaleString();
        if (latencyEl) latencyEl.innerText = metrics.latency;
    },

    downloadPdfCertificate(data) {
        const container = document.getElementById('pdf-certificate-container');
        const element = document.getElementById('certificate-content');
        if (!container || !element) return;

        document.getElementById('cert-doc-id').innerText = data.docId;
        document.getElementById('cert-file-hash').innerText = data.fileHash;
        document.getElementById('cert-ipfs-cid').innerText = data.ipfsCID || 'N/A';
        document.getElementById('cert-signer-wallet').innerText = data.signerWallet;
        document.getElementById('cert-timestamp').innerText = data.timestamp || new Date().toLocaleString('vi-VN');
        
        const qrEl = document.getElementById('cert-qr-img');
        if (qrEl && data.qrCode) qrEl.src = data.qrCode;

        container.style.display = 'block';

        const opt = {
            margin:       10,
            filename:     `Chung-Nhan-${data.docId}.pdf`,
            image:        { type: 'jpeg', quality: 0.98 },
            html2canvas:  { scale: 2 },
            jsPDF:        { unit: 'mm', format: 'a4', orientation: 'landscape' }
        };

        html2pdf().set(opt).from(element).save().then(() => {
            container.style.display = 'none';
        });
    }
};

// Gắn hàm xóa ra toàn cục (Window) để HTML có thể gọi được sự kiện onclick
window.removeUploadFile = function(index) {
    UI.selectedUploadFiles.splice(index, 1);
    UI.renderUploadFileList();
};