// ============================================================================
// ابزارهای مشترک جستجو (مرحله ۴)
//  - نرمال‌سازی فارسی/عربی برای جستجوی درون‌متنی PDF و جستجوی کتابخانه
//  - امتیازدهی فازی چندفیلدی برای کتابخانه (جایگزین بومی fuse.js؛ بدون
//    وابستگی تازه، پس بیلد بدون npm install نمی‌شکند)
// ============================================================================

// نگاشتِ ۱:۱ — فقط جایگزینی تک‌کاراکتر با تک‌کاراکتر، بدون حذف یا افزودن.
// برای جستجوی PDF حیاتی است: چون طول رشته عوض نمی‌شود، آفست‌های تطابق
// دقیقاً روی آیتم‌های متنی اصلی می‌نشینند.
const CHAR_MAP_1TO1 = {
  '\u064A': '\u06CC', // ي عربی → ی فارسی
  '\u0649': '\u06CC', // ى الف مقصوره → ی فارسی
  '\u0643': '\u06A9', // ك عربی → ک فارسی
  '\u0629': '\u0647', // ة → ه
};

export function normalizeSearchText(input) {
  if (!input) return '';
  const s = String(input);
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    out += CHAR_MAP_1TO1[ch] || ch;
  }
  return out.toLowerCase();
}

// نسخهٔ آزاد برای جستجوی کتابخانه (آفست مهم نیست): حذفِ اعراب و تطویل
// (بدونِ جایگزینی با فاصله، تا کلمه تکه‌تکه نشود) و تبدیلِ نیم‌فاصله و
// فاصله‌های چندتایی به یک فاصله (می‌شود == می شود).
const DIACRITICS_TATWEEL = /[\u064B-\u0652\u0670\u0640]+/g;
const SEPARATORS = /[\u200C\u200D\s]+/g;

export function normalizeSearchTextLoose(input) {
  if (!input) return '';
  return normalizeSearchText(input)
    .replace(DIACRITICS_TATWEEL, '')
    .replace(SEPARATORS, ' ')
    .trim();
}

// فاصلهٔ ویرایشی با سقف (Levenshtein bounded): اگر اختلاف از سقف گذشت،
/// زود برمی‌گردد تا برای صدها آیتم، هزینهٔ هر کلیدزنی خطی بماند.
function levenshteinBounded(a, b, maxDist) {
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > maxDist) return maxDist + 1;
  let prev = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    const curr = [i];
    let rowMin = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      curr[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > maxDist) return maxDist + 1;
    prev = curr;
  }
  return prev[n];
}

function isSubsequence(needle, haystack) {
  if (!needle) return true;
  let j = 0;
  for (let i = 0; i < haystack.length && j < needle.length; i++) {
    if (haystack[i] === needle[j]) j++;
  }
  return j === needle.length;
}

const SCORE = {
  exactToken: 120, // توکن دقیق (کلمهٔ کامل)
  prefix: 110, // شروع کلمه
  substring: 100, // زیررشته در هر جای فیلد
  typo: 70, // اشتباه تایپی جزئی (فاصلهٔ ویرایشی ۱ تا ۲)
  subsequence: 45, // حروف پراکنده به‌ترتیب (مخفف‌نویسی)
};

function tokenize(text) {
  return String(text || '')
    .split(/\s+/)
    .filter(Boolean);
}

// بهترین امتیاز یک توکن در یک فیلد (متن فیلد باید از قبل نرمال شده باشد).
function bestTokenScore(token, fieldText) {
  if (!fieldText) return 0;
  if (fieldText === token) return SCORE.exactToken;
  const tokens = tokenize(fieldText);
  for (const t of tokens) {
    if (t === token) return SCORE.exactToken;
  }
  for (const t of tokens) {
    if (t.startsWith(token)) return SCORE.prefix;
  }
  if (fieldText.includes(token)) return SCORE.substring;
  const maxDist = token.length <= 4 ? 1 : 2;
  for (const t of tokens) {
    if (Math.abs(t.length - token.length) > maxDist) continue;
    if (levenshteinBounded(token, t, maxDist) <= maxDist) return SCORE.typo;
  }
  if (isSubsequence(token, fieldText.replace(/\s+/g, ''))) return SCORE.subsequence;
  return 0;
}

// امتیاز فازی یک آیتم برای یک عبارت جستجو.
// fields: [{ text, weight }] — مثلاً نام (وزن ۳)، پوشه (۲)، مسیر (۱)، تگ‌ها (۲).
// قانونِ عطف: همهٔ توکن‌های عبارت باید دست‌کم در یک فیلد بخورند، وگرنه ۰.
// خروجی ۰ یعنی «نامطابق»؛ هرچه بیشتر، دقیق‌تر.
export function fuzzyScoreLibraryItem(query, fields) {
  const q = normalizeSearchTextLoose(query);
  if (!q) return 0;
  const tokens = tokenize(q);
  let total = 0;
  for (const token of tokens) {
    let best = 0;
    for (const field of fields || []) {
      const text = normalizeSearchTextLoose(field?.text || '');
      if (!text) continue;
      const s = bestTokenScore(token, text) * (field?.weight || 1);
      if (s > best) best = s;
    }
    if (best === 0) return 0;
    total += best;
  }
  return total;
}
