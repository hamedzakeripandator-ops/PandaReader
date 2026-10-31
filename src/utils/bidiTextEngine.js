// ============================================================================
// bidiTextEngine.js — موتورِ هوشمندِ پردازش و رندرِ دوجهتیِ متونِ
// فارسی و انگلیسی (BiDi / RTL Text Engine)
//
// مرحله ۱۴: مشکلِ متن‌هایِ ترکیبیِ فارسی و انگلیسی، این بود که
// بومِ Konva (برخلافِ خروجیِ PDF که ctx.direction را تنظیم
// می‌کند) هرگز جهتِ بوم را عوض نمی‌کند و جهتِ پیش‌فرضِ بوم، ltr
// است؛ پس در یک خطِ فارسی، کلماتِ انگلیسی و نقطهٔ پایانِ جمله،
// جایِ خودشان نمی‌نشستند. راه‌حل، نرمال‌سازیِ نمایشیِ خط‌به‌خط
// است (متنِ ذخیره‌شده، همیشه خام می‌ماند و فقط موقعِ رندر،
// نرمال می‌شود):
//
//  ۱. جهتِ هر خط، جداگانه تشخیص داده می‌شود: اگر خط، کاراکترِ
//     فارسی/عربی داشته باشد، راست‌به‌چپ است، وگرنه چپ‌به‌راست.
//  ۲. در خطِ راست‌به‌چپ، هر تکهٔ لاتین/عدد، داخلِ ایزولهٔ
//     FSI…PDI (U+2068…U+2069) می‌رود تا ترتیبِ داخلی‌اش، چپ‌به‌راست
//     بماند ولی در جریانِ راست‌به‌چپ، سرِ جایِ خودش بنشیند.
//  ۳. کلِ خطِ راست‌به‌چپ، داخلِ RLE…PDF (U+202B…U+202C) می‌رود تا
//     حتی وقتی ctx.direction برابرِ ltr است (مثلِ Konva)، خط،
//     یک پاراگرافِ راست‌به‌چپ حساب شود و نقطهٔ پایانِ جمله،
//     همیشه در انتهایِ چپِ خط بنشیند، نه سمتِ راست.
//
// کاراکترهایِ کنترلی، صفرعرض‌اند، پس اندازه‌گیریِ عرضِ متن و
// چینشِ کپسول، عملاً عوض نمی‌شود. خط‌هایِ چپ‌به‌راست، دست‌نخورده
// برمی‌گردند.
// ============================================================================

// بازه‌هایِ یونیکدِ خطِ فارسی/عربی (شاملِ اشکالِ نمایشی).
const ARABIC_SCRIPT_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

// تکه‌هایِ لاتین/عدد، با جداکننده‌هایِ داخلی (مثلِ نسخه‌ها و
// نشانی‌ها)؛ نقطهٔ پایانِ جمله، جزوِ تکه نیست تا در جریانِ
// راست‌به‌چپ، جایِ خودش بماند.
const LATIN_RUN_RE = /[A-Za-z0-9]+(?:[.'’\-_/:][A-Za-z0-9]+)*/g;

const RLE = '\u202B';
const PDF = '\u202C';
const FSI = '\u2068';
const PDI = '\u2069';

/** جهتِ یک خط: 'rtl' اگر کاراکترِ فارسی/عربی داشته باشد، وگرنه 'ltr'. */
export function detectLineDirection(line) {
  if (typeof line !== 'string') return 'ltr';
  return ARABIC_SCRIPT_RE.test(line) ? 'rtl' : 'ltr';
}

/** نرمال‌سازیِ نمایشیِ یک خطِ ترکیبی (خطِ ltr، دست‌نخورده برمی‌گردد). */
export function normalizeMixedBidiLine(line) {
  if (typeof line !== 'string' || line.length === 0) return line;
  if (detectLineDirection(line) !== 'rtl') return line;
  const withIsolates = line.replace(LATIN_RUN_RE, (m) => FSI + m + PDI);
  return RLE + withIsolates + PDF;
}

/** نرمال‌سازیِ نمایشیِ یک متنِ چندخطی، خط‌به‌خط. */
export function normalizeMixedBidiText(text) {
  if (typeof text !== 'string' || text.length === 0) return text;
  return text.split('\n').map(normalizeMixedBidiLine).join('\n');
}

/** جهتِ خطی که مکان‌نما (caret) در آن است؛ برای جهتِ زندهٔ ویرایشگر. */
export function detectCaretLineDirection(text, caretPos) {
  if (typeof text !== 'string' || text.length === 0) return 'ltr';
  const pos = Math.max(0, Math.min(text.length, Math.floor(Number(caretPos) || 0)));
  const lineStart = text.lastIndexOf('\n', pos - 1) + 1;
  const lineEnd = text.indexOf('\n', pos);
  const line = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd);
  return detectLineDirection(line);
}

export default {
  detectLineDirection,
  normalizeMixedBidiLine,
  normalizeMixedBidiText,
  detectCaretLineDirection,
};
