# Contract v2 — Versioning + Expiration + Multi-Sig EIP-712 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy `DataIntegrity` v2 lên Sepolia với `previousDocId` (versioning), `expiresAt` (expiration), và multi-sig EIP-712 (`requiredSigners`/`threshold`/`sealDocument`), rồi cập nhật toàn bộ app đọc/ghi/verifying theo contract mới.

**Architecture:** Contract mới thay thế hoàn toàn (reset data — địa chỉ mới). App đọc `getDocument` trả struct mở rộng; verify phân biệt 6 trạng thái; multi-sig chỉ cho tài liệu đơn (batch `addDocumentsV2` không hỗ trợ ký).

**Tech Stack:** Solidity 0.8.24 + OpenZeppelin Contracts (ECDSA, EIP712), Hardhat 3, ethers v6, Node/Express, vanilla JS frontend.

**Spec:** `docs/superpowers/specs/2026-11-26-contract-v2-versioning-expiry-multisig.md` — **đọc spec trước**, đặc biệt mục "Ràng buộc bổ sung" (4 ràng buộc user chốt).

## Global Constraints

- Reset data: contract cũ `0x33c4…a1f9` giữ nguyên trên Sepolia, app chuyển hẳn sang địa chỉ mới do `scripts/deploy.js` ghi vào `.env` + `assets/js/config.js`.
- Multi-sig **chỉ cho tài liệu đơn** — `addDocumentsV2` (batch) luôn `requiredThreshold=0`, `sealed=true` ngay.
- `previousDocId` chỉ được trỏ bởi uploader bản cũ hoặc ví ROLE_MANAGER/ROLE_ADMIN; tài liệu của ADMIN chỉ ADMIN được kế thừa.
- Chặn phân nhánh: `successorOf[prevDocId]` phải rỗng trước khi gán.
- Doc PENDING chỉ được gán `successorOf` **sau khi** `sealDocument()` set `sealed=true`.
- `sealDocument()`: revert nếu chữ ký trùng signer, signer không thuộc `requiredSigners`, hoặc số chữ ký hợp lệ < `requiredThreshold`. Dùng `ECDSA.recover` + `EIP712` của OpenZeppelin.
- Doc PENDING phải revoke được bởi uploader hoặc MANAGER/ADMIN.
- Verify: hash lệch = GIẢ MẠO (tách biệt); hash khớp + hết hạn / có successor / chưa sealed = trạng thái riêng.
- `npm test` (114 test) phải pass sau mỗi phase; test XSS (`test/xss.test.js`) cấm nội suy chưa `esc()` trong attribute/markup.
- Mọi commit message kết thúc bằng trailer Devin (xem git log gần nhất để copy format).

## Review Focus

1. `getDocument` đổi số field trả về → mọi destructure site phải cập nhật cùng lúc (server.js ~4 chỗ, verifyChain.js, main.js, web3Service.js) — sót chỗ nào verify sẽ sai lặng lẽ.
2. `expiresAt=0` nghĩa là "không hết hạn" — tuyệt đối không so `now > 0`.
3. Signer ký EIP-712 phải ký trên domain đúng `chainId` + `verifyingContract` của contract MỚI — ký nhầm contract cũ sẽ ecrecover ra địa chỉ rác.
4. Batch upload có `replacesDocId` off-chain → phải map sang `previousDocId` on-chain trong `addDocumentsV2`; nếu bỏ sót, versioning on-chain chỉ đúng với upload đơn.
5. `sealDocument` gọi bởi bất kỳ ai — phải kiểm tra `hasSigned` per-signer để một chữ ký không được đếm 2 lần qua 2 lần submit (dù spec nói revert khi trùng — quyết định: revert, không cho submit lại sau sealed).

---

### Task 1: Dependency + Contract v2

**Files:**
- Modify: `contracts/DataIntegrity.sol` (viết lại toàn bộ)
- Modify: `package.json` (thêm `@openzeppelin/contracts`)
- Modify: `hardhat.config.js` (thêm `paths`/`remappings` nếu cần cho import OZ)

