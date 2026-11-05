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

// ── مرحلهٔ ۳۹ §۶: موتورِ جستجویِ مرزیِ پیشرفته (MiniSearch + موتورِ بومی) ──

// کاراکترهایِ «داخلِ کلمه»: لاتین + اعداد + فارسی/عربی + ZWNJ/ZWJ.
// ZWNJ عمداً داخلِ کلمه حساب می‌شود تا «می‌شود» یک کلمه باشد و «شود»
// به‌تنهایی، تطابقِ «کلمهٔ کامل» داخلِ آن نگیرد.
export const WORD_CHAR_PATTERN = '[a-zA-Z0-9_\\u0600-\\u06FF\\uFB50-\\uFDFF\\uFE70-\\uFEFF\\u200C\\u200D]';
const WORD_CHAR_RE = new RegExp(WORD_CHAR_PATTERN);
function isWordChar(ch) {
  return ch ? WORD_CHAR_RE.test(ch) : false;
}

// نرمال‌سازیِ ۱به۱ بدونِ کوچک‌کردنِ حروف (برایِ حالتِ حساس به بزرگیِ حروف).
export function normalizeSearchTextCaseSensitive(input) {
  return String(input || '')
    .split('')
    .map((ch) => CHAR_MAP_1TO1[ch] || ch)
    .join('');
}

// بررسیِ مرزِ کلمه در متنِ نرمالِ فضادار و با آفست‌هایِ اصلی:
// mode: 'whole' (پیش‌فرض) = هر دو همسایه حرف/عدد نباشند؛ 'prefix' =
// فقط همسایهٔ قبل حرف/عدد نباشد (آغازِ کلمه)؛ 'substring' = همیشه معتبر.
// با این قانون، جستجویِ ear فقط earِ مستقل را می‌گیرد و near/hear/
// heart/early را رد می‌کند.
export function isWordBoundaryMatch(text, matchStart, matchLength, mode = 'whole') {
  if (mode === 'substring') return true;
  const before = matchStart > 0 ? text[matchStart - 1] : '';
  if (isWordChar(before)) return false;
  if (mode === 'prefix') return true;
  const after = matchStart + matchLength < text.length ? text[matchStart + matchLength] : '';
  return !isWordChar(after);
}

// توکنایز با آفستِ اصلی: [{text, start, end}] رویِ متنِ نرمالِ فضادار.
export function tokenizeWithOffsets(text) {
  const re = new RegExp(WORD_CHAR_PATTERN + '+', 'g');
  const out = [];
  let m;
  while ((m = re.exec(text || '')) !== null) {
    out.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  }
  return out;
}

