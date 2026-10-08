export const CONFIG = {
    API_BASE: "http://localhost:3000/api", 
    CONTRACT_ADDRESS: "0x8cA16F64b7301fa5C687b02B67C6B60fEE8aA754", 
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
        "function addMerkleBatch(string _batchId, bytes32 _merkleRoot, string _ipfsURI)",
        "function revokeDocument(string _documentId, string _reason)",
        "function assignRole(address _account, uint8 _role)",
        
        "function userRoles(address) view returns (uint8)",
        "function owner() view returns (address)",
        "function hashToDocId(string) view returns (string)",
        "function getDocIdByHash(string _hash) view returns (string)",
        "function getDocument(string _documentId) view returns (string fileHash, string ipfsURI, uint256 timestamp, address uploader, bool isRevoked, string revocationReason)"
    ]
};