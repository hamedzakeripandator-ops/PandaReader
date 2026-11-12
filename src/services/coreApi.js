const getApi = () => {
  if (typeof window !== 'undefined' && window.api) {
    return window.api;
  }
  return null;
};

// تابع کمکی برای اعمال سقف زمانی (Timeout Guard) روی پرامیس‌های IPC
function withTimeout(promise, timeoutMs = 15000, fallbackValue = null) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(fallbackValue), timeoutMs))
  ]);
}

// مرحلهٔ ۵۹ §۲.۴: سقف‌هایِ زمانیِ دیتابیس — عملیاتِ عادی ۱۵۰۰۰ و
// عملیاتِ سنگین ۴۵۰۰۰ میلی‌ثانیه. فهرستِ سنگین، همان فهرستِ
// electron/ipcHandlers.js است (دو نسخهٔ همسان؛ main با require و
// رندرر با ESM کار می‌کنند و ماژولِ مشترکی ندارند — اگر یکی عوض شد،
// دیگری هم باید عوض شود). رندرر، ۵۰۰ میلی‌ثانیه دیرتر از main
// تایم‌اوت می‌کند (۱۵۵۰۰/۴۵۵۰۰) تا خطایِ کنترل‌شدهٔ main همیشه
// زودتر از تایم‌اوتِ رندرر برسد و تایم‌اوتِ رندرر، فقط پشتیبانِ
// هنگ‌کردنِ main باشد (قراردادِ قدیمیِ ۵۰۰۰/۵۵۰۰).
const HEAVY_DB_ACTIONS = new Set([
  'BUILD_BACKUP',
  'RESTORE_BACKUP',
  'SYNC_MISSING_FILES',
  'SYNC_AND_CLEAN_MISSING_FILES',
  'PRUNE_MISSING_FILES',
  'GET_ALL_COVER_CACHES',
]);
const DB_TIMEOUT_MS = 15000;
const DB_HEAVY_TIMEOUT_MS = 45000;
const DB_TIMEOUT_MARGIN_MS = 500;

