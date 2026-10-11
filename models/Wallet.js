import mongoose from 'mongoose';

const walletSchema = new mongoose.Schema({
    address: { type: String, required: true, unique: true, lowercase: true },
    alias: { type: String, default: '' },
    email: { type: String, default: '', lowercase: true, trim: true }, // email chủ ví — nhận OTP duyệt thiết bị mới
    phone: { type: String, default: '', trim: true }, // SĐT chủ ví — liên hệ/cảnh báo bảo mật
    role: { type: String, enum: ['ADMIN', 'QUẢN LÝ', 'NHẬP LIỆU', 'BỊ KHÓA', 'ĐÃ XÓA'], default: 'NHẬP LIỆU' },
    requestedRole: { type: String, enum: ['NHẬP LIỆU', 'QUẢN LÝ'], default: null }, // quyền ví tự đề nghị khi chờ duyệt
    status: { type: String, enum: ['ACTIVE', 'REVOKED', 'DELETED'], default: 'ACTIVE' },
    storageUsed: { type: Number, default: 0 },
    storageLimit: { type: Number, default: 1024 }, // 1 GB/ví — khớp quota thật của gói Pinata free
    lastActive: { type: Date, default: Date.now }
});

export default mongoose.model('Wallet', walletSchema);
