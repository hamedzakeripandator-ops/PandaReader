// ============================================================================
// readingActivity.js — ثبتِ دسته‌ایِ فعالیتِ واقعیِ مطالعه
//
// مرحله ۶ ـ بخش الف: ریدرها (PdfViewer / VerticalViewer) هر بازدیدِ
// صفحه و هر ۳۰ ثانیه حضورِ فعال را اینجا گزارش می‌کنند؛ این ماژول،
// گزارش‌ها را جمع می‌کند و دسته‌ای (حداکثر هر ۴۵ ثانیه، یا هنگامِ
// مخفی‌شدنِ صفحه/بسته‌شدنِ ریدر) با یک فراخوانِ دیتابیس می‌فرستد تا
// نوشتنِ دیتابیس، خواندن را کند نکند. صفحه‌ها در هر نشست و برای هر
// فایل، فقط یک بار شمرده می‌شوند (بازگشت به صفحهٔ قبلی، دوباره
// شمرده نمی‌شود). اگر ارتباط با دیتابیس نباشد یا خطایی رخ دهد،
// آمار بی‌صدا رها می‌شود و خواندن هرگز خراب نمی‌کند.
//
// مرحله ۶ ـ بخش ب: ثانیه‌ها دیگر با گام‌های ۳۰ ثانیه‌ای شمرده
// نمی‌شوند؛ زمانِ شروعِ بازهٔ قابل‌مشاهدهٔ فعلی نگه داشته می‌شود و
// در هر تیکِ ضربان، در visibilitychange، در beforeunload و در
// end()، مابه‌التفاوتِ دقیقِ ثانیه‌های سپری‌شده به انباشتگر اضافه
// می‌شود تا مطالعهٔ ۱۰ یا ۲۵ ثانیه‌ای هم دقیق ثبت شود. همچنین
// waitForPendingFlush() صادر می‌شود تا مصرف‌کننده (مثلاً پروفایل)
// پیش از خواندنِ آمار، منتظرِ اتمامِ فلاشِ در حالِ انجام بماند.
// ============================================================================

import { coreApi } from './coreApi';
import { localDateKey } from '../utils/readingStats';

const FLUSH_INTERVAL_MS = 45000;
const HEARTBEAT_MS = 30000;
const MAX_PENDING_PAGES = 5000;
const MAX_PENDING_SECONDS = 3600;

let currentFilePath = null;
let visitedPages = new Set();
let pendingPages = 0;
let pendingSeconds = 0;
let heartbeatTimer = null;
let flushTimer = null;
let flushQueued = false;
let flushPromise = null;
// مرحله ۶ ـ بخش ب: مُهرِ زمانیِ شروعِ بازهٔ قابل‌مشاهدهٔ فعلی
// (میلی‌ثانیه)؛ null یعنی هیچ بازهٔ فعالی در جریان نیست (صفحه
// مخفی است یا نشستی شروع نشده است).
let lastVisibleAt = null;

function normalizeKey(filePath) {
  return String(filePath || '').trim().replace(/[\\/]+/g, '\\').toLowerCase();
}

function isDocumentHidden() {
  return typeof document !== 'undefined' && document.hidden;
}

// مرحله ۶ ـ بخش ب: انباشتِ دقیقِ ثانیه‌های سپری‌شده از شروعِ بازهٔ
// قابل‌مشاهدهٔ فعلی تا همین لحظه، و شروعِ دوبارهٔ بازه از حالا.
// این تابع، وضعیتِ مخفی‌بودن را خودش چک نمی‌کند: فراخوانندهٔ
// مسئولِ گذارِ مخفی‌شدن (onVisibilityChange)، پیش از نال‌کردنِ
// مُهرِ زمانی، همین‌جا زمانِ تا لحظهٔ مخفی‌شدن را انباشته می‌کند؛
// اگر تابع، خودش مخفی‌بودن را بهانه می‌کرد، دقیقاً همان ثانیه‌ها
// گم می‌شدند. وقتی بازه‌ای در جریان نیست (lastVisibleAt نال است)،
// هیچ‌چیز انباشته نمی‌شود.
function accumulateElapsedSeconds() {
  if (lastVisibleAt === null) return;
  const elapsed = Math.floor((Date.now() - lastVisibleAt) / 1000);
  if (elapsed > 0) {
    pendingSeconds += elapsed;
  }
  lastVisibleAt = Date.now();
}

