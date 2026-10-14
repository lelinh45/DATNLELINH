import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import { spawn } from 'node:child_process';
import contractJson from '../artifacts/contracts/DataIntegrity.sol/DataIntegrity.json' with { type: 'json' };

const RPC = 'http://127.0.0.1:8545';
// Account #0/#1/#2 mặc định của hardhat/edr local node (mnemonic test...junk) — chỉ dùng cho test local
const DEPLOYER_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const USER_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const USER2_KEY = '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a';

let nodeProc, provider, contract, contractAsUser, deployer, user, user2;
let deployerAddr, userAddr, user2Addr;
const DOC = { id: 'doc_test_1', hash: 'a'.repeat(64), uri: 'ipfs://QmTest123' };

async function waitForNode(timeoutMs = 60000) {
    const tmp = new ethers.JsonRpcProvider(RPC);
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try { await tmp.getBlockNumber(); return; } catch { await new Promise(r => setTimeout(r, 800)); }
    }
    throw new Error('hardhat node không khởi động kịp');
}

// Gửi tx và chờ mined; retry tối đa 3 lần nếu gặp nonce flake của node automine
async function sendAndWait(fn) {
    for (let i = 0; i < 3; i++) {
        try {
            return await (await fn()).wait();
        } catch (e) {
            const msg = (e && (e.message || (e.info && e.info.error && e.info.error.message))) || '';
            if (i === 2 || !/nonce/i.test(msg)) throw e;
            await new Promise(r => setTimeout(r, 400));
        }
    }
}

before(async () => {
    nodeProc = spawn('npx', ['hardhat', 'node'], { shell: true, stdio: 'ignore' });
    await waitForNode();
    provider = new ethers.JsonRpcProvider(RPC);
    deployer = new ethers.Wallet(DEPLOYER_KEY, provider);
    user = new ethers.Wallet(USER_KEY, provider);
    user2 = new ethers.Wallet(USER2_KEY, provider);
    deployerAddr = deployer.address;
    userAddr = user.address;
    user2Addr = user2.address;
    const factory = new ethers.ContractFactory(contractJson.abi, contractJson.bytecode, deployer);
    contract = await factory.deploy();
    await contract.waitForDeployment();
    contractAsUser = contract.connect(user);
});

after(() => { if (nodeProc) nodeProc.kill(); });

test('deployer là owner và ROLE_ADMIN', async () => {
    assert.equal(await contract.owner(), deployerAddr);
    assert.equal(await contract.userRoles(deployerAddr), 3n);
});

test('addDocuments: ghi nhiều doc trong 1 tx, getDocument đọc được', async () => {
    const ids = [DOC.id, 'doc_test_2', 'doc_test_3'];
    const hashes = [DOC.hash, 'b'.repeat(64), 'c'.repeat(64)];
    const uris = [DOC.uri, 'ipfs://Qm2', 'ipfs://Qm3'];
    await sendAndWait(() => contract.addDocuments(ids, hashes, uris));

    const doc = await contract.getDocument(DOC.id);
    assert.equal(doc[0], DOC.hash);   // fileHash
    assert.equal(doc[1], DOC.uri);    // ipfsURI
    assert.equal(doc[3], deployerAddr); // uploader
    assert.equal(doc[4], false);      // isRevoked
    assert.equal(await contract.getDocIdByHash(deployerAddr, DOC.hash), DOC.id);
});

test('addDocuments từ chối mảng lệch độ dài / mảng rỗng', async () => {
    await assert.rejects(contract.addDocuments(['x'], ['a'.repeat(64), 'b'.repeat(64)], ['ipfs://x']));
    await assert.rejects(contract.addDocuments([], [], []));
});

test('addDocuments từ chối hash trùng lặp CỦA CHÍNH MÌNH', async () => {
    await assert.rejects(contract.addDocuments(['doc_khac'], [DOC.hash], ['ipfs://x']));
});

test('multi-tenant: ví KHÁC được đóng dấu cùng nội dung', async () => {
    // deployer đã đăng ký DOC.hash — user (có role) vẫn ghi được bản riêng
    await sendAndWait(() => contract.assignRole(userAddr, 2));
    await sendAndWait(() => contractAsUser.addDocuments(['doc_user_same_hash'], [DOC.hash], ['ipfs://QmUserCopy']));
    const d = await contract.getDocument('doc_user_same_hash');
    assert.equal(d[0], DOC.hash);
    assert.equal(d[3], userAddr);
    // sổ của deployer vẫn trỏ doc cũ, sổ của user trỏ doc mới — độc lập
    assert.equal(await contract.getDocIdByHash(deployerAddr, DOC.hash), DOC.id);
    assert.equal(await contract.getDocIdByHash(userAddr, DOC.hash), 'doc_user_same_hash');
    // ví user giờ cũng bị chặn ghi lại chính hash đó
    await assert.rejects(contractAsUser.addDocuments(['doc_user_dup2'], [DOC.hash], ['ipfs://x']));
});

