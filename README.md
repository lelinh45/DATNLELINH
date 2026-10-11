# Blockchain Data Integrity — Hệ thống xác thực & chống giả mạo tài liệu số

Đồ án tốt nghiệp: áp dụng blockchain Ethereum vào bài toán chứng minh một tài liệu
"tồn tại nguyên vẹn từ một thời điểm", đồng thời phát hiện ngay khi nội dung bị sửa.

Ý tưởng cốt lõi rất gọn: **file gốc không bao giờ lên blockchain** — chỉ có dấu vân tay
SHA-256 của nó lên. Nội dung file được mã hóa AES-256 rồi đẩy lên IPFS, còn blockchain
giữ vai trò cuốn sổ công chứng không ai xóa được.

## Hệ thống hoạt động thế nào

```
Người dùng                     Server                       Bên ngoài
    │                            │                              │
    │  mã hóa file (AES-256)     │                              │
    │───────────────────────────>│  pin ciphertext              │──> IPFS (Pinata)
    │                            │                              │
    │  ký giao dịch MetaMask     │                              │
    │───────────────────────────────────────────────────────────>│──> Contract (Sepolia)
    │                            │                              │
    │  verify: nộp file lại      │  băm file → đọc hash on-chain │
    │───────────────────────────>│  khớp = nguyên vẹn           │
    │                            │  lệch = GIẢ MẠO + diff/AI    │
```

Vì hash chỉ là "dấu vân tay", kẻ xấu có đọc được hash trên chuỗi cũng không lật ngược
ra nội dung; và vì file là ciphertext, ai tải được trên IPFS cũng chỉ có đống mã vô
nghĩa nếu không có khóa AES.

## Chức năng chính

- **Đăng nhập bằng chữ ký ví** — không có mật khẩu nào trong hệ thống. Server cấp
  challenge có nonce, ví ký, đổi lấy JWT 24h.
- **Quản lý thiết bị** — đăng nhập trên máy lạ phải được duyệt từ máy đã đăng nhập
  (chuông thông báo 🔔 → Duyệt/Từ chối). OTP email chỉ mở khi ví **không còn thiết
  bị nào hoạt động** — tránh OTP thành đường vòng khi email bị lộ. Ví lần đầu
  đăng nhập sẽ báo cho mọi ví ADMIN để đặt tên và phân quyền.
- **Upload có chọn lọc** — mã hóa AES-256 tại trình duyệt, tự chọn Riêng tư
  (mình + Admin) hay Công khai (mọi ví đăng nhập). Khóa AES được ủy thác cho server,
  bọc thêm một lớp AES-256-GCM trước khi vào MongoDB.
- **Truy xuất** — danh sách tài liệu đọc từ sự kiện on-chain + metadata MongoDB,
  hiện cả phí gas thật (link Etherscan). Ô tìm kiếm tìm mờ theo tên/ID/hash; dán
  nguyên địa chỉ `0x...` thì lọc chính xác theo ví người đăng.
- **Verify công khai** — nộp file + docId, so hash on-chain. Phát hiện sửa thì hiện
  diff từng ký tự, bản đồ nhiệt pixel (với ảnh) và báo cáo pháp y từ Gemini.
- **Thu hồi** — QUẢN LÝ/ADMIN gọi revokeDocument trên contract, lý do ghi công khai
  và bất biến; MongoDB đồng bộ cờ để UI cập nhật ngay. Riêng tài liệu do ví
  ADMIN upload thì chỉ ADMIN được thu hồi — contract tự revert nếu QUẢN LÝ gọi.
- **API cho đối tác (B2B)** — tổ chức không cần MetaMask: cấp `sk_live_...` (chỉ lưu
  hash), upload → server mã hóa + pin + ký on-chain hộ, verify/list/download qua
  REST. Dữ liệu cách ly theo từng key.
- **Quota IPFS thật** — trước mỗi lần pin đọc dung lượng thật từ Pinata
  (`userPinnedDataTotal`), trần 1GB tổng tài khoản; lỗi thì fail-closed.

## Chạy dự án

```bash
npm install
cp .env.example .env      # điền các khóa thật — .env đã nằm trong .gitignore
node server.js            # backend API + xác thực, cổng 3000
```

Frontend là `index.html` tĩnh — backend tự phục vụ sẵn tại `http://localhost:3000`
(chỉ serve `index.html` + `assets/`, không lộ `.env`/code). Vẫn mở được trực tiếp
hoặc qua Live Server (port 5500) như cũ. MetaMask trỏ mạng **Sepolia**.

### Truy cập từ máy khác (không cùng mạng)