function flushNow() {
  // اگر فلاشی در حالِ انجام است، فقط علامت بزن تا پس از اتمامش،
  // باقی‌مانده هم فرستاده شود؛ Promise همان فلاشِ جاری برگردانده
  // می‌شود تا منتظر، کلِ زنجیره را ببیند.
  if (flushPromise) {
    flushQueued = true;
    return flushPromise;
  }
  if (pendingPages <= 0 && pendingSeconds <= 0) return Promise.resolve();
  const payload = {
    date: localDateKey(),
    pages: Math.min(MAX_PENDING_PAGES, pendingPages),
    seconds: Math.min(MAX_PENDING_SECONDS, pendingSeconds),
    // مرحلهٔ ۳۵ §۱: کلیدِ کتابِ جلسهٔ جاری تا ورکر، آمار را به
    // تفکیکِ کتاب هم در byBook بنویسد (بدونِ آن، فقط آمارِ کلی).
    fileKey: currentFilePath || undefined,
  };
  pendingPages = 0;
  pendingSeconds = 0;
  if (!payload.date) return Promise.resolve();
  flushPromise = (async () => {
    try {
      if (coreApi && typeof coreApi.recordReadingActivity === 'function') {
        await coreApi.recordReadingActivity(payload);
      }
    } catch (_) {
      // آمار، هرگز خواندن را خراب نمی‌کند.
    }
    flushPromise = null;
    if (flushQueued) {
      flushQueued = false;
      if (pendingPages > 0 || pendingSeconds > 0) {
        return flushNow();
      }
    }
  })();
  return flushPromise;
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushNow();
  }, FLUSH_INTERVAL_MS);
  if (typeof flushTimer.unref === 'function') {
    try { flushTimer.unref(); } catch (_) {}
  }
}

function onVisibilityChange() {
  if (typeof document === 'undefined') return;
  if (document.hidden) {
    // مرحله ۶ ـ بخش ب: پیش از فلاش، ثانیه‌های بازهٔ جاری دقیق
    // انباشته می‌شوند تا با مخفی‌شدنِ تب، چیزی گم نشود؛ سپس مُهرِ
    // زمانی نال می‌شود تا زمانِ مخفی‌بودن، هرگز شمرده نشود.
    accumulateElapsedSeconds();
    lastVisibleAt = null;
    flushNow();
  } else {
    // بازگشت به حالتِ قابل‌مشاهده: بازهٔ تازه از همین لحظه شروع
    // می‌شود تا زمانِ مخفی‌بودن، هرگز شمرده نشود.
    if (currentFilePath) lastVisibleAt = Date.now();
  }
}

function onBeforeUnload() {
  // مرحله ۶ ـ بخش ب: بهترین تلاش برای ثبتِ ثانیه‌های پایانی پیش از
  // بسته‌شدنِ پنجره/تب؛ فلاشِ ناهمگام ممکن است در همهٔ محیط‌ها
  // کامل نشود، ولی ثانیه‌ها دست‌کم در انباشتگر می‌مانند و فلاشِ
  // زمان‌بندی‌شده یا بعدی، آن‌ها را می‌فرستد.
  accumulateElapsedSeconds();
  flushNow();
}

/** شروعِ نشستِ مطالعه برای یک فایل (با عوض‌شدنِ فایل، مجموعهٔ صفحات صفر می‌شود). */
export function beginReadingSession(filePath) {
  const key = normalizeKey(filePath);
  if (!key) return;
  const changed = currentFilePath !== key;
  if (changed) {
    currentFilePath = key;
    visitedPages = new Set();
    // مرحلهٔ ۳۶ §۵: ثبتِ فوریِ کتاب در byBook، پیش از هر فلاشِ زمانی.
    registerCurrentBook();
  }
  if (heartbeatTimer) return;
  // بازهٔ قابل‌مشاهده از همین لحظه شروع می‌شود، مگر اینکه صفحه از
  // ابتدا مخفی باشد (در آن صورت، visibilitychange آن را شروع می‌کند).
  lastVisibleAt = isDocumentHidden() ? null : Date.now();
  heartbeatTimer = setInterval(() => {
    if (isDocumentHidden()) return;
    // مرحله ۶ ـ بخش ب: به‌جای افزودنِ ثابتِ ۳۰ ثانیه، زمانِ دقیقِ
    // سپری‌شده از تیکِ قبل انباشته می‌شود (معمولاً ۳۰ ثانیه، ولی
    // اگر تیک دیرتر خورد، همان‌قدر که واقعاً گذشته است).
    accumulateElapsedSeconds();
    scheduleFlush();
  }, HEARTBEAT_MS);
  if (typeof heartbeatTimer.unref === 'function') {
    try { heartbeatTimer.unref(); } catch (_) {}
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityChange);
  }
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('beforeunload', onBeforeUnload);
  }
}

