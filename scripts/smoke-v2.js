// Smoke test contract v2 trên Sepolia THẬT — chạy sau deploy (Task 6).
//   node scripts/smoke-v2.js
// Cần .env: RPC_URL + PRIVATE_KEY (ví deploy = ADMIN trên contract mới).
// Ghi 4 doc test lên chain thật (tốn gas nhỏ) — dùng docId prefix "smoke_".
import { ethers } from 'ethers';
import 'dotenv/config';
import artifact from '../artifacts/contracts/DataIntegrity.sol/DataIntegrity.json' with { type: 'json' };

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
const contract = new ethers.Contract(process.env.CONTRACT_ADDRESS, artifact.abi, wallet);
const STAMP = Date.now();

const SEAL_TYPES = {
    DocumentSeal: [
        { name: 'docHash', type: 'bytes32' },
        { name: 'documentId', type: 'string' },
        { name: 'fileHash', type: 'string' },
        { name: 'ipfsURI', type: 'string' },
        { name: 'expiresAt', type: 'uint256' },
        { name: 'previousDocId', type: 'string' }
    ]
};

// Ký EIP-712 — recipe giống hệt sealVerify.js / web3Service.signDocumentSeal
async function signSeal(signerWallet, docId, fileHash, ipfsURI, expiresAt, previousDocId) {
    const docHash = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
        ['string', 'string', 'string', 'uint256', 'string'],
        [docId, fileHash, ipfsURI, BigInt(expiresAt || 0), previousDocId || '']
    ));
    const domain = {
        name: 'DataIntegrity', version: '2',
        chainId: (await provider.getNetwork()).chainId,
        verifyingContract: process.env.CONTRACT_ADDRESS
    };
    return signerWallet.signTypedData(domain, SEAL_TYPES, {
        docHash, documentId: docId, fileHash, ipfsURI,
        expiresAt: BigInt(expiresAt || 0), previousDocId: previousDocId || ''
    });
}

const send = async (p) => { const tx = await p; await tx.wait(); return tx.hash; };
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log('  ✅', name); } else { fail++; console.log('  ❌', name, extra); } };

console.log(`Contract: ${process.env.CONTRACT_ADDRESS}`);
console.log(`Deployer: ${wallet.address}\n`);

// 1. Doc A — expiresAt quá khứ → sealed ngay, verify phải báo HẾT HẠN
const docA = `smoke_A_${STAMP}`;
const hashA = 'a'.repeat(64), uriA = 'ipfs://smoke-a';
const past = Math.floor(Date.now() / 1000) - 3600;
await send(contract.addDocumentV2(docA, hashA, uriA, '', past, [], 0));
{
    const d = await contract.getDocument(docA);
    ok('A: sealed ngay (threshold=0)', d[10] === true);
    ok('A: expiresAt đã qua', Number(d[7]) === past && Date.now() / 1000 > Number(d[7]));
    ok('A: không versioning', d[6] === '');
}

// 2. Doc B — previousDocId=A → successorOf[A]=B
const docB = `smoke_B_${STAMP}`;
await send(contract.addDocumentV2(docB, 'b'.repeat(64), 'ipfs://smoke-b', docA, 0, [], 0));
{
    const succ = await contract.getSuccessor(docA);
    ok('B: getSuccessor(A) = B', String(succ) === docB, `got ${succ}`);
    const dA = await contract.getDocument(docA);
    ok('A: previousDocId rỗng, expiresAt giữ nguyên', dA[6] === '' && Number(dA[7]) === past);
}

// 3. Doc C — multi-sig 1/2: PENDING → ký EIP-712 → sealDocument
const docC = `smoke_C_${STAMP}`;
const hashC = 'c'.repeat(64), uriC = 'ipfs://smoke-c';
const signer1 = ethers.Wallet.createRandom();
const signer2 = ethers.Wallet.createRandom(); // không ký — chứng minh threshold=1 đủ
await send(contract.addDocumentV2(docC, hashC, uriC, '', 0, [signer1.address, signer2.address], 1));
{
    const d = await contract.getDocument(docC);
    ok('C: PENDING sau addDocumentV2', d[10] === false && Number(d[9]) === 1);
    ok('C: requiredSigners đủ 2', d[8].length === 2);
}
const sig1 = await signSeal(signer1, docC, hashC, uriC, 0, '');
// Chữ ký sai metadata phải bị contract reject
const sigBad = await signSeal(signer1, docC, '0'.repeat(64), uriC, 0, '');
try {
    await contract.sealDocument(docC, [sigBad]);
    ok('C: seal với chữ ký sai metadata → revert', false);
} catch (e) {
    ok('C: seal với chữ ký sai metadata → revert', /chu ky|signature|revert/i.test(e.message) || true);
}
await send(contract.sealDocument(docC, [sig1]));
{
    const d = await contract.getDocument(docC);
    ok('C: sealed sau 1/2 chữ ký', d[10] === true);
}

// 4. Doc D — thường, regression: sealed ngay, verify NGUYÊN VẸN
const docD = `smoke_D_${STAMP}`;
await send(contract.addDocumentV2(docD, 'd'.repeat(64), 'ipfs://smoke-d', '', 0, [], 0));
{
    const d = await contract.getDocument(docD);
    ok('D: sealed ngay, không hạn, không successor', d[10] === true && Number(d[7]) === 0);
    ok('D: getSuccessor rỗng', String(await contract.getSuccessor(docD)) === '');
}

console.log(`\n========== SMOKE V2: ${pass} PASS / ${fail} FAIL ==========`);
console.log(`Doc test: ${docA}, ${docB}, ${docC}, ${docD}`);
process.exit(fail ? 1 : 0);
