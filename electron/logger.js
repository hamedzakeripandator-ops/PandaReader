// مرحله ۷ ـ بخش الف: لاگرِ چرخشیِ دیسک برای پروسهٔ اصلی.
//
// این فایل، عمداً هیچ وابستگی‌ای به Electron ندارد (فقط fs/path/os)
// تا هم از main.js و هم از ipcHandlers.js با require قابلِ
// استفاده باشد. نوشتن، همگام (sync) است: در مسیرهای بحرانی
// (uncaughtException) نباید به فلاشِ ناهمگام اعتماد کرد، و حجمِ
// لاگ‌ها آن‌قدر کم است که نوشتنِ همگام، حلقهٔ رویداد را محسوس
// مسدود نمی‌کند. لاگر، هرگز throw نمی‌کند: هر خطایی در نوشتن،
// ساکت بلعیده می‌شود تا خودِ لاگر، باعثِ کرش نشود.
//
// محلِ فایل: <dataDir>/logs/app.log — dataDir همان پوشهٔ دیتای
// برنامه است (~/.comic-reader یا portable-data در حالتِ Portable).
// چرخش: پیش از هر نوشتن، اگر اندازه از ۲ مگابایت گذشته باشد،
// app.log به app.log.1 منتقل می‌شود (نسخهٔ قبلیِ .1 بازنویسی
// می‌شود؛ فقط یک نسلِ قبلی نگه داشته می‌شود).

const fs = require('fs');
const path = require('path');
const os = require('os');

const MAX_LOG_BYTES = 2 * 1024 * 1024; // 2MB
const LOG_FILE_NAME = 'app.log';
const ROTATED_FILE_NAME = 'app.log.1';

function defaultDataDir() {
  return path.join(os.homedir(), '.comic-reader');
}

function isAbsolutePath(p) {
  return typeof p === 'string' && p.length > 0 && path.isAbsolute(p);
}

// تصمیمِ محلِ دیتا (حالتِ Portable در برابرِ حالتِ عادی).
// ترتیبِ بررسی:
//   ۱) متغیرِ محیطیِ COMIC_READER_PORTABLE=1 → portable-data در کنارِ فایلِ اجرایی.
//   ۲) فقط در حالتِ بسته‌بندی‌شده (isPackaged): پوشهٔ portable-data یا
//      نشانگرِ .portable در کنارِ فایلِ اجرایی یا کنارِ appPath → Portable.
//   ۳) فقط در حالتِ توسعه (isPackaged === false): پوشهٔ portable-data
//      در کنارِ ریشهٔ پروژه (appPath) → Portable.
//   ۴) در غیرِ این صورت، ~/.comic-reader دقیقاً مثلِ قبل.
// مرحله ۷ ـ بخش ب: نشانگرِ .portable، فقط در حالتِ بسته‌بندی‌شده
// بررسی می‌شود. پیش از این، در حالتِ توسعه، «کنارِ appPath» یعنی
// پوشهٔ والدِ ریشهٔ پروژه (مثلاً Desktop) بررسی می‌شد و یک فایلِ
// ‎.portableِ بی‌ربط روی Desktop، به‌اشتباه دیتابیسِ ~/.comic-reader
// را نادیده می‌گرفت و برنامه را به portable-dataی داخلِ
// node_modules می‌برد.
// app، همان شیءِ appی Electron است (getPath('exe') و getAppPath و
// isPackaged). اگر app در دسترس نباشد (تستِ واحد)، فقط قانونِ ۵
// اعمال می‌شود.
function resolveComicDataDir(app) {
  const homeDir = defaultDataDir();
  try {
    if (!app || typeof app.getPath !== 'function') return homeDir;
    const exeDir = path.dirname(app.getPath('exe'));
    const appPath = typeof app.getAppPath === 'function' ? app.getAppPath() : null;
    const appDir = appPath ? path.dirname(appPath) : null;
    const portableDir = path.join(exeDir, 'portable-data');

    const envPortable = process.env.COMIC_READER_PORTABLE === '1';
    if (envPortable) return portableDir;
    if (app.isPackaged) {
      const portableFolderBesideExe = fs.existsSync(portableDir);
      const markerBesideExe = fs.existsSync(path.join(exeDir, '.portable'));
      const markerBesideApp = appDir ? fs.existsSync(path.join(appDir, '.portable')) : false;
      if (portableFolderBesideExe || markerBesideExe || markerBesideApp) {
        return portableDir;
      }
    } else if (appPath) {
      const devPortableDir = path.join(appPath, 'portable-data');
      if (fs.existsSync(devPortableDir)) return devPortableDir;
    }
  } catch (_) {
    // هر خطایی در تشخیص، به حالتِ عادی برمی‌گردد؛ هرگز کرش نمی‌کند.
  }
  return homeDir;
}

function createLogger(dataDir) {
  const dir = isAbsolutePath(dataDir) ? dataDir : defaultDataDir();
  const logsDir = path.join(dir, 'logs');
  const logFile = path.join(logsDir, LOG_FILE_NAME);
  const rotatedFile = path.join(logsDir, ROTATED_FILE_NAME);

  function ensureLogsDir() {
    try {
      fs.mkdirSync(logsDir, { recursive: true });
      return true;
    } catch (_) {
      return false;
    }
  }

  function rotateIfNeeded() {
    try {
      const stat = fs.statSync(logFile);
      if (stat.size <= MAX_LOG_BYTES) return;
      try { fs.unlinkSync(rotatedFile); } catch (_) { /* نبودِ فایلِ قبلی، خطا نیست */ }
      fs.renameSync(logFile, rotatedFile);
    } catch (_) {
      // نبودِ فایل یا خطای خواندنِ اندازه: چرخش لازم نیست.
    }
  }

  function formatValue(value) {
    if (value instanceof Error) {
      return value.stack || (value.name + ': ' + value.message);
    }
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value);
    } catch (_) {
      return String(value);
    }
  }

  function write(level, message, detail) {
    try {
      if (!ensureLogsDir()) return;
      rotateIfNeeded();
      const stamp = new Date().toISOString();
      let line = '[' + stamp + '] [' + level + '] ' + String(message);
      if (detail !== undefined && detail !== null && detail !== '') {
        line += '\n' + formatValue(detail);
      }
      line += '\n';
      fs.appendFileSync(logFile, line, 'utf8');
    } catch (_) {
      // لاگر، هرگز throw نمی‌کند.
    }
  }

  return {
    logFile,
    logsDir,
    info(message, detail) { write('INFO', message, detail); },
    warn(message, detail) { write('WARN', message, detail); },
    error(message, detail) { write('ERROR', message, detail); },
  };
}

function getLogFileInfo(dataDir) {
  const dir = isAbsolutePath(dataDir) ? dataDir : defaultDataDir();
  const logFile = path.join(dir, 'logs', LOG_FILE_NAME);
  try {
    const stat = fs.statSync(logFile);
    return { path: logFile, size: stat.size, exists: true };
  } catch (_) {
    return { path: logFile, size: 0, exists: false };
  }
}

module.exports = {
  MAX_LOG_BYTES,
  createLogger,
  resolveComicDataDir,
  getLogFileInfo,
  defaultDataDir,
};
