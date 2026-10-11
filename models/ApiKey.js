import mongoose from 'mongoose';

// API key cấp cho đối tác B2B — chỉ lưu sha256(token), không bao giờ lưu plaintext
const apiKeySchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    keyHash: { type: String, required: true, unique: true },
    prefix: { type: String, required: true }, // "sk_live_ab12cd" — chỉ để hiển thị
    createdBy: { type: String, required: true, lowercase: true },
    revoked: { type: Boolean, default: false },
    lastUsedAt: { type: Date }
}, { timestamps: true });

export default mongoose.model('ApiKey', apiKeySchema);
