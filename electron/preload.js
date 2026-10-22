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

  // کنترل‌های پنجره
  closeApp: () => ipcRenderer.send('window-close'),
  minimizeApp: () => ipcRenderer.send('window-minimize'),
  maximizeApp: () => ipcRenderer.send('window-maximize'),
  toggleFullscreen: () => ipcRenderer.invoke('toggle-fullscreen'),
  isFullscreen: () => ipcRenderer.invoke('is-fullscreen'),

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

  removeExtractionListeners: () => {
    try {
      ipcRenderer.removeAllListeners('extraction-progress');
    } catch (_) {}
  }
});