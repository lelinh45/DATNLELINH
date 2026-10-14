import { CONFIG } from './config.js';

export class Web3Service {
    constructor() {
        this.provider = null;
        this.signer = null;
        this.contract = null;
        this.currentAccount = null;
    }

    async hashFile(file) {
        const arrayBuffer = await file.arrayBuffer();
        const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    // Fuzzy hash theo đoạn nội dung (kiểu CTPH/ssdeep): chia file thành các
    // đoạn tại ranh giới do NỘI DUNG quyết định (rolling checksum đạt
    // trigger), nên chèn/sửa một đoạn giữa file không làm lệch các đoạn
    // phía sau — bắt được "file sửa nhẹ/đổi tên" mà hash toàn cục bỏ sót.
    async computeChunkHashes(file) {
        const buf = new Uint8Array(await file.arrayBuffer());
        const WINDOW = 64, MIN = 4096, MAX = 1 << 18, TRIG = 16383; // mục tiêu ~16KB/đoạn
        const toHex = d => Array.from(new Uint8Array(d)).map(b => b.toString(16).padStart(2, '0')).join('');
        const hashes = [];
        let rolling = 0, start = 0;
        for (let i = 0; i < buf.length; i++) {
            rolling += buf[i] - (i >= WINDOW ? buf[i - WINDOW] : 0);
            const len = i - start + 1;
            if (len >= MAX || (len >= MIN && (rolling & TRIG) === TRIG)) {
                hashes.push(toHex(await crypto.subtle.digest('SHA-256', buf.slice(start, i + 1))));
                start = i + 1;
            }
        }
        if (start < buf.length || hashes.length === 0) {
            hashes.push(toHex(await crypto.subtle.digest('SHA-256', buf.slice(start))));
        }
        return hashes;
    }

    // Nhiều ví extension cài chung sẽ đấu nhau quyền window.ethereum —
    // ưu tiên provider MetaMask thật (isMetaMask) thay vì cái đầu tiên/lạ
    pickInjectedProvider() {
        const eth = window.ethereum;
        if (!eth) return null;
        if (Array.isArray(eth.providers) && eth.providers.length) {
            return eth.providers.find(p => p.isMetaMask) || eth.providers[0];
        }
        if (eth.providerMap instanceof Map && eth.providerMap.size) {
            return eth.providerMap.get('MetaMask') || [...eth.providerMap.values()][0];
        }
        return eth;
    }

    // Một số trình duyệt/extension inject window.ethereum trễ hoặc không inject
    // (site access "on click", vừa bật extension...). Thử EIP-6963 announce và
    // poll ngắn trước khi kết luận "chưa cài ví" — tránh báo lỗi giả.
    async getInjectedProvider(timeoutMs = 2500) {
        const found = this.pickInjectedProvider();
        if (found) return found;
        return await new Promise(resolve => {
            const announced = [];
            const onAnnounce = (e) => { if (e && e.detail && e.detail.provider) announced.push(e.detail.provider); };
            try {
                window.addEventListener('eip6963:announceProvider', onAnnounce);
                window.dispatchEvent(new Event('eip6963:requestProvider'));
            } catch {}
            const t0 = Date.now();
            const tick = setInterval(() => {
                const again = this.pickInjectedProvider();
                if (again || announced.length || Date.now() - t0 > timeoutMs) {
                    clearInterval(tick);
                    window.removeEventListener('eip6963:announceProvider', onAnnounce);
                    resolve(again || announced.find(p => p.isMetaMask) || announced[0] || null);
                }
            }, 150);
        });
    }

    async connectWallet() {
        const injected = await this.getInjectedProvider();
        if (!injected) throw new Error("Không tìm thấy ví MetaMask. Nếu đã cài tiện ích, hãy tải lại trang (F5) và kiểm tra MetaMask được phép truy cập trang này.");
        try {
            await injected.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CONFIG.HARDHAT_CHAIN_ID }] });
        } catch (switchError) {
            if (switchError.code === 4902) {
                await injected.request({
                    method: 'wallet_addEthereumChain',
                    params: [{ chainId: CONFIG.HARDHAT_CHAIN_ID, chainName: CONFIG.HARDHAT_CHAIN_NAME, rpcUrls: [CONFIG.RPC_URL], nativeCurrency: CONFIG.CURRENCY }],
                });
            }
        }
        // Hệ thống chỉ chạy trên Sepolia — user từ chối chuyển mạng hoặc ví không
        // hỗ trợ switch thì dừng luôn, báo rõ thay vì lỗi lạ ở bước sau
        const currentChain = await injected.request({ method: 'eth_chainId' });
        if (String(currentChain).toLowerCase() !== String(CONFIG.HARDHAT_CHAIN_ID).toLowerCase()) {
            throw new Error(`Sai mạng Blockchain. Vui lòng chuyển ví sang mạng ${CONFIG.HARDHAT_CHAIN_NAME} (Sepolia) rồi đăng nhập lại.`);
        }
        this.provider = new ethers.BrowserProvider(injected);
        await this.provider.send("eth_requestAccounts", []);
        this.signer = await this.provider.getSigner();
        this.currentAccount = await this.signer.getAddress();
        this.contract = new ethers.Contract(CONFIG.CONTRACT_ADDRESS, CONFIG.CONTRACT_ABI, this.signer);
        const adminAddress = await this.contract.owner();
        const isAdmin = this.currentAccount.toLowerCase() === adminAddress.toLowerCase();
        return { account: this.currentAccount, isAdmin };
    }

    // ==========================================
    // CƠ CHẾ PHÂN TRANG & CACHE BLOCK (TỐI ƯU RPC)
    // ==========================================
    async getEventsInChunks(filter, cacheKeyName) {
        const latestBlock = await this.provider.getBlockNumber();
        const START_BLOCK = 11740000;
        const CHUNK_SIZE = 9000;
        // Cache gắn theo địa chỉ contract — deploy contract mới thì sự kiện của
        // contract cũ không bị trộn vào danh sách (tránh docId trùng lặp ảo)
        const scopedKey = `bdi_cache_v2_${CONFIG.CONTRACT_ADDRESS}_${cacheKeyName}`;

        let cacheData = JSON.parse(localStorage.getItem(scopedKey)) || { lastScanned: START_BLOCK, events: [] };
        let fromBlock = cacheData.lastScanned + 1;
        let newEvents = [];

        if (fromBlock <= latestBlock) {
            // Chỉ tăng lastScanned tới block cuối LIỀN KỀ quét thành công.
            // Trước đây chunk lỗi bị bỏ qua nhưng lastScanned vẫn nhảy tới
            // latest → hố sự kiện vĩnh viễn trong cache (tài liệu/thu hồi/
            // phân quyền "nhảy" sai so với chain cho tới khi xóa localStorage).
            let contiguousTo = fromBlock - 1;
            for (let from = fromBlock; from <= latestBlock; from += CHUNK_SIZE) {
                let to = from + CHUNK_SIZE - 1;
                if (to > latestBlock) to = latestBlock;
                try {
                    const chunk = await this.contract.queryFilter(filter, from, to);
                    const mappedChunk = chunk.map(ev => ({
                        args: Array.from(ev.args).map(arg => typeof arg === 'bigint' ? arg.toString() : arg),
                        transactionHash: ev.transactionHash,
                        blockNumber: ev.blockNumber
                    }));
                    newEvents = newEvents.concat(mappedChunk);
                    contiguousTo = to;
                } catch (error) {
                    console.warn(`Dừng quét tại block ${from}-${to} (sẽ quét lại lần sau):`, error);
                    break;
                }
            }
            cacheData.events = cacheData.events.concat(newEvents);
            cacheData.lastScanned = contiguousTo;
            localStorage.setItem(scopedKey, JSON.stringify(cacheData));
        }
        return cacheData.events;
    }

    // ĐỌC QUYỀN TRỰC TIẾP TỪ SMART CONTRACT
    // Trả null khi lỗi/không có contract — TUYỆT ĐỐI không trả role giả (1),
    // vì caller sẽ sync role đó xuống MongoDB và phá vỡ phân quyền.
    async getUserRole(address) {
        if (!this.contract) return null;
        try {
            const adminAddress = await this.contract.owner();
            if (address.toLowerCase() === adminAddress.toLowerCase()) return 99;
            return await this.contract.userRoles(address);
        } catch (e) {
            console.warn('getUserRole lỗi (RPC/contract):', e.message || e);
            return null;
        }
    }

    async addDocumentOnChain(docId, fileHash, ipfsCID) {
        if (!this.contract) throw new Error("Vui lòng kết nối ví trước!");
        const tx = await this.contract.addDocument(docId, fileHash, `ipfs://${ipfsCID}`);
        await tx.wait();
        return tx.hash;
    }

    async addDocumentsOnChain(docIds, fileHashes, ipfsURIs) {
        if (!this.contract) throw new Error("Vui lòng kết nối ví trước!");
        const tx = await this.contract.addDocuments(docIds, fileHashes, ipfsURIs);
        await tx.wait();
        return tx.hash;
    }

    async addMerkleBatch(batchId, merkleRoot, ipfsURI) {
        if (!this.contract) throw new Error("Chưa kết nối Smart Contract");
        const tx = await this.contract.addMerkleBatch(batchId, merkleRoot, ipfsURI);
        await tx.wait();
        return tx.hash;
    }

    async getDocumentFromChain(docId) {
        if (!this.contract) throw new Error("Vui lòng kết nối ví trước!");
        return await this.contract.getDocument(docId);
    }

    // Phí gas thật của 1 giao dịch (ETH) — cache vĩnh viễn vì fee không đổi
    async getTxFeeEth(txHash) {
        if (!this.provider || !txHash) return null;
        try {
            const cacheKey = `bdi_txfee_${txHash}`;
            const cached = localStorage.getItem(cacheKey);
            if (cached) return cached;
            const receipt = await this.provider.getTransactionReceipt(txHash);
            if (!receipt) return null;
            const feeWei = receipt.gasUsed * (receipt.gasPrice ?? receipt.effectiveGasPrice ?? 0n);
            const eth = Number(ethers.formatEther(feeWei)).toFixed(6);
            localStorage.setItem(cacheKey, eth);
            return eth;
        } catch (e) { return null; }
    }

    async assignRole(address, roleLevel) {
        if (!this.contract) throw new Error("Vui lòng kết nối ví trước!");
        const tx = await this.contract.assignRole(address, roleLevel);
        await tx.wait();
        return tx.hash;
    }

    async queryHistory() {
        if (!this.contract) throw new Error("Vui lòng kết nối ví trước!");
        return await this.getEventsInChunks(this.contract.filters.DocumentAdded(), 'added_events'); 
    }

    async queryRevokedHistory() {
        if (!this.contract) throw new Error("Vui lòng kết nối ví trước!");
        return await this.getEventsInChunks(this.contract.filters.DocumentRevoked(), 'revoked_events'); 
    }

    async revokeDocument(docId, reason) {
        if (!this.contract) throw new Error("Vui lòng kết nối ví trước!");
        const tx = await this.contract.revokeDocument(docId, reason);
        await tx.wait();
        return tx.hash;
    }

    async getLiveMetrics() {
        if (!this.provider) return { docCount: 0, issuerCount: 1, latency: 0 };
        const startTime = performance.now();
        await this.provider.getBlockNumber();
        const latency = Math.round(performance.now() - startTime);

        let activeDocCount = 0; 
        let issuerCount = 1;
        if (this.contract) {
            try {
                const docEvents = await this.getEventsInChunks(this.contract.filters.DocumentAdded(), 'added_events');
                for (let ev of docEvents) {
                    const docData = await this.contract.getDocument(ev.args[0]);
                    if (!docData[4]) activeDocCount++;
                }
                const roleEvents = await this.getEventsInChunks(this.contract.filters.RoleAssigned(), 'role_events');
                // Đếm ví đang được ủy quyền upload (rank ≥ 1) theo event MỚI NHẤT
                // mỗi ví — ví bị tước (event cuối = 0) không đếm, không đếm trùng
                const latestRole = {};
                for (const ev of roleEvents) latestRole[ev.args[1].toLowerCase()] = Number(ev.args[2]);
                issuerCount = Object.values(latestRole).filter(r => r >= 1).length + 1; // +1 cho owner (constructor gán sẵn, không emit event)
            } catch (err) {}
        }
        return { docCount: activeDocCount, issuerCount, latency };
    }
}