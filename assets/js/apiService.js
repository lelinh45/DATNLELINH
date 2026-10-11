import { CONFIG } from './config.js';

// =====================================================================
// PHIÊN ĐĂNG NHẬP (JWT) — chữ ký MetaMask thay mật khẩu
// Token lưu trong sessionStorage: tự mất khi đóng tab, không lưu localStorage
// =====================================================================
let authToken = sessionStorage.getItem('bdi_jwt') || '';
let authAddress = (sessionStorage.getItem('bdi_addr') || '').toLowerCase();

function tokenAlive() {
    if (!authToken) return false;
    try {
        const payload = JSON.parse(atob(authToken.split('.')[1]));
        return payload.exp * 1000 > Date.now() + 30000; // chỉ coi là sống nếu còn hạn > 30s
    } catch { return false; }
}

function authHeaders() {
    return authToken ? { 'Authorization': `Bearer ${authToken}` } : {};
}

// Định danh thiết bị — random hex lưu localStorage, để server nhận diện "máy lạ"
// và cho phép thu hồi phiên (kick) từ thiết bị khác.
function getDeviceId() {
    let id = localStorage.getItem('bdi_device_id');
    if (!id) {
        const arr = new Uint8Array(16);
        crypto.getRandomValues(arr);
        id = Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
        localStorage.setItem('bdi_device_id', id);
    }
    return id;
}

