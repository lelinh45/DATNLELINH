# Self-Custody Encryption (1c) — Design Spec

Ngày: 2026-11-26 · Trạng thái: đã duyệt phương án A (escrow flag, không lưu encKey)

## Mục tiêu

Tùy chọn "Tự giữ khóa" khi upload: server chỉ lưu ciphertext + cờ `selfCustody`,
**không escrow `encKey`**. Người đọc phải nhập đúng mật khẩu. Phục vụ điểm
"server bị chiếm cũng không đọc được tài liệu tối mật" cho hội đồng.

## Nguyên tắc bất biến

- Luồng escrow hiện tại **không đổi** — file không tích self-custody hoạt động y hệt.
- `selfCustody` là thuộc tính per-file trong manifest/batch và per-doc trong
  `PartnerDocument`. Một batch có thể trộn 2 loại.
- Hash on-chain, Merkle, IPFS, verify **không đổi** — hash luôn là hash plaintext,
  nên verify/tamper-log/audit không bị ảnh hưởng.
- Mật khẩu **không bao giờ được lưu** ở bất kỳ đâu (kể cả log).

## Thiết kế

### 1. Schema

- `Batch.files[]` thêm `selfCustody: Boolean` (mặc định false/absent).
- `PartnerDocument` thêm `selfCustody: Boolean` (mặc định false).
- File self-custody: `encKey` vắng mặt (escrow path đã xử lý `!f.encKey` → 404
  khi cố lấy key — kiểm tra lại thông báo lỗi thân thiện).

### 2. Upload user (index.html / main.js)

- Checkbox "Tự giữ khóa — server không lưu mật khẩu" + ô mật khẩu riêng
  (hiện khi tích; xác nhận nhập 2 lần).
- Mật khẩu → làm passphrase AES trực tiếp (CryptoJS.AES.encrypt như hiện tại,
  `fileKey = selfCustody ? selfPass : (fileItem._key || secretKey)`).
- Payload file manifest gửi `selfCustody: true`, **không gửi `encKey`**.
- Cảnh báo rõ: "Quên mật khẩu = không thể giải mã file này, kể cả admin."

### 3. Tải/Xem user

- `resolveDocKey`/download flow: file `selfCustody` → server không trả encKey
  → prompt nhập mật khẩu (Swal input, giống prompt khóa hiện có) → giải mã
  client-side như thường. Sai mật khẩu → báo "khóa không đúng".
- Không lưu mật khẩu vào localStorage/session — hỏi mỗi phiên (hoặc cache
  trong RAM của trang cho tiện, không persist).

### 4. Partner API (B2B)

- `POST /api/v1/documents` (upload): thêm optional `encryptionKey`.
  - Có `encryptionKey` → server mã hóa bằng key đó, lưu `selfCustody:true`,
    **không** `encKey`.
  - Không có → giữ nguyên escrow như cũ.
- `GET /api/v1/documents/:docId/download`: thêm optional query `key`.
  - Doc self-custody + có `key` → giải mã on-the-fly, trả file.
  - Doc self-custody + thiếu/sai `key` → 400/403 "cần encryptionKey".
  - Doc escrow → bỏ qua `key`, hành vi cũ.
- List endpoint: trả thêm `selfCustody` flag để partner biết doc nào cần key.

### 5. Edge cases

- Verify public (`/api/verify`, verify.html): không đổi — hash plaintext so
  với chain, không cần key. File self-custody vẫn verify được.
- Re-index/audit: `selfCustody` không ảnh hưởng (chỉ metadata hash/revoke).
- Batch trộn: manifest per-file flag; UI download xử lý per-file.
- Legacy data: field absent = escrow — backward compatible hoàn toàn.

## Testing

- `npm test` hiện có phải pass nguyên (không regression escrow path).
- Test mới (nếu harness cho phép): unit test wrap/unwrap bỏ qua khi
  selfCustody; integration nhẹ cho PATCH validation nếu thêm endpoint.
- Tay: upload 1 file self-custody → tải về không key phải hỏi mật khẩu →
  đúng/sai password → partner upload với encryptionKey → download ?key=.

## Ngoài phạm vi (lần này)

- E2E thật (key không chạm server lúc download) — phương án B, để sau.
- Rotate/đổi mật khẩu self-custody — không hỗ trợ (re-upload file mới).
- Nhóm 2 on-chain (versioning/expiration/multi-sig) — cần contract mới.
