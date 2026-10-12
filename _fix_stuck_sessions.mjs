// Xóa cờ revoked trên phiên đang ở trạng thái lai (status != 'revoked' nhưng revoked=true)
// — xảy ra khi phiên bị thu hồi rồi được hồi sinh sang pending mà không xóa cờ.
import 'dotenv/config';
import mongoose from 'mongoose';

await mongoose.connect(process.env.MONGO_URI);
const col = mongoose.connection.db.collection('devicesessions');
const stuck = await col.find({ status: { $ne: 'revoked' }, revoked: true }).toArray();
console.log('Phiên kẹt lai:', stuck.length);
for (const s of stuck) console.log(' -', s.address, '|', s.deviceLabel, '|', s.status);
const r = await col.updateMany(
    { status: { $ne: 'revoked' }, revoked: true },
    { $set: { revoked: false } }
);
console.log('Đã sửa', r.modifiedCount, 'phiên');
await mongoose.disconnect();
