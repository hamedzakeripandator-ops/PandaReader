const getApi = () => {
  if (typeof window !== 'undefined' && window.api) {
    return window.api;
  }
  return null;
};

// تابع کمکی برای اعمال سقف زمانی (Timeout Guard) روی پرامیس‌های IPC
function withTimeout(promise, timeoutMs = 6000, fallbackValue = null) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(fallbackValue), timeoutMs))
  ]);
}

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

  // مرحله ۱ ـ بخش الف: قراردادِ تایم‌اوتِ دیتابیس — main: ۵۰۰۰،
  // رندرر: ۵۵۰۰ میلی‌ثانیه. پس خطای کنترل‌شدهٔ main همیشه زودتر از
  // تایم‌اوتِ رندرر می‌رسد و رندرر، نیم ثانیه زودتر خطای کاذب نشان
  // نمی‌دهد (باگِ قبلی: ۳۵۰۰ در برابرِ ۴۰۰۰). تایم‌اوتِ رندرر حالا
  // فقط یک پشتیبان است برای وقتی که خودِ main هم هنگ کرده باشد.
  // جفت‌شدنِ درخواست و پاسخ در دو لایه تضمین شده است: رندرر↔main با
  // خودِ مکانیزمِ invoke الکترون، و main↔ورکر با reqIdی یکتا که ورکر
  // عیناً در پاسخ برمی‌گرداند (و پاسخِ دیررسِ بدونِ callback، در
  // مسیریابِ main نادیده گرفته می‌شود تا با درخواستِ بعدی قاطی نشود).
  dbAction: async (requestData) => {
    const api = getApi();
    if (!api?.dbAction) return { type: 'error', message: 'ارتباط با دیتابیس برقرار نشد.' };
    try {
      const call = api.dbAction(requestData);
      return await withTimeout(call, 5500, { type: 'error', message: 'تایم‌اوت عملیات دیتابیس' });
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
    const hasBase64 = typeof payload?.base64 === 'string' && payload.base64.length > 0;
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
  recordReadingActivity: async ({ date, pages = 0, seconds = 0 } = {}) => {
    return await coreApi.dbAction({
      action: 'RECORD_READING_ACTIVITY',
      payload: { date, pages, seconds },
    });
  },

  getReadingStats: async () => {
    return await coreApi.dbAction({ action: 'GET_READING_STATS', payload: {} });
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