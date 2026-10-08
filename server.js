import express from 'express';
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
import Wallet from './models/Wallet.js';
import Batch from './models/Batch.js';

// --- BỔ SUNG LỚP 1: Import thư viện AI ---
import { GoogleGenAI } from '@google/genai';

const app = express();
const port = process.env.PORT || 3000;
app.use(cors());
app.use(express.json({ limit: '5mb' }));

// --- BỔ SUNG LỚP 2: Khởi tạo AI & Cấu hình Phòng thủ ---
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const blacklistedIPs = new Set(); // Bộ nhớ tạm lưu các IP bị cấm

const upload = multer({ storage: multer.memoryStorage() });

// Middleware chặn toàn cục các IP đã vào Blacklist (Cơ chế Fail2Ban)
app.use((req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress;
    if (blacklistedIPs.has(ip)) {
        return res.status(403).json({ success: false, message: '🚨 IP của bạn đã bị khóa vĩnh viễn do hành vi tấn công!' });
    }
    next();
});

// Giới hạn chung cho toàn bộ API (nhẹ nhàng)
const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 50 });
app.use('/api/', apiLimiter);

const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
// Khai báo trực tiếp ABI để Server độc lập hoàn toàn, không phụ thuộc vào Hardhat
const abi = [
    "function getDocument(string _documentId) view returns (string fileHash, string ipfsURI, uint256 timestamp, address uploader, bool isRevoked, string revocationReason)"
];

const ipfsMockStorage = new Map(); 

// =====================================================================
// API 1: UPLOAD (CHỈ LƯU IPFS PINATA - TRẢ ID VỀ CHO FRONTEND KÝ)
// =====================================================================
app.post('/api/upload', upload.single('document'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: 'Vui lòng tải lên tài liệu!' });

        const hash = crypto.createHash('sha256');
        hash.update(req.file.buffer);
        const fileHash = hash.digest('hex');

        const safeFileName = req.file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '');
        const documentId = `${safeFileName}_${Date.now()}`;

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
            console.error("Lỗi khi tải lên IPFS:", ipfsErr.response ? ipfsErr.response.data : ipfsErr.message);
            return res.status(500).json({ success: false, message: 'Lỗi tải lên IPFS' });
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
    max: 5, // Tối đa 5 lần thử xác thực
    handler: async (req, res) => {
        const ip = req.ip || req.connection.remoteAddress;
        if (!blacklistedIPs.has(ip)) {
            blacklistedIPs.add(ip); // Cho vào danh sách đen
            
            // Bắn tên lửa báo động về Telegram
            const msg = `🚨 <b>BÁO ĐỘNG HỆ THỐNG PHÒNG THỦ</b> 🚨\n-----------------------------------\n<b>Phát hiện IP:</b> <code>${ip}</code>\n<b>Hành vi:</b> Spam dò tìm mã băm / Brute-force hệ thống giám định giả mạo.\n<b>Trạng thái:</b> Hệ thống đã tự động kích hoạt Blacklist và chặn truy cập 24h!`;
            
            if (TELEGRAM_TOKEN && TELEGRAM_CHAT_ID) {
                axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, { 
                    chat_id: TELEGRAM_CHAT_ID, text: msg, parse_mode: 'HTML' 
                }).catch(e => console.log('Lỗi gửi Telegram:', e.message));
            }
        }
        res.status(429).json({ success: false, message: "Thao tác quá nhiều. IP đã bị khóa!" });
    }
});

// =====================================================================
// API 2: VERIFY (XÁC THỰC & TẢI FILE TỪ IPFS ĐỂ VẼ BẢN ĐỒ NHIỆT)
// =====================================================================
// Gắn verifyLimiter vào API này
app.post('/api/verify', verifyLimiter, upload.single('document'), async (req, res) => {
    try {
        if (!req.file || !req.body.documentId) return res.status(400).json({ success: false, message: 'Thiếu dữ liệu!' });
        
        const documentId = req.body.documentId;
        const currentBuffer = req.file.buffer; 
        
        const hash = crypto.createHash('sha256');
        hash.update(currentBuffer);
        const currentFileHash = hash.digest('hex');

        const contract = new ethers.Contract(CONTRACT_ADDRESS, abi, provider); 
        const [originalHash, ipfsURI, timestamp, uploader] = await contract.getDocument(documentId);

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
            isMatch, currentFileHash, originalHash,
            differences: textDifferences, 
            imageDiff: imageDiffBase64, 
            aiReport: aiForensicReport, // Bổ sung key này để đẩy lên Frontend
            message: isMatch ? 'TÀI LIỆU NGUYÊN VẸN' : 'PHÁT HIỆN GIẢ MẠO'
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

app.get('/api/wallets', async (req, res) => {
    try {
        const wallets = await Wallet.find({ status: { $ne: 'DELETED' } }); 
        res.json(wallets);
    } catch (error) {
        res.status(500).json({ message: "Lỗi máy chủ khi lấy dữ liệu ví", error });
    }
});

app.post('/api/wallets/sync', async (req, res) => {
    try {
        const { address, ...updateData } = req.body;
        if (!address) return res.status(400).json({ message: "Bắt buộc phải có địa chỉ ví" });
        const updatedWallet = await Wallet.findOneAndUpdate(
            { address: address.toLowerCase() },
            { $set: updateData },
            { new: true, upsert: true }
        );
        res.json(updatedWallet);
    } catch (error) {
        res.status(500).json({ message: "Lỗi khi đồng bộ ví vào Database", error });
    }
});

app.get('/api/batches', async (req, res) => {
    try {
        const batches = await Batch.find();
        res.json(batches);
    } catch (error) {
        res.status(500).json({ message: "Lỗi lấy dữ liệu lô" });
    }
});

app.post('/api/batches', async (req, res) => {
    try {
        const newBatch = new Batch(req.body);
        await newBatch.save();
        res.json(newBatch);
    } catch (error) {
        res.status(500).json({ message: "Lỗi lưu lô mới" });
    }
});

app.post('/api/batches/revoke', async (req, res) => {
    try {
        const { docId, reason, revokedBy } = req.body;
        const batch = await Batch.findOne({ "files.docId": docId });
        if (batch) {
            const file = batch.files.find(f => f.docId === docId);
            if (file) {
                file.isRevoked = true;
                file.revocationReason = reason;
                file.revokedBy = revokedBy;
                file.revokedAt = Date.now();
                await batch.save();
            }
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ message: "Lỗi thu hồi tài liệu" });
    }
});

app.listen(port, () => console.log(`🚀 Server Backend (Gộp S1+S2) chạy tại cổng ${port}`));