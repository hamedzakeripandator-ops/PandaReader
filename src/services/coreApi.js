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
  }
};

export default coreApi;