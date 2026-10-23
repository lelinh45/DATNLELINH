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
    refDocId: { type: String, default: '' },      // docId on-chain gốc khi bản ghi là tham chiếu dùng chung
    isSharedRef: { type: Boolean, default: false }, // true = nội dung trùng bản đã đóng dấu → dùng chung bằng chứng on-chain
    isRevoked: { type: Boolean, default: false },
    revocationReason: String,
    revokedBy: String,   // ví ADMIN (sổ cái) hoặc "partner:<tên tổ chức>" (tự thu hồi qua API)
    revokedAt: Date,
    revokeTxHash: String // tx on-chain của revokeDocument (nếu ghi được)
}, { timestamps: true });

export default mongoose.model('PartnerDocument', partnerDocSchema);
