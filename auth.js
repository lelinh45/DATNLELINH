import express from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { ethers } from 'ethers';

// =====================================================================
// MODULE XÁC THỰC & PHÂN QUYỀN (Wallet Signature → JWT)
// Luồng: GET /challenge → client ký bằng MetaMask → POST /login → JWT 24h
// =====================================================================

const CHALLENGE_TTL_MS = 5 * 60 * 1000; // challenge sống 5 phút
const TOKEN_TTL = '24h';

// Băm OTP bằng scrypt + salt ngẫu nhiên — OTP chỉ 6 số (entropy ~20 bit),
// SHA-256 thuần bị brute-force tức thì nếu DB lộ; scrypt làm mỗi lần dò ~50ms.
// Dùng bản async để không chặn event loop của server.
const scryptAsync = promisify(crypto.scrypt);
async function hashOtp(code) {
    const salt = crypto.randomBytes(16);
    const dk = await scryptAsync(String(code), salt, 32);
    return salt.toString('hex') + ':' + dk.toString('hex');
}
async function verifyOtpHash(code, stored) {
    try {
        const [s, h] = String(stored).split(':');
        const calc = await scryptAsync(String(code).trim(), Buffer.from(s, 'hex'), 32);
        const expect = Buffer.from(h, 'hex');
        return calc.length === expect.length && crypto.timingSafeEqual(calc, expect);
    } catch { return false; }
}

// Bảng xếp hạng quyền: on-chain (0-3) và DB map về cùng thang
const ROLE_RANK = {
    'NONE': 0, 'BỊ KHÓA': 0, 'ĐÃ XÓA': 0,
    'NHẬP LIỆU': 1, 'QUẢN LÝ': 2, 'ADMIN': 3,
};

const OTP_TTL_MS = 5 * 60 * 1000;   // OTP sống 5 phút
const OTP_RESEND_MS = 60 * 1000;    // tối thiểu 60s giữa 2 lần gửi
const OTP_MAX_ATTEMPTS = 5;

