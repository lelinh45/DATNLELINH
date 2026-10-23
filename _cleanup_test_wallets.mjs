// Dọn ví test khỏi MongoDB — liệt kê trước, chỉ xóa khi có --yes.
// Dùng:
//   node _cleanup_test_wallets.mjs --list                 → xem toàn bộ ví
//   node _cleanup_test_wallets.mjs --keep 0xAAA,0xBBB     → DRY-RUN (in ra sẽ xóa gì)
//   node _cleanup_test_wallets.mjs --keep 0xAAA,0xBBB --yes → xóa thật
// Xóa: Wallet + DeviceSession + AuthChallenge + Notification của các ví KHÔNG giữ lại.
// KHÔNG đụng Batch/PartnerDocument (dấu vết on-chain) — chỉ cảnh báo nếu ví bị xóa có lô.
import 'dotenv/config';
import mongoose from 'mongoose';
import Wallet from './models/Wallet.js';
import DeviceSession from './models/DeviceSession.js';
import AuthChallenge from './models/AuthChallenge.js';
import Notification from './models/Notification.js';
import Batch from './models/Batch.js';

const args = process.argv.slice(2);
const doList = args.includes('--list');
const keepIdx = args.indexOf('--keep');
const keep = keepIdx >= 0 ? args[keepIdx + 1].split(',').map(a => a.trim().toLowerCase()).filter(Boolean) : [];
const dryRun = !args.includes('--yes');

if (!process.env.MONGO_URI) { console.error('Thiếu MONGO_URI trong .env'); process.exit(1); }
await mongoose.connect(process.env.MONGO_URI);

const wallets = await Wallet.find({}).sort({ createdAt: 1 }).lean();
console.log(`\n=== ${wallets.length} ví trong DB ===`);
for (const w of wallets) {
    const keepMark = keep.includes(String(w.address).toLowerCase()) ? '  [GIỮ]' : '';
    console.log(`${w.address}  role=${w.role}  status=${w.status}  alias="${w.alias || ''}"  granted=${!!w.roleGranted}${keepMark}`);
}

if (doList) { await mongoose.disconnect(); process.exit(0); }

if (!keep.length) { console.error('\nChưa có --keep <địa_chỉ1,địa_chỉ2> — chỉ in danh sách. Thêm --list để xem.'); await mongoose.disconnect(); process.exit(1); }

const toDelete = wallets.filter(w => !keep.includes(String(w.address).toLowerCase()));
if (!toDelete.length) { console.log('\nKhông có ví nào để xóa.'); await mongoose.disconnect(); process.exit(0); }

const addrs = toDelete.map(w => w.address);
// Cảnh báo lô tài liệu của ví sắp xóa — dữ liệu on-chain giữ nguyên, chỉ mất metadata
const batchCounts = await Promise.all(addrs.map(a => Batch.countDocuments({ uploader: a })));

console.log(`\n=== ${dryRun ? 'DRY-RUN — chưa xóa gì' : 'XÓA THẬT'} ===`);
for (let i = 0; i < toDelete.length; i++) {
    console.log(`- ${toDelete[i].address}  "${toDelete[i].alias || ''}"  ${toDelete[i].role}${batchCounts[i] ? `  ⚠ có ${batchCounts[i]} lô tài liệu (giữ nguyên on-chain)` : ''}`);
}

if (dryRun) {
    console.log('\nKiểm tra kỹ rồi chạy lại thêm --yes để xóa thật.');
} else {
    const r1 = await Wallet.deleteMany({ address: { $in: addrs } });
    const r2 = await DeviceSession.deleteMany({ address: { $in: addrs } });
    const r3 = await AuthChallenge.deleteMany({ address: { $in: addrs } });
    const r4 = await Notification.deleteMany({ address: { $in: addrs } });
    console.log(`\nĐã xóa: ${r1.deletedCount} ví · ${r2.deletedCount} phiên · ${r3.deletedCount} challenge · ${r4.deletedCount} thông báo`);
    console.log('Ví bị xóa đăng nhập lại sẽ vào khay chờ cấp quyền như ví mới.');
}

await mongoose.disconnect();
