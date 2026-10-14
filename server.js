import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

import mammoth from 'mammoth';
import multer from 'multer';
import crypto from 'crypto';
import cors from 'cors';
import { ethers } from 'ethers';
import fs from 'fs';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import * as diff from 'diff'; 
import { PNG } from 'pngjs'; 
import pixelmatch from 'pixelmatch'; 
import jpeg from 'jpeg-js';
import QRCode from 'qrcode';
import 'dotenv/config';
import axios from 'axios';
import FormData from 'form-data';
import CryptoJS from 'crypto-js';
import mongoose from 'mongoose';
import nodemailer from 'nodemailer';
import Wallet from './models/Wallet.js';
import Batch from './models/Batch.js';
import AuthChallenge from './models/AuthChallenge.js';
import Notification from './models/Notification.js';
import DeviceSession from './models/DeviceSession.js';
import ApiKey from './models/ApiKey.js';
import PartnerDocument from './models/PartnerDocument.js';
import { createAuth } from './auth.js';

// --- BỔ SUNG LỚP 1: Import thư viện AI ---
import { GoogleGenAI } from '@google/genai';

const app = express();
// Tin header X-Forwarded-For của proxy đầu tiên — cần thiết để rate-limit/blacklist nhận đúng IP thật khi chạy sau nginx/reverse proxy
app.set('trust proxy', 1);
const port = process.env.PORT || 3000;

// CORS: chỉ cho phép origin trong allowlist (CORS_ORIGINS) hoặc localhost dev.
// Không dùng wildcard — API giờ mang quyền ghi dữ liệu theo JWT.
const CORS_ORIGINS = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const corsMw = cors({
    origin: (origin, cb) => {
        if (!origin) return cb(null, true);           // curl/Postman/same-origin không gửi Origin
        if (origin === 'null') return cb(null, true); // frontend mở trực tiếp bằng file://
        if (CORS_ORIGINS.length > 0) return cb(null, CORS_ORIGINS.includes(origin));
        if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return cb(null, true);
        return cb(new Error('CORS bị chặn: ' + origin));
    }
});
// Request same-origin (frontend do chính server này phục vụ qua tunnel/domain)
// không cần CORS — bỏ qua middleware, khỏi phải liệt kê domain tunnel trong .env
app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
        try { if (new URL(origin).host === req.get('host')) return next(); } catch {}
    }
    corsMw(req, res, next);
});
app.use(express.json({ limit: '5mb' }));

// --- BỔ SUNG LỚP 2: Khởi tạo AI & Cấu hình Phòng thủ ---
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
// Đã gỡ cảnh báo Telegram — thông báo nghiệp vụ nằm trong app (Notification) + OTP qua email
// Ban IP CÓ HẠN (15 phút) thay vì vĩnh viễn — tránh khóa nhầm người dùng hợp lệ sau NAT/proxy chung
const BAN_MS = 15 * 60 * 1000;
const ipBans = new Map(); // ip -> banUntil (timestamp ms)

// Giới hạn kích thước file — memoryStorage nạp vào RAM nên không được để vô hạn
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024, files: 1 } // 25MB / 1 file mỗi request
});

// Bọc multer để trả JSON đúng mã lỗi thay vì 500 HTML mặc định của Express
const uploadSingle = (field) => (req, res, next) => {
    upload.single(field)(req, res, (err) => {
        if (err instanceof multer.MulterError) {
            const isSize = err.code === 'LIMIT_FILE_SIZE';
            return res.status(isSize ? 413 : 400).json({
                success: false,
                message: isSize ? 'File vượt quá giới hạn 25MB' : `Upload lỗi: ${err.message}`
            });
        }
        if (err) return res.status(400).json({ success: false, message: `Upload lỗi: ${err.message}` });
        next();
    });
};

// =====================================================================
// QUOTA IPFS THẬT: trần cứng = 1GB gói Pinata free — áp cho TỔNG tài khoản,
// gồm cả file web lẫn file đối tác up qua API key (cùng chung 1 tài khoản Pinata).
// Số dùng thật lấy từ API /data/pinnedUsage của Pinata, không tin client khai.
// =====================================================================
const PINATA_QUOTA_BYTES = 1024 * 1024 * 1024; // 1GB — gói free hiện tại

function sizeStringToMB(s) {
    const n = parseFloat(s);
    if (!isFinite(n) || n <= 0) return 0;
    if (/GB/i.test(s)) return n * 1024;
    if (/KB/i.test(s)) return n / 1024;
    return n; // "x MB" hoặc số bytes nhỏ lẻ coi như MB
}

async function getIpfsUsageBytes() {
    try {
        const r = await axios.get('https://api.pinata.cloud/data/userPinnedDataTotal', {
            headers: {
                'pinata_api_key': process.env.PINATA_API_KEY,
                'pinata_secret_api_key': process.env.PINATA_API_SECRET,
            }
        });
        return Number(r.data?.pin_size_total) || 0;
    } catch (e) {
        // Pinata API lỗi → fallback cộng kích thước đã ghi trong MongoDB
        console.warn('[QUOTA] Không đọc được pinnedUsage từ Pinata, fallback tính từ DB:', e.message);
        let total = 0;
        const batches = await Batch.find().select('files.fileSize').lean();
        for (const b of batches) for (const f of b.files || []) {
            total += sizeStringToMB(f.fileSize) * 1024 * 1024;
        }
        const pdocs = await PartnerDocument.find().select('fileSize').lean();
        for (const d of pdocs) total += Number(d.fileSize) || 0; // partner lưu bytes thật
        return Math.round(total);
    }
}

// Trả true nếu còn đủ chỗ cho incomingBytes; trả false và đã gửi response 403 nếu hết
async function checkIpfsQuota(res, incomingBytes) {
    try {
        const used = await getIpfsUsageBytes();
        if (used + incomingBytes > PINATA_QUOTA_BYTES) {
            res.status(403).json({
                success: false,
                message: `Hết hạn mức lưu trữ IPFS — tài khoản Pinata đã dùng ${(used / 1048576).toFixed(1)}MB / 1024MB (tổng toàn hệ thống). Cần gỡ file cũ hoặc nâng gói Pinata.`
            });
            return false;
        }
        return true;
    } catch (e) {
        // Không xác định được usage (DB cũng lỗi) → fail-closed, không cho pin mù
        console.error('[QUOTA] Không kiểm tra được dung lượng:', e.message);
        res.status(503).json({ success: false, message: 'Không kiểm tra được hạn mức IPFS — thử lại sau' });
        return false;
    }
}

// Middleware chặn toàn cục các IP đã vào Blacklist (Cơ chế Fail2Ban)
app.use((req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress;
    const until = ipBans.get(ip);
    if (until) {
        if (Date.now() < until) {
            return res.status(403).json({ success: false, message: '🚨 IP tạm bị khóa 15 phút do spam xác thực. Vui lòng thử lại sau.' });
        }
        ipBans.delete(ip); // hết hạn → tự mở
    }
    next();
});

// Giới hạn chung cho toàn bộ API — dashboard poll ~2 req/10s nên phải đủ rộng cho phiên làm việc,
// nhưng vẫn chặn flood. Route nhạy cảm (auth/verify) có limiter riêng chặt hơn.
const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 600, standardHeaders: true, legacyHeaders: false });
app.use('/api/', apiLimiter);

// Chống brute-force challenge/login — chặt hơn limiter chung
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });
app.use('/api/auth', authLimiter);

