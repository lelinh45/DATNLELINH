// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract DataIntegrity {
    // ==========================================
    // 1. KIẾN TRÚC PHÂN QUYỀN RBAC (Role-Based Access Control)
    // ==========================================
    uint8 public constant ROLE_NONE = 0;      // Khách: Không có quyền
    uint8 public constant ROLE_ENTRY = 1;     // Nhập liệu: Chỉ được Upload, cấm Thu hồi
    uint8 public constant ROLE_MANAGER = 2;   // Quản lý: Upload + Thu hồi tài liệu sai phạm
    uint8 public constant ROLE_ADMIN = 3;     // Admin: Toàn quyền + Gán quyền cho người khác

    mapping(address => uint8) public userRoles;
    address public owner;

    // ==========================================
    // 2. CẤU TRÚC DỮ LIỆU & LƯU TRỮ
    // ==========================================
    struct Document {
        string fileHash;
        string ipfsURI;
        uint256 timestamp;
        address uploader;
        bool isRevoked;
        string revocationReason;
    }

    struct MerkleBatch {
        bytes32 merkleRoot;
        string ipfsURI;
        uint256 timestamp;
        address uploader;
    }

    mapping(string => Document) private documents;
    mapping(string => MerkleBatch) private batches;
    mapping(string => string) public hashToDocId; // Sổ tay chống trùng lặp

    // ==========================================
    // 3. KHAI BÁO SỰ KIỆN (EVENTS)
    // ==========================================
    event DocumentAdded(string documentId, string fileHash, string ipfsURI, address uploader);
    event DocumentRevoked(string documentId, address revokedBy, string reason);
    event BatchAdded(string batchId, bytes32 merkleRoot, string ipfsURI, address uploader);
    
    // [NEW] Sự kiện khi quyền hạn của một ví bị thay đổi
    event RoleAssigned(address indexed admin, address indexed account, uint8 role);

    // ==========================================
    // 4. MODIFIERS (BỘ LỌC QUYỀN HẠN ĐA TẦNG)
    // ==========================================
    modifier onlyAdmin() {
        require(userRoles[msg.sender] == ROLE_ADMIN, "Loi: Chi Admin moi co quyen nay!");
        _;
    }

    modifier canUpload() {
        require(userRoles[msg.sender] >= ROLE_ENTRY, "Loi: Ban chua duoc cap quyen Upload!");
        _;
    }

    // ==========================================
    // 5. KHỞI TẠO & QUẢN LÝ PHÂN QUYỀN
    // ==========================================
    constructor() {
        owner = msg.sender; 
        userRoles[msg.sender] = ROLE_ADMIN; // Người deploy tự động làm Admin
    }

    // [NEW] Hàm gán quyền chi tiết cho từng ví (Thế chỗ hàm addIssuer cũ)
    function assignRole(address _account, uint8 _role) public onlyAdmin {
        require(_account != owner, "Loi: Khong the thay doi quyen cua Admin goc!");
        require(_role <= 3, "Loi: Cap do quyen khong hop le!");
        
        userRoles[_account] = _role;
        emit RoleAssigned(msg.sender, _account, _role);
    }

    // ==========================================
    // 6. NGHIỆP VỤ LÕI: LƯU TRỮ VÀ THU HỒI
    // ==========================================
    function addDocument(string memory _documentId, string memory _fileHash, string memory _ipfsURI) public canUpload {
        require(bytes(hashToDocId[_fileHash]).length == 0, "Loi: Tai lieu nay da ton tai tren he thong!");
        require(documents[_documentId].timestamp == 0, "Loi: ID da ton tai!");
        
        documents[_documentId] = Document(_fileHash, _ipfsURI, block.timestamp, msg.sender, false, "");
        hashToDocId[_fileHash] = _documentId;

        emit DocumentAdded(_documentId, _fileHash, _ipfsURI, msg.sender);
    }

    function addMerkleBatch(string memory _batchId, bytes32 _merkleRoot, string memory _ipfsURI) public canUpload {
        require(batches[_batchId].timestamp == 0, "Lo tai lieu nay da ton tai!");
        
        batches[_batchId] = MerkleBatch(_merkleRoot, _ipfsURI, block.timestamp, msg.sender);
        emit BatchAdded(_batchId, _merkleRoot, _ipfsURI, msg.sender);
    }

    function revokeDocument(string memory _documentId, string memory _reason) public {
        require(documents[_documentId].timestamp != 0, "Loi: Tai lieu khong ton tai!");
        require(!documents[_documentId].isRevoked, "Loi: Tai lieu nay da bi thu hoi!");
        
        // [NEW] Bức tường lửa RBAC: Chỉ Admin (3) và Quản lý (2) mới được phép thu hồi
        uint8 currentRole = userRoles[msg.sender];
        require(currentRole == ROLE_ADMIN || currentRole == ROLE_MANAGER, "Loi: Nhan vien Nhap lieu khong co quyen Thu hoi tai lieu!");

        documents[_documentId].isRevoked = true;
        documents[_documentId].revocationReason = _reason;

        emit DocumentRevoked(_documentId, msg.sender, _reason);
    }

    // ==========================================
    // 7. NGHIỆP VỤ ĐỌC & KIỂM ĐỊNH (PUBLIC)
    // ==========================================
    function getDocument(string memory _documentId) public view returns (
        string memory fileHash, string memory ipfsURI, uint256 timestamp, 
        address uploader, bool isRevoked, string memory revocationReason
    ) {
        require(documents[_documentId].timestamp != 0, "Khong tim thay tai lieu tren Blockchain!");
        Document memory doc = documents[_documentId];
        return (doc.fileHash, doc.ipfsURI, doc.timestamp, doc.uploader, doc.isRevoked, doc.revocationReason);
    }

    function getDocIdByHash(string memory _hash) public view returns (string memory) {
        return hashToDocId[_hash];
    }
}