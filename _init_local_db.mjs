// Khoi tao database MongoDB LOCAL cho dev: tao collections + indexes
// cho toan bo models. Chay: node _init_local_db.mjs
// (hoac MONGO_URI=mongodb://127.0.0.1:27017/ten_khac node _init_local_db.mjs)
import mongoose from 'mongoose';

const URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/bdi_dev';

const modules = await Promise.all([
    import('./models/ApiKey.js'),
    import('./models/AuthChallenge.js'),
    import('./models/Batch.js'),
    import('./models/DeviceSession.js'),
    import('./models/Notification.js'),
    import('./models/PartnerDocument.js'),
    import('./models/Wallet.js'),
]);

await mongoose.connect(URI);
console.log('Connected:', URI);
console.log('Database :', mongoose.connection.name);

for (const m of modules) {
    const Model = m.default;
    await Model.createCollection();
    await Model.syncIndexes();
    const idx = await Model.collection.indexes();
    console.log(`OK  ${Model.collection.name.padEnd(16)} indexes: ${idx.length}`);
}

const cols = await mongoose.connection.db.listCollections().toArray();
console.log('Collections:', cols.map(c => c.name).join(', '));
await mongoose.disconnect();