const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
// Khai báo trực tiếp ABI để Server độc lập hoàn toàn, không phụ thuộc vào Hardhat
const abi = [
    "function getDocument(string _documentId) view returns (string fileHash, string ipfsURI, uint256 timestamp, address uploader, bool isRevoked, string revocationReason)",
    "function userRoles(address) view returns (uint8)"
];

// Contract khởi tạo lười — server vẫn boot được nếu chưa có CONTRACT_ADDRESS
let chainContract = null;
function getChainContract() {
    if (!chainContract) {
        if (!CONTRACT_ADDRESS) throw new Error('Server chưa cấu hình CONTRACT_ADDRESS trong .env');
        chainContract = new ethers.Contract(CONTRACT_ADDRESS, abi, provider);
    }
    return chainContract;
}

// =====================================================================
// XÁC THỰC: MetaMask signature → JWT (role ưu tiên đọc on-chain, DB dự phòng)
// =====================================================================
// Challenge lưu MongoDB — sống qua restart, TTL index tự dọn document hết hạn
const mongoChallengeStore = {
    set: async (address, data) => {
        await AuthChallenge.findOneAndUpdate(
            { address },
            { challenge: data.challenge, expiresAt: new Date(data.expiresAt) },
            { upsert: true }
        );
    },
    get: async (address) => {
        const d = await AuthChallenge.findOne({ address }).lean();
        return d ? { challenge: d.challenge, expiresAt: d.expiresAt.getTime() } : null;
    },
    delete: async (address) => { await AuthChallenge.deleteOne({ address }); },
};

// Mailer gửi OTP duyệt thiết bị mới — chỉ bật khi có SMTP_USER/SMTP_PASS
const mailer = (process.env.SMTP_USER && process.env.SMTP_PASS) ? {
    transport: nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: Number(process.env.SMTP_PORT || 465),
        secure: Number(process.env.SMTP_PORT || 465) === 465,
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    }),
    async sendOtp(to, code, deviceLabel) {
        await this.transport.sendMail({
            from: process.env.OTP_FROM || process.env.SMTP_USER,
            to,
            subject: '[BDI] Ma xac nhan thiet bi dang nhap moi',
            text: `He thong Blockchain Data Integrity\n\nThiet bi "${deviceLabel}" dang cho phe duyet dang nhap vao vi cua ban.\n\nMa OTP: ${code}\nHet han sau 5 phut.\n\nNeu khong phai ban, hay dang nhap tu thiet bi cu va tu choi phien nay.`,
            html: `<p>Thiết bị <b>${deviceLabel}</b> đang chờ phê duyệt đăng nhập vào ví của bạn.</p><p>Mã OTP: <b style="font-size:20px;letter-spacing:4px">${code}</b></p><p>Hết hạn sau 5 phút. Nếu không phải bạn, hãy đăng nhập từ thiết bị cũ và từ chối phiên này.</p>`
        });
    }
} : null;
if (!mailer) console.warn('⚠️  SMTP chưa cấu hình — OTP email tắt, thiết bị mới chỉ duyệt được từ thiết bị cũ.');

const { router: authRouter, requireAuth, requireRole, getRoleRank } = createAuth({
    walletModel: Wallet,
    jwtSecret: process.env.JWT_SECRET,
    roleProvider: async (addr) => getChainContract().userRoles(addr),
    challengeStore: mongoChallengeStore,
    sessionModel: DeviceSession,
    notificationModel: Notification,
    mailer,
});
app.use('/api/auth', authRouter);
if (!process.env.JWT_SECRET) {
    console.warn('⚠️  JWT_SECRET chưa được cấu hình trong .env — mọi API xác thực sẽ trả 500 cho tới khi cấu hình.');
}

// Quyền đọc "NGƯỜI XEM": rank on-chain = 0 (không ghi được gì trên chuỗi)
// nhưng DB đánh dấu role NGƯỜI XEM → được xem danh sách, không được ghi API.
const requireViewer = async (req, res, next) => {
    try {
        const rank = await getRoleRank(req.user.address);
        if (rank !== null && rank >= 1) return next();
        const w = await Wallet.findOne({ address: req.user.address }).select('role status').lean();
        if (w && w.role === 'NGƯỜI XEM' && w.status === 'ACTIVE') return next();
        return res.status(403).json({ success: false, message: 'Cần ít nhất quyền Người Xem' });
    } catch (e) {
        res.status(503).json({ success: false, message: 'Không kiểm tra được quyền lúc này' });
    }
};

const ipfsMockStorage = new Map(); 

// =====================================================================
// API 1: UPLOAD (CHỈ LƯU IPFS PINATA - TRẢ ID VỀ CHO FRONTEND KÝ)
// =====================================================================
app.post('/api/upload', requireAuth, requireRole('NHẬP LIỆU'), uploadSingle('document'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: 'Vui lòng tải lên tài liệu!' });

        const hash = crypto.createHash('sha256');
        hash.update(req.file.buffer);
        const fileHash = hash.digest('hex');

        // Tên file toàn ký tự lạ → fallback, và cắt dài để docId không vượt giới hạn
        const safeFileName = (req.file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '') || 'file').substring(0, 100);
        const documentId = `${safeFileName}_${Date.now()}`;

        // Chặn trước khi pin: vượt quota 1GB tổng tài khoản Pinata thì từ chối ngay
        if (!await checkIpfsQuota(res, req.file.size)) return;

        let ipfsCID = "";
        try {
            const formData = new FormData();
            formData.append('file', req.file.buffer, { filename: safeFileName });

            const pinataResponse = await axios.post("https://api.pinata.cloud/pinning/pinFileToIPFS", formData, {
                maxBodyLength: "Infinity",
                headers: {
                    'Content-Type': `multipart/form-data; boundary=${formData._boundary}`,
                    'pinata_api_key': process.env.PINATA_API_KEY,
                    'pinata_secret_api_key': process.env.PINATA_API_SECRET,
                }
            });
            ipfsCID = pinataResponse.data.IpfsHash; 
            console.log(`[IPFS] Tải file lên thành công! CID: ${ipfsCID}`);
        } catch (ipfsErr) {
            const detail = ipfsErr.response?.data?.error?.reason || ipfsErr.response?.data?.error?.details || ipfsErr.message;
            console.error("Lỗi khi tải lên IPFS:", ipfsErr.response ? ipfsErr.response.data : ipfsErr.message);
            return res.status(500).json({ success: false, message: `Lỗi tải lên IPFS: ${detail}` });
        }

        let qrCodeBase64 = '';
        try {
            qrCodeBase64 = await QRCode.toDataURL(documentId, {
                color: { dark: '#000000', light: '#ffffff' }, width: 200, margin: 2
            });
        } catch (qrErr) {
            console.error("Lỗi tạo mã QR:", qrErr);
        }

        res.json({ 
            success: true, 
            message: 'Đã lưu IPFS thành công!', 
            documentId, 
            fileHash, 
            ipfsCID, 
            qrCode: qrCodeBase64 
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Lỗi upload', error: error.message });
    }
});

// =====================================================================
// BỔ SUNG LỚP 3: Active Defense - Lá chắn bảo vệ API Verify
// =====================================================================
const verifyLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 phút
    max: 10, // 10 lần/5 phút — đủ cho giám định hợp lệ, vẫn chặn brute-force
    handler: async (req, res) => {
        const ip = req.ip || req.connection.remoteAddress;
        if (!ipBans.has(ip)) {
            ipBans.set(ip, Date.now() + BAN_MS);
            console.warn(`[SECURITY] IP ${ip} spam /api/verify — tạm khóa 15 phút`);
        }
        res.status(429).json({ success: false, message: "Thao tác quá nhiều. IP đã bị khóa!" });
    }
});

