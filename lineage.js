// Truy vết dòng đời phiên bản tài liệu.
// files: mảng phẳng các file-subdoc của mọi Batch (mỗi phần tử cần docId, replacesDocId).
// Trả { chain, index, latest, supersededBy, isLatest } hoặc null nếu docId không tồn tại.
export function buildVersionChain(files, docId) {
    const byId = new Map();
    const nextOf = new Map(); // docId -> docId bản kế nhiệm
    for (const f of files) {
        if (f && f.docId) byId.set(f.docId, f);
        if (f && f.replacesDocId) nextOf.set(f.replacesDocId, f.docId);
    }
    if (!byId.has(docId)) return null;

    const seen = new Set([docId]);

    // Đi ngược về gốc theo replacesDocId (chống vòng lặp bằng seen)
    const ancestors = [];
    let cur = byId.get(docId);
    while (cur.replacesDocId && byId.has(cur.replacesDocId) && !seen.has(cur.replacesDocId)) {
        seen.add(cur.replacesDocId);
        cur = byId.get(cur.replacesDocId);
        ancestors.unshift(cur);
    }
    const chain = [...ancestors, byId.get(docId)];

    // Đi xuôi tới bản mới nhất
    let curId = docId;
    while (nextOf.has(curId) && !seen.has(nextOf.get(curId))) {
        curId = nextOf.get(curId);
        seen.add(curId);
        chain.push(byId.get(curId));
    }

    const nodes = chain.map((f, i) => ({
        docId: f.docId,
        fileName: f.fileName,
        fileHash: f.fileHash,
        isRevoked: !!f.isRevoked,
        replacesDocId: f.replacesDocId || null,
        timestamp: f.timestamp,
        version: i + 1,
    }));
    const index = nodes.findIndex(n => n.docId === docId);
    const latest = nodes[nodes.length - 1];
    const supersededBy = index < nodes.length - 1 ? nodes[index + 1] : null;
    return { chain: nodes, index, latest, supersededBy, isLatest: index === nodes.length - 1 };
}
