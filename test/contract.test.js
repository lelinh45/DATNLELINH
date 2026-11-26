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

test('addDocumentsV2: ghi nhiều doc trong 1 tx, getDocument đọc được', async () => {
    const ids = [DOC.id, 'doc_test_2', 'doc_test_3'];
    const hashes = [DOC.hash, 'b'.repeat(64), 'c'.repeat(64)];
    const uris = [DOC.uri, 'ipfs://Qm2', 'ipfs://Qm3'];
    const prevs = ['', '', ''];
    const exp = [0, 0, 0];
    await sendAndWait(() => contract.addDocumentsV2(ids, hashes, uris, prevs, exp));

    const doc = await contract.getDocument(DOC.id);
    assert.equal(doc[0], DOC.hash);   // fileHash
    assert.equal(doc[1], DOC.uri);    // ipfsURI
    assert.equal(doc[3], deployerAddr); // uploader
    assert.equal(doc[4], false);      // isRevoked
    assert.equal(await contract.getDocIdByHash(deployerAddr, DOC.hash), DOC.id);
});

test('addDocumentsV2 từ chối mảng lệch độ dài / mảng rỗng', async () => {
    await assert.rejects(contract.addDocumentsV2(['x'], ['a'.repeat(64), 'b'.repeat(64)], ['ipfs://x'], [''], [0]));
    await assert.rejects(contract.addDocumentsV2([], [], [], [], []));
});

test('addDocumentsV2 từ chối hash trùng lặp CỦA CHÍNH MÌNH', async () => {
    await assert.rejects(contract.addDocumentsV2(['doc_khac'], [DOC.hash], ['ipfs://x'], [''], [0]));
});

test('multi-tenant: ví KHÁC được đóng dấu cùng nội dung', async () => {
    // deployer đã đăng ký DOC.hash — user (có role) vẫn ghi được bản riêng
    await sendAndWait(() => contract.assignRole(userAddr, 2));
    await sendAndWait(() => contractAsUser.addDocumentsV2(['doc_user_same_hash'], [DOC.hash], ['ipfs://QmUserCopy'], [''], [0]));
    const d = await contract.getDocument('doc_user_same_hash');
    assert.equal(d[0], DOC.hash);
    assert.equal(d[3], userAddr);
    // sổ của deployer vẫn trỏ doc cũ, sổ của user trỏ doc mới — độc lập
    assert.equal(await contract.getDocIdByHash(deployerAddr, DOC.hash), DOC.id);
    assert.equal(await contract.getDocIdByHash(userAddr, DOC.hash), 'doc_user_same_hash');
    // ví user giờ cũng bị chặn ghi lại chính hash đó
    await assert.rejects(contractAsUser.addDocumentsV2(['doc_user_dup2'], [DOC.hash], ['ipfs://x'], [''], [0]));
});

test('chưa cấp quyền (ROLE_NONE) không được upload', async () => {
    const asUser2 = contract.connect(user2);
    await assert.rejects(asUser2.addDocumentsV2(['x'], ['f'.repeat(64)], ['ipfs://x'], [''], [0]));
});

