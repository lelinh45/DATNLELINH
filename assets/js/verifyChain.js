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

const ABI = [
    'function getDocument(string _documentId) view returns (string fileHash, string ipfsURI, uint256 timestamp, address uploader, bool isRevoked, string revocationReason)'
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
    return {
        fileHash: String(d[0] || '').toLowerCase(),
        ipfsURI: String(d[1] || ''),
        timestamp: Number(d[2] || 0),
        timestampISO: d[2] ? new Date(Number(d[2]) * 1000).toLocaleString('vi-VN') : '—',
        uploader: String(d[3] || ''),
        isRevoked: !!d[4],
        revocationReason: String(d[5] || ''),
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
            revocationReason: chainDoc.revocationReason
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
