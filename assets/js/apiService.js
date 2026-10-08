import { CONFIG } from './config.js';

export const ApiService = {
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
                    reject(new Error("Lỗi từ chối tải lên từ máy chủ Backend."));
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
                headers: { "Content-Type": "application/json" },
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
            const response = await fetch(`${CONFIG.API_BASE}/batches`);
            if (!response.ok) throw new Error("Lỗi lấy dữ liệu lô");
            const data = await response.json();
            return Array.isArray(data) ? data : [];
        } catch (error) {
            console.error("Lỗi Backend:", error);
            return [];
        }
    },

    // =====================================================================
    // 3. API: QUẢN LÝ QUYỀN VÍ BẰNG MONGODB
    // =====================================================================
    async getAllWallets() {
        try {
            const response = await fetch(`${CONFIG.API_BASE}/wallets`);
            if (!response.ok) throw new Error("Không thể lấy dữ liệu từ Backend");
            return await response.json(); 
        } catch (error) {
            console.error("Lỗi Backend:", error);
            return []; 
        }
    },

    async syncWalletData(walletAddress, updateData) {
        try {
            const response = await fetch(`${CONFIG.API_BASE}/wallets/sync`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
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