// =====================================================================
// API 2: VERIFY (XÁC THỰC & TẢI FILE TỪ IPFS ĐỂ VẼ BẢN ĐỒ NHIỆT)
// =====================================================================
// Gắn verifyLimiter vào API này
app.post('/api/verify', verifyLimiter, uploadSingle('document'), async (req, res) => {
    try {
        if (!req.file || !req.body.documentId) return res.status(400).json({ success: false, message: 'Thiếu dữ liệu!' });
        
        const documentId = req.body.documentId;
        if (typeof documentId !== 'string' || !/^[\w.\-]{1,300}$/.test(documentId)) {
            return res.status(400).json({ success: false, message: 'documentId không hợp lệ' });
        }
        const currentBuffer = req.file.buffer; 
        
        const hash = crypto.createHash('sha256');
        hash.update(currentBuffer);
        const currentFileHash = hash.digest('hex');

        const [originalHash, ipfsURI, timestamp, uploader, isRevoked, revocationReason] = await getChainContract().getDocument(documentId);

        const isMatch = (currentFileHash === originalHash);
        
        let textDifferences = null;
        let imageDiffBase64 = null;

        // NẾU PHÁT HIỆN GIẢ MẠO, HỆ THỐNG BẮT ĐẦU ĐIỀU TRA
        if (!isMatch) {
            const ipfsCID = ipfsURI.replace('ipfs://', ''); 
            let originalBuffer = null;

            const gateways = [
                `https://gateway.pinata.cloud/ipfs/${ipfsCID}`,
                `https://ipfs.io/ipfs/${ipfsCID}`,
                `https://cloudflare-ipfs.com/ipfs/${ipfsCID}`
            ];

            for (const gateway of gateways) {
                try {
                    console.log(`[IPFS] Đang truy xuất bản gốc qua cổng: ${gateway}`);
                    const ipfsResponse = await axios.get(gateway, { responseType: 'arraybuffer', timeout: 10000 });
                    originalBuffer = Buffer.from(ipfsResponse.data);
                    console.log(`[IPFS] ✅ Tải file thành công từ cổng này!`);
                    break; 
                } catch (downloadErr) {
                    console.log(`[IPFS] ⚠️ Cổng bị nghẽn, đang thử chuyển hướng...`);
                }
            }
            
            if (originalBuffer) {
                // Giải mã AES-256 (In-memory)
                if (req.body.secretKey) {
                    console.log("[AES-256] Đang tiến hành giải mã file từ IPFS...");
                    try {
                        const encryptedText = originalBuffer.toString('utf-8'); 
                        const decryptedBytes = CryptoJS.AES.decrypt(encryptedText, req.body.secretKey);
                        const decryptedBase64 = decryptedBytes.toString(CryptoJS.enc.Utf8);
                        
                        if (!decryptedBase64) {
                            return res.status(400).json({ success: false, message: 'Sai mật khẩu giải mã AES-256!' });
                        }
                        
                        originalBuffer = Buffer.from(decryptedBase64, 'base64');
                        console.log("[AES-256] Giải mã thành công, sẵn sàng đối chiếu!");
                    } catch (error) {
                        console.error("[AES-256] Lỗi giải mã:", error.message);
                        return res.status(400).json({ success: false, message: 'Mật khẩu sai hoặc tệp tin bị hỏng!' });
                    }
                }

                const fileName = req.file.originalname.toLowerCase();

                if (fileName.endsWith('.txt') || fileName.endsWith('.csv')) {
                    const originalContent = originalBuffer.toString('utf8');
                    const currentContent = currentBuffer.toString('utf8');
                    textDifferences = diff.diffWords(originalContent, currentContent);
                } 
                else if (fileName.endsWith('.docx')) {
                    try {
                        const originalDocx = await mammoth.extractRawText({ buffer: originalBuffer });
                        const currentDocx = await mammoth.extractRawText({ buffer: currentBuffer });
                        textDifferences = diff.diffWords(originalDocx.value, currentDocx.value);
                    } catch (docxErr) {
                        console.error("Lỗi đọc file DOCX:", docxErr);
                    }
                }
                else if (fileName.endsWith('.png') || fileName.endsWith('.jpg') || fileName.endsWith('.jpeg')) {
                    try {
                        let img1, img2, width, height;

                        if (fileName.endsWith('.png')) {
                            img1 = PNG.sync.read(originalBuffer);
                            img2 = PNG.sync.read(currentBuffer);
                            width = img1.width;
                            height = img1.height;
                        } else {
                            img1 = jpeg.decode(originalBuffer, { useTArray: true });
                            img2 = jpeg.decode(currentBuffer, { useTArray: true });
                            width = img1.width;
                            height = img1.height;
                        }

                        if (img1.width !== img2.width || img1.height !== img2.height) {
                            throw new Error(`Kích thước không khớp!`);
                        }

                        const diffImage = new PNG({ width, height });
                        pixelmatch(img1.data, img2.data, diffImage.data, width, height, { threshold: 0.1, diffColor: [255, 0, 0] });

                        const diffBuffer = PNG.sync.write(diffImage);
                        imageDiffBase64 = `data:image/png;base64,${diffBuffer.toString('base64')}`;
                    } catch (err) {
                        console.error("Lỗi phân tích pixel ảnh:", err.message);
                    }
                }
            }
        }

        // =====================================================================
        // BỔ SUNG LỚP 4: Tích hợp AI Forensic (Gemini) phân tích rủi ro
        // =====================================================================
        let aiForensicReport = null;

        if (!isMatch && textDifferences && textDifferences.length > 0) {
            try {
                console.log("[AI Forensic] Đang phân tích rủi ro giả mạo...");
                
                // Trích xuất các đoạn bị sửa để gửi cho AI
                const diffSummary = textDifferences
                    .filter(p => p.added || p.removed)
                    .map(p => (p.added ? `Nội dung bị chèn lén: "${p.value.trim()}"` : `Nội dung bị xóa/sửa: "${p.value.trim()}"`))
                    .join(' | ');

                const prompt = `Bạn là một Điều tra viên An ninh số. Dưới đây là phần văn bản bị thay đổi trái phép trong một tài liệu pháp lý: [${diffSummary}]. Hãy viết một Báo cáo Pháp y (Forensic Report) cực kỳ ngắn gọn (dưới 80 chữ) bằng tiếng Việt. Báo cáo cần chỉ rõ nội dung nào bị thay đổi và cảnh báo rủi ro lừa đảo. Không dùng markdown, không có lời chào hỏi.`;

                const aiResponse = await ai.models.generateContent({
                    model: 'gemini-1.5-flash',
                    contents: prompt,
                });
                
                aiForensicReport = aiResponse.text;
                console.log("[AI Forensic] Báo cáo hoàn tất:", aiForensicReport);
            } catch (aiError) {
                console.error("[AI Forensic] Lỗi sinh báo cáo:", aiError.message);
                aiForensicReport = "Phát hiện sự thay đổi cấu trúc dữ liệu nghiêm trọng, hệ thống khuyên bạn nên vô hiệu hóa tài liệu này.";
            }
        }

        res.json({
            success: true,
            isMatch, isRevoked, revocationReason, currentFileHash, originalHash,
            differences: textDifferences, 
            imageDiff: imageDiffBase64, 
            aiReport: aiForensicReport, // Bổ sung key này để đẩy lên Frontend
            message: isRevoked ? 'TÀI LIỆU ĐÃ BỊ THU HỒI' : (isMatch ? 'TÀI LIỆU NGUYÊN VẸN' : 'PHÁT HIỆN GIẢ MẠO')
        });

    } catch (error) {
        console.error("🚨 LỖI BÊN TRONG CATCH VERIFY:", error);
        if (error.message.includes("Khong tim thay tai lieu")) {
            return res.status(404).json({ success: false, message: 'Tài liệu không tồn tại trên mạng lưới!' });
        }
        res.status(500).json({ success: false, message: 'Lỗi xác thực', error: error.message });
    }
});

