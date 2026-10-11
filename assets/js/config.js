export const CONFIG = {
    // Truy cập qua Live Server (port 5500) → API trỏ localhost:3000.
    // Truy cập qua chính backend / tunnel / domain → dùng same-origin /api.
    API_BASE: (typeof location !== 'undefined' && !['5500', '5501'].includes(location.port))
        ? `${location.origin}/api`
        : "http://localhost:3000/api", 
    CONTRACT_ADDRESS: "0xAf1e50C05D6Cf05f2927231dDf418EEc6CC5dF74", 
    HARDHAT_CHAIN_ID: "0xaa36a7", 
    HARDHAT_CHAIN_NAME: "Sepolia Testnet", 
    RPC_URL: "https://rpc.sepolia.org", 
    CURRENCY: { name: "Sepolia ETH", symbol: "ETH", decimals: 18 },
    
    // Đây chính là ABI đã được trích xuất từ file .sol của bạn!
    CONTRACT_ABI: [
        "constructor()",
        "event DocumentAdded(string documentId, string fileHash, string ipfsURI, address uploader)",
        "event DocumentRevoked(string documentId, address revokedBy, string reason)",
        "event BatchAdded(string batchId, bytes32 merkleRoot, string ipfsURI, address uploader)",
        "event RoleAssigned(address indexed admin, address indexed account, uint8 role)",
        
        "function addDocument(string _documentId, string _fileHash, string _ipfsURI)",
        "function addDocuments(string[] _documentIds, string[] _fileHashes, string[] _ipfsURIs)",
        "function addMerkleBatch(string _batchId, bytes32 _merkleRoot, string _ipfsURI)",
        "function revokeDocument(string _documentId, string _reason)",
        "function assignRole(address _account, uint8 _role)",
        "function transferOwnership(address _newOwner)",
        
        "function userRoles(address) view returns (uint8)",
        "function owner() view returns (address)",
        "function hashToDocId(string) view returns (string)",
        "function getDocIdByHash(string _hash) view returns (string)",
        "function getMerkleBatch(string _batchId) view returns (bytes32 merkleRoot, string ipfsURI, uint256 timestamp, address uploader)",
        "function getDocument(string _documentId) view returns (string fileHash, string ipfsURI, uint256 timestamp, address uploader, bool isRevoked, string revocationReason)"
    ]
};