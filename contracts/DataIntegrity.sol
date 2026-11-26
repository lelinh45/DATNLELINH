// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract DataIntegrity is EIP712 {
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
    // 2. CẤU TRÚC DỮ LIỆU & LƯU TRỮ (v2)
    // ==========================================
    struct Document {
        string fileHash;
        string ipfsURI;
        uint256 timestamp;
        address uploader;
        bool isRevoked;
        string revocationReason;
        string previousDocId;        // versioning: docId bản cũ ("" = không)
        uint256 expiresAt;           // 0 = không hết hạn; >0 = hạn epoch giây
        address[] requiredSigners;   // multi-sig: rỗng = không yêu cầu ký
        uint8 requiredThreshold;     // số chữ ký tối thiểu (0 = ký tự do)
        bool isSealed;                 // đủ chữ ký → hoàn tất pháp lý
    }

    struct MerkleBatch {
        bytes32 merkleRoot;
        string ipfsURI;
        uint256 timestamp;
        address uploader;
    }

    mapping(string => Document) private documents;
    mapping(string => MerkleBatch) private batches;
    // Sổ tay chống trùng lặp THEO VÍ — mỗi tổ chức/ví có sổ riêng.
    // Cùng một nội dung có thể được nhiều ví khác nhau đóng dấu độc lập
    // (kịch bản multi-tenant), nhưng một ví không ghi 2 lần cùng nội dung
    // trừ khi bản ghi cũ đã bị thu hồi.
    mapping(address => mapping(string => string)) public uploaderHashToDocId;
    // Versioning: previousDocId -> docId bản mới ("" = chưa có bản kế thừa).
    // Chỉ set khi bản mới sealed (hoặc sealed ngay nếu threshold == 0).
    mapping(string => string) public successorOf;
    // Multi-sig: chống ký trùng / replay chữ ký.
    mapping(string => mapping(address => bool)) public hasSigned;

    // ==========================================
    // 3. EIP-712 — KÝ GỘP ĐA CHỮ KÝ
    // ==========================================
    // Domain: name="DataIntegrity", version="2", chainId động, verifyingContract.
    // Struct: DocumentSeal(bytes32 docHash, string documentId, string fileHash,
    //                      string ipfsURI, uint256 expiresAt, string previousDocId)
    //   docHash = keccak256(abi.encode(documentId, fileHash, ipfsURI, expiresAt, previousDocId))
    bytes32 private constant DOCUMENT_SEAL_TYPEHASH = keccak256(
        "DocumentSeal(bytes32 docHash,string documentId,string fileHash,string ipfsURI,uint256 expiresAt,string previousDocId)"
    );

    // ==========================================
    // 4. KHAI BÁO SỰ KIỆN (EVENTS)
    // ==========================================
    event DocumentAddedV2(
        string documentId,
        string fileHash,
        string ipfsURI,
        string previousDocId,
        uint256 expiresAt,
        address[] requiredSigners,
        uint8 requiredThreshold,
        address uploader
    );
    event DocumentSealed(string documentId, uint256 signerCount);
    event DocumentRevoked(string documentId, address revokedBy, string reason);
    event BatchAdded(string batchId, bytes32 merkleRoot, string ipfsURI, address uploader);

    // [NEW] Sự kiện khi quyền hạn của một ví bị thay đổi
    event RoleAssigned(address indexed admin, address indexed account, uint8 role);

    // ==========================================
    // 5. MODIFIERS (BỘ LỌC QUYỀN HẠN ĐA TẦNG)
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
    // 6. KHỞI TẠO & QUẢN LÝ PHÂN QUYỀN
    // ==========================================
    constructor() EIP712("DataIntegrity", "2") {
        owner = msg.sender;
        userRoles[msg.sender] = ROLE_ADMIN; // Người deploy tự động làm Admin
    }

    // Hàm gán quyền chi tiết cho từng ví (Thế chỗ hàm addIssuer cũ)
    function assignRole(address _account, uint8 _role) public onlyAdmin {
        require(_account != owner, "Loi: Khong the thay doi quyen cua Admin goc!");
        require(_role <= 3, "Loi: Cap do quyen khong hop le!");

        userRoles[_account] = _role;
        emit RoleAssigned(msg.sender, _account, _role);
    }

    // ==========================================
    // 7. NGHIỆP VỤ LÕI: LƯU TRỮ, VERSIONING, ĐÓNG DẤU ĐA CHỮ KÝ
    // ==========================================

    // Kiểm tra quyền versioning cho previousDocId (ràng buộc 2 của spec):
    // - doc cũ phải tồn tại
    // - caller là uploader bản cũ HOẶC role >= MANAGER
    // - nếu uploader bản cũ là ADMIN → caller phải là ADMIN
    // - chặn phân nhánh: previousDocId chưa được có successor
    function _checkPreviousDoc(string memory _previousDocId) private view {
        Document storage prev = documents[_previousDocId];
        require(prev.timestamp != 0, "Loi: previousDocId khong ton tai!");

        if (userRoles[prev.uploader] == ROLE_ADMIN) {
            require(userRoles[msg.sender] == ROLE_ADMIN, "Loi: Chi ADMIN duoc ke thua tai lieu cua ADMIN!");
        } else {
            require(
                msg.sender == prev.uploader || userRoles[msg.sender] >= ROLE_MANAGER,
                "Loi: Chi uploader ban cu hoac Quan ly/Admin moi duoc version tai lieu!"
            );
        }

        require(bytes(successorOf[_previousDocId]).length == 0, "Loi: previousDocId da co ban moi (phan nhanh)!");
    }

    // Tạo doc đơn — hỗ trợ versioning (previousDocId) + hạn hiệu lực (expiresAt)
    // + multi-sig EIP-712 (requiredSigners/requiredThreshold).
    // threshold == 0 → sealed ngay; threshold > 0 → PENDING, chờ sealDocument.
    function addDocumentV2(
        string memory _documentId,
        string memory _fileHash,
        string memory _ipfsURI,
        string memory _previousDocId,
        uint256 _expiresAt,
        address[] memory _requiredSigners,
        uint8 _requiredThreshold
    ) public canUpload {
        require(bytes(uploaderHashToDocId[msg.sender][_fileHash]).length == 0, "Loi: Vi cua ban da dong dau noi dung nay!");
        require(documents[_documentId].timestamp == 0, "Loi: ID da ton tai!");

        bool hasPrev = bytes(_previousDocId).length > 0;
        if (hasPrev) {
            _checkPreviousDoc(_previousDocId);
        }

        if (_requiredThreshold == 0) {
            // Không yêu cầu ký → danh sách signer bị bỏ qua, doc sealed ngay.
            _requiredSigners = new address[](0);
        } else {
            require(_requiredSigners.length >= _requiredThreshold, "Loi: So signer it hon nguong chu ky!");
            // Dedupe + loại địa chỉ 0: mỗi signer chỉ được đếm 1 lần khi seal.
            for (uint256 i = 0; i < _requiredSigners.length; i++) {
                require(_requiredSigners[i] != address(0), "Loi: Dia chi signer khong hop le!");
                for (uint256 j = i + 1; j < _requiredSigners.length; j++) {
                    require(_requiredSigners[i] != _requiredSigners[j], "Loi: Signer bi trung lap!");
                }
            }
        }

        bool sealedNow = _requiredThreshold == 0;
        documents[_documentId] = Document(
            _fileHash,
            _ipfsURI,
            block.timestamp,
            msg.sender,
            false,
            "",
            _previousDocId,
            _expiresAt,
            _requiredSigners,
            _requiredThreshold,
            sealedNow
        );
        uploaderHashToDocId[msg.sender][_fileHash] = _documentId;

        // Versioning: bản sealed-ngay thì gán successorOf luôn;
        // bản PENDING (threshold > 0) chỉ gán sau khi sealDocument thành công.
        if (hasPrev && sealedNow) {
            successorOf[_previousDocId] = _documentId;
        }

        emit DocumentAddedV2(
            _documentId, _fileHash, _ipfsURI, _previousDocId, _expiresAt,
            _requiredSigners, _requiredThreshold, msg.sender
        );
    }

    // Batch upload — KHÔNG multi-sig: mọi doc sealed=true ngay, threshold=0,
    // successorOf (nếu có prevId) được gán ngay trong cùng transaction.
    function addDocumentsV2(
        string[] memory _documentIds,
        string[] memory _fileHashes,
        string[] memory _ipfsURIs,
        string[] memory _previousDocIds,
        uint256[] memory _expiresAts
    ) public canUpload {
        require(_documentIds.length > 0, "Loi: Mang rong!");
        require(_documentIds.length <= 100, "Loi: Mot lan toi da 100 tai lieu!");
        require(
            _documentIds.length == _fileHashes.length &&
            _fileHashes.length == _ipfsURIs.length &&
            _ipfsURIs.length == _previousDocIds.length &&
            _previousDocIds.length == _expiresAts.length,
            "Loi: Do dai mang khong khop!"
        );

        for (uint256 i = 0; i < _documentIds.length; i++) {
            require(bytes(uploaderHashToDocId[msg.sender][_fileHashes[i]]).length == 0, "Loi: Vi cua ban da dong dau noi dung nay!");
            require(documents[_documentIds[i]].timestamp == 0, "Loi: ID da ton tai!");

            string memory prevId = _previousDocIds[i];
            if (bytes(prevId).length > 0) {
                _checkPreviousDoc(prevId);
                successorOf[prevId] = _documentIds[i]; // sealed ngay → gán luôn
            }

            documents[_documentIds[i]] = Document(
                _fileHashes[i],
                _ipfsURIs[i],
                block.timestamp,
                msg.sender,
                false,
                "",
                prevId,
                _expiresAts[i],
                new address[](0),
                0,
                true // sealed ngay — batch không hỗ trợ multi-sig
            );
            uploaderHashToDocId[msg.sender][_fileHashes[i]] = _documentIds[i];

            emit DocumentAddedV2(
                _documentIds[i], _fileHashes[i], _ipfsURIs[i], prevId, _expiresAts[i],
                new address[](0), 0, msg.sender
            );
        }
    }

    function addMerkleBatch(string memory _batchId, bytes32 _merkleRoot, string memory _ipfsURI) public canUpload {
        require(batches[_batchId].timestamp == 0, "Lo tai lieu nay da ton tai!");

        batches[_batchId] = MerkleBatch(_merkleRoot, _ipfsURI, block.timestamp, msg.sender);
        emit BatchAdded(_batchId, _merkleRoot, _ipfsURI, msg.sender);
    }

    // Đóng dấu đa chữ ký: MỘT giao dịch chứa TOÀN BỘ chữ ký EIP-712.
    // Nếu số signer hợp lệ < requiredThreshold → revert toàn bộ (không tích lũy state).
    // Ai cũng được gọi — chữ ký EIP-712 chính là ủy quyền.
    function sealDocument(string memory _documentId, bytes[] memory _signatures) public {
        Document storage doc = documents[_documentId];
        require(doc.timestamp != 0, "Loi: Tai lieu khong ton tai!");
        require(!doc.isSealed, "Loi: Tai lieu da duoc dong dau!");
        require(doc.requiredThreshold > 0, "Loi: Tai lieu khong yeu cau chu ky!");
        require(_signatures.length <= doc.requiredSigners.length, "Loi: Qua nhieu chu ky!");

        // docHash cam kết toàn bộ metadata; struct EIP-712 chứa cả docHash lẫn các field.
        bytes32 docHash = keccak256(
            abi.encode(_documentId, doc.fileHash, doc.ipfsURI, doc.expiresAt, doc.previousDocId)
        );
        // EIP-712: trường string/bytes phải được keccak256-hóa trước khi encode
        // (abi.encode(string) cho layout offset+length — KHÔNG đúng chuẩn EIP-712).
        bytes32 structHash = keccak256(
            abi.encode(
                DOCUMENT_SEAL_TYPEHASH,
                docHash,
                keccak256(bytes(_documentId)),
                keccak256(bytes(doc.fileHash)),
                keccak256(bytes(doc.ipfsURI)),
                doc.expiresAt,
                keccak256(bytes(doc.previousDocId))
            )
        );
        bytes32 digest = _hashTypedDataV4(structHash);

        uint256 validCount = 0;
        for (uint256 i = 0; i < _signatures.length; i++) {
            address signer = ECDSA.recover(digest, _signatures[i]);
            // Ràng buộc 1: revert nếu signer không thuộc requiredSigners hoặc đã ký.
            require(_isRequiredSigner(doc.requiredSigners, signer), "Loi: Chu ky khong thuoc danh sach signer!");
            require(!hasSigned[_documentId][signer], "Loi: Signer da ky truoc do!");
            hasSigned[_documentId][signer] = true;
            validCount++;
        }

        require(validCount >= doc.requiredThreshold, "Loi: Chua du chu ky de dong dau!");

        doc.isSealed = true;
        // Bản PENDING có previousDocId → chỉ giờ mới gán successorOf (chống phân nhánh ảo).
        if (bytes(doc.previousDocId).length > 0) {
            successorOf[doc.previousDocId] = _documentId;
        }

        emit DocumentSealed(_documentId, validCount);
    }

    function _isRequiredSigner(address[] storage _signers, address _signer) private view returns (bool) {
        for (uint256 i = 0; i < _signers.length; i++) {
            if (_signers[i] == _signer) return true;
        }
        return false;
    }

    function revokeDocument(string memory _documentId, string memory _reason) public {
        Document storage doc = documents[_documentId];
        require(doc.timestamp != 0, "Loi: Tai lieu khong ton tai!");
        require(!doc.isRevoked, "Loi: Tai lieu nay da bi thu hoi!");

        uint8 currentRole = userRoles[msg.sender];
        if (!doc.isSealed) {
            // Ràng buộc 3: doc PENDING (chưa đủ chữ ký) được hủy bởi
            // chính uploader HOẶC role >= MANAGER — tránh treo vĩnh viễn.
            require(
                msg.sender == doc.uploader || currentRole >= ROLE_MANAGER,
                "Loi: Chi uploader hoac Quan ly/Admin moi duoc huy tai lieu cho ky!"
            );
        } else {
            // [NEW] Bức tường lửa RBAC: Chỉ Admin (3) và Quản lý (2) mới được phép thu hồi
            require(currentRole == ROLE_ADMIN || currentRole == ROLE_MANAGER, "Loi: Nhan vien Nhap lieu khong co quyen Thu hoi tai lieu!");
        }

        // Tài liệu do ví ADMIN upload thì chỉ ADMIN được thu hồi — Quản lý không đụng được
        if (userRoles[doc.uploader] == ROLE_ADMIN) {
            require(currentRole == ROLE_ADMIN, "Loi: Quan ly khong the thu hoi tai lieu cua Admin!");
        }

        doc.isRevoked = true;
        doc.revocationReason = _reason;
        // Xóa khỏi sổ chống trùng CỦA NGƯỜI UPLOAD để họ có thể nạp lại
        // nội dung này sau thu hồi (các ví khác không bị ảnh hưởng)
        delete uploaderHashToDocId[doc.uploader][doc.fileHash];

        emit DocumentRevoked(_documentId, msg.sender, _reason);
    }

    // ==========================================
    // 8. NGHIỆP VỤ ĐỌC & KIỂM ĐỊNH (PUBLIC)
    // ==========================================
    // Trả 11 fields theo thứ tự:
    // (fileHash, ipfsURI, timestamp, uploader, isRevoked, revocationReason,
    //  previousDocId, expiresAt, requiredSigners, requiredThreshold, sealed)
    function getDocument(string memory _documentId) public view returns (
        string memory fileHash,
        string memory ipfsURI,
        uint256 timestamp,
        address uploader,
        bool isRevoked,
        string memory revocationReason,
        string memory previousDocId,
        uint256 expiresAt,
        address[] memory requiredSigners,
        uint8 requiredThreshold,
        bool isSealed
    ) {
        require(documents[_documentId].timestamp != 0, "Khong tim thay tai lieu tren Blockchain!");
        Document memory doc = documents[_documentId];
        return (
            doc.fileHash,
            doc.ipfsURI,
            doc.timestamp,
            doc.uploader,
            doc.isRevoked,
            doc.revocationReason,
            doc.previousDocId,
            doc.expiresAt,
            doc.requiredSigners,
            doc.requiredThreshold,
            doc.isSealed
        );
    }

    // Tra docId bản mới kế thừa doc này ("" = chưa có / không phải bản cũ).
    function getSuccessor(string memory _documentId) public view returns (string memory) {
        return successorOf[_documentId];
    }

    // Tra docId theo (ví upload, hash) — chỉ phản ánh sổ chống trùng của ví đó
    function getDocIdByHash(address _uploader, string memory _hash) public view returns (string memory) {
        return uploaderHashToDocId[_uploader][_hash];
    }

    function getMerkleBatch(string memory _batchId) public view returns (
        bytes32 merkleRoot, string memory ipfsURI, uint256 timestamp, address uploader
    ) {
        require(batches[_batchId].timestamp != 0, "Khong tim thay lo tren Blockchain!");
        MerkleBatch memory b = batches[_batchId];
        return (b.merkleRoot, b.ipfsURI, b.timestamp, b.uploader);
    }

    // Chuyển quyền root cho ví khác (chỉ chủ sở hữu gốc mới được gọi).
    // Owner cũ giữ role ADMIN nhưng mất bảo vệ "owner" — owner mới có thể giáng quyền họ qua assignRole.
    function transferOwnership(address _newOwner) public {
        require(msg.sender == owner, "Loi: Chi chu so huu goc moi co quyen nay!");
        require(_newOwner != address(0) && _newOwner != owner, "Loi: Dia chi khong hop le!");

        owner = _newOwner;
        userRoles[_newOwner] = ROLE_ADMIN;

        emit RoleAssigned(msg.sender, _newOwner, ROLE_ADMIN);
    }
}
