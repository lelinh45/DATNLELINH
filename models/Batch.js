import mongoose from 'mongoose';

const batchSchema = new mongoose.Schema({
    batchId: { type: String, required: true, unique: true },
    merkleRoot: { type: String, required: true },
    ipfsCID: { type: String, required: true }, // CID của manifest JSON — danh mục file của cả lô
    txHash: { type: String, required: true },
    uploader: { type: String, required: true, lowercase: true },
    files: [{
        docId: String,
        fileName: String,
        fileHash: String,
        fileSize: String,
        ipfsCID: String, // CID riêng của từng file ciphertext
        qrCode: String,  // QR chứa docId để tra cứu nhanh khi in ấn
        encKey: String,  // AES key của file — đã bọc bằng MASTER_KEY (AES-256-GCM), không phải plaintext
        visibility: { type: String, enum: ['private', 'public'], default: 'private' },
        chunkHashes: [String], // fuzzy hash theo đoạn (CTPH) — phục vụ tìm file nội dung tương tự
        isRevoked: { type: Boolean, default: false },
        replacesDocId: String, // docId của phiên bản cũ mà file này thay thế — truy vết dòng đời
        revocationReason: String,
        revokedBy: String,
        revokedAt: Number
    }],
    timestamp: { type: Number, default: Date.now }
});

export default mongoose.model('Batch', batchSchema);
