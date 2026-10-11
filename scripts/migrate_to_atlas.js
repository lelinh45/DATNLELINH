// Copy toàn bộ collections từ MongoDB local (MONGO_URI trong .env)
// sang MongoDB Atlas. Chạy:
//   node scripts/migrate_to_atlas.js "mongodb+srv://user:pass@cluster.../DataIntegrity"
// URI Atlas truyền qua tham số dòng lệnh — không ghi vào file, không commit.
import mongoose from 'mongoose';
import 'dotenv/config';

const atlasUri = process.argv[2];
if (!atlasUri || !atlasUri.startsWith('mongodb+srv://')) {
    console.error('Cách dùng: node scripts/migrate_to_atlas.js "mongodb+srv://user:pass@cluster0.xxx.mongodb.net/DataIntegrity"');
    process.exit(1);
}

const local = await mongoose.createConnection(process.env.MONGO_URI).asPromise();
const atlas = await mongoose.createConnection(atlasUri).asPromise();

let total = 0;
for (const col of await local.db.listCollections().toArray()) {
    const docs = await local.db.collection(col.name).find({}).toArray();
    if (docs.length === 0) { console.log(`${col.name}: 0 docs — bỏ qua`); continue; }
    await atlas.db.collection(col.name).deleteMany({}); // thay hẳn dữ liệu cũ nếu có
    await atlas.db.collection(col.name).insertMany(docs);
    total += docs.length;
    console.log(`${col.name}: đã chuyển ${docs.length} docs`);
}
console.log(`\n✅ Xong — tổng ${total} bản ghi sang Atlas.`);
await local.close();
await atlas.close();
