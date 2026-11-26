import mongoose from 'mongoose';

// Nhật ký phát hiện file bị sửa đổi khi verify — bằng chứng pháp y:
// ai nộp, lúc nào, hash nộp vs hash trên chain, IP/user-agent.
const tamperEventSchema = new mongoose.Schema({
    docId: { type: String, required: true, index: true },
    ownerAddress: { type: String, default: '', index: true }, // ví tạo tài liệu bị giả mạo
    submittedHash: String,  // hash file người nộp tính được
    onChainHash: String,    // hash gốc ghi trên contract
    ip: String,
    userAgent: String,
    source: { type: String, default: 'verify' }, // 'verify' | 'lookup'
    webhookSent: { type: Boolean, default: false }
}, { timestamps: { createdAt: true, updatedAt: false } });

export default mongoose.model('TamperEvent', tamperEventSchema);
