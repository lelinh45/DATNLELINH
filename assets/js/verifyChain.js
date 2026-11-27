// Xác thực TRỰC TIẾP on-chain từ trình duyệt — không qua backend.
// Dùng ethers UMD (window.ethers) + CONFIG từ config.js. Mọi RPC đều là
// public read-only; lỗi RPC được fallback qua danh sách endpoint.
import { CONFIG } from './config.js';

const RPC_FALLBACKS = [
    CONFIG.RPC_URL,
    'https://ethereum-sepolia-rpc.publicnode.com',
    'https://sepolia.drpc.org',
    'https://rpc.sepolia.org'
].filter((v, i, a) => v && a.indexOf(v) === i);

// ABI tối thiểu cho getDocument v2 — 11 fields theo thứ tự contract:
// (fileHash, ipfsURI, timestamp, uploader, isRevoked, revocationReason,
//  previousDocId, expiresAt, requiredSigners, requiredThreshold, isSealed)
const ABI = [
    'function getDocument(string _documentId) view returns (string fileHash, string ipfsURI, uint256 timestamp, address uploader, bool isRevoked, string revocationReason, string previousDocId, uint256 expiresAt, address[] requiredSigners, uint8 requiredThreshold, bool isSealed)',
    'function getSuccessor(string _documentId) view returns (string)',
    'function hasSigned(string _documentId, address _signer) view returns (bool)'
];

let cached = null; // { provider, contract, rpcUrl }

async function connect() {
    if (cached) return cached;
    let lastErr = null;
    for (const url of RPC_FALLBACKS) {
        try {
            const provider = new ethers.JsonRpcProvider(url, 11155111, { staticNetwork: true });
            await provider.getBlockNumber(); // probe — RPC chết thì thử endpoint kế
            const contract = new ethers.Contract(CONFIG.CONTRACT_ADDRESS, ABI, provider);
            cached = { provider, contract, rpcUrl: url };
            return cached;
        } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('Không có RPC nào phản hồi');
}

// docId -> bản ghi on-chain. Throw Error với message thân thiện khi lỗi.
export async function verifyOnChain(docId) {
    const { contract, rpcUrl } = await connect();
    const d = await contract.getDocument(docId);
    const expiresAtNum = d[7] != null ? Number(d[7]) : 0;
    const requiredSigners = Array.isArray(d[8]) ? d[8].map(String) : [];
    const sealed = !!d[10];
    const requiredThreshold = Number(d[9] || 0);
    // Doc PENDING (threshold>0, chưa sealed): đếm hasSigned trên từng signer
    // để hiển thị "đã ký x/y" — tối đa 20 signer nên ≤20 RPC call song song.
    let signedCount = null;
    if (!sealed && requiredThreshold > 0 && requiredSigners.length) {
        const flags = await Promise.all(
            requiredSigners.map(a => contract.hasSigned(docId, a).catch(() => false))
        );
        signedCount = flags.filter(Boolean).length;
    }
    // successorOf: docId bản mới kế thừa ("" = chưa có) — nguồn on-chain độc lập
    // với hasNewer off-chain (Mongo replacesDocId).
    const successor = await contract.getSuccessor(docId).catch(() => '');
    return {
        fileHash: String(d[0] || '').toLowerCase(),
        ipfsURI: String(d[1] || ''),
        timestamp: Number(d[2] || 0),
        timestampISO: d[2] ? new Date(Number(d[2]) * 1000).toLocaleString('vi-VN') : '—',
        uploader: String(d[3] || ''),
        isRevoked: !!d[4],
        revocationReason: String(d[5] || ''),
        previousDocId: String(d[6] || ''),
        expiresAt: expiresAtNum.toString(),
        expiresAtISO: expiresAtNum > 0 ? new Date(expiresAtNum * 1000).toLocaleString('vi-VN') : null,
        isExpired: expiresAtNum > 0 && Date.now() / 1000 > expiresAtNum,
        requiredSigners,
        requiredThreshold,
        signedCount,
        sealed,
        successor: String(successor || ''),
        rpcUsed: rpcUrl,
        contractAddress: CONFIG.CONTRACT_ADDRESS,
        chainId: 11155111
    };
}

// Gói bằng chứng độc lập — ai cũng tái kiểm chứng được bằng getDocument() trên RPC công cộng.
export function buildProofBundle(docId, localHash, chainDoc) {
    return {
        schema: 'bdi-proof-bundle/v1',
        docId,
        contractAddress: CONFIG.CONTRACT_ADDRESS,
        chainId: 11155111,
        rpcUsed: chainDoc.rpcUsed,
        onChain: {
            fileHash: chainDoc.fileHash,
            ipfsURI: chainDoc.ipfsURI,
            timestamp: chainDoc.timestamp,
            timestampISO: chainDoc.timestampISO,
            uploader: chainDoc.uploader,
            isRevoked: chainDoc.isRevoked,
            revocationReason: chainDoc.revocationReason,
            previousDocId: chainDoc.previousDocId,
            expiresAt: chainDoc.expiresAt,
            expiresAtISO: chainDoc.expiresAtISO,
            isExpired: chainDoc.isExpired,
            requiredThreshold: chainDoc.requiredThreshold,
            signedCount: chainDoc.signedCount,
            sealed: chainDoc.sealed,
            successor: chainDoc.successor
        },
        client: {
            localHash: localHash || null,
            hashMatch: localHash ? (localHash.toLowerCase() === chainDoc.fileHash) : null
        },
        verifiedAt: new Date().toISOString(),
        note: 'Tái kiểm chứng: gọi getDocument(docId) trên contract tại bất kỳ RPC Sepolia công cộng nào.'
    };
}

export function downloadProofBundle(docId, localHash, chainDoc) {
    const bundle = buildProofBundle(docId, localHash, chainDoc);
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `proof_${docId.replace(/[^\w.\-]/g, '_')}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
}
