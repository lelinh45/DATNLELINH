import mongoose from 'mongoose';

const batchSchema = new mongoose.Schema({
    batchId: { type: String, required: true, unique: true },
    merkleRoot: { type: String, required: true },
    ipfsCID: { type: String, required: true }, // This is the manifest CID
    txHash: { type: String, required: true },
    uploader: { type: String, required: true, lowercase: true },
    files: [{
        docId: String,
        fileName: String,
        fileHash: String,
        fileSize: String,
        ipfsCID: String, // FIX C2: CID of the individual file
        qrCode: String,  // FIX C2: Ensure it is saved if provided
        isRevoked: { type: Boolean, default: false },
        revocationReason: String,
        revokedBy: String,
        revokedAt: Number
    }],
    timestamp: { type: Number, default: Date.now }
});

export default mongoose.model('Batch', batchSchema);
