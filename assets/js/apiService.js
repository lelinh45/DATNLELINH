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

// Đọc body JSON an toàn — proxy/rate-limiter đôi khi trả text thuần ("Too many requests") hoặc HTML lỗi,
// JSON.parse trực tiếp sẽ văng lỗi khó hiểu "Unexpected token ... is not valid JSON"
async function readJson(res) {
    const text = await res.text();
    try { return JSON.parse(text); }
    catch {
        if (res.status === 429)
            throw new Error('Bạn thao tác quá nhanh — máy chủ đang giới hạn lượt truy cập. Đợi vài phút rồi thử lại.');
        throw new Error(`Máy chủ trả về phản hồi không hợp lệ (HTTP ${res.status}). Thử tải lại trang.`);
    }
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
    let ver = '';
    let m;
    // Thứ tự quan trọng: các trình duyệt Chromium (Cốc Cốc, Brave, Edge, Opera)
    // đều có chuỗi "Chrome/x" trong UA — phải soi token riêng TRƯỚC Chrome
    if (/coc_coc/i.test(ua)) { browser = 'Cốc Cốc'; m = ua.match(/coc_coc_browser\/(\d+)/i); }
    else if (/brave/i.test(ua)) { browser = 'Brave'; m = ua.match(/Chrome\/(\d+)/i); }
    else if ((m = ua.match(/OPR\/(\d+)/i))) browser = 'Opera';
    else if ((m = ua.match(/Edg\/(\d+)/i))) browser = 'Edge';
    else if ((m = ua.match(/Chrome\/(\d+)/i))) browser = 'Chrome';
    else if ((m = ua.match(/Firefox\/(\d+)/i))) browser = 'Firefox';
    else if ((m = ua.match(/Version\/(\d+).*Safari/i))) browser = 'Safari';
    if (m) ver = ' ' + m[1];
    return `${browser}${ver} · ${os}`;
}