// =======================================================
// API TỪ BACKEND CŨ (S2) ĐÃ ĐƯỢC GỘP VÀO S1
// =======================================================
const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/DataIntegrity"; 
mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ Đã kết nối thành công với MongoDB!'))
    .catch((err) => console.log('❌ Lỗi kết nối Database:', err));

// Hồ sơ của chính mình — ví rank 0 (chờ cấp quyền) vẫn cần đọc/điền alias + liên hệ
app.get('/api/wallets/me', requireAuth, async (req, res) => {
    try {
        const w = await Wallet.findOne({ address: req.user.address }).lean();
        res.json(w || { address: req.user.address });
    } catch (error) {
        res.status(500).json({ message: "Lỗi lấy hồ sơ ví" });
    }
});

// Liên hệ admin — ví bị từ chối cần biết gọi ai. Chỉ lộ alias/email/phone/địa chỉ.
app.get('/api/wallets/admin-contact', requireAuth, async (req, res) => {
    try {
        const w = await Wallet.findOne({ role: 'ADMIN', status: 'ACTIVE' })
            .select('address alias email phone').lean();
        res.json(w || {});
    } catch (e) {
        res.status(500).json({ message: 'Lỗi lấy liên hệ admin' });
    }
});

// Ví đã đăng nhập nhưng quyền on-chain vẫn là 0 — khay "chờ cấp quyền" của ADMIN
app.get('/api/wallets/pending', requireAuth, requireRole('ADMIN'), async (req, res) => {
    try {
        const wallets = await Wallet.find({ status: 'ACTIVE', role: { $ne: 'NGƯỜI XEM' } })
            .select('address alias email phone requestedRole lastActive').sort({ lastActive: -1 }).lean();
        // Check rank TRỰC TIẾP trên contract (không qua getRoleRank — fallback DB
        // của nó không dùng được ở đây). RPC lỗi → giữ những ví đã gửi yêu cầu
        // (requestedRole) để khay không trống khi mạng Sepolia chập chờn
        const ranks = await Promise.all(wallets.map(w =>
            getChainContract().userRoles(w.address).then(r => Number(r)).catch(() => null)));
        res.json({ success: true, wallets: wallets.filter((w, i) => ranks[i] === 0 || (ranks[i] === null && !!w.requestedRole)) });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Lỗi lấy danh sách ví chờ duyệt' });
    }
});

// ADMIN từ chối ví đang chờ duyệt — khóa trong DB (hiện "TẠM KHÓA" ở bảng ví),
// ví bên kia thấy trạng thái bị từ chối thay vì chờ mãi
app.post('/api/wallets/reject', requireAuth, requireRole('ADMIN'), async (req, res) => {
    try {
        const { address } = req.body || {};
        if (typeof address !== 'string' || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
            return res.status(400).json({ success: false, message: 'Địa chỉ ví không hợp lệ' });
        }
        const target = address.toLowerCase();
        if (target === req.user.address) {
            return res.status(400).json({ success: false, message: 'Không thể từ chối chính ví của mình' });
        }
        const cur = await Wallet.findOne({ address: target }).select('rejectCount').lean();
        if (!cur) return res.status(404).json({ success: false, message: 'Không tìm thấy ví trong hệ thống' });
        // Tích lũy số lần bị từ chối — từ lần thứ 3 trở đi cấm xin lại 30 phút
        // (chống spam khay duyệt); đếm reset về 0 khi ví được cấp quyền
        const newCount = (cur.rejectCount || 0) + 1;
        const blocked = newCount >= 3 ? Date.now() + 30 * 60 * 1000 : 0;
        const w = await Wallet.findOneAndUpdate(
            { address: target },
            { $set: { status: 'REVOKED', rejected: true, rejectCount: newCount, rejectBlockedUntil: blocked } },
            { returnDocument: 'after' }
        );
        try {
            await Notification.create({
                address: target, type: 'system',
                title: 'Yêu cầu cấp quyền bị từ chối',
                message: blocked
                    ? 'Admin đã từ chối cấp quyền cho ví của bạn. Đây là lần từ chối thứ 3 — ví tạm bị khóa chức năng xin cấp quyền trong 30 phút.'
                    : 'Admin đã từ chối cấp quyền cho ví của bạn. Liên hệ quản trị viên nếu cần xem xét lại.',
                meta: { rejectedBy: req.user.address, rejectCount: newCount }
            });
        } catch (e) {}
        res.json({ success: true, message: 'Đã từ chối ví' });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Lỗi khi từ chối ví' });
    }
});

// Danh sách ví toàn hệ thống — chỉ nhân sự đã được cấp quyền (rank >= 1) mới xem
app.get('/api/wallets', requireAuth, requireViewer, async (req, res) => {
    try {
        const wallets = await Wallet.find({ status: { $ne: 'DELETED' } }).lean();
        // Dung lượng thật tính từ DB, không tin số client tự khai qua /wallets/sync
        const batches = await Batch.find().select('uploader files.fileSize').lean();
        const usedByAddr = {};
        for (const b of batches) {
            const u = String(b.uploader || '').toLowerCase();
            for (const f of b.files || []) {
                usedByAddr[u] = (usedByAddr[u] || 0) + sizeStringToMB(f.fileSize);
            }
        }
        for (const w of wallets) {
            w.storageUsed = Number((usedByAddr[String(w.address).toLowerCase()] || 0).toFixed(2));
        }
        // Email/SĐT là dữ liệu liên hệ riêng — chỉ QUẢN LÝ trở lên mới được xem,
        // tài khoản thường vẫn thấy danh sách ví nhưng bị che 2 trường này
        const callerRank = await getRoleRank(req.user.address);
        if (callerRank < 2) {
            for (const w of wallets) { delete w.email; delete w.phone; }
        }
        res.json(wallets);
    } catch (error) {
        res.status(500).json({ message: "Lỗi máy chủ khi lấy dữ liệu ví", error });
    }
});

