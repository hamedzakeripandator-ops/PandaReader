const { contextBridge, ipcRenderer, webUtils } = require('electron');

// اعتبارسنجی و تبدیل امن شیء ورودی به آبجکت خالص قابل شبیه‌سازی در ساختار IPC
function sanitizePayload(payload) {
  if (payload === undefined || payload === null) return payload;
  try {
    return JSON.parse(JSON.stringify(payload));
  } catch (err) {
    // در صورت وجود ارجاعات دوار (Circular References) پاک‌سازی سطحی انجام می‌شود
    const clean = {};
    if (typeof payload === 'object') {
      for (const [key, val] of Object.entries(payload)) {
        if (typeof val !== 'function' && typeof val !== 'symbol') {
          try {
            clean[key] = JSON.parse(JSON.stringify(val));
          } catch (_) {}
        }
      }
    }
    return clean;
  }
}

contextBridge.exposeInMainWorld('api', {
  // دریافت مسیر فایل با پشتیبانی چندگانه از File Object، رشته مستقیم و ساختار وب
  getFilePath: (file) => {
    if (!file) return '';
    if (typeof file === 'string') return file.trim();

    try {
      if (webUtils && typeof webUtils.getPathForFile === 'function') {
        const p = webUtils.getPathForFile(file);
        if (p) return p;
      }
    } catch (_) {}

    return file?.path || file?.filePath || '';
  },

  openFolder: () => ipcRenderer.invoke('open-folder'),
  openFile: () => ipcRenderer.invoke('open-file'),

  // انتخاب تصویر کاور سفارشی از سیستم و ذخیره دائمی برای کمیک یا PDF
  selectCustomCover: (comicFilePath = '') => {
    const cleanPath = typeof comicFilePath === 'string' ? comicFilePath.trim() : '';
    return ipcRenderer.invoke('select-custom-cover', cleanPath);
  },

  handleDrop: (filePaths) => {
    const sanitized = Array.isArray(filePaths)
      ? filePaths.map((p) => (typeof p === 'string' ? p : p?.path || '')).filter(Boolean)
      : [];
    return ipcRenderer.invoke('handle-drop', sanitized);
  },

  sortDirectory: (filePath, sortBy) => {
    return ipcRenderer.invoke('sort-directory', {
      filePath: typeof filePath === 'string' ? filePath : '',
      sortBy: sortBy || 'name_asc'
    });
  },

  // لغو استخراج فایل و پاک‌سازی کش موقت
  cancelExtraction: () => ipcRenderer.invoke('cancel-extraction'),
  cleanupComicCache: () => ipcRenderer.invoke('cleanup-comic-cache'),

  // استخراج صاعقه‌ای کاور صفحه اول مانهوا / کمیک
  getFirstPageThumbnail: (filePath) => {
    if (!filePath || typeof filePath !== 'string') {
      return Promise.resolve({ success: false, error: 'مسیر نامعتبر است' });
    }
    return ipcRenderer.invoke('get-first-page-thumbnail', filePath.trim());
  },

  // تراکنش‌های امن دیتابیس لوکال با پاک‌سازی داده
  dbAction: (requestData) => {
    const cleanData = sanitizePayload(requestData);
    return ipcRenderer.invoke('db-action', cleanData);
  },

  // اکشن‌های سیستمی فایل و کلیپ‌بورد
  showItemInFolder: (filePath) => {
    if (!filePath || typeof filePath !== 'string') {
      return Promise.resolve({ success: false, error: 'مسیر فایل مشخص نشده است.' });
    }
    return ipcRenderer.invoke('show-item-in-folder', filePath.trim());
  },

  copyImageToClipboard: (payload) => {
    return ipcRenderer.invoke('copy-image-clipboard', sanitizePayload(payload));
  },

  saveScreenshot: (payload) => {
    return ipcRenderer.invoke('save-screenshot', sanitizePayload(payload));
  },

  // مرحله ۵ ـ بخش الف: خروجیِ PDFِ حاشیه‌نویسی‌شده + پشتیبان‌گیری/بازیابی
  exportAnnotatedPdf: (payload) => {
    return ipcRenderer.invoke('export-annotated-pdf', sanitizePayload(payload));
  },

  // مرحله ۸ ـ بخش الف: استراتژیِ Xodo — بررسیِ محافظت و ساختِ
  // نسخهٔ کپیِ بدونِ قفل، فقط هنگامِ ورود به استودیو.
  checkPdfProtection: (filePath) => {
    if (!filePath || typeof filePath !== 'string') {
      return Promise.resolve({ protected: false, reason: 'unknown', pageCount: -1, hasEncryptToken: false });
    }
    return ipcRenderer.invoke('check-pdf-protection', { filePath: filePath.trim() });
  },

  // مرحله ۱۱: options اختیاری — { desiredName, desiredPath }:
  // نام/مسیرِ دلخواهِ کاربر برای نسخهٔ کپی (از مودالِ محافظت).
  createUnlockedPdfCopy: (filePath, password, options) => {
    if (!filePath || typeof filePath !== 'string') {
      return Promise.resolve({ success: false, error: 'مسیر فایل مشخص نشده است.' });
    }
    return ipcRenderer.invoke('create-unlocked-pdf-copy', {
      filePath: filePath.trim(),
      password: typeof password === 'string' ? password : '',
      desiredName: options && typeof options.desiredName === 'string' ? options.desiredName : undefined,
      desiredPath: options && typeof options.desiredPath === 'string' ? options.desiredPath : undefined,
    });
  },

  // مرحله ۱۱: دیالوگِ استانداردِ انتخابِ نام و پوشهٔ نسخهٔ کپی.
  chooseCopySavePath: (filePath, defaultName) => {
    if (!filePath || typeof filePath !== 'string') {
      return Promise.resolve({ canceled: true });
    }
    return ipcRenderer.invoke('choose-copy-save-path', {
      filePath: filePath.trim(),
      defaultName: typeof defaultName === 'string' ? defaultName : undefined,
    });
  },

  // مرحله ۱۱: ایندکسِ جستجویِ کناریِ فایلِ بازسازی‌شده.
  getSearchIndex: (filePath) => {
    if (!filePath || typeof filePath !== 'string') {
      return Promise.resolve({ found: false });
    }
    return ipcRenderer.invoke('get-search-index', { filePath: filePath.trim() });
  },

  // مرحله ۹ — لایهٔ ۱: آماده‌سازیِ خواندنِ فایلِ محافظت‌شده
  // (رمزِ صوری / رمزگشایی با رمزِ نشست / نیازِ رمز). رمزِ عبور، فقط
  // برای این فراخوانی به پروسهٔ اصلی می‌رود و هیچ‌جا ذخیره نمی‌شود.
  prepareProtectedPdfForReading: (filePath, password) => {
    if (!filePath || typeof filePath !== 'string') {
      return Promise.resolve({ status: 'error', reason: 'file-missing', pageCount: -1 });
    }
    return ipcRenderer.invoke('prepare-protected-pdf-for-reading', { filePath: filePath.trim(), password: typeof password === 'string' ? password : '' });
  },

  // مرحله ۸ ـ اصلاحِ نهایی: لغوِ ساختِ نسخهٔ کپی (کارهای فعالِ
  // همین رندرر خاتمه می‌یابند).
  cancelPdfCopy: () => {
    return ipcRenderer.invoke('cancel-pdf-copy');
  },

  // مرحله ۱۰: مدیریتِ حافظه (آمار، پاک‌سازیِ کاورها، هرسِ
  // فایل‌های حذف‌شده) + ذخیرهٔ فایلِ بازسازی‌شده + تغییرِ محلِ
  // داده. رمزِ عبوری در هیچ‌یک از این کانال‌ها رد نمی‌شود.
  getStorageStats: () => {
    return ipcRenderer.invoke('get-storage-stats');
  },

  clearAllCovers: () => {
    return ipcRenderer.invoke('clear-all-covers');
  },

  pruneMissingFiles: () => {
    return ipcRenderer.invoke('prune-missing-files');
  },

  saveRebuiltPdf: (payload) => {
    return ipcRenderer.invoke('save-rebuilt-pdf', sanitizePayload(payload));
  },

  changeDataDirectory: (payload) => {
    return ipcRenderer.invoke('change-data-directory', sanitizePayload(payload || {}));
  },

  exportBackup: () => {
    return ipcRenderer.invoke('export-backup');
  },

  importBackup: () => {
    return ipcRenderer.invoke('import-backup');
  },

  // کنترل‌های پنجره
  closeApp: () => ipcRenderer.send('window-close'),
  minimizeApp: () => ipcRenderer.send('window-minimize'),
  maximizeApp: () => ipcRenderer.send('window-maximize'),
  toggleFullscreen: () => ipcRenderer.invoke('toggle-fullscreen'),
  isFullscreen: () => ipcRenderer.invoke('is-fullscreen'),

  // مرحله ۷ ـ بخش الف: اطلاعاتِ محیط برای صفحهٔ دانلودها/به‌روزرسانی
  // (نسخه، حالتِ بسته‌بندی/Portable، اندازهٔ دیتابیس و لاگ، تعدادِ کاورها).
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),

  // شنونده پیشرفت استخراج بدون نشت حافظه
  onExtractionProgress: (callback) => {
    if (typeof callback !== 'function') return () => {};

    const subscription = (event, percent) => {
      try {
        callback(percent);
      } catch (err) {
        console.error('Extraction progress listener error:', err);
      }
    };

    ipcRenderer.on('extraction-progress', subscription);

    return () => {
      try {
        ipcRenderer.removeListener('extraction-progress', subscription);
      } catch (_) {}
    };
  },

  // مرحله ۸ ـ اصلاحِ نهایی: پیشرفتِ پروب/کپیِ PDF (ورکرِ جدا).
  // الگو، همان onExtractionProgress است: اشتراک + تابعِ لغوِ
  // اشتراک، بدونِ نشتِ شنونده.
  onPdfCopyProgress: (callback) => {
    if (typeof callback !== 'function') return () => {};

    const subscription = (event, progress) => {
      try {
        callback(progress);
      } catch (err) {
        console.error('PDF copy progress listener error:', err);
      }
    };

    ipcRenderer.on('pdf-copy-progress', subscription);

    return () => {
      try {
        ipcRenderer.removeListener('pdf-copy-progress', subscription);
      } catch (_) {}
    };
  },

  removeExtractionListeners: () => {
    try {
      ipcRenderer.removeAllListeners('extraction-progress');
    } catch (_) {}
  }
});