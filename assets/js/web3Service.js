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

    async connectWallet() {
        if (typeof window.ethereum === 'undefined') throw new Error("Không tìm thấy ví MetaMask. Vui lòng cài đặt tiện ích!");
        try {
            await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CONFIG.HARDHAT_CHAIN_ID }] });
        } catch (switchError) {
            if (switchError.code === 4902) {
                await window.ethereum.request({
                    method: 'wallet_addEthereumChain',
                    params: [{ chainId: CONFIG.HARDHAT_CHAIN_ID, chainName: CONFIG.HARDHAT_CHAIN_NAME, rpcUrls: [CONFIG.RPC_URL], nativeCurrency: CONFIG.CURRENCY }],
                });
            }
        }
        this.provider = new ethers.BrowserProvider(window.ethereum);
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
        
        let cacheData = JSON.parse(localStorage.getItem(`bdi_cache_${cacheKeyName}`)) || { lastScanned: START_BLOCK, events: [] };
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
            localStorage.setItem(`bdi_cache_${cacheKeyName}`, JSON.stringify(cacheData));
        }
        return cacheData.events;
    }

    // ĐỌC QUYỀN TRỰC TIẾP TỪ SMART CONTRACT
    async getUserRole(address) {
        if (!this.contract) return 1; 
        try {
            const adminAddress = await this.contract.owner();
            if (address.toLowerCase() === adminAddress.toLowerCase()) return 99; 
            return await this.contract.userRoles(address); 
        } catch (e) { return 1; }
    }

    async addDocumentOnChain(docId, fileHash, ipfsCID) {
        if (!this.contract) throw new Error("Vui lòng kết nối ví trước!");
        const tx = await this.contract.addDocument(docId, fileHash, `ipfs://${ipfsCID}`);
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
                issuerCount += roleEvents.length;
            } catch (err) {}
        }
        return { docCount: activeDocCount, issuerCount, latency };
    }
}