app.post('/api/wallets/sync', requireAuth, async (req, res) => {
    try {
        const { address, ...updateData } = req.body || {};
        if (typeof address !== 'string' || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
            return res.status(400).json({ success: false, message: "Địa chỉ ví không hợp lệ" });
        }
        const target = address.toLowerCase();
        const isSelf = target === req.user.address;

        // Whitelist field — role/status/storageLimit chỉ ADMIN mới được ghi.
        // storageUsed KHÔNG nhận từ client — server tự tính từ Batch khi GET /api/wallets
        const SELF_FIELDS = ['alias', 'lastActive', 'requestedRole'];
        const ADMIN_FIELDS = ['role', 'status', 'storageLimit'];
        const update = {};
        for (const k of SELF_FIELDS) if (k in updateData) update[k] = updateData[k];
        // requestedRole chỉ nhận 2 giá trị hợp lệ; rỗng → xóa yêu cầu
        if ('requestedRole' in update) {
            if (update.requestedRole === '' || update.requestedRole === null) update.requestedRole = null;
            else if (!['NHẬP LIỆU', 'QUẢN LÝ', 'NGƯỜI XEM'].includes(update.requestedRole)) delete update.requestedRole;
        }

        const wantsAdminFields = Object.keys(updateData).some(k => ADMIN_FIELDS.includes(k));
        if (!isSelf || wantsAdminFields) {
            const callerRank = await getRoleRank(req.user.address);
            if (callerRank < 3) {
                return res.status(403).json({ success: false, message: 'Chỉ Admin mới được đồng bộ ví người khác hoặc thay đổi quyền' });
            }
            for (const k of ADMIN_FIELDS) if (k in updateData) update[k] = updateData[k];
            // Admin ghi role = quyền đã được duyệt chính thức → đánh dấu tin cậy
            // cho fallback RPC + xóa luôn yêu cầu chờ duyệt (đã xử xong)
            if ('role' in updateData) {
                update.roleGranted = true;
                update.requestedRole = null;
                // Được duyệt → xóa tích lũy từ chối và mở khóa xin quyền (nếu đang bị chặn)
                update.rejectCount = 0;
                update.rejectBlockedUntil = 0;
            }
        }

        // Cần đọc doc hiện tại khi ví tự khai thông tin — dùng cho 2 check dưới
        let curDoc = null;
        if (isSelf && ('alias' in update || 'requestedRole' in update)) {
            curDoc = await Wallet.findOne({ address: target }).select('alias email phone status rejected role rejectCount rejectBlockedUntil').lean();
        }

        // Ví tự đề nghị quyền phải khai đủ Tên + Email + SĐT — thiếu 1 trường
        // thì không tính là "xin duyệt" (bypass frontend gọi API cũng bị chặn)
        if (isSelf && 'requestedRole' in update && update.requestedRole) {
            const merged = { ...(curDoc || {}), ...update };
            if (!merged.alias || !merged.email || !merged.phone) {
                return res.status(400).json({ success: false, message: 'Vui lòng khai đủ Tên, Email và Số điện thoại trước khi xin cấp quyền' });
            }
        }

        // Ví bị từ chối ≥3 lần đang trong 30 phút cấm — chặn mọi yêu cầu xin lại
        // (kể cả bypass frontend gọi thẳng API)
        if (isSelf && curDoc && curDoc.status === 'REVOKED' && curDoc.rejected === true
            && (curDoc.rejectBlockedUntil || 0) > Date.now()) {
            const mins = Math.ceil((curDoc.rejectBlockedUntil - Date.now()) / 60000);
            return res.status(429).json({ success: false, message: `Ví này đã bị từ chối cấp quyền 3 lần — tạm khóa xin quyền, thử lại sau ~${mins} phút.` });
        }

        // Ví bị từ chối (rejected) hoặc bị sync cũ đè role BỊ KHÓA dù chưa từng có
        // quyền on-chain — tự khai lại thông tin → cho quay lại khay chờ duyệt.
        // Ví bị Admin khóa thủ công (giữ role thật, rejected=false) KHÔNG tự mở được
        if (curDoc && curDoc.status === 'REVOKED' && (curDoc.rejected === true || curDoc.role === 'BỊ KHÓA')) {
            update.status = 'ACTIVE';
            update.rejected = false;
            if (curDoc.role === 'BỊ KHÓA') update.role = 'NHẬP LIỆU';
        }

        const updatedWallet = await Wallet.findOneAndUpdate(
            { address: target },
            { $set: update },
            { returnDocument: 'after', upsert: true, runValidators: true }
        );
        res.json(updatedWallet);
    } catch (error) {
        if (error.name === 'ValidationError') return res.status(400).json({ success: false, message: error.message });
        res.status(500).json({ success: false, message: "Lỗi khi đồng bộ ví vào Database" });
    }
});

// Đăng ký/đổi email + SĐT chủ ví — email nhận OTP duyệt thiết bị mới. Chỉ chủ ví tự đặt cho mình.
app.post('/api/wallets/email', requireAuth, async (req, res) => {
    try {
        const { email, phone } = req.body || {};
        const $set = {};
        if (email !== undefined) {
            if (typeof email !== 'string' || !/^[^\s@]{1,64}@[^\s@]{1,190}$/.test(email.trim()) || email.length > 254) {
                return res.status(400).json({ success: false, message: 'Email không hợp lệ' });
            }
            $set.email = email.trim().toLowerCase();
        }
        if (phone !== undefined) {
            const p = String(phone).trim();
            if (!/^\+?[\d\s-]{8,15}$/.test(p)) {
                return res.status(400).json({ success: false, message: 'Số điện thoại không hợp lệ' });
            }
            $set.phone = p;
        }
        if (Object.keys($set).length === 0) {
            return res.status(400).json({ success: false, message: 'Không có dữ liệu để lưu' });
        }
        await Wallet.findOneAndUpdate(
            { address: req.user.address },
            { $set },
            { upsert: true }
        );
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Lỗi lưu thông tin liên hệ' });
    }
});

// =====================================================================
// KHÓA GIẢI MÃ FILE (KEY ESCROW): bọc AES key của user bằng MASTER_KEY
// trước khi ghi Mongo — DB rò rỉ cũng không lộ plaintext key.
// =====================================================================
const masterKeyBytes = crypto.createHash('sha256')
    .update(String(process.env.MASTER_KEY || process.env.JWT_SECRET || 'dev-master-key'))
    .digest();

function wrapKey(plain) {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', masterKeyBytes, iv);
    const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
    return `${iv.toString('hex')}:${enc.toString('hex')}:${c.getAuthTag().toString('hex')}`;
}
function unwrapKey(blob) {
    try {
        const [ivH, dataH, tagH] = String(blob).split(':');
        const d = crypto.createDecipheriv('aes-256-gcm', masterKeyBytes, Buffer.from(ivH, 'hex'));
        d.setAuthTag(Buffer.from(tagH, 'hex'));
        return Buffer.concat([d.update(Buffer.from(dataH, 'hex')), d.final()]).toString('utf8');
    } catch { return null; }
}

// Danh mục tài liệu toàn hệ thống — chỉ nhân sự được cấp quyền mới đọc;
// khách rank 0 có JWT nhưng gọi thẳng bằng DevTools cũng bị 403
app.get('/api/batches', requireAuth, requireViewer, async (req, res) => {
    try {
        const batches = await Batch.find();
        res.json(batches);
    } catch (error) {
        res.status(500).json({ message: "Lỗi lấy dữ liệu lô" });
    }
});

