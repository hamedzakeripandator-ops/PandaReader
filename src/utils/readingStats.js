// ============================================================================
// readingStats.js — محاسبهٔ خالصِ آمارِ مطالعه (بدونِ وابستگی به React/Electron)
//
// مرحله ۶ ـ بخش الف: آمارِ واقعیِ مطالعه از روی جدولِ روزهای
// `readingStats.days` در دیتابیس حساب می‌شود؛ کلیدِ هر روز، تاریخِ
// محلیِ `YYYY-MM-DD` است. این توابع خالص‌اند تا در Node هم تست شوند.
// ============================================================================

const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** کلیدِ روزِ محلیِ یک Date (نه UTC — رکوردِ پیوستگی با تقویمِ کاربر معنا دارد). */
export function localDateKey(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** کلیدِ روزِ قبلِ یک کلیدِ معتبر؛ null اگر کلید نامعتبر است. */
export function previousDayKey(dayKey) {
  if (!DAY_KEY_RE.test(dayKey || '')) return null;
  const d = new Date(`${dayKey}T12:00:00`);
  d.setDate(d.getDate() - 1);
  return localDateKey(d);
}

/** آیا دو کلیدِ روز، متوالی‌اند (دومی، دقیقاً روزِ بعدِ اولی است)؟ */
export function isNextDay(prevKey, nextKey) {
  return previousDayKey(nextKey) === prevKey;
}

function sanitizeDayEntry(entry) {
  if (!entry || typeof entry !== 'object') return { pages: 0, seconds: 0 };
  const pages = Math.max(0, Math.min(100000, Math.floor(Number(entry.pages) || 0)));
  const seconds = Math.max(0, Math.min(86400, Math.floor(Number(entry.seconds) || 0)));
  return { pages, seconds };
}

/**
 * خلاصهٔ آمار از روی نقشهٔ روزها.
 * @param {Object} days - { 'YYYY-MM-DD': { pages, seconds } }
 * @returns {{totalPages, totalSeconds, totalDays, currentStreak, bestStreak, todayPages, todaySeconds, last7: Array<{key, pages, seconds}>}}
 *
 * رکوردِ پیوستگیِ جاری (currentStreak): روزهای متوالیِ دارای فعالیت
 * که به امروز یا دیروز ختم می‌شوند (اگر امروز هنوز فعالیتی ثبت نشده،
 * رکوردِ دیروز هنوز «جاری» است و با اولین فعالیتِ امروز ادامه می‌یابد).
 * رکوردِ پیوستگیِ بهترین (bestStreak): طولانی‌ترین زنجیرهٔ متوالی در
 * کلِ تاریخچه. روزی که فقط ثانیه دارد ولی صفحه ندارد هم «روزِ فعال»
 * حساب می‌شود (کاربر کتاب را باز کرده و خوانده، ولی صفحه عوض نکرده).
 */
export function computeReadingSummary(days, todayKey = localDateKey()) {
  const clean = {};
  for (const [key, entry] of Object.entries(days || {})) {
    if (DAY_KEY_RE.test(key)) clean[key] = sanitizeDayEntry(entry);
  }
  const keys = Object.keys(clean).sort();
  let totalPages = 0;
  let totalSeconds = 0;
  for (const key of keys) {
    totalPages += clean[key].pages;
    totalSeconds += clean[key].seconds;
  }

  const isActiveDay = (key) => {
    const e = clean[key];
    return Boolean(e && (e.pages > 0 || e.seconds > 0));
  };

  // بهترین زنجیره: پیمایشِ کلیدهای مرتب و شمردنِ زنجیره‌های متوالی.
  let bestStreak = 0;
  let run = 0;
  let prevKey = null;
  for (const key of keys) {
    if (!isActiveDay(key)) {
      run = 0;
      prevKey = null;
      continue;
    }
    run = prevKey !== null && isNextDay(prevKey, key) ? run + 1 : 1;
    if (run > bestStreak) bestStreak = run;
    prevKey = key;
  }

  // زنجیرهٔ جاری: از امروز (یا دیروز، اگر امروز هنوز فعالیتی نیست)
  // به عقب بشمار، تا وقتی روزها متوالی و فعال‌اند.
  let currentStreak = 0;
  let cursor = isActiveDay(todayKey) ? todayKey : previousDayKey(todayKey);
  while (cursor && isActiveDay(cursor)) {
    currentStreak += 1;
    cursor = previousDayKey(cursor);
  }

  // ۷ روزِ اخیر (از ۶ روزِ پیش تا امروز)، برای نمودارِ میله‌ای.
  const last7 = [];
  const today = new Date(`${todayKey}T12:00:00`);
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = localDateKey(d);
    const entry = clean[key] || { pages: 0, seconds: 0 };
    last7.push({ key, pages: entry.pages, seconds: entry.seconds });
  }

  const todayEntry = clean[todayKey] || { pages: 0, seconds: 0 };
  return {
    totalPages,
    totalSeconds,
    totalDays: keys.filter(isActiveDay).length,
    currentStreak,
    bestStreak,
    todayPages: todayEntry.pages,
    todaySeconds: todayEntry.seconds,
    last7,
  };
}

/** ثانیه → «۲:۴۵ ساعت» / «۳۵ دقیقه» (فارسیِ نمایشی، بدونِ اعشارِ اضافی). */
export function formatReadingHours(totalSeconds) {
  const s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  if (hours <= 0) return `${minutes} دقیقه`;
  if (minutes === 0) return `${hours} ساعت`;
  return `${hours} ساعت و ${minutes} دقیقه`;
}