test('chưa cấp quyền (ROLE_NONE) không được upload', async () => {
    const asUser2 = contract.connect(user2);
    await assert.rejects(asUser2.addDocuments(['x'], ['f'.repeat(64)], ['ipfs://x']));
});

test('revokeDocument xóa uploaderHashToDocId → re-upload cùng nội dung được', async () => {
    // cấp quyền MANAGER cho user, user tự upload doc rồi revoke (uploader ≠ admin nên được phép)
    await sendAndWait(() => contract.assignRole(userAddr, 2));
    const mgrHash = 'd'.repeat(64);
    await sendAndWait(() => contractAsUser.addDocuments(['doc_mgr'], [mgrHash], [DOC.uri]));
    await sendAndWait(() => contractAsUser.revokeDocument('doc_mgr', 'sai pham test'));

    const doc = await contract.getDocument('doc_mgr');
    assert.equal(doc[4], true); // isRevoked
    assert.equal(await contract.getDocIdByHash(userAddr, mgrHash), ''); // đã xóa khỏi sổ chống trùng CỦA USER

    // chính user re-upload cùng hash với docId mới phải thành công
    await sendAndWait(() => contractAsUser.addDocuments(['doc_reupload'], [mgrHash], [DOC.uri]));
    const reDoc = await contract.getDocument('doc_reupload');
    assert.equal(reDoc[0], mgrHash);
});

test('QUẢN LÝ không thu hồi được tài liệu của ADMIN', async () => {
    // DOC.id do deployer (ADMIN) upload — manager chỉ được thu hồi tài liệu của người thường
    await assert.rejects(contractAsUser.revokeDocument(DOC.id, 'x'));
    // ADMIN vẫn thu hồi được tài liệu của chính mình
    await sendAndWait(() => contract.revokeDocument(DOC.id, 'admin tu thu hoi'));
    const doc = await contract.getDocument(DOC.id);
    assert.equal(doc[4], true);
});

test('ROLE_ENTRY không được revoke', async () => {
    await sendAndWait(() => contract.assignRole(user2Addr, 1));
    const asUser2 = contract.connect(user2);
    await assert.rejects(asUser2.revokeDocument('doc_reupload', 'x'));
});

test('getDocument revert với id không tồn tại', async () => {
    await assert.rejects(contract.getDocument('khong_ton_tai'));
});

test('getMerkleBatch đọc lại batch đã ghi', async () => {
    const root = '0x' + 'ab'.repeat(32);
    await sendAndWait(() => contract.addMerkleBatch('BATCH_T1', root, 'ipfs://manifest'));
    const b = await contract.getMerkleBatch('BATCH_T1');
    assert.equal(b[0], root);
    assert.equal(b[3], deployerAddr); // uploader
});

test('addDocuments từ chối >100 doc/lô (gas guard)', async () => {
    const ids = Array.from({ length: 101 }, (_, i) => `over_${i}`);
    const hashes = Array.from({ length: 101 }, () => '0'.repeat(64));
    const uris = Array.from({ length: 101 }, () => 'ipfs://x');
    await assert.rejects(contract.addDocuments(ids, hashes, uris));
});

test('addDocuments từ chối hash trùng trong CÙNG một lô (atomic revert)', async () => {
    // 2 phần tử cùng hash trong 1 mảng → phải revert toàn bộ, không ghi gì
    await assert.rejects(contract.addDocuments(['dA', 'dB'], ['9'.repeat(64), '9'.repeat(64)], ['ipfs://a', 'ipfs://b']));
    await assert.rejects(contract.getDocument('dA')); // dA không được ghi dù đứng trước
});

test('transferOwnership từ chối địa chỉ 0 và tự chuyển cho chính mình', async () => {
    // deployer đang là owner tại thời điểm này (test chạy tuần tự)
    await assert.rejects(contract.transferOwnership('0x0000000000000000000000000000000000000000'));
    await assert.rejects(contract.transferOwnership(deployerAddr));
    // người không phải owner (dù là ADMIN) cũng không được chuyển
    await assert.rejects(contractAsUser.transferOwnership(userAddr));
});

test('getMerkleBatch revert với batchId không tồn tại', async () => {
    await assert.rejects(contract.getMerkleBatch('BATCH_KHONG_CO'));
});

test('transferOwnership chuyển quyền root, owner cũ vẫn ADMIN nhưng mất bảo vệ', async () => {
    await sendAndWait(() => contract.transferOwnership(userAddr));
    assert.equal(await contract.owner(), userAddr);
    assert.equal(await contract.userRoles(userAddr), 3n);
    // owner cũ (deployer) vẫn ADMIN nhưng giờ bị assignRole đụng tới được
    await sendAndWait(() => contract.connect(user).assignRole(deployerAddr, 1));
    assert.equal(await contract.userRoles(deployerAddr), 1n);
});
