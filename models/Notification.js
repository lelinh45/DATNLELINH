import mongoose from 'mongoose';

// Thông báo/cảnh báo theo ví — đăng nhập thiết bị lạ, tài liệu bị thu hồi, v.v.
const notificationSchema = new mongoose.Schema({
    address: { type: String, required: true, index: true }, // ví nhận thông báo (lowercase)
    type: { type: String, enum: ['new_device', 'new_wallet', 'device_pending', 'device_approved', 'doc_revoked', 'session_revoked', 'security_alert', 'system'], default: 'system' },
    title: { type: String, required: true },
    message: { type: String, default: '' },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
    read: { type: Boolean, default: false },
    createdAt: { type: Number, default: Date.now }
});

export default mongoose.model('Notification', notificationSchema);