export const ApiService = {
    getToken: () => authToken,
    hasValidToken: () => tokenAlive(),
    getDeviceId,

    // Đăng nhập: xin challenge → ký bằng MetaMask → đổi lấy JWT 24h
    async loginWithWallet(signer, address) {
        const addr = String(address).toLowerCase();
        const chRes = await fetch(`${CONFIG.API_BASE}/auth/challenge?address=${addr}`);
        const chData = await readJson(chRes);
        if (!chRes.ok || !chData.challenge) throw new Error(chData.message || 'Không lấy được challenge đăng nhập');

        const signature = await signer.signMessage(chData.challenge);
        const res = await fetch(`${CONFIG.API_BASE}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ address: addr, signature, challenge: chData.challenge, deviceId: getDeviceId(), deviceLabel: getDeviceLabel() })
        });
        const data = await readJson(res);
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
                    let errMsg = "Lỗi từ chối tải lên từ máy chủ Backend.";
                    try { errMsg = JSON.parse(xhr.responseText).message || errMsg; }
                    catch { if (xhr.status === 429) errMsg = "Máy chủ đang giới hạn lượt tải lên — đợi vài phút rồi thử lại."; }
                    reject(new Error(errMsg));
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
        return await readJson(response);
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

    // Tra cứu tài liệu theo hash nội dung / tên file — public.
    // Dùng cho verify không cần gõ mã: thả file → băm → tự tìm docId.
    async lookupDocument(hash, name) {
        try {
            const q = new URLSearchParams();
            if (hash) q.set('hash', hash);
            if (name) q.set('name', name);
            const res = await fetch(`${CONFIG.API_BASE}/documents/lookup?${q}`);
            if (!res.ok) return null;
            return await res.json(); // { byHash: [...], byName: [...] }
        } catch { return null; }
    },

    // Tìm bản ghi có nội dung tương tự theo tập chunk-hash (CTPH) — public.
    // Dùng khi file bị sửa nhẹ + đổi tên: các đoạn còn nguyên vẫn trùng hash.
    async lookupSimilar(chunks) {
        try {
            const res = await fetch(`${CONFIG.API_BASE}/documents/lookup-similar`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chunks })
            });
            if (!res.ok) return null;
            return await res.json(); // { matches: [{docId, fileName, score, ...}] }
        } catch { return null; }
    },

    // Chuỗi phiên bản v1→v2→v3 của tài liệu — public
    async getDocumentLineage(docId) {
        try {
            const res = await fetch(`${CONFIG.API_BASE}/documents/${encodeURIComponent(docId)}/lineage`);
            if (!res.ok) return null;
            return await res.json(); // { success, chain: [{docId,fileName,version,isRevoked,...}], isLatest, supersededBy, latest }
        } catch { return null; }
    },

    // Trạng thái thu hồi trong MongoDB — public, để verify đối chiếu 2 nguồn
    async getDocumentStatus(docId) {
        try {
            const res = await fetch(`${CONFIG.API_BASE}/documents/${encodeURIComponent(docId)}/status`);
            if (!res.ok) return null;
            return await res.json(); // { isRevoked, revocationReason }
        } catch { return null; }
    },

    // Map docId -> orgName của tài liệu đối tác (server ký on-chain hộ) —
    // sổ cái hiện badge "ĐỐI TÁC" thay vì nhầm là doc của ví ADMIN
    async getPartnerDocs() {
        try {
            const res = await fetch(`${CONFIG.API_BASE}/partner-docs`, { headers: authHeaders() });
            if (!res.ok) return {};
            const data = await res.json();
            return data.partners || {};
        } catch { return {}; }
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
    // Step-up auth: xin challenge riêng cho thao tác nhạy cảm rồi ký bằng
    // MetaMask — JWT phiên không đủ, buộc có private key tại thời điểm thao tác.
    async stepUpSign(signer) {
        if (!signer) throw new Error('Cần kết nối MetaMask để ký xác nhận thao tác này');
        const res = await fetch(`${CONFIG.API_BASE}/auth/step-challenge`, {
            method: 'POST', headers: authHeaders()
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.challenge) throw new Error(data.message || 'Không lấy được challenge xác nhận');
        const stepSignature = await signer.signMessage(data.challenge);
        return { stepChallenge: data.challenge, stepSignature };
    },

    async revokeSession(deviceId, step) {
        const res = await fetch(`${CONFIG.API_BASE}/sessions/revoke`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify({ deviceId, ...step })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || 'Thu hồi phiên thất bại');
        return data;
    },

    // Duyệt một thiết bị đang pending (gọi từ thiết bị đã đăng nhập)
    async approveSession(deviceId, step) {
        const res = await fetch(`${CONFIG.API_BASE}/sessions/approve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify({ deviceId, ...step })
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
            return { status: data.status || 'unknown', activeDevices: data.activeDevices || [], otpAvailable: data.otpAvailable !== false };
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

    // Đăng ký email + SĐT chủ ví — email nhận OTP duyệt thiết bị mới.
    // Bắt buộc step signature; đổi email có sẵn → trả {pending:true} chờ mã về email cũ.
    async setWalletContact(email, phone, step) {
        const res = await fetch(`${CONFIG.API_BASE}/wallets/email`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify({ email, phone, ...step })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || 'Lưu thông tin liên hệ thất bại');
        return data;
    },

    // Bước 2 đổi email: xác nhận mã 6 số đã gửi về email CŨ
    async confirmEmailChange(code) {
        const res = await fetch(`${CONFIG.API_BASE}/wallets/email/confirm`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify({ code })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || 'Xác nhận đổi email thất bại');
        return data;
    },

    // Lấy khóa AES đã lưu escrow — public: mọi ví đăng nhập; private: chỉ uploader
    async getDocumentKey(docId) {
        const res = await fetch(`${CONFIG.API_BASE}/documents/${encodeURIComponent(docId)}/key`, { headers: authHeaders() });
        if (!res.ok) return null;
        const data = await res.json().catch(() => ({}));
        return data.key || null;
    },

    // Đổi chế độ public ↔ private — chỉ chủ sở hữu tài liệu
    async setDocumentVisibility(docId, visibility) {
        const res = await fetch(`${CONFIG.API_BASE}/documents/${encodeURIComponent(docId)}/visibility`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify({ visibility })
        });
        const data = await res.json().catch(() => ({}));
        return { ok: res.ok, ...data };
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
            method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ address })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || 'Không từ chối được ví');
        return data;
    },

    // Liên hệ admin — ví bị từ chối/chờ duyệt cần biết gọi ai
    async getAdminContact() {
        try {
            const res = await fetch(`${CONFIG.API_BASE}/wallets/admin-contact`, { headers: authHeaders() });
            if (!res.ok) return null;
            return await res.json();
        } catch (e) { return null; }
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