Chỉ cần `node server.js` — server tự spawn ngrok tunnel và in link public ra
console (`AUTO_TUNNEL=0` để tắt, `NGROK_BIN=` trỏ đường dẫn nếu ngrok không có
trong PATH). Link ngẫu nhiên đổi mỗi lần khởi động; muốn **link cố định** thì
vào https://dashboard.ngrok.com/domains lấy 1 static domain miễn phí rồi đặt
`NGROK_DOMAIN=xxx.ngrok-free.app` trong `.env` — mỗi lần `node server.js` là
mọi người vào đúng link đó.

Người dùng mở URL HTTPS của tunnel → cài MetaMask → đăng nhập bình thường
(`config.js` tự nhận same-origin `/api`, CORS tự nhận domain tunnel).
Bắt buộc phải là HTTPS — `crypto.subtle` (băm file) chỉ chạy trong secure context,
nên mở thẳng `http://IP:3000` sẽ không hoạt động.

### Deploy 24/7 lên Render (miễn phí) — không phụ thuộc máy cá nhân

Hệ thống chạy được hoàn toàn trên cloud: file lưu trên IPFS/Pinata, metadata trên
MongoDB, contract trên Sepolia — không có dữ liệu nào nằm trên ổ đĩa local.

**Bước 1 — MongoDB Atlas (miễn phí M0)**

1. Vào https://cloud.mongodb.com → tạo cluster **M0 Free**
2. Database Access → tạo user + password
3. Network Access → Add IP `0.0.0.0/0` (Render dùng IP động)
4. Connect → Drivers → copy chuỗi `mongodb+srv://<user>:<pass>@cluster.../DataIntegrity`

**Bước 2 — Đẩy code lên GitHub**

```bash
git add -A && git commit -m "deploy render"
git remote add origin https://github.com/<tên>/<repo>.git
git push -u origin master
```

(repo private cũng được — Render kết nối qua GitHub App.)

**Bước 3 — Render**

1. https://dashboard.render.com → **New + → Blueprint** → chọn repo
   (`render.yaml` trong repo tự điền build/start/plan free)
2. Dashboard hỏi các env `sync:false` — điền theo `.env` hiện tại:
   `MONGO_URI` (chuỗi Atlas ở bước 1), `PRIVATE_KEY`, `CONTRACT_ADDRESS`,
   `RPC_URL`, `PINATA_API_KEY/SECRET`, `GEMINI_API_KEY`, SMTP nếu dùng.
   `JWT_SECRET` + `MASTER_KEY` Render tự sinh.
3. Deploy xong → link cố định `https://blockchain-data-integrity.onrender.com`

**Lưu ý free plan:** server ngủ sau ~15 phút không truy cập — người đầu tiên vào
chờ 30-60s khởi động, các lượt sau nhanh bình thường. Muốn không ngủ: nâng lên
plan Starter ($7/tháng) chỉ bằng 1 click, không phải đổi code.

**Sau deploy nhớ cập nhật frontend config** nếu `API_BASE`/`CONTRACT_ADDRESS`
trong `assets/js/config.js` đang trỏ localhost — mặc định đã là same-origin
`/api` nên thường không phải sửa.

Biến môi trường bắt buộc: `JWT_SECRET`, `PINATA_API_KEY`, `PINATA_API_SECRET`,
`RPC_URL`, `CONTRACT_ADDRESS`, `PRIVATE_KEY` (ví server — trả gas cho API đối tác).
Khuyến nghị thêm `MASTER_KEY` (bọc khóa escrow; để trống dùng JWT_SECRET) và
`SMTP_*` (OTP email — thiếu thì thiết bị mới chỉ duyệt được từ máy cũ).

## Kiểm thử

```bash
npm test    # 71 ca: contract, auth/OTP, consistency, secrets, XSS
```

## Cấu trúc

```
contracts/DataIntegrity.sol   — contract lưu hash + RBAC 4 cấp, deploy bằng Hardhat
server.js                     — API upload/verify/batch/quota/API-key, escrow khóa
auth.js                       — challenge → JWT, phiên thiết bị, OTP (scrypt)
models/                       — Wallet, Batch, DeviceSession, ApiKey,
                                PartnerDocument, Notification, AuthChallenge
assets/js/                    — frontend: web3Service (MetaMask/contract),
                                apiService (gọi backend), uiHandler, sanitize, main
test/                         — 71 ca test tự động (node:test)
BaoCao_DeTai.html             — báo cáo đồ án đầy đủ, in được ra A4 / tải về Word
```

## Những giới hạn đã biết

- Tài liệu đối tác qua API do **ví server** ký on-chain (đối tác không có ví) —
  quyền sở hữu thật nằm trong MongoDB theo apiKeyId.
- Quota 1GB là tổng tài khoản Pinata dùng chung toàn hệ thống; con số per-ví
  hiển thị là hạn mức logic nội bộ.
- Chạy Sepolia testnet — chuyển mainnet cần đánh giá lại gas.
- Xem trước DOCX (docx-preview) giữ được font/bảng/lề nhưng SmartArt, textbox
  phức tạp có thể khác Word gốc.