app.post('/api/batches', requireAuth, requireRole('NHẬP LIỆU'), async (req, res) => {
    try {
        const { batchId, merkleRoot, ipfsCID, txHash, files } = req.body || {};
        if (typeof batchId !== 'string' || !batchId.trim()) {
            return res.status(400).json({ success: false, message: 'Thiếu batchId hợp lệ' });
        }
        // Whitelist từng field của file — chặn client nhúng sẵn isRevoked/revokedBy giả
        const safeFiles = Array.isArray(files) ? files.map(f => ({
            docId: f && f.docId, fileHash: f && f.fileHash, ipfsCID: f && f.ipfsCID,
            fileName: f && f.fileName, fileSize: f && f.fileSize, qrCode: f && f.qrCode,
            visibility: ['public', 'private'].includes(f && f.visibility) ? f.visibility : 'private',
            // AES key do user nhập — bọc bằng MASTER_KEY trước khi ghi DB
            encKey: f && f.encKey ? wrapKey(f.encKey) : undefined
        })) : [];
        // Retry an toàn: batchId đã tồn tại (VD: bản ghi phục hồi từ manifest
        // thiếu encKey) → merge field CÒN THIẾU của file trùng docId thay vì 409.
        // Không ghi đè dữ liệu có sẵn — chỉ bổ sung chỗ trống
        const existing = await Batch.findOne({ batchId });
        if (existing) {
            let changed = false;
            // Bản ghi phục hồi có thể thiếu chủ sở hữu — khi chủ ví thật retry
            // lô mồ côi, gán lại theo chủ JWT
            if (!existing.uploader || existing.uploader === 'unknown') {
                existing.uploader = req.user.address; changed = true;
            }
            for (const nf of safeFiles) {
                const ef = existing.files.find(x => x.docId === nf.docId);
                if (!ef) { existing.files.push(nf); changed = true; continue; }
                for (const k of ['fileHash', 'ipfsCID', 'fileName', 'fileSize', 'qrCode', 'visibility', 'encKey']) {
                    if (!ef[k] && nf[k]) { ef[k] = nf[k]; changed = true; }
                }
            }
            if (changed) await existing.save();
            return res.json({ success: true, merged: changed, batch: existing });
        }
        const newBatch = new Batch({
            batchId, merkleRoot, ipfsCID, txHash, files: safeFiles,
            uploader: req.user.address // lấy từ JWT — chống giả mạo uploader
        });
        await newBatch.save();
        res.status(201).json(newBatch);
    } catch (error) {
        if (error.code === 11000) return res.status(409).json({ success: false, message: 'batchId đã tồn tại' });
        if (error.name === 'ValidationError') return res.status(400).json({ success: false, message: error.message });
        res.status(500).json({ success: false, message: "Lỗi lưu lô mới" });
    }
});

// Trạng thái thu hồi theo MongoDB — public (thông tin này đã public trên chain)
// để verify đối chiếu 2 nguồn, bắt được cả bản ghi thu hồi off-chain cũ.
app.get('/api/documents/:docId/status', async (req, res) => {
    try {
        const docId = req.params.docId;
        if (!/^[\w.\-]{1,300}$/.test(docId)) {
            return res.status(400).json({ success: false, message: 'docId không hợp lệ' });
        }
        const batch = await Batch.findOne({ "files.docId": docId }).lean();
        const file = batch && batch.files.find(f => f.docId === docId);
        res.json({
            success: true,
            isRevoked: !!(file && file.isRevoked),
            revocationReason: file ? (file.revocationReason || '') : null,
            visibility: (file && file.visibility) || 'private',
            uploader: batch ? (batch.uploader || '') : ''
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Lỗi truy vấn trạng thái' });
    }
});

// Trả khóa giải mã cho người được phép: uploader của lô, hoặc role >= QUẢN LÝ
app.get('/api/documents/:docId/key', requireAuth, async (req, res) => {
    try {
        const docId = req.params.docId;
        if (!/^[\w.\-]{1,300}$/.test(docId)) {
            return res.status(400).json({ success: false, message: 'docId không hợp lệ' });
        }
        const batch = await Batch.findOne({ "files.docId": docId }).lean();
        const file = batch && batch.files.find(f => f.docId === docId);
        if (!file) return res.status(404).json({ success: false, message: 'Không tìm thấy tài liệu' });

        // public: ví đã đăng nhập nào cũng lấy được khóa.
        // private: chỉ uploader hoặc ADMIN (rank 3) — QUẢN LÝ không mở được tài liệu riêng tư.
        const isUploader = String(batch.uploader || '').toLowerCase() === req.user.address;
        if (!isUploader && (file.visibility || 'private') !== 'public') {
            const rank = await getRoleRank(req.user.address);
            if (rank < 3) return res.status(403).json({ success: false, message: 'Tài liệu riêng tư — chỉ người tải lên và Admin được mở' });
        }
        if (!file.encKey) {
            return res.status(404).json({ success: false, message: 'Tài liệu không có khóa lưu trữ (upload trước khi có tính năng này)' });
        }
        const key = unwrapKey(file.encKey);
        if (key === null) return res.status(500).json({ success: false, message: 'Không giải được khóa lưu trữ' });
        res.json({ success: true, key });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Lỗi lấy khóa giải mã' });
    }
});

app.post('/api/batches/revoke', requireAuth, requireRole('QUẢN LÝ'), async (req, res) => {
    try {
        const { docId, reason } = req.body || {};
        if (typeof docId !== 'string' || !docId.trim()) {
            return res.status(400).json({ success: false, message: 'Thiếu docId hợp lệ' });
        }
        const batch = await Batch.findOne({ "files.docId": docId });
        if (!batch) return res.status(404).json({ success: false, message: 'Không tìm thấy tài liệu' });

        const file = batch.files.find(f => f.docId === docId);
        if (!file) return res.status(404).json({ success: false, message: 'Không tìm thấy tài liệu trong lô' });
        if (file.isRevoked) return res.status(409).json({ success: false, message: 'Tài liệu đã bị thu hồi trước đó' });

        // Tài liệu của ví ADMIN chỉ ADMIN được thu hồi — chặn lớp 2 (lớp 1 nằm trên contract)
        const uploaderRank = await getRoleRank(batch.uploader);
        const callerRank = await getRoleRank(req.user.address);
        if (uploaderRank === 3 && callerRank < 3) {
            return res.status(403).json({ success: false, message: 'Quản lý không được thu hồi tài liệu của Admin' });
        }

        file.isRevoked = true;
        file.revocationReason = reason || '';
        file.revokedBy = req.user.address; // lấy từ JWT — chống giả mạo người ra lệnh
        file.revokedAt = Date.now();
        await batch.save();

        // Thông báo cho ví chủ sở hữu khi NGƯỜI KHÁC (quản lý/admin) thu hồi tài liệu của họ
        const uploaderAddr = String(batch.uploader || '').toLowerCase();
        if (uploaderAddr && uploaderAddr !== req.user.address) {
            try {
                await Notification.create({
                    address: uploaderAddr, type: 'doc_revoked',
                    title: 'Tài liệu của bạn đã bị thu hồi',
                    message: `Tài liệu "${file.fileName || docId}" (ID: ${docId}) đã bị thu hồi bởi ${req.user.address}. Lý do: ${reason || 'Không ghi'}`,
                    meta: { docId, fileName: file.fileName, reason: reason || '', revokedBy: req.user.address }
                });
            } catch (e) { console.warn('[NOTIF] Lỗi tạo thông báo thu hồi:', e.message); }
        }

        // Hoàn trả dung lượng cho ví uploader — server tự tính, không tin client
        try {
            let sizeMB = 0.05;
            if (file.fileSize) {
                if (file.fileSize.includes('MB')) sizeMB = parseFloat(file.fileSize);
                else if (file.fileSize.includes('KB')) sizeMB = parseFloat(file.fileSize) / 1024;
                if (!isFinite(sizeMB) || sizeMB <= 0) sizeMB = 0.05;
            }
            const upAddr = String(batch.uploader || '').toLowerCase();
            const uw = await Wallet.findOne({ address: upAddr });
            if (uw) {
                uw.storageUsed = Math.max(0, Number(((uw.storageUsed || 0) - sizeMB).toFixed(2)));
                await uw.save();
            }
        } catch (e) {
            console.warn('[REVOKE] Không trừ được dung lượng ví uploader:', e.message);
        }

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: "Lỗi thu hồi tài liệu" });
    }
});