// Nhãn thân thiện cho thiết bị — "Chrome · Windows 10" — suy ra từ userAgent
function getDeviceLabel() {
    const ua = navigator.userAgent || '';
    let os = 'Unknown OS';
    if (/Windows NT/i.test(ua)) os = 'Windows';
    else if (/Android/i.test(ua)) os = 'Android';
    else if (/iPhone|iPad/i.test(ua)) os = 'iOS';
    else if (/Mac OS X/i.test(ua)) os = 'macOS';
    else if (/Linux/i.test(ua)) os = 'Linux';
    let browser = 'Browser';
    if (/Edg\//i.test(ua)) browser = 'Edge';
    else if (/Chrome\//i.test(ua)) browser = 'Chrome';
    else if (/Firefox\//i.test(ua)) browser = 'Firefox';
    else if (/Safari\//i.test(ua)) browser = 'Safari';
    return `${browser} · ${os}`;
}

export const ApiService = {
    getToken: () => authToken,
    hasValidToken: () => tokenAlive(),
    getDeviceId,

    // Đăng nhập: xin challenge → ký bằng MetaMask → đổi lấy JWT 24h
    async loginWithWallet(signer, address) {
        const addr = String(address).toLowerCase();
        const chRes = await fetch(`${CONFIG.API_BASE}/auth/challenge?address=${addr}`);
        const chData = await chRes.json();
        if (!chRes.ok || !chData.challenge) throw new Error(chData.message || 'Không lấy được challenge đăng nhập');

        const signature = await signer.signMessage(chData.challenge);
        const res = await fetch(`${CONFIG.API_BASE}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ address: addr, signature, challenge: chData.challenge, deviceId: getDeviceId(), deviceLabel: getDeviceLabel() })
        });
        const data = await res.json();
        // Thiết bị mới chưa được duyệt → trả về cờ pending để UI hiện màn chờ/OTP
        if (res.status === 403 && data.code === 'DEVICE_PENDING') {
            return { pending: true, deviceId: getDeviceId(), message: data.message };
        }
        if (!res.ok || !data.token) throw new Error(data.message || 'Xác thực ví thất bại');

        authToken = data.token;
        authAddress = addr;
        sessionStorage.setItem('bdi_jwt', authToken);
        sessionStorage.setItem('bdi_addr', authAddress);
        return data;
    },

    // Đảm bảo có JWT còn hạn cho đúng ví đang kết nối — hết hạn/đổi ví thì ký lại
    async ensureAuth(signer, address) {
        const addr = String(address).toLowerCase();
        if (tokenAlive() && authAddress === addr) return;
        await this.loginWithWallet(signer, addr);
    },

    logout() {
        authToken = '';
        authAddress = '';
        sessionStorage.removeItem('bdi_jwt');
        sessionStorage.removeItem('bdi_addr');
    },

    // =====================================================================
    // 1. API: TẢI TỆP LÊN MẠNG LƯỚI PINATA (IPFS THẬT)
    // =====================================================================
    uploadFileWithProgress(file, onProgress) {
        return new Promise((resolve, reject) => {
            const formData = new FormData();
            formData.append('document', file);

            const xhr = new XMLHttpRequest();
            // Gọi qua Backend Server — Pinata keys chỉ nằm ở phía server (.env)
            xhr.open("POST", `${CONFIG.API_BASE}/upload`, true);
            if (authToken) xhr.setRequestHeader('Authorization', `Bearer ${authToken}`);

            // Bắt sự kiện thanh tiến trình tải lên thật
            xhr.upload.onprogress = (event) => {
                if (event.lengthComputable && onProgress) {
                    const percent = Math.round((event.loaded / event.total) * 100);
                    onProgress(percent);
                }
            };

            xhr.onload = () => {
                if (xhr.status === 200) {
                    resolve(JSON.parse(xhr.responseText));
                } else {
                    const err = JSON.parse(xhr.responseText || '{}');
                    reject(new Error(err.message || "Lỗi từ chối tải lên từ máy chủ Backend."));
                }
            };

            xhr.onerror = () => reject(new Error("Lỗi mất kết nối tới máy chủ Backend"));

            // Bắt đầu gửi file
            xhr.send(formData);
        });
    },

    async verifyWithBackend(file, docId, secretKey) {
        const formData = new FormData();
        formData.append("document", file);
        formData.append("documentId", docId);
        if (secretKey) formData.append("secretKey", secretKey);

        const response = await fetch(`${CONFIG.API_BASE}/verify`, { method: "POST", body: formData });
        return await response.json();
    },

    // =====================================================================
    // 2. API: QUẢN LÝ TỆP TIN (BATCH) BẰNG MONGODB
    // =====================================================================
    async saveBatchToDatabase(batchData) {
        try {
            const response = await fetch(`${CONFIG.API_BASE}/batches`, {
                method: "POST", 
                headers: { "Content-Type": "application/json", ...authHeaders() },
                body: JSON.stringify(batchData)
            });
            if (!response.ok) throw new Error("Lỗi lưu lô mới vào MongoDB"); 
            return await response.json();
        } catch (error) {
            console.error("Lỗi Backend:", error);
            throw error;
        }
    },

    async getBatchesFromDatabase() {
        try {
            const response = await fetch(`${CONFIG.API_BASE}/batches`, { headers: authHeaders() });
            if (!response.ok) throw new Error("Lỗi lấy dữ liệu lô");
            const data = await response.json();
            return Array.isArray(data) ? data : [];
        } catch (error) {
            console.error("Lỗi Backend:", error);
            return [];
        }
    },

    // Thu hồi 1 file trong lô (off-chain MongoDB) — JWT đi kèm, revokedBy do server tự lấy từ token
    async revokeBatchFile(docId, reason) {
        const response = await fetch(`${CONFIG.API_BASE}/batches/revoke`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify({ docId, reason })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.message || 'Server từ chối lệnh thu hồi');
        return data;
    },

    // Trạng thái thu hồi trong MongoDB — public, để verify đối chiếu 2 nguồn
    async getDocumentStatus(docId) {
        try {
            const res = await fetch(`${CONFIG.API_BASE}/documents/${encodeURIComponent(docId)}/status`);
            if (!res.ok) return null;
            return await res.json(); // { isRevoked, revocationReason }
        } catch { return null; }
    },

    // ---- Thông báo & phiên thiết bị ----
    async getNotifications() {
        try {
            const res = await fetch(`${CONFIG.API_BASE}/notifications`, { headers: authHeaders() });
            if (!res.ok) return { notifications: [], unread: 0 };
            return await res.json();
        } catch { return { notifications: [], unread: 0 }; }
    },
    async markNotificationsRead() {
        try {
            await fetch(`${CONFIG.API_BASE}/notifications/read`, { method: 'POST', headers: authHeaders() });
        } catch {}
    },
    async getSessions() {
        try {
            const res = await fetch(`${CONFIG.API_BASE}/sessions`, { headers: authHeaders() });
            if (!res.ok) return { sessions: [] };
            return await res.json();
        } catch { return { sessions: [] }; }
    },
    async revokeSession(deviceId) {
        const res = await fetch(`${CONFIG.API_BASE}/sessions/revoke`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify({ deviceId })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || 'Thu hồi phiên thất bại');
        return data;
    },

    // Duyệt một thiết bị đang pending (gọi từ thiết bị đã đăng nhập)
    async approveSession(deviceId) {
        const res = await fetch(`${CONFIG.API_BASE}/sessions/approve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify({ deviceId })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || 'Phê duyệt thất bại');
        return data;
    },

    // ---- Thiết bị pending: poll trạng thái + OTP email (không cần JWT) ----
    async checkPendingStatus(address, deviceId) {
        try {
            const res = await fetch(`${CONFIG.API_BASE}/auth/pending?address=${encodeURIComponent(address)}&deviceId=${encodeURIComponent(deviceId)}`);
            const data = await res.json().catch(() => ({}));
            return { status: data.status || 'unknown', activeDevices: data.activeDevices || [] };
        } catch { return { status: 'unknown', activeDevices: [] }; }
    },
    async requestOtp(address, deviceId) {
        const res = await fetch(`${CONFIG.API_BASE}/auth/request-otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ address, deviceId })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { const e = new Error(data.message || 'Không gửi được OTP'); e.code = data.code; throw e; }
        return data;
    },
    async verifyOtp(address, deviceId, code) {
        const res = await fetch(`${CONFIG.API_BASE}/auth/verify-otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ address, deviceId, code })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || 'Xác nhận OTP thất bại');
        return data;
    },

    // Đăng ký email + SĐT chủ ví — email nhận OTP duyệt thiết bị mới
    async setWalletContact(email, phone) {
        const res = await fetch(`${CONFIG.API_BASE}/wallets/email`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify({ email, phone })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || 'Lưu thông tin liên hệ thất bại');
        return data;
    },

    // Lấy khóa AES đã lưu escrow — chỉ uploader hoặc role >= QUẢN LÝ mới được server trả
    async getDocumentKey(docId) {
        const res = await fetch(`${CONFIG.API_BASE}/documents/${encodeURIComponent(docId)}/key`, { headers: authHeaders() });
        if (!res.ok) return null;
        const data = await res.json().catch(() => ({}));
        return data.key || null;
    },

    // =====================================================================
    // 3. API: QUẢN LÝ QUYỀN VÍ BẰNG MONGODB
    // =====================================================================
    // Ví mới đang chờ cấp quyền — chỉ ADMIN gọi được (403/lỗi → null)
    async getPendingWallets() {
        try {
            const res = await fetch(`${CONFIG.API_BASE}/wallets/pending`, { headers: authHeaders() });
            if (!res.ok) return null;
            const data = await res.json().catch(() => ({}));
            return data.wallets || [];
        } catch (e) { return null; }
    },

    // Từ chối ví đang chờ cấp quyền — chỉ ADMIN (khóa ví: status → REVOKED)
    async rejectWallet(address) {
        const res = await fetch(`${CONFIG.API_BASE}/wallets/reject`, {
            method: 'POST', headers: authHeaders(), body: JSON.stringify({ address })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || 'Không từ chối được ví');
        return data;
    },

    // Hồ sơ của chính ví đang đăng nhập — mọi rank đều đọc được (kể cả khách rank 0)
    async getMyWallet() {
        try {
            const res = await fetch(`${CONFIG.API_BASE}/wallets/me`, { headers: authHeaders() });
            if (!res.ok) return null;
            return await res.json();
        } catch (e) { return null; }
    },

    async getAllWallets() {
        try {
            const response = await fetch(`${CONFIG.API_BASE}/wallets`, { headers: authHeaders() });
            if (!response.ok) throw new Error("Không thể lấy dữ liệu từ Backend");
            return await response.json(); 
        } catch (error) {
            console.error("Lỗi Backend:", error);
            return []; 
        }
    },

    // ---- API Keys cho đối tác B2B (chỉ ADMIN) ----
    async listApiKeys() {
        const res = await fetch(`${CONFIG.API_BASE}/apikeys`, { headers: authHeaders() });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || 'Không lấy được danh sách API key');
        return data.keys || [];
    },
    async createApiKey(name) {
        const res = await fetch(`${CONFIG.API_BASE}/apikeys`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify({ name })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || 'Tạo API key thất bại');
        return data; // { apiKey, token } — token chỉ trả 1 lần
    },
    async revokeApiKey(id) {
        const res = await fetch(`${CONFIG.API_BASE}/apikeys/${encodeURIComponent(id)}/revoke`, {
            method: 'POST', headers: authHeaders()
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || 'Thu hồi API key thất bại');
        return data;
    },

    async syncWalletData(walletAddress, updateData) {
        try {
            const response = await fetch(`${CONFIG.API_BASE}/wallets/sync`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...authHeaders() },
                body: JSON.stringify({
                    address: walletAddress.toLowerCase(),
                    ...updateData
                })
            });

            if (!response.ok) throw new Error("Lỗi đồng bộ lên Backend");
            return await response.json(); 
        } catch (error) {
            console.error("Lỗi Backend:", error);
            throw error; 
        }
    }
};