**Interfaces:**
- Produces: ABI mới trong `artifacts/contracts/DataIntegrity.sol/DataIntegrity.json` gồm `addDocumentV2`, `addDocumentsV2`, `sealDocument`, `getDocument` (10 fields), `getSuccessor`, `getDocIdByHash`, `revokeDocument`, `assignRole`, `transferOwnership`, `addMerkleBatch` + events `DocumentAddedV2`, `DocumentSealed`, `DocumentRevoked`, `BatchAdded`, `RoleAssigned`.

- [ ] **Step 1: Cài OpenZeppelin**

```bash
npm install @openzeppelin/contracts@5.4.0 --save-dev
```

Chọn version đã publish >7 ngày, tương thích solc 0.8.24.

- [ ] **Step 2: Viết contract mới theo spec**

Struct `Document` thêm `previousDocId` (string), `expiresAt` (uint256),
`requiredSigners` (address[]), `requiredThreshold` (uint8), `sealed` (bool).
Mappings: `successorOf(string=>string)`, `hasSigned(string=>mapping(address=>bool))`.
EIP712 domain: name `"DataIntegrity"`, version `"2"`.

`addDocumentV2(string docId, string fileHash, string ipfsURI, string previousDocId, uint256 expiresAt, address[] requiredSigners, uint8 requiredThreshold)`:
- `canUpload`; require `documents[docId].timestamp==0`.
- Versioning rules (ràng buộc 2): nếu `previousDocId!=""` → doc cũ phải tồn tại,
  `msg.sender` là uploader bản cũ HOẶC role ≥ MANAGER; nếu uploader bản cũ là
  ADMIN (`userRoles[uploader]==ROLE_ADMIN`) → require `userRoles[msg.sender]==ROLE_ADMIN`;
  `successorOf[previousDocId]==""` (chặn phân nhánh); nếu `requiredThreshold>0`
  (PENDING) → KHÔNG set `successorOf` ngay (chờ seal).
- `sealed = (requiredThreshold==0)`; emit `DocumentAddedV2`.

`addDocumentsV2(string[] ids, string[] hashes, string[] uris, string[] prevIds, uint256[] expiresAts)`:
- `canUpload`; length ≤100, các mảng cùng độ dài; mỗi phần tử áp dụng cùng
  versioning rules của `addDocumentV2` với `requiredSigners=[]`, `threshold=0`
  → `sealed=true` ngay; set `successorOf` ngay (không PENDING).

`sealDocument(string docId, bytes[] signatures)`:
- Doc phải tồn tại, `!sealed`, `requiredThreshold>0`.
- Với mỗi signature: `ECDSA.recover(digest, sig)` → addr; require addr ∈
  `requiredSigners` (dedupe set), `!hasSigned[docId][addr]` → set hasSigned,
  đếm valid. Sau vòng lặp require `validCount >= requiredThreshold` →
  `sealed=true`, emit `DocumentSealed(docId, validCount)`.
- Digest EIP-712 struct: `DocumentSeal(bytes32 docHash, string documentId,
  string fileHash, string ipfsURI, uint256 expiresAt, string previousDocId)`
  — `docHash = keccak256(abi.encode(docId, fileHash, ipfsURI, expiresAt, previousDocId))`.
  (Chốt encoding chính xác khi viết — phải khớp 100% với client EIP-712.)

`revokeDocument`: giữ logic cũ + allow khi `!sealed` (PENDING) — uploader của
  doc HOẶC role ≥ MANAGER (ràng buộc 3). Xóa `successorOf` nếu doc này là
  successor? KHÔNG — giữ nguyên lịch sử; chỉ set isRevoked.

`getDocument(docId)` trả 10 fields: `(fileHash, ipfsURI, timestamp, uploader,
isRevoked, revocationReason, previousDocId, expiresAt, requiredSigners,
requiredThreshold, sealed)` — viết thành struct return hoặc tuple; ưu tiên
tuple 11 phần tử để ít sửa caller nhất. Cập nhật NGAY mọi caller (Task 3+).

`getSuccessor(string docId) view returns (string)` → `successorOf[docId]`.