// =====================================================================
// THÔNG BÁO & PHIÊN ĐĂNG NHẬP THEO THIẾT BỊ
// =====================================================================
app.get('/api/notifications', requireAuth, async (req, res) => {
    try {
        const list = await Notification.find({ address: req.user.address })
            .sort({ createdAt: -1 }).limit(50).lean();
        const unread = list.filter(n => !n.read).length;
        res.json({ success: true, notifications: list, unread });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Lỗi lấy thông báo' });
    }
});

app.post('/api/notifications/read', requireAuth, async (req, res) => {
    try {
        await Notification.updateMany({ address: req.user.address, read: false }, { $set: { read: true } });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Lỗi đánh dấu đã đọc' });
    }
});

// Danh sách thiết bị đang giữ phiên đăng nhập của ví này (gồm cả pending chờ duyệt)
app.get('/api/sessions', requireAuth, async (req, res) => {
    try {
        const sessions = await DeviceSession.find({
            address: req.user.address,
            revoked: { $ne: true }, status: { $ne: 'revoked' }
        }).sort({ lastSeen: -1 }).lean();
        res.json({
            success: true,
            sessions: sessions.map(s => ({
                deviceId: s.deviceId, deviceLabel: s.deviceLabel,
                ip: s.ip || '', userAgent: s.userAgent || '',
                createdAt: s.createdAt, lastSeen: s.lastSeen,
                status: s.revoked === true ? 'revoked' : (s.status || 'active'),
                current: s.deviceId === req.user.dev
            }))
        });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Lỗi lấy danh sách phiên' });
    }
});

// Phê duyệt một thiết bị đang pending — chỉ từ thiết bị đang active của cùng ví
app.post('/api/sessions/approve', requireAuth, async (req, res) => {
    try {
        const { deviceId } = req.body || {};
        if (typeof deviceId !== 'string' || !/^[a-z0-9_-]{8,64}$/i.test(deviceId)) {
            return res.status(400).json({ success: false, message: 'Thiếu deviceId hợp lệ' });
        }
        const r = await DeviceSession.findOneAndUpdate(
            { address: req.user.address, deviceId, status: 'pending' },
            { $set: { status: 'active', revoked: false, lastSeen: Date.now() } },
            { returnDocument: 'after' }
        );
        if (!r) return res.status(404).json({ success: false, message: 'Không tìm thấy phiên chờ duyệt' });
        try {
            await Notification.create({
                address: req.user.address, type: 'device_approved',
                title: 'Thiết bị đã được phê duyệt',
                message: `Thiết bị "${r.deviceLabel || deviceId}" đã được bạn phê duyệt đăng nhập.`,
                meta: { deviceId }
            });
        } catch (e) {}
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Lỗi phê duyệt thiết bị' });
    }
});

// Kick/từ chối một thiết bị — JWT của thiết bị đó sẽ bị requireAuth từ chối từ request kế tiếp
app.post('/api/sessions/revoke', requireAuth, async (req, res) => {
    try {
        const { deviceId } = req.body || {};
        if (typeof deviceId !== 'string' || !/^[a-z0-9_-]{8,64}$/i.test(deviceId)) {
            return res.status(400).json({ success: false, message: 'Thiếu deviceId hợp lệ' });
        }
        const r = await DeviceSession.findOneAndUpdate(
            { address: req.user.address, deviceId },
            { $set: { status: 'revoked', revoked: true } }
        );
        if (!r) return res.status(404).json({ success: false, message: 'Không tìm thấy phiên' });

        if (deviceId !== req.user.dev) {
            try {
                await Notification.create({
                    address: req.user.address, type: 'session_revoked',
                    title: 'Đã thu hồi một phiên đăng nhập',
                    message: `Phiên trên thiết bị "${r.deviceLabel || deviceId}" đã bị bạn thu hồi.`,
                    meta: { deviceId }
                });
            } catch (e) {}
        }
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Lỗi thu hồi phiên' });
    }
});

// =====================================================================
// PARTNER API (B2B) — đối tác (trường/bệnh viện) gọi server-to-server
// bằng header x-api-key, không cần MetaMask/JWT.
// Server tự mã hóa AES, pin IPFS và ký giao dịch on-chain bằng PRIVATE_KEY.
// =====================================================================

// Contract có quyền ghi — ký bằng ví deploy (PRIVATE_KEY). Lazy init.
let chainWriter = null;
function getChainWriter() {
    if (!chainWriter) {
        if (!process.env.PRIVATE_KEY) throw new Error('Server chưa cấu hình PRIVATE_KEY — không ký được giao dịch');
        const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
        chainWriter = new ethers.Contract(CONTRACT_ADDRESS, [
            "function addDocuments(string[] _documentIds, string[] _fileHashes, string[] _ipfsURIs)"
        ], signer);
    }
    return chainWriter;
}

// Rate limit mềm theo key: 60 req/phút — in-memory, đủ cho demo/tích hợp nhẹ
const apiKeyHits = new Map(); // keyId -> { count, resetAt }
async function requireApiKey(req, res, next) {
    try {
        const token = req.get('x-api-key') || '';
        if (!/^sk_live_[a-zA-Z0-9]{16,64}$/.test(token)) {
            return res.status(401).json({ success: false, message: 'Thiếu hoặc sai định dạng header x-api-key' });
        }
        const keyHash = crypto.createHash('sha256').update(token).digest('hex');
        const key = await ApiKey.findOne({ keyHash, revoked: false }).lean();
        if (!key) return res.status(401).json({ success: false, message: 'API key không hợp lệ hoặc đã bị thu hồi' });

        const now = Date.now();
        let bucket = apiKeyHits.get(String(key._id));
        if (!bucket || now > bucket.resetAt) {
            bucket = { count: 0, resetAt: now + 60000 };
            apiKeyHits.set(String(key._id), bucket);
        }
        if (++bucket.count > 60) {
            return res.status(429).json({ success: false, message: 'Quá giới hạn 60 request/phút cho API key này' });
        }

        req.apiKey = key;
        ApiKey.updateOne({ _id: key._id }, { $set: { lastUsedAt: new Date() } }).catch(() => {});
        next();
    } catch (e) {
        res.status(500).json({ success: false, message: 'Lỗi xác thực API key' });
    }
}

