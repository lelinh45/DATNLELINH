// Xóa các batch chỉ tồn tại trong MongoDB (không có file nào on-chain trên
// contract mới) — giữ lại các batch có ít nhất 1 file đã được addDocuments ghi.
// Backup bản ghi bị xóa ra _backup_deleted_batches.json trước khi delete.
import 'dotenv/config';
import mongoose from 'mongoose';
import { ethers } from 'ethers';
import fs from 'fs';

const NEW_CONTRACT = '0xAf1e50C05D6Cf05f2927231dDf418EEc6CC5dF74';

await mongoose.connect(process.env.MONGO_URI);
const provider = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL || process.env.RPC_URL);
const contract = new ethers.Contract(NEW_CONTRACT,
    ['function getDocument(string) view returns (string,string,uint256,address,bool,string)'], provider);

const col = mongoose.connection.db.collection('batches');
const docs = await col.find({}).toArray();
const toDelete = [], toKeep = [];
for (const b of docs) {
    const files = (b.files && b.files.length) ? b.files : [{ docId: b.docId }];
    let onChain = false;
    for (const f of files) {
        try { await contract.getDocument(f.docId || b.batchId); onChain = true; break; } catch (e) {}
    }
    (onChain ? toKeep : toDelete).push(b);
}
console.log('Giữ (có file on-chain):', toKeep.map(b => b.batchId).join(', '));
console.log('Xóa:', toDelete.length, 'batch,', toDelete.reduce((s, b) => s + ((b.files || []).length || 1), 0), 'file');

fs.writeFileSync('_backup_deleted_batches.json', JSON.stringify(toDelete, null, 2));
const r = await col.deleteMany({ _id: { $in: toDelete.map(b => b._id) } });
console.log('Đã xóa:', r.deletedCount, 'batch. Backup → _backup_deleted_batches.json');

// Tính lại dung lượng ví theo dữ liệu còn lại
const walletCol = mongoose.connection.db.collection('wallets');
const used = {};
for (const b of await col.find({}).toArray()) {
    const up = (b.uploader || '').toLowerCase();
    for (const f of (b.files || [])) {
        if (!f.revoked) used[up] = (used[up] || 0) + (f.fileSize || 0);
    }
}
for (const w of await walletCol.find({}).toArray()) {
    const u = used[(w.address || '').toLowerCase()] || 0;
    await walletCol.updateOne({ _id: w._id }, { $set: { storageUsed: u } });
}
console.log('Dung lượng còn lại:', used);
await mongoose.disconnect();
