import mongoose from 'mongoose';

const walletSchema = new mongoose.Schema({
    address: { type: String, required: true, unique: true, lowercase: true },
    alias: { type: String, default: '' },
    email: { type: String, default: '', lowercase: true, trim: true }, // email chủ ví — nhận OTP duyệt thiết bị mới
    phone: { type: String, default: '', trim: true }, // SĐT chủ ví — liên hệ/cảnh báo bảo mật
    role: { type: String, enum: ['ADMIN', 'QUẢN LÝ', 'NHẬP LIỆU', 'NGƯỜI XEM', 'BỊ KHÓA', 'ĐÃ XÓA'], default: 'NHẬP LIỆU' },
    requestedRole: { type: String, enum: ['NHẬP LIỆU', 'QUẢN LÝ', 'NGƯỜI XEM'], default: null }, // quyền ví tự đề nghị khi chờ duyệt
    status: { type: String, enum: ['ACTIVE', 'REVOKED', 'DELETED'], default: 'ACTIVE' },
    rejected: { type: Boolean, default: false }, // true = bị Admin từ chối cấp quyền (khác với bị khóa thủ công)
    rejectCount: { type: Number, default: 0 }, // số lần xin quyền bị từ chối tích lũy — reset khi được duyệt
    rejectBlockedUntil: { type: Number, default: 0 }, // mốc ms: bị từ chối ≥3 lần → cấm xin lại tới mốc này (30 phút)
    roleGranted: { type: Boolean, default: false }, // true = role do Admin gán (khác với mặc định khi ví tự tạo) — fallback quyền chỉ tin cờ này
    storageUsed: { type: Number, default: 0 },
    storageLimit: { type: Number, default: 1024 }, // 1 GB/ví — khớp quota thật của gói Pinata free
    lastActive: { type: Date, default: Date.now }
});

export default mongoose.model('Wallet', walletSchema);