Giữ nguyên: `assignRole`, `transferOwnership`, `addMerkleBatch`,
`getDocIdByHash`, `getMerkleBatch`, modifiers, events cũ (DocumentRevoked,
BatchAdded, RoleAssigned) + thêm `DocumentAddedV2`, `DocumentSealed`.
Bỏ `addDocuments`/`addDocument` cũ (reset — không caller nào cần).

- [ ] **Step 3: Compile**

```bash
npx hardhat compile
```
Expected: `Compiled N Solidity files` không lỗi. Nếu import OZ lỗi → thêm
`remappings` vào hardhat.config.js: `["@openzeppelin/contracts/=node_modules/@openzeppelin/contracts/"]`.

- [ ] **Step 4: Commit** (chưa deploy — deploy ở Task 6 sau khi app sẵn sàng)

```bash
git add contracts/DataIntegrity.sol hardhat.config.js package.json package-lock.json
git commit -m "feat(contract): v2 — versioning + expiration + multi-sig EIP-712"
```

---

### Task 2: Cập nhật ABI ở frontend + server

**Files:**
- Modify: `assets/js/config.js` (CONTRACT_ABI array)
- Modify: `server.js` (ABI nội tuyến ~dòng 1658 + mọi chỗ `getDocument` destructure ~dòng 384, 1806, audit)
- Modify: `assets/js/web3Service.js` (addDocumentsOnChain + mọi getDocument caller)
- Modify: `assets/js/verifyChain.js` (getDocument caller)

**Interfaces:**
- Consumes: ABI từ `artifacts/.../DataIntegrity.json` (Task 1).
- Produces: `web3.addDocumentsOnChain(ids, hashes, uris, prevIds, expiresAts)` — chữ ký mới; `web3.getDocumentV2(docId)` trả object `{fileHash, ipfsURI, timestamp, uploader, isRevoked, revocationReason, previousDocId, expiresAt, requiredSigners, requiredThreshold, sealed}`; `web3.getSuccessor(docId)`; `web3.sealDocumentOnChain(docId, signatures)`; `web3.signDocumentSeal(docData)` → EIP-712 signature.

- [ ] **Step 1: Sinh ABI JSON → copy vào config.js**

Lấy `abi` array từ artifact, paste vào `CONFIG.CONTRACT_ABI` (config.js).
Server.js dùng ABI nội tuyến — đồng bộ cùng nội dung (hoặc import chung nếu
đã có pattern; kiểm tra server.js ~dòng 160-190 cách khởi tạo contract).

- [ ] **Step 2: Sửa mọi `getDocument` destructure**

`const [fileHash, ipfsURI, timestamp, uploader, isRevoked, reason] = await contract.getDocument(id)`
→ tuple 11 phần tử: thêm `previousDocId, expiresAt, requiredSigners, requiredThreshold, sealed`.
Grep `getDocument(` toàn repo, sửa hết: server.js (verify ~384, partner verify ~1806,
audit reconcile), web3Service.js, verifyChain.js, main.js (nếu có).

- [ ] **Step 3: `web3Service.addDocumentsOnChain` mở rộng tham số**

Signature mới: `(documentIds, fileHashes, ipfsURIs, previousDocIds = [], expiresAts = [])`
→ gọi `addDocumentsV2`. Cập nhật caller trong main.js `executeUploadCore`
truyền `uploadedDocs.map(d => d._prevDocId || '')` và `._expiresAt || 0`.

- [ ] **Step 4: Thêm helper EIP-712**

```js
// web3Service.js
async signDocumentSeal(docId, fileHash, ipfsURI, expiresAt, previousDocId) → signature
async sealDocumentOnChain(docId, signatures) → txHash
async getSuccessor(docId) → string
```

EIP-712 typed data phải khớp contract: domain `{name:'DataIntegrity',version:'2',chainId,verifyingContract}`;
types `DocumentSeal` fields theo spec; `primaryType:'DocumentSeal'`;
`message.docHash = keccak256(AbiCoder.encode(['string','string','string','uint256','string'],[docId,fileHash,ipfsURI,expiresAt,previousDocId]))`.
Dùng `ethers.TypedDataEncoder`/`wallet.signTypedData` — KHÔNG tự encode.