// Upload tài liệu: file plaintext → server mã hóa AES → IPFS → ghi on-chain → lưu DB
app.post('/api/v1/documents', requireApiKey, uploadSingle('document'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: 'Thiếu file (field "document")' });

        const fileHash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
        const safeFileName = (req.file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '') || 'file').substring(0, 100);
        const documentId = `${safeFileName}_${Date.now()}`;

        // Mã hóa AES giống luồng web: CryptoJS.AES.encrypt(base64(bytes), passphrase)
        const secretKey = crypto.randomBytes(24).toString('hex');
        const encryptedText = CryptoJS.AES.encrypt(req.file.buffer.toString('base64'), secretKey).toString();

        // File đối tác cũng nằm trên cùng tài khoản Pinata → trừ vào quota chung 1GB
        if (!await checkIpfsQuota(res, Buffer.byteLength(encryptedText, 'utf8'))) return;

        let ipfsCID = "";
        try {
            const formData = new FormData();
            formData.append('file', Buffer.from(encryptedText, 'utf8'), { filename: safeFileName + '.enc' });
            const pinataResponse = await axios.post("https://api.pinata.cloud/pinning/pinFileToIPFS", formData, {
                maxBodyLength: "Infinity",
                headers: {
                    'Content-Type': `multipart/form-data; boundary=${formData._boundary}`,
                    'pinata_api_key': process.env.PINATA_API_KEY,
                    'pinata_secret_api_key': process.env.PINATA_API_SECRET,
                }
            });
            ipfsCID = pinataResponse.data.IpfsHash;
        } catch (ipfsErr) {
            const detail = ipfsErr.response?.data?.error?.reason || ipfsErr.response?.data?.error?.details || ipfsErr.message;
            return res.status(500).json({ success: false, message: `Lỗi tải lên IPFS: ${detail}` });
        }

        let txHash = '';
        try {
            const tx = await getChainWriter().addDocuments([documentId], [fileHash], [`ipfs://${ipfsCID}`]);
            const receipt = await tx.wait();
            txHash = receipt.hash;
        } catch (chainErr) {
            console.error('[PARTNER] Ghi on-chain lỗi:', chainErr.message);
            return res.status(502).json({ success: false, message: `File đã lên IPFS nhưng ghi blockchain thất bại: ${chainErr.message}` });
        }

        await PartnerDocument.create({
            docId: documentId, apiKeyId: req.apiKey._id, orgName: req.apiKey.name,
            fileName: req.file.originalname, fileHash, fileSize: req.file.size,
            ipfsCID, encKey: wrapKey(secretKey), txHash
        });

        res.json({ success: true, documentId, fileHash, ipfsCID, txHash });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Lỗi upload đối tác', error: error.message });
    }
});

// Verify: gửi file + documentId → so hash với bản ghi on-chain (giống /api/verify, gọn hơn)
app.post('/api/v1/verify', requireApiKey, uploadSingle('document'), async (req, res) => {
    try {
        if (!req.file || !req.body.documentId) return res.status(400).json({ success: false, message: 'Thiếu file hoặc documentId' });
        const documentId = req.body.documentId;
        if (typeof documentId !== 'string' || !/^[\w.\-]{1,300}$/.test(documentId)) {
            return res.status(400).json({ success: false, message: 'documentId không hợp lệ' });
        }
        const currentFileHash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
        const [originalHash, ipfsURI, timestamp, uploader, isRevoked, revocationReason] = await getChainContract().getDocument(documentId);
        res.json({
            success: true,
            match: currentFileHash === originalHash,
            documentId, isRevoked,
            timestamp: Number(timestamp) * 1000
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Lỗi xác thực', error: error.message });
    }
});

// Liệt kê chỉ tài liệu do chính API key này upload — không trả encKey
app.get('/api/v1/documents', requireApiKey, async (req, res) => {
    try {
        const docs = await PartnerDocument.find({ apiKeyId: req.apiKey._id })
            .select('docId fileName fileHash fileSize ipfsCID txHash isRevoked createdAt')
            .sort({ createdAt: -1 }).lean();
        res.json({ success: true, documents: docs });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Lỗi lấy danh sách tài liệu' });
    }
});

// Tải file gốc đã giải mã — chỉ cho tài liệu thuộc key này
app.get('/api/v1/documents/:docId/download', requireApiKey, async (req, res) => {
    try {
        const docId = req.params.docId;
        if (!/^[\w.\-]{1,300}$/.test(docId)) return res.status(400).json({ success: false, message: 'docId không hợp lệ' });
        const doc = await PartnerDocument.findOne({ docId, apiKeyId: req.apiKey._id });
        if (!doc) return res.status(404).json({ success: false, message: 'Không tìm thấy tài liệu của đối tác này' });
        const secretKey = doc.encKey ? unwrapKey(doc.encKey) : null;
        if (!secretKey) return res.status(500).json({ success: false, message: 'Không giải được khóa lưu trữ' });

        const cid = doc.ipfsCID;
        let text = null;
        // Ưu tiên gateway Pinata riêng của tài khoản + gateway.pinata.cloud — ipfs.io hay bị 429
        for (const gw of [
            `https://azure-above-donkey-104.mypinata.cloud/ipfs/${cid}`,
            `https://gateway.pinata.cloud/ipfs/${cid}`,
            `https://ipfs.io/ipfs/${cid}`,
            `https://cloudflare-ipfs.com/ipfs/${cid}`
        ]) {
            try {
                const r = await axios.get(gw, { timeout: 20000, responseType: 'text' });
                if (r.data) { text = r.data; break; }
            } catch (e) {}
        }
        if (!text) return res.status(502).json({ success: false, message: 'Không tải được file từ IPFS gateway' });

        const decrypted = CryptoJS.AES.decrypt(text, secretKey).toString(CryptoJS.enc.Utf8); // base64 gốc
        const buf = Buffer.from(decrypted, 'base64');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(doc.fileName || docId)}"`);
        res.setHeader('Content-Type', 'application/octet-stream');
        res.send(buf);
    } catch (e) {
        res.status(500).json({ success: false, message: 'Lỗi tải tài liệu' });
    }
});

// ---- Quản trị API keys (JWT + ADMIN) ----
app.post('/api/apikeys', requireAuth, requireRole('ADMIN'), async (req, res) => {
    try {
        const name = String(req.body?.name || '').trim();
        if (!name || name.length > 80) return res.status(400).json({ success: false, message: 'Tên đối tác không hợp lệ (1-80 ký tự)' });
        const token = 'sk_live_' + crypto.randomBytes(24).toString('hex');
        const keyHash = crypto.createHash('sha256').update(token).digest('hex');
        const doc = await ApiKey.create({ name, keyHash, prefix: token.slice(0, 14), createdBy: req.user.address });
        // token chỉ trả về ĐÚNG 1 LẦN — server không lưu plaintext
        res.status(201).json({ success: true, apiKey: { id: doc._id, name: doc.name, prefix: doc.prefix, createdAt: doc.createdAt }, token });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Lỗi tạo API key' });
    }
});

app.get('/api/apikeys', requireAuth, requireRole('ADMIN'), async (req, res) => {
    try {
        const keys = await ApiKey.find().select('name prefix revoked lastUsedAt createdAt').sort({ createdAt: -1 }).lean();
        res.json({ success: true, keys });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Lỗi lấy danh sách API key' });
    }
});

app.post('/api/apikeys/:id/revoke', requireAuth, requireRole('ADMIN'), async (req, res) => {
    try {
        const r = await ApiKey.findByIdAndUpdate(req.params.id, { $set: { revoked: true } });
        if (!r) return res.status(404).json({ success: false, message: 'Không tìm thấy API key' });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Lỗi thu hồi API key' });
    }
});

// =====================================================================
// PHỤC VỤ FRONTEND TĨNH — chỉ index.html + thư mục assets (KHÔNG serve
// thư mục gốc vì sẽ lộ .env, server.js, node_modules).
// Nhờ vậy backend + frontend cùng 1 cổng → expose ra ngoài chỉ cần 1 tunnel.
// =====================================================================
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.listen(port, () => {
    console.log(`🚀 Server backend (API + xác thực) chạy tại cổng ${port}`);
});