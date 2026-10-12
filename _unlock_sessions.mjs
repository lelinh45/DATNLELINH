// Mở khóa phiên đăng nhập: thu hồi toàn bộ DeviceSession còn sống để mọi ví
// đăng nhập lại được như "thiết bị đầu tiên" (tự duyệt nếu ví không có email,
// hoặc đi đường OTP nếu có). Giữ bản ghi với status 'revoked' làm lịch sử.
//   node _unlock_sessions.mjs             → thu hồi phiên của MỌI ví
//   node _unlock_sessions.mjs 0xABC...    → chỉ thu hồi phiên của ví đó
import 'dotenv/config';
import mongoose from 'mongoose';

const onlyAddr = (process.argv[2] || '').toLowerCase() || null;

await mongoose.connect(process.env.MONGO_URI);
const col = mongoose.connection.db.collection('devicesessions');

const filter = { status: { $nin: ['revoked'] }, revoked: { $ne: true } };
if (onlyAddr) filter.address = onlyAddr;

const list = await col.find(filter).toArray();
console.log(`Tìm thấy ${list.length} phiên còn sống${onlyAddr ? ` của ${onlyAddr}` : ''}:`);
for (const s of list) {
    console.log(` - ${s.address} | ${s.deviceLabel} | ${s.status} | lastSeen ${new Date(s.lastSeen).toLocaleString('vi-VN')}`);
}
if (list.length === 0) { await mongoose.disconnect(); process.exit(0); }

const r = await col.updateMany(filter, {
    $set: { status: 'revoked', revoked: true, otpHash: '', otpExpires: 0, otpAttempts: 0 }
});
console.log(`Đã thu hồi ${r.modifiedCount} phiên. Lần đăng nhập tới sẽ:`);
console.log('  • ví KHÔNG có email  → tự động duyệt thiết bị, vào thẳng');
console.log('  • ví CÓ email + SMTP → hiện màn chờ → bấm "Gửi mã OTP về email" → nhập mã → đăng nhập lại');
await mongoose.disconnect();
