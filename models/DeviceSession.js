import mongoose from 'mongoose';

// Phiên đăng nhập theo thiết bị — deviceId do frontend sinh (random, lưu localStorage).
// status:
//   pending  — thiết bị mới, chờ phê duyệt từ thiết bị cũ (đường chính)
//              hoặc OTP email — chỉ mở khi ví không còn thiết bị nào active
//   active   — được phép dùng JWT
//   revoked  — bị kick / từ chối; requireAuth sẽ từ chối JWT mang claim 'dev' trùng deviceId
const deviceSessionSchema = new mongoose.Schema({
    address: { type: String, required: true, index: true },
    deviceId: { type: String, required: true },
    deviceLabel: { type: String, default: 'Thiết bị không rõ' },
    status: { type: String, enum: ['pending', 'active', 'revoked'], default: 'active' },
    createdAt: { type: Number, default: Date.now },
    lastSeen: { type: Number, default: Date.now },
    // OTP email cho thiết bị pending — lưu hash, không lưu mã thật
    otpHash: { type: String, default: '' },
    otpExpires: { type: Number, default: 0 },
    otpAttempts: { type: Number, default: 0 }
});

deviceSessionSchema.index({ address: 1, deviceId: 1 }, { unique: true });

export default mongoose.model('DeviceSession', deviceSessionSchema);
