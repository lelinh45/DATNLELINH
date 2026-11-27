export const CONFIG = {
    // Truy cập qua Live Server (port 5500) → API trỏ localhost:3000.
    // Truy cập qua chính backend / tunnel / domain → dùng same-origin /api.
    API_BASE: (typeof location !== 'undefined' && !['5500', '5501'].includes(location.port))
        ? `${location.origin}/api`
        : "http://localhost:3000/api", 
    CONTRACT_ADDRESS: "0x86F521B177Fc701F2ec3cdE274759C376c92522F", 
    HARDHAT_CHAIN_ID: "0xaa36a7", 
    HARDHAT_CHAIN_NAME: "Sepolia Testnet", 
    RPC_URL: "https://rpc.sepolia.org", 
    CURRENCY: { name: "Sepolia ETH", symbol: "ETH", decimals: 18 },
    
    // ABI contract v2 — sinh từ artifacts/contracts/DataIntegrity.sol/DataIntegrity.json
    // (npx hardhat compile). getDocument trả 11 fields; addDocument(s) cũ đã bị
    // thay bằng addDocumentV2/addDocumentsV2 + sealDocument (EIP-712).
    CONTRACT_ABI: [
    {
        "inputs": [],
        "stateMutability": "nonpayable",
        "type": "constructor"
    },
    {
        "inputs": [],
        "name": "ECDSAInvalidSignature",
        "type": "error"
    },
    {
        "inputs": [
            {
                "internalType": "uint256",
                "name": "length",
                "type": "uint256"
            }
        ],
        "name": "ECDSAInvalidSignatureLength",
        "type": "error"
    },
    {
        "inputs": [
            {
                "internalType": "bytes32",
                "name": "s",
                "type": "bytes32"
            }
        ],
        "name": "ECDSAInvalidSignatureS",
        "type": "error"
    },
    {
        "inputs": [],
        "name": "InvalidShortString",
        "type": "error"
    },
    {
        "inputs": [
            {
                "internalType": "string",
                "name": "str",
                "type": "string"
            }
        ],
        "name": "StringTooLong",
        "type": "error"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": false,
                "internalType": "string",
                "name": "batchId",
                "type": "string"
            },
            {
                "indexed": false,
                "internalType": "bytes32",
                "name": "merkleRoot",
                "type": "bytes32"
            },
            {
                "indexed": false,
                "internalType": "string",
                "name": "ipfsURI",
                "type": "string"
            },
            {
                "indexed": false,
                "internalType": "address",
                "name": "uploader",
                "type": "address"
            }
        ],
        "name": "BatchAdded",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": false,
                "internalType": "string",
                "name": "documentId",
                "type": "string"
            },
            {
                "indexed": false,
                "internalType": "string",
                "name": "fileHash",
                "type": "string"
            },
            {
                "indexed": false,
                "internalType": "string",
                "name": "ipfsURI",
                "type": "string"
            },
            {
                "indexed": false,
                "internalType": "string",
                "name": "previousDocId",
                "type": "string"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "expiresAt",
                "type": "uint256"
            },
            {
                "indexed": false,
                "internalType": "address[]",
                "name": "requiredSigners",
                "type": "address[]"
            },
            {
                "indexed": false,
                "internalType": "uint8",
                "name": "requiredThreshold",
                "type": "uint8"
            },
            {
                "indexed": false,
                "internalType": "address",
                "name": "uploader",
                "type": "address"
            }
        ],
        "name": "DocumentAddedV2",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": false,
                "internalType": "string",
                "name": "documentId",
                "type": "string"
            },
            {
                "indexed": false,
                "internalType": "address",
                "name": "revokedBy",
                "type": "address"
            },
            {
                "indexed": false,
                "internalType": "string",
                "name": "reason",
                "type": "string"
            }
        ],
        "name": "DocumentRevoked",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": false,
                "internalType": "string",
                "name": "documentId",
                "type": "string"
            },
            {
                "indexed": false,
                "internalType": "uint256",
                "name": "signerCount",
                "type": "uint256"
            }
        ],
        "name": "DocumentSealed",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [],
        "name": "EIP712DomainChanged",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "internalType": "address",
                "name": "admin",
                "type": "address"
            },
            {
                "indexed": true,
                "internalType": "address",
                "name": "account",
                "type": "address"
            },
            {
                "indexed": false,
                "internalType": "uint8",
                "name": "role",
                "type": "uint8"
            }
        ],
        "name": "RoleAssigned",
        "type": "event"
    },
    {
        "inputs": [],
        "name": "ROLE_ADMIN",
        "outputs": [
            {
                "internalType": "uint8",
                "name": "",
                "type": "uint8"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "ROLE_ENTRY",
        "outputs": [
            {
                "internalType": "uint8",
                "name": "",
                "type": "uint8"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "ROLE_MANAGER",
        "outputs": [
            {
                "internalType": "uint8",
                "name": "",
                "type": "uint8"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "ROLE_NONE",
        "outputs": [
            {
                "internalType": "uint8",
                "name": "",
                "type": "uint8"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "string",
                "name": "_documentId",
                "type": "string"
            },
            {
                "internalType": "string",
                "name": "_fileHash",
                "type": "string"
            },
            {
                "internalType": "string",
                "name": "_ipfsURI",
                "type": "string"
            },
            {
                "internalType": "string",
                "name": "_previousDocId",
                "type": "string"
            },
            {
                "internalType": "uint256",
                "name": "_expiresAt",
                "type": "uint256"
            },
            {
                "internalType": "address[]",
                "name": "_requiredSigners",
                "type": "address[]"
            },
            {
                "internalType": "uint8",
                "name": "_requiredThreshold",
                "type": "uint8"
            }
        ],
        "name": "addDocumentV2",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "string[]",
                "name": "_documentIds",
                "type": "string[]"
            },
            {
                "internalType": "string[]",
                "name": "_fileHashes",
                "type": "string[]"
            },
            {
                "internalType": "string[]",
                "name": "_ipfsURIs",
                "type": "string[]"
            },
            {
                "internalType": "string[]",
                "name": "_previousDocIds",
                "type": "string[]"
            },
            {
                "internalType": "uint256[]",
                "name": "_expiresAts",
                "type": "uint256[]"
            }
        ],
        "name": "addDocumentsV2",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "string",
                "name": "_batchId",
                "type": "string"
            },
            {
                "internalType": "bytes32",
                "name": "_merkleRoot",
                "type": "bytes32"
            },
            {
                "internalType": "string",
                "name": "_ipfsURI",
                "type": "string"
            }
        ],
        "name": "addMerkleBatch",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "_account",
                "type": "address"
            },
            {
                "internalType": "uint8",
                "name": "_role",
                "type": "uint8"
            }
        ],
        "name": "assignRole",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "eip712Domain",
        "outputs": [
            {
                "internalType": "bytes1",
                "name": "fields",
                "type": "bytes1"
            },
            {
                "internalType": "string",
                "name": "name",
                "type": "string"
            },
            {
                "internalType": "string",
                "name": "version",
                "type": "string"
            },
            {
                "internalType": "uint256",
                "name": "chainId",
                "type": "uint256"
            },
            {
                "internalType": "address",
                "name": "verifyingContract",
                "type": "address"
            },
            {
                "internalType": "bytes32",
                "name": "salt",
                "type": "bytes32"
            },
            {
                "internalType": "uint256[]",
                "name": "extensions",
                "type": "uint256[]"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "_uploader",
                "type": "address"
            },
            {
                "internalType": "string",
                "name": "_hash",
                "type": "string"
            }
        ],
        "name": "getDocIdByHash",
        "outputs": [
            {
                "internalType": "string",
                "name": "",
                "type": "string"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "string",
                "name": "_documentId",
                "type": "string"
            }
        ],
        "name": "getDocument",
        "outputs": [
            {
                "internalType": "string",
                "name": "fileHash",
                "type": "string"
            },
            {
                "internalType": "string",
                "name": "ipfsURI",
                "type": "string"
            },
            {
                "internalType": "uint256",
                "name": "timestamp",
                "type": "uint256"
            },
            {
                "internalType": "address",
                "name": "uploader",
                "type": "address"
            },
            {
                "internalType": "bool",
                "name": "isRevoked",
                "type": "bool"
            },
            {
                "internalType": "string",
                "name": "revocationReason",
                "type": "string"
            },
            {
                "internalType": "string",
                "name": "previousDocId",
                "type": "string"
            },
            {
                "internalType": "uint256",
                "name": "expiresAt",
                "type": "uint256"
            },
            {
                "internalType": "address[]",
                "name": "requiredSigners",
                "type": "address[]"
            },
            {
                "internalType": "uint8",
                "name": "requiredThreshold",
                "type": "uint8"
            },
            {
                "internalType": "bool",
                "name": "isSealed",
                "type": "bool"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "string",
                "name": "_batchId",
                "type": "string"
            }
        ],
        "name": "getMerkleBatch",
        "outputs": [
            {
                "internalType": "bytes32",
                "name": "merkleRoot",
                "type": "bytes32"
            },
            {
                "internalType": "string",
                "name": "ipfsURI",
                "type": "string"
            },
            {
                "internalType": "uint256",
                "name": "timestamp",
                "type": "uint256"
            },
            {
                "internalType": "address",
                "name": "uploader",
                "type": "address"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "string",
                "name": "_documentId",
                "type": "string"
            }
        ],
        "name": "getSuccessor",
        "outputs": [
            {
                "internalType": "string",
                "name": "",
                "type": "string"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "string",
                "name": "",
                "type": "string"
            },
            {
                "internalType": "address",
                "name": "",
                "type": "address"
            }
        ],
        "name": "hasSigned",
        "outputs": [
            {
                "internalType": "bool",
                "name": "",
                "type": "bool"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "owner",
        "outputs": [
            {
                "internalType": "address",
                "name": "",
                "type": "address"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "string",
                "name": "_documentId",
                "type": "string"
            },
            {
                "internalType": "string",
                "name": "_reason",
                "type": "string"
            }
        ],
        "name": "revokeDocument",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "string",
                "name": "_documentId",
                "type": "string"
            },
            {
                "internalType": "bytes[]",
                "name": "_signatures",
                "type": "bytes[]"
            }
        ],
        "name": "sealDocument",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "string",
                "name": "",
                "type": "string"
            }
        ],
        "name": "successorOf",
        "outputs": [
            {
                "internalType": "string",
                "name": "",
                "type": "string"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "_newOwner",
                "type": "address"
            }
        ],
        "name": "transferOwnership",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "",
                "type": "address"
            },
            {
                "internalType": "string",
                "name": "",
                "type": "string"
            }
        ],
        "name": "uploaderHashToDocId",
        "outputs": [
            {
                "internalType": "string",
                "name": "",
                "type": "string"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "",
                "type": "address"
            }
        ],
        "name": "userRoles",
        "outputs": [
            {
                "internalType": "uint8",
                "name": "",
                "type": "uint8"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    }
]
};
