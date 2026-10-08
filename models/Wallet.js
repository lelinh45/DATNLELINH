import mongoose from 'mongoose';

const walletSchema = new mongoose.Schema({
    address: { type: String, required: true, unique: true, lowercase: true },
    alias: { type: String, default: '' },
    role: { type: String, enum: ['ADMIN', 'QUẢN LÝ', 'NHẬP LIỆU', 'BỊ KHÓA', 'ĐÃ XÓA'], default: 'NHẬP LIỆU' },
    status: { type: String, enum: ['ACTIVE', 'REVOKED', 'DELETED'], default: 'ACTIVE' },
    storageUsed: { type: Number, default: 0 },
    storageLimit: { type: Number, default: 500 },
    lastActive: { type: Date, default: Date.now }
});

export default mongoose.model('Wallet', walletSchema);
