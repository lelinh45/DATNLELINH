import mongoose from 'mongoose';

// Chữ ký EIP-712 pending của tài liệu multi-sig — server verify chữ ký
// (recover signer ∈ requiredSigners, chưa trùng) TRƯỚC khi lưu. Khi đủ
// threshold, client gọi sealDocument on-chain với toàn bộ chữ ký.
const pendingSignatureSchema = new mongoose.Schema({
    docId: { type: String, required: true, index: true },
    signerAddress: { type: String, required: true, lowercase: true },
    signature: { type: String, required: true },
    fileHash: String,   // snapshot để detect doc bị thay
    ipfsURI: String,
    expiresAt: Number,
    previousDocId: String
}, { timestamps: { createdAt: true, updatedAt: false } });

pendingSignatureSchema.index({ docId: 1, signerAddress: 1 }, { unique: true });

export default mongoose.model('PendingSignature', pendingSignatureSchema);