test('revokeDocument xóa uploaderHashToDocId → re-upload cùng nội dung được', async () => {
    // cấp quyền MANAGER cho user, user tự upload doc rồi revoke (uploader ≠ admin nên được phép)
    await sendAndWait(() => contract.assignRole(userAddr, 2));
    const mgrHash = 'd'.repeat(64);
    await sendAndWait(() => contractAsUser.addDocumentsV2(['doc_mgr'], [mgrHash], [DOC.uri], [''], [0]));
    await sendAndWait(() => contractAsUser.revokeDocument('doc_mgr', 'sai pham test'));

    const doc = await contract.getDocument('doc_mgr');
    assert.equal(doc[4], true); // isRevoked
    assert.equal(await contract.getDocIdByHash(userAddr, mgrHash), ''); // đã xóa khỏi sổ chống trùng CỦA USER

    // chính user re-upload cùng hash với docId mới phải thành công
    await sendAndWait(() => contractAsUser.addDocumentsV2(['doc_reupload'], [mgrHash], [DOC.uri], [''], [0]));
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

test('addDocumentsV2 từ chối >100 doc/lô (gas guard)', async () => {
    const ids = Array.from({ length: 101 }, (_, i) => `over_${i}`);
    const hashes = Array.from({ length: 101 }, () => '0'.repeat(64));
    const uris = Array.from({ length: 101 }, () => 'ipfs://x');
    const prevs = Array.from({ length: 101 }, () => '');
    const exp = Array.from({ length: 101 }, () => 0);
    await assert.rejects(contract.addDocumentsV2(ids, hashes, uris, prevs, exp));
});

test('addDocumentsV2 từ chối hash trùng trong CÙNG một lô (atomic revert)', async () => {
    // 2 phần tử cùng hash trong 1 mảng → phải revert toàn bộ, không ghi gì
    await assert.rejects(contract.addDocumentsV2(['dA', 'dB'], ['9'.repeat(64), '9'.repeat(64)], ['ipfs://a', 'ipfs://b'], ['', ''], [0, 0]));
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

// ===== Contract v2: multi-sig EIP-712 + versioning + revoke-PENDING =====
// State tại điểm này: deployer=owner/ADMIN, user=MANAGER(2), user2=ENTRY(1)

const SEAL_TYPES = {
    DocumentSeal: [
        { name: 'docHash', type: 'bytes32' },
        { name: 'documentId', type: 'string' },
        { name: 'fileHash', type: 'string' },
        { name: 'ipfsURI', type: 'string' },
        { name: 'expiresAt', type: 'uint256' },
        { name: 'previousDocId', type: 'string' }
    ]
};

// Ký EIP-712 giống hệt recipe contract: docHash = keccak256(abi.encode(5 fields))
async function signSeal(wallet, docId, fileHash, ipfsURI, expiresAt, previousDocId) {
    const contractAddr = await contract.getAddress();
    const docHash = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
        ['string', 'string', 'string', 'uint256', 'string'],
        [docId, fileHash, ipfsURI, expiresAt, previousDocId]
    ));
    const domain = { name: 'DataIntegrity', version: '2', chainId: 31337n, verifyingContract: contractAddr };
    return wallet.signTypedData(domain, SEAL_TYPES, {
        docHash, documentId: docId, fileHash, ipfsURI, expiresAt, previousDocId
    });
}

test('sealDocument: happy path 2/2 signer → sealed + successorOf gán sau seal', async () => {
    // v1 sealed ngay (threshold=0)
    await sendAndWait(() => contractAsUser.addDocumentV2('doc_v1', 'e'.repeat(64), 'ipfs://v1', '', 0, [], 0));
    // bản mới PENDING 2/3 signer, trỏ previousDocId=doc_v1
    const signers = [userAddr, user2Addr, deployerAddr];
    await sendAndWait(() => contractAsUser.addDocumentV2('doc_pend', 'f'.repeat(64), 'ipfs://pend', 'doc_v1', 0, signers, 2));

    let d = await contract.getDocument('doc_pend');
    assert.equal(d[10], false); // isSealed = false → PENDING
    assert.equal(d[6], 'doc_v1'); // previousDocId
    assert.equal(await contract.getSuccessor('doc_v1'), ''); // chưa gán successor

    const sigU = await signSeal(user, 'doc_pend', 'f'.repeat(64), 'ipfs://pend', 0, 'doc_v1');
    const sigU2 = await signSeal(user2, 'doc_pend', 'f'.repeat(64), 'ipfs://pend', 0, 'doc_v1');
    // ai cũng gọi được — dùng deployer submit chữ ký gộp
    await sendAndWait(() => contract.sealDocument('doc_pend', [sigU, sigU2]));

    d = await contract.getDocument('doc_pend');
    assert.equal(d[10], true); // sealed
    assert.equal(await contract.getSuccessor('doc_v1'), 'doc_pend'); // successorOf gán sau seal
});

test('sealDocument: thiếu chữ ký so với threshold → revert toàn bộ', async () => {
    await sendAndWait(() => contractAsUser.addDocumentV2('doc_pend_less', '1'.repeat(64), 'ipfs://pl', '', 0, [userAddr, user2Addr], 2));
    const sigU = await signSeal(user, 'doc_pend_less', '1'.repeat(64), 'ipfs://pl', 0, '');
    await assert.rejects(contract.sealDocument('doc_pend_less', [sigU]));
    const d = await contract.getDocument('doc_pend_less');
    assert.equal(d[10], false); // vẫn PENDING — revert không tích lũy state
});

test('sealDocument: chữ ký của địa chỉ NGOÀI requiredSigners → revert', async () => {
    // requiredSigners chỉ có user2; deployer ký → recover ra deployerAddr ∉ list
    await sendAndWait(() => contractAsUser.addDocumentV2('doc_pend_out', '2'.repeat(64), 'ipfs://po', '', 0, [user2Addr], 1));
    const sigDeployer = await signSeal(deployer, 'doc_pend_out', '2'.repeat(64), 'ipfs://po', 0, '');
    await assert.rejects(contract.sealDocument('doc_pend_out', [sigDeployer]));
});

test('sealDocument: cùng một chữ ký nộp 2 lần → revert (chống đếm trùng)', async () => {
    await sendAndWait(() => contractAsUser.addDocumentV2('doc_pend_dup', '3'.repeat(64), 'ipfs://pd', '', 0, [userAddr, user2Addr], 2));
    const sigU = await signSeal(user, 'doc_pend_dup', '3'.repeat(64), 'ipfs://pd', 0, '');
    await assert.rejects(contract.sealDocument('doc_pend_dup', [sigU, sigU]));
});

test('sealDocument: doc đã bị thu hồi (PENDING) → revert', async () => {
    await sendAndWait(() => contractAsUser.addDocumentV2('doc_pend_rev', '4'.repeat(64), 'ipfs://pr', '', 0, [userAddr], 1));
    // user là MANAGER → được revoke doc PENDING của chính mình theo nhánh uploader/manager
    await sendAndWait(() => contractAsUser.revokeDocument('doc_pend_rev', 'huy cho ky'));
    const sigU = await signSeal(user, 'doc_pend_rev', '4'.repeat(64), 'ipfs://pr', 0, '');
    await assert.rejects(contract.sealDocument('doc_pend_rev', [sigU]));
});

test('versioning: chỉ uploader cũ / MANAGER mới được trỏ previousDocId; chặn ADMIN-inheritance sai quyền', async () => {
    // user2 (ENTRY, không phải uploader doc_v1 của user) không được version
    await assert.rejects(contract.connect(user2).addDocumentV2('doc_bad_ver', '5'.repeat(64), 'ipfs://bv', 'doc_v1', 0, [], 0));
    // uploader bản cũ (user) tự version doc của mình → OK
    await sendAndWait(() => contractAsUser.addDocumentV2('doc_perm_base', '6'.repeat(64), 'ipfs://pb', '', 0, [], 0));
    await sendAndWait(() => contractAsUser.addDocumentV2('doc_perm_v2', '7'.repeat(64), 'ipfs://pv2', 'doc_perm_base', 0, [], 0));
    assert.equal(await contract.getSuccessor('doc_perm_base'), 'doc_perm_v2');
    // MANAGER (user) version doc của user2 (không phải uploader nhưng role>=MANAGER) → OK
    await sendAndWait(() => contract.connect(user2).addDocumentV2('doc_u2_base', '8'.repeat(64), 'ipfs://u2b', '', 0, [], 0));
    await sendAndWait(() => contractAsUser.addDocumentV2('doc_u2_v2', '9'.repeat(64), 'ipfs://u2v2', 'doc_u2_base', 0, [], 0));
    assert.equal(await contract.getSuccessor('doc_u2_base'), 'doc_u2_v2');
    // doc do deployer (ADMIN) upload → MANAGER không được kế thừa
    await sendAndWait(() => contract.addDocumentV2('doc_admin_v1', 'a'.repeat(63) + '7', 'ipfs://av1', '', 0, [], 0));
    await assert.rejects(contractAsUser.addDocumentV2('doc_bad_admin', 'b'.repeat(63) + '8', 'ipfs://ba', 'doc_admin_v1', 0, [], 0));
    // ADMIN được kế thừa
    await sendAndWait(() => contract.addDocumentV2('doc_admin_v2', 'c'.repeat(63) + '9', 'ipfs://av2', 'doc_admin_v1', 0, [], 0));
    assert.equal(await contract.getSuccessor('doc_admin_v1'), 'doc_admin_v2');
});

test('versioning: chặn phân nhánh — prev đã có successor thì reject cả add lẫn seal', async () => {
    // doc_base do user upload
    await sendAndWait(() => contractAsUser.addDocumentV2('doc_base', 'a'.repeat(63) + '1', 'ipfs://base', '', 0, [], 0));
    // PENDING successor chiếm "slot" trước (chưa gán successorOf)
    await sendAndWait(() => contractAsUser.addDocumentV2('doc_pend_race', 'b'.repeat(63) + '2', 'ipfs://prace', 'doc_base', 0, [userAddr], 1));
    // Trong lúc PENDING, một successor KHÁC sealed-ngay chiếm successorOf[doc_base]
    await sendAndWait(() => contractAsUser.addDocumentV2('doc_race_win', 'c'.repeat(63) + '3', 'ipfs://rwin', 'doc_base', 0, [], 0));
    assert.equal(await contract.getSuccessor('doc_base'), 'doc_race_win');
    // Giờ seal doc_pend_race → phải revert vì successorOf[doc_base] đã bị chiếm
    const sigU = await signSeal(user, 'doc_pend_race', 'b'.repeat(63) + '2', 'ipfs://prace', 0, 'doc_base');
    await assert.rejects(contract.sealDocument('doc_pend_race', [sigU]));
    // Và add mới với cùng prev cũng reject ngay từ _checkPreviousDoc
    await assert.rejects(contractAsUser.addDocumentV2('doc_branch', 'd'.repeat(63) + '4', 'ipfs://br', 'doc_base', 0, [], 0));
});

test('revoke-PENDING: uploader được tự hủy; ví ENTRY không phải uploader thì không', async () => {
    // doc do user (MANAGER) upload PENDING → user2 (ENTRY, không phải uploader) không được hủy
    await sendAndWait(() => contractAsUser.addDocumentV2('doc_pend_huy', 'e'.repeat(63) + '5', 'ipfs://ph', '', 0, [user2Addr], 1));
    await assert.rejects(contract.connect(user2).revokeDocument('doc_pend_huy', 'x'));
    // uploader (user) tự hủy được
    await sendAndWait(() => contractAsUser.revokeDocument('doc_pend_huy', 'tu huy'));
    const d = await contract.getDocument('doc_pend_huy');
    assert.equal(d[4], true); // isRevoked
});

test('expiresAt: lưu đúng giá trị, expiresAt=0 = không hạn', async () => {
    await sendAndWait(() => contractAsUser.addDocumentV2('doc_exp', 'f'.repeat(63) + '6', 'ipfs://exp', '', 1893456000, [], 0));
    const d = await contract.getDocument('doc_exp');
    assert.equal(d[7], 1893456000n); // expiresAt
    assert.equal(d[10], true); // sealed ngay vì threshold=0
});

test('transferOwnership chuyển quyền root, owner cũ vẫn ADMIN nhưng mất bảo vệ', async () => {
    await sendAndWait(() => contract.transferOwnership(userAddr));
    assert.equal(await contract.owner(), userAddr);
    assert.equal(await contract.userRoles(userAddr), 3n);
    // owner cũ (deployer) vẫn ADMIN nhưng giờ bị assignRole đụng tới được
    await sendAndWait(() => contract.connect(user).assignRole(deployerAddr, 1));
    assert.equal(await contract.userRoles(deployerAddr), 1n);
});
