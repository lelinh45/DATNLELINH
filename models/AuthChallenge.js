import mongoose from 'mongoose';

// Challenge đăng nhập một lần dùng — lưu MongoDB để sống qua restart server.
// TTL index: MongoDB tự xóa document khi expiresAt quá hạn.
const authChallengeSchema = new mongoose.Schema({
    address: { type: String, required: true, unique: true, lowercase: true },
    challenge: { type: String, required: true },
    expiresAt: { type: Date, required: true }
});

authChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model('AuthChallenge', authChallengeSchema);
