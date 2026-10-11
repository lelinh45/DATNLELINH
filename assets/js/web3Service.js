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

    async connectWallet() {
        const injected = this.pickInjectedProvider();
        if (!injected) throw new Error("Không tìm thấy ví MetaMask. Vui lòng cài đặt tiện ích!");
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
        const scopedKey = `bdi_cache_${CONFIG.CONTRACT_ADDRESS}_${cacheKeyName}`;

        let cacheData = JSON.parse(localStorage.getItem(scopedKey)) || { lastScanned: START_BLOCK, events: [] };
        let fromBlock = cacheData.lastScanned + 1;
        let newEvents = [];

        if (fromBlock <= latestBlock) {
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
                } catch (error) { console.warn(`Bỏ qua lỗi tại block ${from}-${to}:`, error); }
            }
            cacheData.events = cacheData.events.concat(newEvents);
            cacheData.lastScanned = latestBlock;
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