// lower_bound رویِ strippedToOriginal: اولین ایندکسِ stripped که
// آفستِ اصلیِ آن >= p است.
export function originalIndexToStrippedIndex(strippedToOriginal, originalIndex) {
  let lo = 0;
  let hi = (strippedToOriginal || []).length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (strippedToOriginal[mid] < originalIndex) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// تطابق رویِ یک رشتهٔ معمولی (EPUB و تست‌ها): [{start, end}] در
// مختصاتِ همان رشته. فاصله/ZWNJِ عبارت، عیناً حساب می‌شود.
export function findTextMatchSpans(text, query, options = {}) {
  const { wholeWord = true, caseSensitive = false, prefix = false } = options;
  const normText = caseSensitive ? normalizeSearchTextCaseSensitive(text) : normalizeSearchText(text);
  const normQuery = caseSensitive ? normalizeSearchTextCaseSensitive(query) : normalizeSearchText(query);
  const q = normQuery.trim();
  if (!q) return [];
  const qStripped = q.replace(/[\s\u200C\u200D]+/g, '');
  const out = [];
  if (prefix) {
    const maxDist = qStripped.length <= 4 ? 1 : 2;
    for (const t of tokenizeWithOffsets(normText)) {
      const tok = t.text.replace(/[\s\u200C\u200D]+/g, '');
      const hit = tok.startsWith(qStripped) || (qStripped.length >= 4 && levenshteinBounded(tok, qStripped, maxDist) <= maxDist);
      if (!hit) continue;
      if (!isWordBoundaryMatch(normText, t.start, t.text.length, 'prefix')) continue;
      out.push({ start: t.start, end: t.end });
    }
    return out;
  }
  let from = 0;
  while (true) {
    const idx = normText.indexOf(q, from);
    if (idx === -1) break;
    if (!wholeWord || isWordBoundaryMatch(normText, idx, q.length, 'whole')) {
      out.push({ start: idx, end: idx + q.length });
    }
    from = idx + Math.max(1, q.length);
  }
  return out;
}

// تطابق رویِ ورودیِ صفحهٔ PDF (extractPageText): [{sStart, sEnd, start, end}].
// بررسیِ مرز، رویِ متنِ نرمالِ فضادار با آفست‌هایِ اصلی انجام می‌شود؛
// چون stripped همهٔ فاصله‌ها را حذف می‌کند، بررسیِ مرز رویِ stripped
// «the ear» را اشتباهاً رد می‌کرد.
export function findStrippedMatchSpans(entry, query, options = {}) {
  const { wholeWord = true, caseSensitive = false, prefix = false } = options;
  if (!entry || !query) return [];
  const stripped = caseSensitive ? entry.strippedCase || entry.stripped : entry.stripped;
  const normalized = caseSensitive ? entry.normalizedCase || entry.normalized : entry.normalized;
  const map = entry.strippedToOriginal || [];
  if (!stripped || !normalized || map.length === 0) return [];
  const q = (caseSensitive ? normalizeSearchTextCaseSensitive(query) : normalizeSearchText(query)).replace(/[\s\u200C\u200D]+/g, '');
  if (!q) return [];
  const out = [];
  if (prefix) {
    const maxDist = q.length <= 4 ? 1 : 2;
    for (const t of tokenizeWithOffsets(normalized)) {
      const tok = t.text.replace(/[\s\u200C\u200D]+/g, '');
      const hit = tok.startsWith(q) || (q.length >= 4 && levenshteinBounded(tok, q, maxDist) <= maxDist);
      if (!hit) continue;
      if (!isWordBoundaryMatch(normalized, t.start, t.text.length, 'prefix')) continue;
      const sStart = originalIndexToStrippedIndex(map, t.start);
      const sEnd = originalIndexToStrippedIndex(map, t.end);
      if (sEnd > sStart) out.push({ sStart, sEnd, start: t.start, end: t.end });
    }
    return out;
  }
  let from = 0;
  while (true) {
    const idx = stripped.indexOf(q, from);
    if (idx === -1) break;
    const origStart = map[idx];
    const origEnd = map[idx + q.length - 1] + 1;
    if (!wholeWord || isWordBoundaryMatch(normalized, origStart, origEnd - origStart, 'whole')) {
      out.push({ sStart: idx, sEnd: idx + q.length, start: origStart, end: origEnd });
    }
    from = idx + Math.max(1, q.length);
  }
  return out;
}

// ── MiniSearch (بارگذاریِ تنبل؛ نبودِ آن، موتورِ بومی را متوقف نمی‌کند) ──
let miniSearchModulePromise = null;
export function loadMiniSearch() {
  if (!miniSearchModulePromise) {
    miniSearchModulePromise = import('minisearch')
      .then((m) => (m && m.default) || m || null)
      .catch(() => null);
  }
  return miniSearchModulePromise;
}

// ایندکسِ سبکِ صفحه/فصل: شتاب‌دهندهٔ مرتب‌سازیِ نتایج است، نه جایگزینِ
// موتورِ بومی — مکانِ دقیقِ تطابق و مستطیلِ هایلایت همیشه از موتورِ
// بومی می‌آید. add تکراری، خطا نمی‌دهد.
export function createMiniSearchIndex() {
  return loadMiniSearch().then((MiniSearch) => {
    if (!MiniSearch) return null;
    let mini;
    try {
      mini = new MiniSearch({
        fields: ['text'],
        storeFields: ['label'],
        searchOptions: { prefix: true, fuzzy: 0.2, combineWith: 'AND' },
      });
    } catch (_) {
      return null;
    }
    return {
      add(id, text, label) {
        try {
          mini.add({ id, text: text || '', label: label || String(id) });
        } catch (_) {}
      },
      search(query, opts = {}) {
        try {
          const res = mini.search(query || '', {
            prefix: opts.prefix !== false,
            fuzzy: opts.fuzzy ? 0.2 : 0,
            combineWith: 'AND',
          });
          return res.map((r) => r.id);
        } catch (_) {
          return [];
        }
      },
      has(id) {
        try {
          return mini.has(id);
        } catch (_) {
          return false;
        }
      },
    };
  });
}
