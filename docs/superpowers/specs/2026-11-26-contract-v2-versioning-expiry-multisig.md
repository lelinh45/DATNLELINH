# Contract v2 — Versioning + Expiration + Multi-Sig EIP-712 — Design Spec

Ngày: 2026-11-26 · Trạng thái: chờ user review
Quyết định đã chốt: **reset data** (deploy contract mới, upload lại),
**cả 3 tính năng trong 1 lần deploy**, multi-sig dùng **EIP-712 ký gộp**.

## Bối cảnh & nguyên tắc

- Contract cũ `0x33c4…a1f9` giữ nguyên trên Sepolia (không đụng, chỉ ngừng dùng).
- Contract mới = địa chỉ mới → cập nhật `config.js` + env `CONTRACT_ADDRESS`.
- Mọi docId cũ verify sẽ báo "không tồn tại" — chấp nhận vì reset demo.
- Off-chain `replacesDocId` (Mongo) vẫn giữ — on-chain `previousDocId` bổ sung
  bằng chứng bất biến; hai lớp bổ trợ nhau.

## Struct Document mới

```solidity
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
    bool sealed;                 // đủ chữ ký → hoàn tất pháp lý
}
```

Mapping bổ sung:
- `successorOf[prevDocId] → newDocId` — tra "đã có bản mới" O(1), không cần quét event.
- `hasSigned[docId][signer]` — chống ký trùng/replay.

## EIP-712 — mô hình ký gộp (chọn)

- Domain: `name="DataIntegrity"`, `version="2"`, `chainId` động, `verifyingContract`.
- Type: `DocumentSeal(bytes32 docHash, string documentId, string fileHash, string ipfsURI, uint256 expiresAt, string previousDocId)` — ký trên TOÀN BỘ metadata doc → không thể dùng lại chữ ký cho doc khác.
- Luồng: uploader tạo doc ở trạng thái **PENDING** (threshold>0) → các bên ký
  EIP-712 **off-chain** → một người submit `sealDocument(docId, signatures[])` —
  contract `ecrecover` từng chữ ký, đếm signer hợp lệ distinct ≥ threshold →
  `sealed=true`, emit `DocumentSealed`. Ai cũng gọi được (chữ ký chính là ủy quyền).
- Doc không yêu cầu ký (threshold=0) → `sealed=true` ngay khi tạo.

## Functions mới (thay thế, không giữ bản cũ — reset sạch)

| Function | Mục đích |
|---|---|
| `addDocumentV2(docId, fileHash, ipfsURI, previousDocId, expiresAt, signers[], threshold)` | Tạo doc đơn; previousDocId phải tồn tại & cùng uploader; set `successorOf[prev]=docId` |
| `addDocumentsV2(ids[], hashes[], uris[], prevIds[], expiresAts[])` | Batch upload — KHÔNG multi-sig (threshold=0, sealed ngay); prevIds[i]="" được phép |
| `sealDocument(docId, signatures[])` | Nộp chữ ký gộp → ecrecover → sealed |
| `getDocument(docId)` | Trả struct đầy đủ (10+ fields) — cập nhật mọi caller |
| `getSuccessor(docId)` | docId bản mới nhất thay thế doc này ("" = chưa có) |
| `getDocIdByHash(uploader, hash)` | giữ nguyên — sổ chống trùng |
| `revokeDocument`, `assignRole`, `transferOwnership`, `addMerkleBatch` | giữ nguyên logic |

Events: `DocumentAddedV2` (đủ field mới), `DocumentSealed(docId, signerCount)`,
giữ `DocumentRevoked`, `BatchAdded`, `RoleAssigned`.

## Trạng thái verify (3→4 trạng thái)

verify.html/lookup hiển thị:
1. **Giả mạo** — hash lệch
2. **Đã thu hồi** — isRevoked
3. **Hết hạn** — `expiresAt>0 && now>expiresAt` (mới)
4. **Chờ chữ ký** — `!sealed` → "đã đóng dấu nhưng chưa đủ chữ ký x/y" (mới)
5. **Đã có bản mới** — `getSuccessor(docId)!=""` (bổ sung cho hasNewer off-chain)
6. **Nguyên vẹn** — còn lại

## Thay đổi theo lớp

- `contracts/DataIntegrity.sol` — viết lại theo spec, compile bằng hardhat/solc.
- `assets/js/web3Service.js` — ABI mới, `addDocumentsOnChain` nhận thêm
  prevIds/expiresAts; hàm mới `sealDocumentOnChain`, `signDocumentEIP712`.
- `server.js` — `getChainContract()` ABI mới; getDocument destructure đủ field;
  upload nhận `expiresAt` + `requiredSigners/threshold` (single-doc flow);
  partner upload tương tự optional.
- `main.js` — UI upload: tùy chọn hạn hiệu lực + danh sách ví ký + ngưỡng;
  màn hình "chờ ký" cho doc pending; nút ký EIP-712 cho signer.
- `verify.html`/`verifyChain.js` — 4 trạng thái + nút ký khi cần.
- Deploy: `PRIVATE_KEY` server ví (đã có gas Sepolia) → ghi địa chỉ mới vào
  `config.js` + Render env.

## Edge cases

- `previousDocId` trỏ doc không tồn tại hoặc khác uploader → revert.
- Vòng lặp version (A→B→A) → chặn: prevDocId không được là docId của chính nó
  hoặc tạo cycle (kiểm tra successorOf[prev]=="" trước khi set).
- `expiresAt` ở quá khứ → vẫn cho phép (doc tạo ra đã hết hạn — vô nghĩa nhưng
  không hại; UI cảnh báo).
- Signer trùng lặp trong requiredSigners → dedupe khi tính threshold.
- Chữ ký sai/hết hạn → ecrecover ra address(0) hoặc không khớp signer → bỏ qua;
  `sealDocument` yêu cầu sigCount hợp lệ ≥ threshold mới set sealed.
- Batch upload không hỗ trợ multi-sig — UI chỉ hiện tùy chọn ký khi upload
  tài liệu đơn (nếu flow hiện tại chỉ có batch → quyết định khi implement:
  ưu tiên batch, multi-sig để phase 2 nếu phức tạp).

## Testing

- Unit test contract bằng hardhat (nếu có) hoặc script Node + ethers local
  không khả thi trên Sepolia testnet → test trên Sepolia thật với docId test.
- Regression: `npm test` 114 test phải pass (cập nhật mock ABI nếu test đụng).
- Tay: upload doc có prevDocId → verify doc cũ báo "có bản mới" on-chain;
  upload doc expiresAt quá khứ → verify báo hết hạn; upload doc 2/3 signers →
  verify báo chờ ký → ký đủ → báo nguyên vẹn.

## Ngoài phạm vi

- Migration data cũ (reset).
- Ủy quyền ký hộ (signer ủy quyền ví khác) — phức tạp, để sau.
- Hủy pending doc (chưa đủ ký) — để sau nếu cần.