export function createAuth({ walletModel, jwtSecret, roleProvider, challengeTtlMs = CHALLENGE_TTL_MS, challengeStore, sessionModel, notificationModel, mailer }) {
    // roleProvider: async (addressLowercase) => 0..3 — thường là contract.userRoles(address)
    const router = express.Router();

    // challengeStore: { set(address, {challenge, expiresAt}), get(address), delete(address) }
    // Mặc định RAM (dùng cho test); production truyền store MongoDB để sống qua restart
    const memChallenges = new Map();
    const store = challengeStore || {
        set: async (addr, v) => { memChallenges.set(addr, v); },
        get: async (addr) => memChallenges.get(addr) || null,
        delete: async (addr) => { memChallenges.delete(addr); },
    };

    // Trả về hạng quyền 0..3 của một địa chỉ ví
    async function getRoleRank(address) {
        const addr = String(address).toLowerCase();

        // Ví bị khóa/xóa trong DB luôn mất quyền, kể cả khi chain còn role cũ
        const w = walletModel ? await walletModel.findOne({ address: addr }) : null;
        if (w && w.status && w.status !== 'ACTIVE') return 0;

        if (roleProvider) {
            try {
                return Math.max(0, Math.min(3, Number(await roleProvider(addr))));
            } catch (e) {
                console.warn('[AUTH] roleProvider lỗi, fallback qua MongoDB:', e.message);
            }
        }
        if (!w) return 0;
        // Fallback qua DB chỉ tin role DO ADMIN GÁN (roleGranted) — ví tự tạo có
        // role mặc định 'NHẬP LIỆU'; nếu tin mặc định thì ví chờ duyệt sẽ được
        // rank 1 mỗi khi RPC lỗi → lỗ hổng leo quyền + rơi khỏi khay chờ duyệt
        if (!w.roleGranted) return 0;
        return ROLE_RANK[w.role] ?? 0;
    }

    // ---- BƯỚC 1: Cấp challenge ----
    router.get('/challenge', async (req, res) => {
        try {
            const address = String(req.query.address || '').toLowerCase();
            if (!/^0x[a-f0-9]{40}$/.test(address)) {
                return res.status(400).json({ success: false, message: 'Địa chỉ ví không hợp lệ' });
            }
            const nonce = crypto.randomBytes(16).toString('hex');
            const challenge = `DANG NHAP HE THONG BDI\nDia chi vi: ${address}\nNonce: ${nonce}`;
            await store.set(address, { challenge, expiresAt: Date.now() + challengeTtlMs });
            res.json({ success: true, challenge });
        } catch (e) {
            res.status(500).json({ success: false, message: 'Lỗi tạo challenge' });
        }
    });

    // ---- BƯỚC 2: Đăng nhập bằng chữ ký ----
    router.post('/login', async (req, res) => {
        try {
            if (!jwtSecret) {
                return res.status(500).json({ success: false, message: 'Server chưa cấu hình JWT_SECRET' });
            }
            const { address, signature, challenge, deviceId, deviceLabel } = req.body || {};
            if (typeof address !== 'string' || typeof signature !== 'string' || typeof challenge !== 'string') {
                return res.status(400).json({ success: false, message: 'Thiếu dữ liệu đăng nhập' });
            }

            const key = address.toLowerCase();
            const pending = await store.get(key);
            if (!pending || pending.expiresAt < Date.now() || pending.challenge !== challenge) {
                return res.status(401).json({ success: false, message: 'Challenge không hợp lệ hoặc đã hết hạn' });
            }

            let recovered;
            try {
                recovered = ethers.verifyMessage(challenge, signature);
            } catch {
                return res.status(401).json({ success: false, message: 'Chữ ký không hợp lệ' });
            }
            if (recovered.toLowerCase() !== key) {
                return res.status(401).json({ success: false, message: 'Chữ ký không khớp địa chỉ ví' });
            }

            await store.delete(key); // challenge chỉ dùng 1 lần

            // Ghi nhận phiên theo thiết bị — deviceId hợp lệ mới được đưa vào JWT claim 'dev'.
            // Thiết bị MỚI (khi ví còn phiên active khác) → status 'pending', từ chối cấp JWT
            // cho tới khi được duyệt từ thiết bị cũ hoặc xác nhận OTP email.
            const dev = (typeof deviceId === 'string' && /^[a-z0-9_-]{8,64}$/i.test(deviceId)) ? deviceId : null;
            if (dev && sessionModel) {
                try {
                    const label = (typeof deviceLabel === 'string' ? deviceLabel : '').slice(0, 120) || 'Thiết bị không rõ';
                    const existing = await sessionModel.findOne({ address: key, deviceId: dev });
                    // status undefined = phiên tạo trước khi có cơ chế duyệt → coi như active
                    const isActive = (s) => s && s.status !== 'pending' && s.status !== 'revoked' && s.revoked !== true;
                    const activeCount = await sessionModel.countDocuments({
                        address: key, status: { $nin: ['pending', 'revoked'] }, revoked: { $ne: true }
                    });

                    const denyPending = async () => {
                        // Cô lập notification trong try riêng — lỗi ghi thông báo KHÔNG được
                        // làm rơi xuống catch ngoài rồi chạy tiếp xuống cấp JWT (fail-open)
                        try {
                            if (notificationModel) {
                                await notificationModel.create({
                                    address: key, type: 'device_pending',
                                    title: 'Thiết bị mới chờ phê duyệt',
                                    message: `Thiết bị "${label}" vừa đăng nhập và đang chờ phê duyệt. Mở chuông thông báo để Phê duyệt hoặc Từ chối.`,
                                    meta: { deviceId: dev, deviceLabel: label }
                                });
                            }
                        } catch (e) { console.warn('[AUTH] Lỗi tạo thông báo pending:', e.message); }
                        return res.status(403).json({
                            success: false, code: 'DEVICE_PENDING', deviceId: dev,
                            message: 'Thiết bị mới cần được phê duyệt từ một thiết bị đã đăng nhập, hoặc xác nhận bằng mã OTP gửi về email chủ ví.'
                        });
                    };

                    if (activeCount === 0) {
                        // Không còn phiên nào hoạt động nhưng ví có email + SMTP → bắt OTP
                        // thay vì tự duyệt (OTP là đường cứu duy nhất khi không còn máy online)
                        const w = walletModel ? await walletModel.findOne({ address: key }).lean() : null;
                        if (mailer && mailer.sendOtp && w && w.email) {
                            await sessionModel.findOneAndUpdate(
                                { address: key, deviceId: dev },
                                { $set: { deviceLabel: label, status: 'pending', lastSeen: Date.now() }, $setOnInsert: { createdAt: Date.now() } },
                                { upsert: true }
                            );
                            return await denyPending();
                        }
                        // Thiết bị đầu tiên / không có email → tự duyệt để không khóa vĩnh viễn
                        const everLoggedIn = existing || await sessionModel.exists({ address: key });
                        await sessionModel.findOneAndUpdate(
                            { address: key, deviceId: dev },
                            { $set: { deviceLabel: label, status: 'active', lastSeen: Date.now() }, $setOnInsert: { createdAt: Date.now() } },
                            { upsert: true }
                        );
                        if (notificationModel) {
                            // Chưa từng có phiên → "phiên đầu tiên"; đã từng có nhưng đều bị thu hồi → cảnh báo thật
                            await notificationModel.create(everLoggedIn ? {
                                address: key, type: 'new_device',
                                title: 'Đăng nhập trên thiết bị mới',
                                message: `Ví của bạn vừa đăng nhập từ thiết bị: ${label} (các phiên trước đã hết/bị thu hồi nên tự động duyệt). Nếu không phải bạn, hãy thu hồi phiên đó ngay.`,
                                meta: { deviceId: dev, deviceLabel: label }
                            } : {
                                address: key, type: 'new_device',
                                title: 'Phiên đăng nhập đầu tiên được ghi nhận',
                                message: `Thiết bị "${label}" đã được tự động phê duyệt làm phiên đầu tiên của ví.`,
                                meta: { deviceId: dev, deviceLabel: label }
                            });
                        }
                    } else if (!existing || !isActive(existing)) {
                        // Thiết bị mới, hoặc phiên bị thu hồi/pending đăng nhập lại → chờ duyệt
                        if (!existing) {
                            await sessionModel.create({ address: key, deviceId: dev, deviceLabel: label, status: 'pending' });
                        } else {
                            existing.status = 'pending';
                            existing.deviceLabel = label;
                            existing.lastSeen = Date.now();
                            await existing.save();
                        }
                        return await denyPending();
                    } else {
                        existing.lastSeen = Date.now();
                        await existing.save();
                    }
                } catch (e) { console.warn('[AUTH] Lỗi ghi session thiết bị:', e.message); }
            }

            // Ví lần đầu tiên đăng nhập hệ thống (chưa có bản ghi wallet) → báo cho
            // mọi ví ADMIN để đặt tên + phân quyền, tránh "ví lạ trôi nổi" trong danh sách
            if (walletModel && notificationModel) {
                try {
                    const existed = await walletModel.exists({ address: key });
                    if (!existed) {
                        const admins = await walletModel.find({ role: 'ADMIN', status: 'ACTIVE' }).select('address').lean();
                        for (const a of admins) {
                            await notificationModel.create({
                                address: a.address, type: 'new_wallet',
                                title: 'Ví mới vừa đăng nhập lần đầu',
                                message: `Ví ${key} vừa đăng nhập hệ thống lần đầu. Hãy vào Quản Lý Quyền Ví để đặt tên và phân quyền cho ví này.`,
                                meta: { newAddress: key }
                            });
                        }
                    }
                } catch (e) { console.warn('[AUTH] Lỗi báo ví mới cho admin:', e.message); }
            }

            const payload = { address: key };
            if (dev) payload.dev = dev;
            const token = jwt.sign(payload, jwtSecret, { expiresIn: TOKEN_TTL });
            res.json({ success: true, token, address: key });
        } catch (e) {
            res.status(500).json({ success: false, message: 'Lỗi đăng nhập' });
        }
    });

    // ---- Thiết bị pending: poll trạng thái duyệt (public, không cần JWT) ----
    router.get('/pending', async (req, res) => {
        try {
            const address = String(req.query.address || '').toLowerCase();
            const deviceId = String(req.query.deviceId || '');
            if (!/^0x[a-f0-9]{40}$/.test(address) || !/^[a-z0-9_-]{8,64}$/i.test(deviceId) || !sessionModel) {
                return res.status(400).json({ success: false, message: 'Thiếu tham số hợp lệ' });
            }
            const s = await sessionModel.findOne({ address, deviceId }).lean();
            if (!s) return res.json({ success: true, status: 'unknown' });
            res.json({ success: true, status: s.revoked === true ? 'revoked' : (s.status || 'active') });
        } catch (e) {
            res.status(500).json({ success: false, message: 'Lỗi kiểm tra trạng thái' });
        }
    });

    // ---- Gửi mã OTP về email chủ ví cho thiết bị đang pending ----
    router.post('/request-otp', async (req, res) => {
        try {
            const { address, deviceId } = req.body || {};
            const key = String(address || '').toLowerCase();
            if (!/^0x[a-f0-9]{40}$/.test(key) || typeof deviceId !== 'string' || !sessionModel) {
                return res.status(400).json({ success: false, message: 'Thiếu dữ liệu hợp lệ' });
            }
            const sess = await sessionModel.findOne({ address: key, deviceId });
            if (!sess || sess.status !== 'pending') {
                return res.status(400).json({ success: false, message: 'Không có phiên chờ duyệt cho thiết bị này' });
            }
            // OTP chỉ là đường cứu khi KHÔNG còn thiết bị nào khác đang hoạt động —
            // còn máy active thì bắt buộc duyệt từ máy đó, tránh lạm dụng OTP
            const otherActive = await sessionModel.countDocuments({
                address: key, deviceId: { $ne: deviceId },
                status: { $nin: ['pending', 'revoked'] }, revoked: { $ne: true }
            });
            if (otherActive > 0) {
                return res.status(403).json({ success: false, code: 'OTP_BLOCKED', message: 'Ví còn thiết bị đang hoạt động — hãy phê duyệt từ thiết bị cũ qua chuông 🔔. OTP chỉ dùng khi không còn thiết bị nào khả dụng.' });
            }
            const w = walletModel ? await walletModel.findOne({ address: key }).lean() : null;
            if (!w || !w.email) {
                return res.status(400).json({ success: false, code: 'NO_EMAIL', message: 'Ví chưa đăng ký email — chỉ có thể duyệt từ thiết bị đã đăng nhập' });
            }
            if (!mailer || !mailer.sendOtp) {
                return res.status(400).json({ success: false, code: 'SMTP_MISSING', message: 'Server chưa cấu hình SMTP — chỉ có thể duyệt từ thiết bị đã đăng nhập' });
            }
            // Chặn spam gửi mail: tối thiểu OTP_RESEND_MS giữa 2 lần
            const lastSent = (sess.otpExpires || 0) - OTP_TTL_MS;
            if (Date.now() < lastSent + OTP_RESEND_MS) {
                return res.status(429).json({ success: false, message: 'Vừa gửi mã, vui lòng chờ 60 giây' });
            }
            const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
            sess.otpHash = await hashOtp(code);
            sess.otpExpires = Date.now() + OTP_TTL_MS;
            sess.otpAttempts = 0;
            await sess.save();
            await mailer.sendOtp(w.email, code, sess.deviceLabel);
            res.json({ success: true, maskedEmail: w.email.replace(/^(.{2}).+(@.+)$/, '$1***$2') });
        } catch (e) {
            console.warn('[AUTH] Lỗi gửi OTP:', e.message);
            res.status(500).json({ success: false, message: 'Không gửi được mã OTP' });
        }
    });

    // ---- Xác nhận OTP → duyệt thiết bị pending ----
    router.post('/verify-otp', async (req, res) => {
        try {
            const { address, deviceId, code } = req.body || {};
            const key = String(address || '').toLowerCase();
            if (!/^0x[a-f0-9]{40}$/.test(key) || typeof deviceId !== 'string' || typeof code !== 'string' || !sessionModel) {
                return res.status(400).json({ success: false, message: 'Thiếu dữ liệu hợp lệ' });
            }
            const sess = await sessionModel.findOne({ address: key, deviceId });
            if (!sess || sess.status !== 'pending' || !sess.otpHash || sess.otpExpires < Date.now()) {
                return res.status(400).json({ success: false, message: 'Mã không tồn tại hoặc đã hết hạn — hãy gửi lại' });
            }
            if ((sess.otpAttempts || 0) >= OTP_MAX_ATTEMPTS) {
                return res.status(429).json({ success: false, message: 'Nhập sai quá nhiều lần — hãy gửi lại mã mới' });
            }
            // Guard lần 2: lỡ giữa lúc gửi mã và nhập mã có thiết bị khác được duyệt → cũng chặn
            const otherActive = await sessionModel.countDocuments({
                address: key, deviceId: { $ne: deviceId },
                status: { $nin: ['pending', 'revoked'] }, revoked: { $ne: true }
            });
            if (otherActive > 0) {
                return res.status(403).json({ success: false, code: 'OTP_BLOCKED', message: 'Ví đã có thiết bị đang hoạt động — hãy phê duyệt từ thiết bị đó.' });
            }
            if (!await verifyOtpHash(code, sess.otpHash)) {
                sess.otpAttempts = (sess.otpAttempts || 0) + 1;
                await sess.save();
                return res.status(401).json({ success: false, message: 'Mã OTP không đúng' });
            }
            sess.status = 'active';
            sess.otpHash = '';
            sess.otpExpires = 0;
            await sess.save();
            if (notificationModel) {
                await notificationModel.create({
                    address: key, type: 'device_approved',
                    title: 'Thiết bị đã được phê duyệt',
                    message: `Thiết bị "${sess.deviceLabel}" đã được xác nhận bằng mã OTP email.`,
                    meta: { deviceId }
                });
            }
            res.json({ success: true });
        } catch (e) {
            res.status(500).json({ success: false, message: 'Lỗi xác nhận OTP' });
        }
    });

    // ---- MIDDLEWARE ----
    async function requireAuth(req, res, next) {
        if (!jwtSecret) {
            return res.status(500).json({ success: false, message: 'Server chưa cấu hình JWT_SECRET' });
        }
        const header = req.headers.authorization || '';
        const token = header.startsWith('Bearer ') ? header.slice(7) : '';
        if (!token) {
            return res.status(401).json({ success: false, message: 'Thiếu token xác thực' });
        }
        try {
            req.user = jwt.verify(token, jwtSecret, { algorithms: ['HS256'] });
            // Token gắn deviceId → chặn nếu phiên thiết bị không còn 'active'
            // (bị kick, đang chờ duyệt). Phiên cũ thiếu field status vẫn coi như active.
            if (req.user.dev && sessionModel) {
                const sess = await sessionModel.findOne({ address: req.user.address, deviceId: req.user.dev });
                if (sess && (sess.status === 'pending' || sess.status === 'revoked' || sess.revoked === true)) {
                    return res.status(401).json({ success: false, message: 'Phiên đăng nhập trên thiết bị này đã bị thu hồi hoặc chưa được phê duyệt' });
                }
            }
            next();
        } catch {
            res.status(401).json({ success: false, message: 'Token không hợp lệ hoặc đã hết hạn' });
        }
    }

    // requireRole('NHẬP LIỆU' | 'QUẢN LÝ' | 'ADMIN') — quyền cao bao quát quyền thấp
    function requireRole(minRole) {
        const need = ROLE_RANK[minRole] ?? 3;
        return async (req, res, next) => {
            try {
                const rank = await getRoleRank(req.user.address);
                req.user.roleRank = rank;
                if (rank < need) {
                    return res.status(403).json({ success: false, message: 'Không đủ quyền thực hiện thao tác này' });
                }
                next();
            } catch (e) {
                res.status(500).json({ success: false, message: 'Lỗi kiểm tra quyền' });
            }
        };
    }

    return { router, requireAuth, requireRole, getRoleRank };
}