- [ ] **Step 5: `node --check` mọi file sửa + `npm test`**

Expected: 114/114 pass. Nếu test mock ABI getDocument → cập nhật mock.

- [ ] **Step 6: Commit**

---

### Task 3: Upload flow — expiresAt + previousDocId on-chain

**Files:**
- Modify: `assets/js/main.js` (modal AES ~dòng 1793-1860, executeUploadCore ~1906-1990)
- Modify: `server.js` (`/api/batches` safeFiles ~dòng 997 — whitelist thêm fields nếu cần lưu expiry; on-chain là chính)

**Interfaces:**
- Consumes: `addDocumentsOnChain` mới (Task 2).
- Produces: `fileItem._expiresAt` (uint256, 0=không hạn), `fileItem._prevDocIdOnchain` (string, "" = không).

- [ ] **Step 1: UI modal upload — thêm 2 trường tùy chọn**

Trong `aesHtml`: input `datetime-local` "Hạn hiệu lực (tùy chọn)" → epoch giây;
và per-file đã có `replacesDocId` → map sang `previousDocId` on-chain (file có
`_replacesDocId` → `_prevDocIdOnchain = replacesDocId`). Lưu ý: chỉ gửi
previousDocId on-chain khi user thực sự chọn "phiên bản mới" (replaces) —
`replacesDocId` hiện có trong UI per-file (`.bdi-replace`).

- [ ] **Step 2: Truyền vào executeUploadCore**

`uploadedDocs.push` thêm `_expiresAt`, `_prevDocIdOnchain`; gọi
`web3.addDocumentsOnChain(..., prevIds, expiresAts)`.

- [ ] **Step 3: Server `/api/batches`** — lưu `expiresAt`/`previousDocId` vào
`files[]` schema (Batch.js thêm 2 field optional) để hiển thị lại sau này.

- [ ] **Step 4: `npm test` + commit**

---

### Task 4: Multi-sig — upload đơn + ký EIP-712 + seal

**Files:**
- Modify: `assets/js/main.js` (UI upload đơn / flow ký)
- Modify: `assets/js/web3Service.js` (signDocumentSeal, sealDocumentOnChain)
- Modify: `server.js` (nếu cần endpoint tra doc pending)

**Interfaces:**
- Consumes: `addDocumentV2` ABI, `sealDocument`, `getDocument` 11 fields.
- Produces: `web3.addDocumentV2OnChain(docId, hash, uri, prevDocId, expiresAt, signers[], threshold)`; UI "tài liệu chờ ký".

- [ ] **Step 1: UI khai báo người ký**

Khi upload tài liệu đơn (không phải batch): thêm phần "Đồng ký đa bên" —
danh sách địa chỉ ví (comma-separated) + ngưỡng K. Validate: 1 ≤ K ≤ số signer,
địa chỉ hợp lệ `^0x[0-9a-fA-F]{40}$`, dedupe.

- [ ] **Step 2: Upload đơn qua `addDocumentV2`**

Flow upload đơn hiện có (nếu chỉ có batch → thêm nhánh single-doc hoặc dùng
`addDocumentV2` cho file đầu tiên?). **Quyết định khi implement**: nếu app chỉ
có batch upload, multi-sig áp cho TOÀN BỘ lô không khả thi → giới hạn: multi-sig
chỉ bật khi `fileDataArray.length===1`, ngược lại disable checkbox kèm tooltip.

- [ ] **Step 3: Màn hình ký cho signer**