// مرحلهٔ ۳۶ §۵: ثبتِ ۰/۰ برایِ کتابِ جاری — ورکر، با همین پیام،
// ورودیِ byBook را می‌سازد (بدونِ آن، کتاب تا اولین فلاشِ ۴۵ ثانیه‌ای
// در آماربندی‌هایِ سفارشی دیده نمی‌شد).
export function registerCurrentBook() {
  if (!currentFilePath) return;
  try {
    if (coreApi && typeof coreApi.recordReadingActivity === 'function') {
      const r = coreApi.recordReadingActivity({ date: localDateKey(), pages: 0, seconds: 0, fileKey: currentFilePath });
      if (r && typeof r.catch === 'function') r.catch(() => {});
    }
  } catch (_) {}
}

/** گزارشِ بازدیدِ یک صفحه؛ فقط اولین بازدیدِ هر صفحه در نشست شمرده می‌شود. */
export function notePageVisit(pageNumber) {
  if (!currentFilePath) return;
  const page = Math.floor(Number(pageNumber) || 0);
  if (page <= 0) return;
  if (visitedPages.has(page)) return;
  visitedPages.add(page);
  pendingPages += 1;
  scheduleFlush();
}

/**
 * مرحله ۶ ـ بخش ب: انتظار برای اتمامِ فلاشِ جاری (و فلاشِ فوریِ
 * باقی‌مانده، اگر چیزی انباشته شده باشد). پروفایل، پیش از خواندنِ
 * آمار، این را صدا می‌زند تا آمارِ لحظاتی پیش را هم ببیند. اگر
 * نشستی فعال نیست یا چیزی برای فرستادن نیست، بی‌درنگ حل می‌شود.
 */
export async function waitForPendingFlush() {
  accumulateElapsedSeconds();
  if (pendingPages > 0 || pendingSeconds > 0) {
    await flushNow();
  }
  if (flushPromise) {
    await flushPromise;
  }
  // اگر در حینِ فلاش، دادهٔ تازه‌ای انباشته شده باشد، یک دورِ دیگر
  // هم صبر می‌کنیم تا آمار، واقعاً تا آخرین لحظه به‌روز باشد.
  if (pendingPages > 0 || pendingSeconds > 0) {
    await flushNow();
  }
  if (flushPromise) {
    await flushPromise;
  }
}

/** پایانِ نشست: ضربان متوقف و باقی‌ماندهٔ گزارش‌ها فوراً فرستاده می‌شود. */
export function endReadingSession() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', onVisibilityChange);
  }
  if (typeof window !== 'undefined' && window.removeEventListener) {
    window.removeEventListener('beforeunload', onBeforeUnload);
  }
  // مرحله ۶ ـ بخش ب: ثانیه‌های بازهٔ جاری، پیش از پایانِ نشست دقیق
  // انباشته می‌شوند؛ وگرنه مطالعهٔ کوتاه‌تر از ۳۰ ثانیه، صفر ثبت
  // می‌شد.
  accumulateElapsedSeconds();
  lastVisibleAt = null;
  currentFilePath = null;
  visitedPages = new Set();
  flushNow();
}

// ============================================================================
// مرحله ۱۴: موتورِ زمان‌سنجِ سراسریِ کلِ برنامه (App Session &
// Total Time Engine) — جدا از نشستِ مطالعهٔ یک کتاب. از لحظهٔ
// باز شدنِ برنامه (App.jsx) شروع می‌شود و مادامی که پنجره
// قابل‌مشاهده است، هر ۱ ثانیه زمانِ حضور را می‌شمارد؛ دسته‌ای
// (حداکثر هر ۴۵ ثانیه، یا هنگامِ مخفی‌شدن/بسته‌شدن) با
// RECORD_APP_ACTIVITY در readingStats.totalAppSeconds و تفکیکِ
// روزانه (days[date].appSeconds) ذخیره می‌شود.
// ============================================================================

