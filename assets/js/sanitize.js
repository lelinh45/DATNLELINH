// =====================================================================
// HELPER CHỐNG XSS — escape mọi giá trị động trước khi nội suy vào HTML
// Dùng được cho cả text node lẫn attribute (kể cả data-* đọc lại qua dataset)
// =====================================================================
const ESCAPE_MAP = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
    '`': '&#96;',
};

export function esc(value) {
    return String(value ?? '').replace(/[&<>"'`]/g, (c) => ESCAPE_MAP[c]);
}
