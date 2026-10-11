import mongoose from 'mongoose';

// Tài liệu do đối tác B2B upload qua API key — server ký on-chain thay,
// quyền sở hữu gắn theo apiKeyId thay vì ví người dùng.
const partnerDocSchema = new mongoose.Schema({
    docId: { type: String, required: true, unique: true },
    apiKeyId: { type: mongoose.Schema.Types.ObjectId, ref: 'ApiKey', required: true },
    orgName: { type: String, default: '' },
    fileName: String,
    fileHash: String,
    fileSize: Number,
    ipfsCID: String,
    encKey: String, // AES key bọc MASTER_KEY — giống cơ chế escrow của luồng web
    txHash: String,
    isRevoked: { type: Boolean, default: false },
    revocationReason: String
}, { timestamps: true });

export default mongoose.model('PartnerDocument', partnerDocSchema);