const APP_FLUSH_INTERVAL_MS = 45000;
let appSessionStarted = false;
let appSessionTotalSeconds = 0;
let appPendingSeconds = 0;
let appLastVisibleAt = null;
let appHeartbeatTimer = null;
let appFlushTimer = null;
let appFlushPromise = null;
let appFlushQueued = false;

function accumulateAppElapsed() {
  if (appLastVisibleAt === null) return;
  const elapsed = Math.floor((Date.now() - appLastVisibleAt) / 1000);
  if (elapsed > 0) {
    appPendingSeconds += elapsed;
    appSessionTotalSeconds += elapsed;
  }
  appLastVisibleAt = Date.now();
}

function flushAppNow() {
  if (appFlushPromise) {
    appFlushQueued = true;
    return appFlushPromise;
  }
  if (appPendingSeconds <= 0) return Promise.resolve();
  const payload = { date: localDateKey(), seconds: Math.min(86400, appPendingSeconds) };
  appPendingSeconds = 0;
  if (!payload.date) return Promise.resolve();
  appFlushPromise = (async () => {
    try {
      if (coreApi && typeof coreApi.recordAppActivity === 'function') {
        await coreApi.recordAppActivity(payload);
      }
    } catch (_) {
      // آمارِ حضور، هرگز برنامه را خراب نمی‌کند.
    }
    appFlushPromise = null;
    if (appFlushQueued) {
      appFlushQueued = false;
      if (appPendingSeconds > 0) return flushAppNow();
    }
  })();
  return appFlushPromise;
}

function scheduleAppFlush() {
  if (appFlushTimer) return;
  appFlushTimer = setTimeout(() => {
    appFlushTimer = null;
    flushAppNow();
  }, APP_FLUSH_INTERVAL_MS);
  if (typeof appFlushTimer.unref === 'function') {
    try { appFlushTimer.unref(); } catch (_) {}
  }
}

function onAppVisibilityChange() {
  if (typeof document === 'undefined') return;
  if (document.hidden) {
    accumulateAppElapsed();
    appLastVisibleAt = null;
    flushAppNow();
  } else if (appSessionStarted) {
    appLastVisibleAt = Date.now();
  }
}

function onAppBeforeUnload() {
  // بهترین تلاش برای ثبتِ ثانیه‌های پایانی؛ مثلِ نشستِ مطالعه،
  // فلاشِ ناهمگام ممکن است در همهٔ محیط‌ها کامل نشود، ولی
  // فلاشِ دوره‌ایِ ۴۵ ثانیه‌ای، خطا را به همان سقف محدود می‌کند.
  accumulateAppElapsed();
  flushAppNow();
}

/** شروعِ نشستِ سراسریِ برنامه؛ فقط یک بار اثر دارد. */
export function beginAppSession() {
  if (appSessionStarted) return;
  appSessionStarted = true;
  appLastVisibleAt = isDocumentHidden() ? null : Date.now();
  appHeartbeatTimer = setInterval(() => {
    if (isDocumentHidden()) return;
    accumulateAppElapsed();
    scheduleAppFlush();
  }, 1000);
  if (typeof appHeartbeatTimer.unref === 'function') {
    try { appHeartbeatTimer.unref(); } catch (_) {}
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onAppVisibilityChange);
  }
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('beforeunload', onAppBeforeUnload);
  }
}

/** ثانیه‌هایِ نشستِ فعلیِ برنامه (شاملِ بازهٔ در جریانِ دیده‌شده). */
export function getAppSessionSeconds() {
  let current = 0;
  if (appLastVisibleAt !== null) {
    current = Math.floor((Date.now() - appLastVisibleAt) / 1000);
  }
  return appSessionTotalSeconds + Math.max(0, current);
}

/** انتظار برای اتمامِ فلاشِ حضورِ در حالِ انجام. */
export async function waitForAppFlush() {
  accumulateAppElapsed();
  if (appPendingSeconds > 0) await flushAppNow();
  if (appFlushPromise) await appFlushPromise;
  if (appPendingSeconds > 0) await flushAppNow();
  if (appFlushPromise) await appFlushPromise;
}

export const readingActivity = {
  begin: beginReadingSession,
  visitPage: notePageVisit,
  end: endReadingSession,
  waitForPendingFlush,
  beginAppSession,
  getAppSessionSeconds,
  waitForAppFlush,
};

export default readingActivity;
