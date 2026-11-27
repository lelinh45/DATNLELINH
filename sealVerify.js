// =====================================================================
// EIP-712 "DocumentSeal" — recipe CHUNG giữa client (web3Service.signDocumentSeal),
// contract (sealDocument) và server (POST /api/documents/:docId/signature).
// Mọi thay đổi ở đây phải khớp 100% với DOCUMENT_SEAL_TYPEHASH trong
// contracts/DataIntegrity.sol — sai 1 field là chữ ký vô hiệu.
// =====================================================================
import { ethers } from 'ethers';

export const SEAL_DOMAIN_NAME = 'DataIntegrity';
export const SEAL_DOMAIN_VERSION = '2';

export const SEAL_TYPES = {
    DocumentSeal: [
        { name: 'docHash', type: 'bytes32' },
        { name: 'documentId', type: 'string' },
        { name: 'fileHash', type: 'string' },
        { name: 'ipfsURI', type: 'string' },
        { name: 'expiresAt', type: 'uint256' },
        { name: 'previousDocId', type: 'string' }
    ]
};

// Domain EIP-712: chainId động (Sepolia=11155111), verifyingContract = địa chỉ deploy.
export function sealDomain(chainId, verifyingContract) {
    return {
        name: SEAL_DOMAIN_NAME,
        version: SEAL_DOMAIN_VERSION,
        chainId: BigInt(chainId),
        verifyingContract
    };
}

// docHash = keccak256(abi.encode(documentId, fileHash, ipfsURI, expiresAt, previousDocId))
// — đúng y hệt sealDocument() trong contract. expiresAt/previousDocId PHẢI lấy
// từ giá trị doc đang lưu on-chain (getDocument), không phải giá trị client gửi.
export function sealDocHash(documentId, fileHash, ipfsURI, expiresAt, previousDocId) {
    return ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
        ['string', 'string', 'string', 'uint256', 'string'],
        [documentId, fileHash, ipfsURI, BigInt(expiresAt || 0), previousDocId || '']
    ));
}

// Message đầy đủ để verifyTypedData / signTypedData.
export function sealMessage(documentId, fileHash, ipfsURI, expiresAt, previousDocId) {
    return {
        docHash: sealDocHash(documentId, fileHash, ipfsURI, expiresAt, previousDocId),
        documentId,
        fileHash,
        ipfsURI,
        expiresAt: BigInt(expiresAt || 0),
        previousDocId: previousDocId || ''
    };
}

// Chữ ký EIP-712 EOA: 65 bytes = 0x + 130 ký tự hex. Từ chối mọi định dạng khác
// (trước khi tốn RPC recover) — contract cũng chỉ nhận bytes[] 65-byte.
export function isValidSealSignature(sig) {
    return typeof sig === 'string' && /^0x[0-9a-fA-F]{130}$/.test(sig);
}

// Recover địa chỉ signer từ chữ ký — trả về checksummed address.
export function recoverSealSigner(domain, message, signature) {
    return ethers.verifyTypedData(domain, SEAL_TYPES, message, signature);
}