export const coreApi = {
  isAvailable: () => Boolean(getApi()),

  getFilePath: (file) => {
    const api = getApi();
    if (!api?.getFilePath) return file?.path || file?.filePath || '';
    try {
      return api.getFilePath(file);
    } catch (_) {
      return file?.path || file?.filePath || '';
    }
  },

  openFile: async () => {
    const api = getApi();
    if (!api?.openFile) return { success: false, error: 'محیط الکترون در دسترس نیست.' };
    try {
      return await api.openFile();
    } catch (err) {
      return { success: false, error: err?.message || 'خطا در انتخاب فایل' };
    }
  },

  openFolder: async () => {
    const api = getApi();
    if (!api?.openFolder) return { success: false, error: 'محیط الکترون در دسترس نیست.' };
    try {
      return await api.openFolder();
    } catch (err) {
      return { success: false, error: err?.message || 'خطا در انتخاب پوشه' };
    }
  },

  // باز کردن دیالوگ انتخاب تصویر کاور سفارشی و ذخیره دائمی در دیتابیس
  selectCustomCover: async (comicFilePath = '') => {
    const api = getApi();
    if (!api?.selectCustomCover) {
      return { success: false, error: 'محیط الکترون در دسترس نیست.' };
    }
    try {
      return await api.selectCustomCover(comicFilePath);
    } catch (err) {
      return { success: false, error: err?.message || 'خطا در انتخاب تصویر کاور' };
    }
  },

  handleDrop: async (filePaths) => {
    const api = getApi();
    if (!api?.handleDrop) return { success: false, error: 'محیط الکترون در دسترس نیست.' };
    if (!filePaths || !Array.isArray(filePaths) || filePaths.length === 0) {
      return { success: false, error: 'هیچ فایلی برای پردازش ارسال نشد.' };
    }
    try {
      return await api.handleDrop(filePaths);
    } catch (err) {
      return { success: false, error: err?.message || 'خطا در پردازش فایل‌های رهاشده' };
    }
  },

  // لغو فوری عملیات لودینگ و استخراج فایل
  cancelExtraction: async () => {
    const api = getApi();
    if (!api?.cancelExtraction) return { success: false };
    try {
      return await api.cancelExtraction();
    } catch (err) {
      return { success: false, error: err?.message };
    }
  },

  // پاک‌سازی فایل‌های استخراج‌شده از هارد دیسک پس از اتمام مطالعه
  cleanupComicCache: async () => {
    const api = getApi();
    if (!api?.cleanupComicCache) return { success: false };
    try {
      return await api.cleanupComicCache();
    } catch (_) {
      return { success: false };
    }
  },

  // استخراج کاور صفحه اول همراه با سقف مهلت ۵ ثانیه‌ای جهت پیشگیری از انجماد UI
  getFirstPageThumbnail: async (filePath) => {
    const api = getApi();
    if (!api?.getFirstPageThumbnail || !filePath) return { success: false };
    try {
      const call = api.getFirstPageThumbnail(filePath);
      return await withTimeout(call, 5000, {
        success: false,
        error: 'مهلت زمانی استخراج کاور به پایان رسید.'
      });
    } catch (err) {
      return { success: false, error: err?.message };
    }
  },

  sortDirectory: async (filePath, sortBy = 'name_asc') => {
    const api = getApi();
    if (!api?.sortDirectory || !filePath) return null;
    try {
      return await api.sortDirectory(filePath, sortBy);
    } catch (_) {
      return null;
    }
  },

  // مرحله ۱ ـ بخش الف: قراردادِ تایم‌اوتِ دیتابیس — main: ۱۵۰۰۰
  // (سنگین: ۴۵۰۰۰)، رندرر: ۱۵۵۰۰ (سنگین: ۴۵۵۰۰) میلی‌ثانیه. پس
  // خطای کنترل‌شدهٔ main همیشه زودتر از تایم‌اوتِ رندرر می‌رسد و
  // رندرر، نیم ثانیه زودتر خطای کاذب نشان نمی‌دهد (باگِ قبلی:
  // ۳۵۰۰ در برابرِ ۴۰۰۰). تایم‌اوتِ رندرر حالا فقط یک پشتیبان است
  // برای وقتی که خودِ main هم هنگ کرده باشد.
  // جفت‌شدنِ درخواست و پاسخ در دو لایه تضمین شده است: رندرر↔main با
  // خودِ مکانیزمِ invoke الکترون، و main↔ورکر با reqIdی یکتا که ورکر
  // عیناً در پاسخ برمی‌گرداند (و پاسخِ دیررسِ بدونِ callback، در
  // مسیریابِ main نادیده گرفته می‌شود تا با درخواستِ بعدی قاطی نشود).
  dbAction: async (requestData) => {
    const api = getApi();
    if (!api?.dbAction) return { type: 'error', message: 'ارتباط با دیتابیس برقرار نشد.' };
    try {
      const call = api.dbAction(requestData);
      const baseTimeout = HEAVY_DB_ACTIONS.has(requestData?.action)
        ? DB_HEAVY_TIMEOUT_MS
        : DB_TIMEOUT_MS;
      return await withTimeout(call, baseTimeout + DB_TIMEOUT_MARGIN_MS, { type: 'error', message: 'تایم‌اوت عملیات دیتابیس' });
    } catch (err) {
      return { type: 'error', message: err?.message || 'خطا در عملیات دیتابیس' };
    }
  },

  // متدهای کمکی مدیریت هایلایت‌ها، اشکال و یادداشت‌های روی صفحه
  getPageAnnotations: async (filePath, pageNumber) => {
    return await coreApi.dbAction({
      action: 'GET_ANNOTATIONS',
      payload: { filePath, pageNumber }
    });
  },

  savePageAnnotations: async (filePath, pageNumber, items) => {
    return await coreApi.dbAction({
      action: 'SAVE_ANNOTATIONS',
      payload: { filePath, pageNumber, items }
    });
  },

  clearPageAnnotations: async (filePath, pageNumber = null) => {
    return await coreApi.dbAction({
      action: 'CLEAR_ANNOTATIONS',
      payload: { filePath, pageNumber }
    });
  },

  // مرحله ۷ ـ بخش الف: اطلاعاتِ محیط (نسخه/حالت/سلامتِ سیستم)
  // برای صفحهٔ دانلودها. با تایم‌اوتِ ۵ ثانیه‌ایِ مرسومِ همین
  // فایل، و همان قراردادِ {success:false} وقتی API در دسترس نیست.
  getAppInfo: async () => {
    const api = getApi();
    if (!api?.getAppInfo) return { success: false, error: 'محیط الکترون در دسترس نیست.' };
    try {
      return await withTimeout(api.getAppInfo(), 5000, {
        success: false,
        error: 'تایم‌اوت دریافتِ اطلاعاتِ برنامه',
      });
    } catch (err) {
      return { success: false, error: err?.message || 'خطا در دریافتِ اطلاعاتِ برنامه' };
    }
  },
  // مرحلهٔ ۵۵ §۲ (m2): به‌روزرسانیِ خودکار از گیت‌هاب.
  // الگو، همان getAppInfo است: گاردِ api?.، تایم‌اوتِ مرسوم و
  // پاسخِ { success: false } وقتی API در دسترس نیست. دانلود و
  // نصب، عمداً بدونِ withTimeout اند: دانلود دقیقه‌ها طول می‌کشد
  // و پیشرفتش با رویداد می‌آید، و quitAndInstall برنامه را خارج
  // می‌کند (همان استدلالِ exportAnnotatedPdf برای دیالوگ‌دارها).
  getAppVersion: async () => {
    const api = getApi();
    if (!api?.getAppVersion) return { version: '', isPackaged: false };
    try {
      return await withTimeout(api.getAppVersion(), 5000, { version: '', isPackaged: false });
    } catch (err) {
      return { version: '', isPackaged: false };
    }
  },

  checkForUpdates: async () => {
    const api = getApi();
    if (!api?.checkForUpdates) return { success: false, status: 'error', version: '', message: 'محیط الکترون در دسترس نیست.' };
    try {
      return await withTimeout(api.checkForUpdates(), 60000, { success: false, status: 'error', version: '', message: 'مهلت زمانی بررسیِ به‌روزرسانی به پایان رسید.' });
    } catch (err) {
      return { success: false, status: 'error', version: '', message: err?.message || 'خطا در بررسیِ به‌روزرسانی' };
    }
  },

  // مرحلهٔ ۵۸ §۲ (m2): لایهٔ سومِ بررسی — fetch مستقیمِ رندرر
  // (کرومیوم؛ پروکسیِ سیستمیِ ویندوز / V2Ray را می‌بیند). فقط وقتی
  // اجرا می‌شود که IPCِ check-for-updates خطا داده باشد؛ پس هر
  // شکستِ main، بی‌پاسخ نمی‌ماند. بدونِ توکن؛ cache: 'no-store'
  // یعنی هر کلیک، دوباره از گیت‌هاب می‌خواند و هیچ کشی نیست.
  // تایم‌اوتِ ۱۵ ثانیه با AbortController. ۴۰۴ یعنی «هنوز هیچ
  // انتشاری نیست» و همان پاسخِ مؤدبانهٔ 'no-releases' برمی‌گردد،
  // نه خطایِ شبکه. در این مسیر، نمی‌توان User-Agent گذاشت
  // (هدرِ ممنوعهٔ مرورگر است)؛ گیت‌هاب، بدونِ آن هم جواب می‌دهد.
  fetchLatestReleaseViaRenderer: async (currentVersion) => {
    const current = coreApi.stripVersionPrefix(currentVersion);
    if (typeof window === 'undefined' || typeof window.fetch !== 'function') {
      return { success: false, status: 'error', version: current, updateAvailable: null, latestVersion: '', releaseNotes: '', publishedAt: '', downloadUrl: '', htmlUrl: '', source: 'renderer-fetch', message: 'مرورگرِ داخلی در دسترس نیست.' };
    }
    let controller = null;
    let timer = null;
    try {
      if (typeof AbortController !== 'undefined') {
        controller = new AbortController();
        timer = setTimeout(() => {
          try { controller.abort(); } catch (_) {}
        }, 15000);
      }
      const init = {
        method: 'GET',
        headers: { Accept: 'application/vnd.github.v3+json' },
        cache: 'no-store',
      };
      if (controller) init.signal = controller.signal;
      const res = await window.fetch(coreApi.githubLatestReleaseUrl, init);
      const status = res && typeof res.status === 'number' ? res.status : 0;
      if (status === 404) {
        return { success: true, status: 'no-releases', version: current, updateAvailable: null, latestVersion: '', releaseNotes: '', publishedAt: '', downloadUrl: '', htmlUrl: '', source: 'renderer-fetch', message: 'هنوز نسخهٔ عمومی در بخش Releases گیت‌هاب منتشر نشده است.' };
      }
      if (!res || !res.ok) {
        return { success: false, status: 'error', version: current, updateAvailable: null, latestVersion: '', releaseNotes: '', publishedAt: '', downloadUrl: '', htmlUrl: '', source: 'renderer-fetch', message: 'گیت‌هاب، پاسخِ ' + status + ' داد.' };
      }
      const json = await res.json();
      const norm = coreApi.normalizeLatestRelease(json, current);
      if (!norm || !norm.version) {
        return { success: false, status: 'error', version: current, updateAvailable: null, latestVersion: '', releaseNotes: '', publishedAt: '', downloadUrl: '', htmlUrl: '', source: 'renderer-fetch', message: 'پاسخِ گیت‌هاب، انتشارِ معتبری نداشت.' };
      }
      return {
        success: true,
        status: norm.updateAvailable === true ? 'available' : (norm.updateAvailable === false ? 'up-to-date' : 'checked'),
        version: current,
        updateAvailable: norm.updateAvailable,
        latestVersion: norm.version,
        tagName: norm.tagName,
        releaseNotes: norm.releaseNotes,
        publishedAt: norm.publishedAt,
        htmlUrl: norm.htmlUrl,
        downloadUrl: norm.downloadUrl,
        source: 'renderer-fetch',
      };
    } catch (err) {
      const aborted = err && (err.name === 'AbortError' || err.name === 'TimeoutError');
      return { success: false, status: 'error', version: current, updateAvailable: null, latestVersion: '', releaseNotes: '', publishedAt: '', downloadUrl: '', htmlUrl: '', source: 'renderer-fetch', message: aborted ? 'مهلتِ ۱۵ ثانیه‌ایِ تماس با گیت‌هاب گذشت.' : (err && err.message ? String(err.message) : 'خطا در تماس با گیت‌هاب') };
    } finally {
      try { if (timer) clearTimeout(timer); } catch (_) {}
    }
  },

  // مرحلهٔ ۵۸ §۲ (m2): بررسیِ بروزرسانی با fallback — اول IPC
  // (main: net.fetch پروکسی‌شناس، بعد https) و فقط وقتی IPC،
  // success:false یا status:'error' داد (یا throw کرد)، fetch
  // رندرر. پاسخِ قطعیِ 'no-releases' از IPC، خطا نیست و هرگز
  // fallback نمی‌خورد؛ همان‌طور که هست برمی‌گردد. اگر هر دو لایه
  // شکست خوردند، همان خطایِ IPC (اولویت‌دار) برمی‌گردد تا پیام،
  // همان پیامِ آشنایِ main باشد.
  checkForUpdatesWithFallback: async () => {
    let ipcResult = null;
    let ipcFailed = false;
    try {
      ipcResult = await coreApi.checkForUpdates();
    } catch (_) {
      ipcFailed = true;
    }
    const ipcUsable = !ipcFailed
      && ipcResult
      && typeof ipcResult === 'object'
      && ipcResult.success !== false
      && ipcResult.status !== 'error';
    if (ipcUsable) return ipcResult;
    let currentVersion = '';
    try {
      const v = await coreApi.getAppVersion();
      if (v && typeof v.version === 'string') currentVersion = v.version;
    } catch (_) { currentVersion = ''; }
    if (!currentVersion && ipcResult && typeof ipcResult.version === 'string') {
      currentVersion = ipcResult.version;
    }
    try {
      const fb = await coreApi.fetchLatestReleaseViaRenderer(currentVersion);
      if (fb && fb.success) return fb;
      if (ipcResult && typeof ipcResult === 'object') return ipcResult;
      return fb;
    } catch (_) {
      if (ipcResult && typeof ipcResult === 'object') return ipcResult;
      return { success: false, status: 'error', version: currentVersion, message: 'بررسی بروزرسانی انجام نشد.' };
    }
  },

  downloadUpdate: async () => {
    const api = getApi();
    if (!api?.downloadUpdate) return { success: false, status: 'dev-mode', version: '', message: 'محیط الکترون در دسترس نیست.' };
    try {
      return await api.downloadUpdate();
    } catch (err) {
      return { success: false, status: 'error', version: '', message: err?.message || 'خطا در دانلودِ به‌روزرسانی' };
    }
  },

  quitAndInstallUpdate: async () => {
    const api = getApi();
    if (!api?.quitAndInstallUpdate) return { success: false, status: 'dev-mode', version: '', message: 'محیط الکترون در دسترس نیست.' };
    try {
      return await api.quitAndInstallUpdate();
    } catch (err) {
      return { success: false, status: 'error', version: '', message: err?.message || 'خطا در نصبِ به‌روزرسانی' };
    }
  },

  // مرحلهٔ ۵۵ §۲ (m2): وضعیتِ زندهٔ به‌روزرسانی. تابعِ لغوِ اشتراک
  // را برمی‌گرداند (الگوی onPdfCopyProgress در همین فایل).
  onUpdateStatus: (callback) => {
    const api = getApi();
    if (!api?.onUpdateStatus) return () => {};
    try {
      return api.onUpdateStatus(callback) || (() => {});
    } catch (_) {
      return () => {};
    }
  },

  // مرحلهٔ ۵۷ §۳ (m3) + مرحلهٔ ۵۸ §۲ (m2): موتورِ REST عمومیِ گیت‌هاب؛
  // لایهٔ سومِ آن، fetch رندرر (fetchLatestReleaseViaRenderer) است.
  // مخزنِ hamedzakeripandator-ops/PandaReader عمومی است و بررسیِ
  // آخرین انتشار، با همین فراخوانِ بدونِ توکن انجام می‌شود؛ پس این
  // فایل، هیچ توکنی ندارد و هیچ هدرِ احرازِ هویتی نمی‌فرستد.
  // تابع‌هایِ خالصِ این بخش (مقایسهٔ نسخه، تمیزکردنِ یادداشت‌ها،
  // نرمال‌سازیِ پاسخِ REST)، در Node هم از همین فایل تست می‌شوند.
  githubLatestReleaseUrl: 'https://api.github.com/repos/hamedzakeripandator-ops/PandaReader/releases/latest',
  skippedUpdateVersionKey: 'pandaReader.skippedVersion',
  autoCheckUpdatesKey: 'pandaReader.autoCheckUpdates',

  // «v1.0.3» و «1.0.3» یکی‌اند؛ پیشوندِ v و فاصله‌هایِ اضافه حذف
  // می‌شوند تا مقایسه، همیشه رویِ عددها انجام شود.
  stripVersionPrefix: (version) => {
    if (typeof version !== 'string') return '';
    return version.trim().replace(/^[vV]/, '').trim();
  },

  // مقایسهٔ معناییِ دو نسخه: ۱ یعنی اولی تازه‌تر است، ۱- یعنی
  // قدیمی‌تر، ۰ یعنی برابر. بخش‌هایِ عددی با هم سنجیده می‌شوند؛
  // پسوندِ پیش‌انتشار (مثلِ beta) از نسخهٔ نهایی قدیمی‌تر است.
  compareVersions: (a, b) => {
    const splitParts = (v) => {
      const noBuild = coreApi.stripVersionPrefix(v).split('+')[0];
      const dashAt = noBuild.indexOf('-');
      const core = dashAt === -1 ? noBuild : noBuild.slice(0, dashAt);
      const pre = dashAt === -1 ? '' : noBuild.slice(dashAt + 1);
      const nums = core.split('.').map((part) => {
        const n = parseInt(part, 10);
        return Number.isFinite(n) ? n : 0;
      });
      return { nums, pre };
    };
    const left = splitParts(a);
    const right = splitParts(b);
    const len = Math.max(left.nums.length, right.nums.length);
    for (let i = 0; i < len; i++) {
      const l = left.nums[i] || 0;
      const r = right.nums[i] || 0;
      if (l > r) return 1;
      if (l < r) return -1;
    }
    if (left.pre === right.pre) return 0;
    if (!left.pre) return 1;
    if (!right.pre) return -1;
    if (left.pre < right.pre) return -1;
    return 1;
  },

  // یادداشتِ انتشارِ گیت‌هاب (body) معمولاً مارک‌داون و گاهی HTML
  // دارد؛ تگ‌ها و entityها حذف می‌شوند تا در باکسِ RTL، تمیز
  // خوانده شود. خط‌هایِ خالیِ پشتِ سرِ هم، به یک خطِ خالی می‌رسند.
  cleanReleaseNotes: (body) => {
    if (typeof body !== 'string') return '';
    let text = body.replace(/<br\s*\/?>/gi, '\n');
    text = text.replace(/<[^>]*>/g, '');
    text = text.replace(/&#(\d+);/g, (m, code) => {
      const n = parseInt(code, 10);
      if (!Number.isFinite(n) || n <= 0 || n > 0x10ffff) return '';
      try { return String.fromCodePoint(n); } catch (_) { return ''; }
    });
    text = text.replace(/&#x([0-9a-fA-F]+);/g, (m, code) => {
      const n = parseInt(code, 16);
      if (!Number.isFinite(n) || n <= 0 || n > 0x10ffff) return '';
      try { return String.fromCodePoint(n); } catch (_) { return ''; }
    });
    text = text.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'");
    const lines = text.split('\n').map((line) => line.replace(/[ \t]+$/, ''));
    const out = [];
    let blankRun = 0;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === '') {
        blankRun += 1;
        if (blankRun <= 1) out.push('');
      } else {
        blankRun = 0;
        out.push(lines[i]);
      }
    }
    while (out.length > 0 && out[0].trim() === '') out.shift();
    while (out.length > 0 && out[out.length - 1].trim() === '') out.pop();
    return out.join('\n');
  },

  // سطرهایِ یادداشتِ تمیزشده را به بلوک‌هایِ قابلِ رندر می‌شکند:
  // 'heading' برایِ سرفصل‌هایِ #، 'bullet' برایِ خط‌هایِ - و * و •
  // و 'text' برایِ بقیه. تابعِ خالص است و JSX تولید نمی‌کند.
  splitReleaseNotes: (text) => {
    const cleaned = coreApi.cleanReleaseNotes(text);
    if (!cleaned) return [];
    const blocks = [];
    const lines = cleaned.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const heading = line.match(/^(#{1,6})\s+(.*)$/);
      if (heading) {
        blocks.push({ kind: 'heading', text: heading[2].trim() });
        continue;
      }
      const bullet = line.match(/^([-*•])\s+(.*)$/);
      if (bullet) {
        blocks.push({ kind: 'bullet', text: bullet[2].trim() });
        continue;
      }
      blocks.push({ kind: 'text', text: line });
    }
    return blocks;
  },

  // از فهرستِ assets انتشار، فایلِ نصبِ ویندوز (.exe) را برمی‌گرداند؛
  // «Setup» در اولویت است، وگرنه اولین .exe. اگر نبود، رشتهٔ خالی.
  pickExeAsset: (assets) => {
    if (!Array.isArray(assets)) return '';
    const exes = assets.filter((a) => a && typeof a.name === 'string' && /\.exe$/i.test(a.name));
    const preferred = exes.find((a) => /setup/i.test(a.name)) || exes[0];
    if (!preferred || typeof preferred.browser_download_url !== 'string') return '';
    return preferred.browser_download_url;
  },

  // شکلِ واقعیِ پاسخِ REST (tag_name ،body ،published_at ،assets)
  // را به همان شکلی برمی‌گرداند که هندلرِ check-for-updates و
  // رندرر می‌فهمند. updateAvailable وقتی null است که نسخهٔ فعلی
  // خوانده نشده باشد و مقایسه ممکن نباشد.
  normalizeLatestRelease: (json, currentVersion) => {
    if (!json || typeof json !== 'object') return null;
    const tagName = typeof json.tag_name === 'string' ? json.tag_name : '';
    const version = coreApi.stripVersionPrefix(tagName);
    const releaseNotes = coreApi.cleanReleaseNotes(typeof json.body === 'string' ? json.body : '');
    const current = coreApi.stripVersionPrefix(currentVersion);
    let updateAvailable = null;
    if (current && version) {
      updateAvailable = coreApi.compareVersions(version, current) > 0;
    }
    return {
      tagName,
      version,
      releaseNotes,
      publishedAt: typeof json.published_at === 'string' ? json.published_at : '',
      htmlUrl: typeof json.html_url === 'string' ? json.html_url : '',
      downloadUrl: coreApi.pickExeAsset(json.assets),
      updateAvailable,
      source: 'rest',
    };
  },

  // پاسخِ مستقیمِ هندلرِ check-for-updates (بعد از ادغامِ REST و
  // electron-updater) را نرمال می‌کند تا کارتِ تنظیمات، صفحهٔ
  // دانلودها و مودالِ App، هر سه یک شکل ببینند.
  normalizeCheckForUpdatesResult: (result, currentVersion) => {
    if (!result || typeof result !== 'object') {
      return { updateAvailable: null, latestVersion: '', releaseNotes: '', publishedAt: '', downloadUrl: '', htmlUrl: '', currentVersion: coreApi.stripVersionPrefix(currentVersion), status: 'error', message: '' };
    }
    const current = coreApi.stripVersionPrefix(typeof result.version === 'string' ? result.version : currentVersion);
    let latest = '';
    if (typeof result.latestVersion === 'string' && result.latestVersion) {
      latest = coreApi.stripVersionPrefix(result.latestVersion);
    } else if (result.updateInfo && typeof result.updateInfo.version === 'string') {
      latest = coreApi.stripVersionPrefix(result.updateInfo.version);
    }
    let updateAvailable = typeof result.updateAvailable === 'boolean' ? result.updateAvailable : null;
    if (updateAvailable === null && latest && current) {
      updateAvailable = coreApi.compareVersions(latest, current) > 0;
    }
    const rawNotes = typeof result.releaseNotes === 'string'
      ? result.releaseNotes
      : (typeof result.releaseBody === 'string' ? result.releaseBody : '');
    return {
      updateAvailable,
      latestVersion: latest,
      releaseNotes: coreApi.cleanReleaseNotes(rawNotes),
      publishedAt: typeof result.publishedAt === 'string' ? result.publishedAt : '',
      downloadUrl: typeof result.downloadUrl === 'string' ? result.downloadUrl : '',
      htmlUrl: typeof result.htmlUrl === 'string' ? result.htmlUrl : '',
      currentVersion: current,
      status: typeof result.status === 'string' ? result.status : 'checked',
      message: typeof result.message === 'string' ? result.message : '',
      // مرحلهٔ ۵۸ §۲ (m2): 'no-releases' همان‌طور که هست عبور می‌کند؛
      // latestVersion خالی است، پس updateAvailable همان null می‌ماند
      // و مصرف‌کننده، آن را خطا نمی‌بیند. source هم ('rest' یا
      // 'renderer-fetch') برایِ گزارش‌گیری عبور می‌کند.
      source: typeof result.source === 'string' ? result.source : '',
    };
  },

  // رویدادِ خامِ 'app-update-status' را به پیشرفتِ یک‌شکلِ
  // { kind, version, percent, transferred, total, bytesPerSecond }
  // برمی‌گرداند؛ مودالِ دانلود در App از این تابع می‌خواند.
  normalizeUpdateProgressEvent: (raw) => {
    const empty = { kind: 'unknown', version: '', percent: 0, transferred: 0, total: 0, bytesPerSecond: 0, message: '' };
    if (!raw || typeof raw !== 'object') return empty;
    const keyRaw = raw.type || raw.status || raw.event || raw.kind || '';
    const key = String(keyRaw).trim().toLowerCase().replace(/_/g, '-');
    const version = typeof raw.version === 'string' ? raw.version : '';
    let percent = 0;
    if (typeof raw.percent === 'number') percent = raw.percent;
    else if (typeof raw.progress === 'number') percent = raw.progress;
    else if (typeof raw.transferred === 'number' && typeof raw.total === 'number' && raw.total > 0) {
      percent = (raw.transferred / raw.total) * 100;
    }
    const transferred = typeof raw.transferred === 'number' ? raw.transferred : 0;
    const total = typeof raw.total === 'number' ? raw.total : 0;
    const bytesPerSecond = typeof raw.bytesPerSecond === 'number' ? raw.bytesPerSecond : 0;
    const message = typeof raw.message === 'string' ? raw.message : '';
    if (key === 'checking' || key === 'checking-for-update') return { ...empty, kind: 'checking', version, message };
    if (key === 'update-available' || key === 'available') return { ...empty, kind: 'available', version, message };
    if (key === 'update-not-available' || key === 'not-available' || key === 'up-to-date') return { ...empty, kind: 'not-available', version, message };
    if (key === 'download-progress' || key === 'downloading') return { kind: 'downloading', version, percent, transferred, total, bytesPerSecond, message };
    if (key === 'update-downloaded' || key === 'downloaded') return { ...empty, kind: 'downloaded', version, percent: 100, transferred, total, bytesPerSecond, message };
    if (key === 'error') return { ...empty, kind: 'error', version, message };
    return empty;
  },

  // نمایشِ خوانایِ بایت: 0 B ،12.5 KB ،3.2 MB. ارقام، لاتین‌اند
  // تا در کنارِ «٪» و واحدها، در متنِ RTL به‌هم نریزند.
  formatBytes: (bytes) => {
    const n = typeof bytes === 'number' && Number.isFinite(bytes) ? Math.max(0, bytes) : 0;
    if (n <= 0) return '0 B';
    if (n < 1024) return Math.round(n) + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + ' MB';
    return (n / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  },

  formatDownloadSpeed: (bytesPerSecond) => {
    return coreApi.formatBytes(bytesPerSecond) + '/s';
  },

  // --- حافظهٔ محلیِ انتخاب‌هایِ بروزرسانی (localStorage) ---
  // نسخهٔ نادیده‌گرفته‌شده: مودال برای آن نسخه دیگر باز نمی‌شود،
  // مگر با زدنِ دستیِ دکمهٔ بررسی در تنظیمات/دانلودها.
  readSkippedUpdateVersion: () => {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return '';
      return window.localStorage.getItem('pandaReader.skippedVersion') || '';
    } catch (_) { return ''; }
  },

  writeSkippedUpdateVersion: (version) => {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return;
      const value = coreApi.stripVersionPrefix(version);
      if (value) window.localStorage.setItem('pandaReader.skippedVersion', value);
      else window.localStorage.removeItem('pandaReader.skippedVersion');
    } catch (_) {}
  },

  // قانونِ باز شدنِ مودالِ یادآوری (تابعِ خالص؛ در Node تست می‌شود):
  // بدونِ نسخه، هرگز؛ نسخهٔ نادیده‌گرفته‌شده، فقط با بررسیِ دستی؛
  // «یادآوری در نوبتِ بعدی» فقط همین نشست را ساکت می‌کند.
  shouldOpenUpdateModal: ({ latestVersion, manual, skippedVersion, remindedVersion }) => {
    if (!latestVersion) return false;
    const latest = coreApi.stripVersionPrefix(latestVersion);
    if (!latest) return false;
    if (!manual && skippedVersion && coreApi.stripVersionPrefix(skippedVersion) === latest) return false;
    if (!manual && remindedVersion && coreApi.stripVersionPrefix(remindedVersion) === latest) return false;
    return true;
  },

  // کلیدِ «بررسی و یادآوریِ خودکارِ آپدیت‌ها»؛ پیش‌فرض، روشن است.
  // هر تغییر، رویدادِ 'panda-reader-auto-check-changed' می‌فرستد تا
  // سوییچِ داخلِ مودال و کارتِ تنظیمات، هم‌گام بمانند.
  readAutoCheckUpdatesEnabled: () => {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return true;
      const raw = window.localStorage.getItem('pandaReader.autoCheckUpdates');
      if (raw === null || raw === undefined || raw === '') return true;
      return raw === '1' || raw === 'true';
    } catch (_) { return true; }
  },

  writeAutoCheckUpdatesEnabled: (enabled) => {
    const value = enabled === true;
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem('pandaReader.autoCheckUpdates', value ? '1' : '0');
      }
    } catch (_) {}
    try {
      if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
        window.dispatchEvent(new window.CustomEvent('panda-reader-auto-check-changed', { detail: { enabled: value } }));
      }
    } catch (_) {}
  },

  onAutoCheckUpdatesChanged: (callback) => {
    if (typeof window === 'undefined' || typeof callback !== 'function') return () => {};
    const handler = (event) => {
      try {
        const enabled = event && event.detail ? event.detail.enabled : coreApi.readAutoCheckUpdatesEnabled();
        callback(enabled === true);
      } catch (_) {}
    };
    try { window.addEventListener('panda-reader-auto-check-changed', handler); } catch (_) { return () => {}; }
    return () => {
      try { window.removeEventListener('panda-reader-auto-check-changed', handler); } catch (_) {}
    };
  },

  // --- پلِ رویدادِ «نسخهٔ تازه پیدا شد» بینِ کارتِ تنظیمات/
  // صفحهٔ دانلودها و مودالِ سراسریِ App ---
  // detail: { updateAvailable, latestVersion, releaseNotes,
  // publishedAt, downloadUrl, htmlUrl, currentVersion, manual }
  // manual یعنی کاربر خودش دکمهٔ بررسی را زده است (مودال، حتی برایِ
  // نسخهٔ نادیده‌گرفته‌شده هم باز می‌شود)؛ در بررسیِ خودکار، false است.
  emitUpdateAvailable: (info) => {
    try {
      if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
      window.dispatchEvent(new window.CustomEvent('panda-reader-update-available', { detail: info || {} }));
    } catch (_) {}
  },

  onUpdateAvailable: (callback) => {
    if (typeof window === 'undefined' || typeof callback !== 'function') return () => {};
    const handler = (event) => {
      try { callback((event && event.detail) || {}); } catch (_) {}
    };
    try { window.addEventListener('panda-reader-update-available', handler); } catch (_) { return () => {}; }
    return () => {
      try { window.removeEventListener('panda-reader-update-available', handler); } catch (_) {}
    };
  },

  // دانلودِ مستقیمِ فایلِ .exe از گیت‌هاب (حالتِ Portable/توسعه که
  // electron-updater در آن نیست). بدونِ withTimeout است، چون دانلود
  // دقیقه‌ها طول می‌کشد و پیشرفتش با رویداد می‌رسد (همان الگویِ
  // downloadUpdate در همین فایل).
  downloadUpdateDirect: async (payload) => {
    const api = getApi();
    if (!api?.downloadUpdateDirect) return { success: false, status: 'dev-mode', version: '', message: 'محیط الکترون در دسترس نیست.' };
    try {
      return await api.downloadUpdateDirect(payload);
    } catch (err) {
      return { success: false, status: 'error', version: '', message: err?.message || 'خطا در دانلودِ مستقیمِ نسخهٔ جدید' };
    }
  },

  // اجرایِ نصب‌کنندهٔ دانلودشده؛ فلاشِ دیتابیس، در سمتِ main و پیش
  // از اجرایِ نصب‌کننده انجام می‌شود (همان هندلرِ quitAndInstall).
  installDownloadedUpdate: async (payload) => {
    const api = getApi();
    if (!api?.installDownloadedUpdate) return { success: false, status: 'dev-mode', version: '', message: 'محیط الکترون در دسترس نیست.' };
    try {
      return await api.installDownloadedUpdate(payload);
    } catch (err) {
      return { success: false, status: 'error', version: '', message: err?.message || 'خطا در نصبِ نسخهٔ دانلودشده' };
    }
  },

  showItemInFolder: async (filePath) => {
    const api = getApi();
    if (!api?.showItemInFolder) return { success: false, error: 'محیط الکترون در دسترس نیست.' };
    if (!filePath || typeof filePath !== 'string') {
      return { success: false, error: 'مسیر فایل مشخص نشده است.' };
    }
    try {
      return await api.showItemInFolder(filePath);
    } catch (err) {
      return { success: false, error: err?.message || 'خطا در باز کردن فایل‌اکسپلورر' };
    }
  },

  copyImageToClipboard: async (payload) => {
    const api = getApi();
    if (!api?.copyImageToClipboard) return { success: false, error: 'کلیپ‌بورد در دسترس نیست.' };
    if (!payload?.filePath && !payload?.dataUrl) {
      return { success: false, error: 'داده تصویری برای کپی یافت نشد.' };
    }
    try {
      return await api.copyImageToClipboard(payload);
    } catch (err) {
      return { success: false, error: err?.message || 'خطا در کپی تصویر' };
    }
  },

  saveScreenshot: async (payload) => {
    const api = getApi();
    if (!api?.saveScreenshot) return { success: false, error: 'سرویس ذخیره‌سازی در دسترس نیست.' };
    if (!payload?.dataUrl) {
      return { success: false, error: 'داده تصویری برای ذخیره موجود نیست.' };
    }
    try {
      return await api.saveScreenshot(payload);
    } catch (err) {
      return { success: false, error: err?.message || 'خطا در ذخیره اسکرین‌شات' };
    }
  },

  // مرحله ۵ ـ بخش ب: خروجیِ PDFِ حاشیه‌نویسی‌شده (ذخیرهٔ دوگانه).
  // عمداً بدونِ
  // withTimeout است (مثلِ openFile/saveScreenshot): دیالوگِ ذخیره در
  // main باز می‌شود و زمانِ انتخابِ کاربر، نباید تایم‌اوتِ کاذب بسازد.
  exportAnnotatedPdf: async (payload) => {
    const api = getApi();
    if (!api?.exportAnnotatedPdf) return { success: false, error: 'محیط الکترون در دسترس نیست.' };
    // مرحله ۵ ـ بخش ب: mode ('in-place' | 'save-as') از همین‌جا عبور
    // می‌کند و pages می‌تواند آبجکتِ خالی باشد، فقط در حالتِ درجا
    // (بازگرداندنِ فایل به پایهٔ تمیز پس از پاک‌شدنِ همهٔ آیتم‌ها).
    if (!payload?.pdfPath || payload?.pages == null) {
      return { success: false, error: 'دادهٔ خروجیِ PDF کامل نیست.' };
    }
    try {
      return await api.exportAnnotatedPdf(payload);
    } catch (err) {
      return { success: false, error: err?.message || 'خطا در ساختِ PDFِ حاشیه‌نویسی‌شده' };
    }
  },

  // مرحلهٔ ۴۴ §۴: خروجیِ CBZِ حاشیه‌نویسی‌شده (ذخیرهٔ مستقیم در آرشیو).
  // عمداً بدونِ withTimeout است (مثلِ exportAnnotatedPdf): دیالوگِ
  // ذخیره در main باز می‌شود و زمانِ انتخابِ کاربر، نباید تایم‌اوتِ
  // کاذب بسازد. قراردادِ payload با preload و ipcHandlers یکی است:
  // { cbzPath, mode, pages, annotationsByPage } که pages همان
  // { [pageNumber]: { entryName, imageDataUrl, width, height } } است.
  exportAnnotatedCbz: async (payload) => {
    const api = getApi();
    if (!api?.exportAnnotatedCbz) return { success: false, error: 'محیط الکترون در دسترس نیست.' };
    if (!payload?.cbzPath || payload?.pages == null || typeof payload.pages !== 'object') {
      return { success: false, error: 'دادهٔ خروجیِ CBZ کامل نیست.' };
    }
    try {
      return await api.exportAnnotatedCbz(payload);
    } catch (err) {
      return { success: false, error: err?.message || 'خطا در ساختِ CBZِ حاشیه‌نویسی‌شده' };
    }
  },

  // مرحلهٔ ۴۴ §۴: خروجیِ EPUBِ حاشیه‌نویسی‌شده (اورلیِ پخته + مانیفست).
  // قراردادِ payload با preload و ipcHandlers یکی است:
  // { epubPath, mode, chapters, annotationsByPage, highlights, bookmarks }
  // که chapters همان [{ chapterId, chapterIndex, href, overlayPng, highlightPng }] است.
  exportAnnotatedEpub: async (payload) => {
    const api = getApi();
    if (!api?.exportAnnotatedEpub) return { success: false, error: 'محیط الکترون در دسترس نیست.' };
    if (!payload?.epubPath || !Array.isArray(payload?.chapters)) {
      return { success: false, error: 'دادهٔ خروجیِ EPUB کامل نیست.' };
    }
    try {
      return await api.exportAnnotatedEpub(payload);
    } catch (err) {
      return { success: false, error: err?.message || 'خطا در ساختِ EPUBِ حاشیه‌نویسی‌شده' };
    }
  },


  // مرحلهٔ ۴۶ §۲: خروجیِ HTMLِ مستقلِ گزارشِ آماربندی (گزارشِ آمادهٔ نمایش).
  // عمداً بدونِ withTimeout است (مثلِ exportAnnotatedPdf): دیالوگِ
  // ذخیره در main باز می‌شود و زمانِ انتخابِ کاربر، نباید تایم‌اوتِ کاذب بسازد.
  // قراردادِ payload با preload و ipcHandlers یکی است: { html, defaultFileName }؛
  // ورودیِ ProfileView همان exportStatsHtml(html, fileName) است.
  exportStatsHtml: async (html, fileName) => {
    const api = getApi();
    if (!api?.exportStatsHtml) return { success: false, error: 'محیط الکترون در دسترس نیست.' };
    if (!html || typeof html !== 'string' || !fileName || typeof fileName !== 'string') {
      return { success: false, error: 'دادهٔ خروجیِ HTML کامل نیست.' };
    }
    try {
      return await api.exportStatsHtml({ html, defaultFileName: fileName });
    } catch (err) {
      return { success: false, error: err?.message || 'خطا در ذخیرهٔ گزارشِ HTML' };
    }
  },
  // مرحلهٔ ۴۴ §۴: خواندنِ مانیفستِ جاسازی‌شدهٔ CBZ برایِ بارگذاریِ
  // خودکار (فقط وقتی دیتابیسِ محلی خالی است؛ تصمیم در ویوور گرفته
  // می‌شود). تایم‌اوتِ ۳۰ ثانیه‌ای چون خواندنِ کاملِ آرشیو لازم است.
  getEmbeddedCbzAnnotations: async (filePath) => {
    const api = getApi();
    if (!api?.getEmbeddedCbzAnnotations) return { success: false, error: 'محیط الکترون در دسترس نیست.' };
    if (!filePath || typeof filePath !== 'string') {
      return { success: false, error: 'مسیرِ فایل مشخص نشده است.' };
    }
    try {
      return await withTimeout(api.getEmbeddedCbzAnnotations(filePath), 30000, { success: false, error: 'مهلت زمانی خواندنِ CBZ به پایان رسید.' });
    } catch (err) {
      return { success: false, error: err?.message || 'خطا در خواندنِ CBZ' };
    }
  },

  // مرحله ۸ ـ بخش الف: بررسیِ محافظتِ PDF هنگامِ ورود به استودیو.
  // مرحله ۸ ـ اصلاحِ نهایی: تایم‌اوت، ۱۰ ثانیه به ۶۰ ثانیه رسید؛
  // پروب حالا در ورکرِ جدا اجرا می‌شود و پروسهٔ اصلی قفل نیست،
  // اما خواندن + پارسِ کاملِ فایلِ ۶۸ مگابایتی روی CPUهای قدیمی،
  // هنوز بیشتر از ۱۰ ثانیه طول می‌کشد و تایم‌اوتِ کوتاه، نتیجهٔ
  // «نامشخصِ» کاذب می‌ساخت (استودیو، بدونِ مودال باز می‌شد). در
  // تایم‌اوت یا هر خطا، نتیجهٔ «نامشخص» برمی‌گردد تا استودیو مثلِ
  // همیشه روشن شود (رفتارِ قبلی) و کاربر، معطلِ پروب نماند.
  checkPdfProtection: async (filePath) => {
    const api = getApi();
    if (!api?.checkPdfProtection) return { protected: false, reason: 'unknown', pageCount: -1, hasEncryptToken: false };
    if (!filePath || typeof filePath !== 'string') {
      return { protected: false, reason: 'unknown', pageCount: -1, hasEncryptToken: false };
    }
    try {
      return await withTimeout(api.checkPdfProtection(filePath), 60000, {
        protected: false,
        reason: 'unknown',
        pageCount: -1,
        hasEncryptToken: false,
      });
    } catch (err) {
      return { protected: false, reason: 'unknown', pageCount: -1, hasEncryptToken: false };
    }
  },

  // مرحله ۸ ـ بخش الف: ساختِ نسخهٔ کپیِ بدونِ قفل. عمداً بدونِ
  // withTimeout است (مثلِ exportAnnotatedPdf): رمزگشایی و اعتبارسنجیِ
  // فایلِ بزرگ، زمان‌بر است و نباید تایم‌اوتِ کاذب بسازد.
  // مرحله ۱۱: options اختیاری — { desiredName, desiredPath }.
  createUnlockedPdfCopy: async (filePath, password, options) => {
    const api = getApi();
    if (!api?.createUnlockedPdfCopy) return { success: false, error: 'محیط الکترون در دسترس نیست.' };
    if (!filePath || typeof filePath !== 'string') {
      return { success: false, error: 'مسیر فایل مشخص نشده است.' };
    }
    try {
      return await api.createUnlockedPdfCopy(filePath, typeof password === 'string' ? password : '', options || undefined);
    } catch (err) {
      return { success: false, error: err?.message || 'خطا در ساختِ نسخهٔ کپی' };
    }
  },

  // مرحله ۱۱: دیالوگِ انتخابِ نام/پوشهٔ نسخهٔ کپی. عمداً بدونِ
  // تایم‌اوت (تعاملِ کاربر با دیالوگِ ویندوز).
  chooseCopySavePath: async (filePath, defaultName) => {
    const api = getApi();
    if (!api?.chooseCopySavePath) return { canceled: true };
    if (!filePath || typeof filePath !== 'string') return { canceled: true };
    try {
      return await api.chooseCopySavePath(filePath, defaultName);
    } catch (err) {
      return { canceled: true };
    }
  },

  // مرحله ۱۱: ایندکسِ جستجویِ کناری. تایم‌اوتِ ۳۰ ثانیه‌ای؛ در
  // خطا، «پیدا نشد» برمی‌گردد تا جستجو، مسیرِ عادی را برود.
  getSearchIndex: async (filePath) => {
    const api = getApi();
    if (!api?.getSearchIndex) return { found: false };
    if (!filePath || typeof filePath !== 'string') return { found: false };
    try {
      return await withTimeout(api.getSearchIndex(filePath), 30000, { found: false });
    } catch (err) {
      return { found: false };
    }
  },

  // مرحله ۹ — لایهٔ ۱: آماده‌سازیِ خواندنِ فایلِ محافظت‌شده.
  // تایم‌اوتِ ۱۲۰ ثانیه‌ای (پارسِ فایلِ بزرگ در ورکر)؛ در تایم‌اوت
  // یا خطا، وضعیتِ خطا برمی‌گردد تا رندرر، مودالِ رمز را نشان دهد.
  prepareProtectedPdfForReading: async (filePath, options) => {
    const api = getApi();
    if (!api?.prepareProtectedPdfForReading) return { status: 'error', reason: 'unavailable', pageCount: -1 };
    if (!filePath || typeof filePath !== 'string') {
      return { status: 'error', reason: 'file-missing', pageCount: -1 };
    }
    const password = options && typeof options.password === 'string' ? options.password : '';
    try {
      return await withTimeout(api.prepareProtectedPdfForReading(filePath, password), 120000, {
        status: 'error',
        reason: 'timeout',
        pageCount: -1,
      });
    } catch (err) {
      return { status: 'error', reason: 'failed', pageCount: -1 };
    }
  },

  // مرحله ۸ ـ اصلاحِ نهایی: پیشرفتِ پروب/کپی و لغوِ ساختِ کپی.
  // onPdfCopyProgress، تابعِ لغوِ اشتراک را برمی‌گرداند (الگوی
  // onExtractionProgress در preload).
  onPdfCopyProgress: (callback) => {
    const api = getApi();
    if (!api?.onPdfCopyProgress) return () => {};
    try {
      return api.onPdfCopyProgress(callback) || (() => {});
    } catch (_) {
      return () => {};
    }
  },

  cancelPdfCopy: async () => {
    const api = getApi();
    if (!api?.cancelPdfCopy) return { cancelled: 0 };
    try {
      return await api.cancelPdfCopy();
    } catch (err) {
      return { cancelled: 0, error: err?.message || 'لغو انجام نشد.' };
    }
  },

  // مرحله ۱۰: مدیریتِ حافظه و محلِ داده. آمار/هرس/پاک‌سازی،
  // تایم‌اوتِ ۹۰ ثانیه‌ای دارند (ورکرِ دیتابیس، ۶۰ ثانیه + حاشیه)؛
  // ذخیرهٔ بازسازی‌شده و تغییرِ محلِ داده، دیالوگ‌دارند و عمداً
  // بدونِ تایم‌اوت‌اند (همان استدلالِ exportAnnotatedPdf).
  getStorageStats: async () => {
    const api = getApi();
    if (!api?.getStorageStats) return { success: false, error: 'محیط الکترون در دسترس نیست.' };
    try {
      return await withTimeout(api.getStorageStats(), 30000, { success: false, error: 'مهلت زمانی دریافتِ آمارِ حافظه به پایان رسید.' });
    } catch (err) {
      return { success: false, error: err?.message || 'خطا در دریافتِ آمارِ حافظه' };
    }
  },

  clearAllCovers: async () => {
    const api = getApi();
    if (!api?.clearAllCovers) return { success: false, error: 'محیط الکترون در دسترس نیست.' };
    try {
      return await withTimeout(api.clearAllCovers(), 90000, { success: false, error: 'مهلت زمانی پاک‌سازیِ کاورها به پایان رسید.' });
    } catch (err) {
      return { success: false, error: err?.message || 'خطا در پاک‌سازیِ کاورها' };
    }
  },

  pruneMissingFiles: async () => {
    const api = getApi();
    if (!api?.pruneMissingFiles) return { success: false, error: 'محیط الکترون در دسترس نیست.' };
    try {
      return await withTimeout(api.pruneMissingFiles(), 90000, { success: false, error: 'مهلت زمانی هرسِ فایل‌ها به پایان رسید.' });
    } catch (err) {
      return { success: false, error: err?.message || 'خطا در هرسِ فایل‌های حذف‌شده' };
    }
  },

  // مرحلهٔ ۵۲ §۱: همگام‌سازیِ دسته‌ایِ فایل‌هایِ حذف‌شده؛ مسیرِ
  // ترجیحیِ استور (با همان مهلتِ ۹۰ ثانیه‌ایِ هرس).
  syncMissingFiles: async (payload) => {
    const api = getApi();
    if (!api?.syncMissingFiles) return { success: false, error: 'محیط الکترون در دسترس نیست.' };
    try {
      return await withTimeout(api.syncMissingFiles(payload || {}), 90000, { success: false, error: 'مهلت زمانی همگام‌سازیِ فایل‌های حذف‌شده به پایان رسید.' });
    } catch (err) {
      return { success: false, error: err?.message || 'خطا در همگام‌سازیِ فایل‌های حذف‌شده' };
    }
  },

  // مرحله ۱۳: پاک‌سازیِ جداگانهٔ کاورها و کش‌ها + پیش‌نمایشِ
  // هرس + گالریِ تصاویرِ بوک‌مارک.
  clearOnlyCovers: async (payload = {}) => {
    const api = getApi();
    if (!api?.clearOnlyCovers) return { success: false, error: 'محیط الکترون در دسترس نیست.' };
    try {
      return await withTimeout(api.clearOnlyCovers(payload), 90000, { success: false, error: 'مهلت زمانی پاک‌سازیِ کاورها به پایان رسید.' });
    } catch (err) {
      return { success: false, error: err?.message || 'خطا در پاک‌سازیِ کاورها' };
    }
  },

  clearOnlyCaches: async (payload = {}) => {
    const api = getApi();
    if (!api?.clearOnlyCaches) return { success: false, error: 'محیط الکترون در دسترس نیست.' };
    try {
      return await withTimeout(api.clearOnlyCaches(payload), 90000, { success: false, error: 'مهلت زمانی پاک‌سازیِ کش‌ها به پایان رسید.' });
    } catch (err) {
      return { success: false, error: err?.message || 'خطا در پاک‌سازیِ کش‌ها' };
    }
  },

  previewPruneMissingFiles: async () => {
    const api = getApi();
    if (!api?.previewPruneMissingFiles) return { success: false, error: 'محیط الکترون در دسترس نیست.' };
    try {
      return await withTimeout(api.previewPruneMissingFiles(), 60000, { success: false, error: 'مهلت زمانی پیش‌نمایشِ هرس به پایان رسید.' });
    } catch (err) {
      return { success: false, error: err?.message || 'خطا در پیش‌نمایشِ هرس' };
    }
  },

  listBookmarkBackgrounds: async () => {
    const api = getApi();
    if (!api?.listBookmarkBackgrounds) return { success: false, error: 'محیط الکترون در دسترس نیست.' };
    try {
      return await withTimeout(api.listBookmarkBackgrounds(), 30000, { success: false, error: 'مهلت زمانی خواندنِ پوشهٔ تصاویر به پایان رسید.' });
    } catch (err) {
      return { success: false, error: err?.message || 'خطا در خواندنِ پوشهٔ تصاویر' };
    }
  },

  openBookmarkBackgroundsFolder: async () => {
    const api = getApi();
    if (!api?.openBookmarkBackgroundsFolder) return { success: false, error: 'محیط الکترون در دسترس نیست.' };
    try {
      return await withTimeout(api.openBookmarkBackgroundsFolder(), 30000, { success: false, error: 'مهلت زمانی باز کردنِ پوشه به پایان رسید.' });
    } catch (err) {
      return { success: false, error: err?.message || 'خطا در باز کردنِ پوشه' };
    }
  },

  // مرحله ۱۴: وارد کردنِ مستقیمِ عکس‌ها به پوشهٔ بوک‌مارک.
  importBookmarkBackgroundFiles: async (paths) => {
    const api = getApi();
    if (!api?.importBookmarkBackgroundFiles) return { success: false, error: 'محیط الکترون در دسترس نیست.' };
    try {
      return await withTimeout(api.importBookmarkBackgroundFiles(paths), 60000, { success: false, error: 'مهلت زمانی وارد کردنِ عکس‌ها به پایان رسید.' });
    } catch (err) {
      return { success: false, error: err?.message || 'خطا در وارد کردنِ عکس‌ها' };
    }
  },

  // مرحله ۱۵: حذفِ عکس از پوشهٔ بوک‌مارک.
  deleteBookmarkBackground: async (name) => {
    const api = getApi();
    if (!api?.deleteBookmarkBackground) return { success: false, error: 'محیط الکترون در دسترس نیست.' };
    try {
      return await withTimeout(api.deleteBookmarkBackground(name), 30000, { success: false, error: 'مهلت زمانی حذفِ عکس به پایان رسید.' });
    } catch (err) {
      return { success: false, error: err?.message || 'خطا در حذفِ عکس' };
    }
  },

  // مرحله ۱۵: خواندنِ تمپلیت‌هایِ همراهِ نرم‌افزار.
  getAppBookmarkPresets: async () => {
    const api = getApi();
    if (!api?.getAppBookmarkPresets) return { success: false, error: 'محیط الکترون در دسترس نیست.' };
    try {
      return await withTimeout(api.getAppBookmarkPresets(), 30000, { success: false, error: 'مهلت زمانی خواندنِ تمپلیت‌هایِ همراه به پایان رسید.' });
    } catch (err) {
      return { success: false, error: err?.message || 'خطا در خواندنِ تمپلیت‌هایِ همراه' };
    }
  },

  saveRebuiltPdf: async (payload) => {
    const api = getApi();
    if (!api?.saveRebuiltPdf) return { success: false, error: 'محیط الکترون در دسترس نیست.' };
    // مرحلهٔ ۳۲ — ورودیِ باینری (Uint8Array) یا base64ِ قدیمی، هر دو
    // قبول‌اند؛ باینری اولویت دارد و از sanitize نمی‌گذرد.
    const hasBinary = payload?.pdfBytes instanceof Uint8Array && payload.pdfBytes.length > 0;
    const hasBase64 = (typeof payload?.base64 === 'string' && payload.base64.length > 0) || (typeof payload?.base64Data === 'string' && payload.base64Data.length > 0);
    // مرحلهٔ ۳۴ — پشتیبانِ ارسالِ دوگانه (base64/base64Data) هم
    // قبول است؛ باینری در main اولویت دارد.
    if (!payload?.pdfPath || (!hasBinary && !hasBase64)) {
      return { success: false, error: 'دادهٔ فایلِ بازسازی‌شده کامل نیست.' };
    }
    try {
      return await api.saveRebuiltPdf(payload);
    } catch (err) {
      return { success: false, error: err?.message || 'خطا در ذخیرهٔ فایلِ بازسازی‌شده' };
    }
  },

  changeDataDirectory: async (mode) => {
    const api = getApi();
    if (!api?.changeDataDirectory) return { success: false, error: 'محیط الکترون در دسترس نیست.' };
    try {
      return await api.changeDataDirectory({ mode: mode === 'reset' ? 'reset' : 'choose' });
    } catch (err) {
      return { success: false, error: err?.message || 'خطا در تغییرِ محلِ ذخیرهٔ اطلاعات' };
    }
  },

  resetDataDirectory: async () => {
    const api = getApi();
    if (!api?.changeDataDirectory) return { success: false, error: 'محیط الکترون در دسترس نیست.' };
    try {
      return await api.changeDataDirectory({ mode: 'reset' });
    } catch (err) {
      return { success: false, error: err?.message || 'خطا در بازگشت به مسیرِ پیش‌فرض' };
    }
  },

  // مرحله ۵ ـ بخش الف: پشتیبان‌گیری و بازیابیِ یک‌کلیکی (دیالوگ‌دار،
  // بدونِ تایم‌اوتِ رندرر — همان استدلالِ exportAnnotatedPdf).
  exportBackup: async () => {
    const api = getApi();
    if (!api?.exportBackup) return { success: false, error: 'محیط الکترون در دسترس نیست.' };
    try {
      return await api.exportBackup();
    } catch (err) {
      return { success: false, error: err?.message || 'خطا در ساختِ فایل پشتیبان' };
    }
  },

  importBackup: async () => {
    const api = getApi();
    if (!api?.importBackup) return { success: false, error: 'محیط الکترون در دسترس نیست.' };
    try {
      return await api.importBackup();
    } catch (err) {
      return { success: false, error: err?.message || 'خطا در بازیابیِ فایل پشتیبان' };
    }
  },

  // مرحله ۶ ـ بخش الف: آمارِ واقعیِ مطالعه. از مسیرِ dbActionِ معمولی
  // می‌گذرد (تایم‌اوتِ ۵٫۵ ثانیه‌ایِ استاندارد)؛ فراخواننده (سرویسِ
  // readingActivity) گزارش‌ها را دسته‌ای می‌فرستد، پس این فراخوان‌ها
  // کم‌تعداد و سبک‌اند.
  recordReadingActivity: async ({ date, pages = 0, seconds = 0, fileKey } = {}) => {
    return await coreApi.dbAction({
      action: 'RECORD_READING_ACTIVITY',
      payload: { date, pages, seconds, fileKey },
    });
  },

  getReadingStats: async () => {
    return await coreApi.dbAction({ action: 'GET_READING_STATS', payload: {} });
  },

  // مرحلهٔ ۳۵ §۲: خواندنِ EPUB + هایلایت‌هایِ آن.
  loadEpubBook: async (filePath) => {
    const api = getApi();
    if (!api || typeof api.loadEpubBook !== 'function') return { success: false, message: 'سرویسِ EPUB در دسترس نیست.' };
    return await api.loadEpubBook(filePath);
  },

  loadEpubChapter: async (filePath, chapterId) => {
    const api = getApi();
    if (!api || typeof api.loadEpubChapter !== 'function') return { success: false, message: 'سرویسِ EPUB در دسترس نیست.' };
    return await api.loadEpubChapter(filePath, chapterId);
  },

  getEpubHighlights: async (filePath) => {
    try {
      const res = await coreApi.dbAction({ action: 'GET_EPUB_HIGHLIGHTS', payload: { filePath } });
      if (res && res.type === 'done' && Array.isArray(res.highlights)) return res.highlights;
    } catch (_) {}
    return [];
  },

  saveEpubHighlights: async (filePath, highlights) => {
    try {
      return await coreApi.dbAction({ action: 'SAVE_EPUB_HIGHLIGHTS', payload: { filePath, highlights } });
    } catch (_) {
      return { success: false };
    }
  },

  // مرحلهٔ ۴۰ §۱: اطلاعاتِ موتورِ دیتابیس (sqlite یا json) + شمارشِ
  // ردیف‌ها، برایِ بررسیِ فعال بودنِ SQLite.
  getDatabaseInfo: async () => {
    try {
      return await coreApi.dbAction({ action: 'GET_DATABASE_INFO', payload: {} });
    } catch (_) {
      return { type: 'error', engine: 'unknown' };
    }
  },

  // مرحلهٔ ۴۰ §۵: کشِ متنِ خالصِ فصلِ EPUB در SQLite — خواندن.
  // اگر موتور JSON باشد یا mtime عوض شده باشد، found=false برمی‌گردد
  // و خواننده، فصل را از اول می‌خواند.
  getEpubChapterText: async (filePath, chapterIndex, mtimeMs) => {
    try {
      return await coreApi.dbAction({ action: 'GET_EPUB_CHAPTER_TEXT', payload: { filePath, chapterIndex, mtime: mtimeMs } });
    } catch (_) {
      return { type: 'error', found: false, plainText: null };
    }
  },

  // مرحلهٔ ۴۰ §۵: کشِ متنِ خالصِ فصلِ EPUB در SQLite — نوشتن.
  saveEpubChapterText: async (filePath, chapterIndex, mtimeMs, text) => {
    try {
      return await coreApi.dbAction({ action: 'SAVE_EPUB_CHAPTER_TEXT', payload: { filePath, chapterIndex, mtime: mtimeMs, plainText: text } });
    } catch (_) {
      return { success: false };
    }
  },

  // مرحله ۱۴: ثبتِ زمانِ حضورِ سراسریِ برنامه.
  recordAppActivity: async ({ date, seconds = 0 } = {}) => {
    return await coreApi.dbAction({
      action: 'RECORD_APP_ACTIVITY',
      payload: { date, seconds },
    });
  },

  toggleFullscreen: async () => {
    const api = getApi();
    if (!api?.toggleFullscreen) return false;
    try {
      return await api.toggleFullscreen();
    } catch (_) {
      return false;
    }
  },

  isFullscreen: async () => {
    const api = getApi();
    if (!api?.isFullscreen) return false;
    try {
      return await api.isFullscreen();
    } catch (_) {
      return false;
    }
  },

  closeApp: () => getApi()?.closeApp?.(),
  minimizeApp: () => getApi()?.minimizeApp?.(),
  maximizeApp: () => getApi()?.maximizeApp?.(),

  // مدیریت رویدادهای پروگرس بار همراه با لغو ایمن اشتراک
  onProgress: (callback) => {
    const api = getApi();
    if (!api?.onExtractionProgress || typeof callback !== 'function') return () => {};
    try {
      return api.onExtractionProgress(callback);
    } catch (_) {
      return () => {};
    }
  },

  removeProgressListeners: () => {
    try {
      getApi()?.removeExtractionListeners?.();
    } catch (_) {}
  },

};

export default coreApi;