Doc PENDING hiển thị trong lịch sử với badge "CHỜ KÝ x/y". Ví đang kết nối nếu
∈ requiredSigners → nút "Ký xác nhận" → `signTypedData` → collect chữ ký →
gọi `sealDocumentOnChain(docId, sigs)` (ai cũng gọi được, chữ ký là ủy quyền).
Cần cơ chế gom chữ ký: đơn giản nhất — mỗi signer tự submit `sealDocument`
với chữ ký của mình? KHÔNG — spec là gộp. Thực tế: `sealDocument` nhận mảng
chữ ký → cần các bên đưa chữ ký cho nhau off-chain. **Demo pragmatic**:
server lưu chữ ký đã ký vào Mongo (`pendingSigs[docId][]`), endpoint
`POST /api/documents/:docId/signature` nhận chữ ký, khi đủ threshold → client
(hoặc server) gọi `sealDocument`. Hoặc đơn giản hơn cho demo: signer ký xong
→ frontend hiển thị chữ ký hex → họ gửi cho uploader → uploader paste vào
"nộp chữ ký" → seal. **Chọn phương án đơn giản nhất chạy được**, ghi rõ trong
code comment.

- [ ] **Step 4: `npm test` + commit**

---

### Task 5: Verify 4 trạng thái + successor on-chain

**Files:**
- Modify: `verify.html`, `assets/js/verifyChain.js`, `assets/js/main.js` (lookup)
- Modify: `server.js` (`/api/documents/lookup` thêm on-chain fields nếu cần)

- [ ] **Step 1: verifyChain.js đọc đủ 11 fields**

`isExpired = expiresAt>0 && Date.now()/1000 > expiresAt`;
`successor = await getSuccessor(docId)`; `sealed` flag.

- [ ] **Step 2: Thứ tự trạng thái (ưu tiên)**

1. hash lệch → GIẢ MẠO (đỏ)
2. isRevoked → ĐÃ THU HỒI
3. !sealed → CHỜ CHỮ KÝ (kèm x/y nếu đọc được sigCount — nếu contract không
   lưu count public thì hiển thị "chờ đủ chữ ký")
4. isExpired → HẾT HẠN
5. successor!="" → NGUYÊN VẸN + badge "ĐÃ CÓ BẢN MỚI" + link docId mới
6. còn lại → NGUYÊN VẸN

- [ ] **Step 3: lookup off-chain `hasNewer` giữ nguyên** — bổ sung on-chain
`successor` khi verifyChain chạy (2 nguồn độc lập cùng chỉ 1 kết luận).

- [ ] **Step 4: `npm test` + commit**

---

### Task 6: Deploy + smoke test + docs

**Files:**
- Modify: `.env` (CONTRACT_ADDRESS — deploy.js tự ghi), `assets/js/config.js` (tự ghi)
- Modify: `README.md` (ghi chú contract v2, cách ký multi-sig)

- [ ] **Step 1: Deploy Sepolia**

```bash
node scripts/deploy.js
```
Cần `.env` có `RPC_URL` + `PRIVATE_KEY` (ví server đã có gas). Expected: in ra
địa chỉ mới + tự cập nhật `.env`/`config.js`.

- [ ] **Step 2: Smoke test trên Sepolia thật**

- Upload 1 file đơn có `expiresAt` quá khứ → verify báo HẾT HẠN.
- Upload file B với previousDocId=A → verify A báo "có bản mới".
- Upload file C multi-sig 1/2 → verify báo CHỜ KÝ → ký → seal → verify NGUYÊN VẸN.
- Upload file D thường → verify NGUYÊN VẸN (regression).

- [ ] **Step 3: `npm test` full + restart backend local + push**

- [ ] **Step 4: Cập nhật Render env `CONTRACT_ADDRESS`** (nếu deploy trên Render
  dùng env riêng) + hướng dẫn user upload lại data test.

---

## Self-Review notes (đã check)

- Spec coverage: versioning ✓(T1,T3,T5), expiration ✓(T1,T3,T5), multi-sig ✓(T1,T4),
  4 ràng buộc ✓(T1 contract enforce + T4/T5 UI), reset ✓(T6), verify states ✓(T5).
- Type consistency: `addDocumentsOnChain` signature thống nhất T2→T3;
  `getDocument` 11 fields thống nhất T1→T2→T5.
- Rủi ro lớn nhất: EIP-712 encoding mismatch contract↔client → Step T2.4 bắt
  dùng `ethers.TypedDataEncoder` hai phía và test ký/verify trên Sepolia thật
  trước khi build UI (T6 smoke test bắt buộc).
