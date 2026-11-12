'use strict';

// ============================================================================
// راه‌اندازی و تزریق مسیرهای ماژول در محیط پروداکشن برای ورکرها (رفع خطای Cannot find module)
// ============================================================================
const path = require('path');
const Module = require('module');

(function bootstrapAsarWorkerModulePaths() {
  const extraPaths = [];
  const unpackedRoot = path.resolve(__dirname, '..', '..');
  extraPaths.push(path.join(unpackedRoot, 'node_modules'));
  if (unpackedRoot.includes('app.asar.unpacked')) {
    const asarRoot = unpackedRoot.replace('app.asar.unpacked', 'app.asar');
    extraPaths.push(path.join(asarRoot, 'node_modules'));
  }
  if (process.resourcesPath) {
    extraPaths.push(path.join(process.resourcesPath, 'app.asar', 'node_modules'));
    extraPaths.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules'));
  }
  for (const p of extraPaths) {
    if (p && !module.paths.includes(p)) {
      module.paths.unshift(p);
    }
  }
  const existingNodePath = process.env.NODE_PATH ? process.env.NODE_PATH.split(path.delimiter) : [];
  const merged = Array.from(new Set([...extraPaths, ...existingNodePath])).filter(Boolean);
  process.env.NODE_PATH = merged.join(path.delimiter);
  if (typeof Module._initPaths === 'function') {
    Module._initPaths();
  }
  if (typeof Module._nodeModulePaths === 'function') {
    const origNodeModulePaths = Module._nodeModulePaths;
    Module._nodeModulePaths = function (from) {
      const paths = origNodeModulePaths.call(this, from);
      const combined = [];
      for (const p of paths) {
        if (p.includes('app.asar.unpacked')) {
          combined.push(p);
          combined.push(p.replace('app.asar.unpacked', 'app.asar'));
        } else if (p.includes('app.asar')) {
          combined.push(p.replace('app.asar', 'app.asar.unpacked'));
          combined.push(p);
        } else {
          combined.push(p);
        }
      }
      return Array.from(new Set([...extraPaths, ...combined]));
    };
  }
})();

const { parentPort } = require('worker_threads');
const fs = require('fs');

function requireServiceModule(relPath) {
  const candidates = [
    path.resolve(__dirname, relPath),
  ];
  if (__dirname.includes('app.asar.unpacked')) {
    candidates.push(path.resolve(__dirname.replace('app.asar.unpacked', 'app.asar'), relPath));
  } else if (__dirname.includes('app.asar')) {
    candidates.push(path.resolve(__dirname.replace('app.asar', 'app.asar.unpacked'), relPath));
  }

  let lastErr = null;
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error(`Cannot find module ${relPath}`);
}

let saver = null;
let qpdfService = null;

try {
  saver = requireServiceModule('../services/pdfAnnotationSaver');
} catch (err) {
  if (parentPort) {
    parentPort.postMessage({
      type: 'error',
      message: 'ماژولِ خروجیِ PDF (pdfAnnotationSaver.js) پیدا نشد: ' + String((err && err.message) || err),
    });
  }
}

try {
  qpdfService = requireServiceModule('../services/qpdfUnlockService');
} catch (_) {
  qpdfService = null;
}

function postProgress(stage, fraction, label) {
  try {
    if (parentPort) {
      parentPort.postMessage({
        type: 'progress',
        stage,
        fraction,
        label: String(label || ''),
      });
    }
  } catch (_) {}
}

function makeLogger() {
  const send = (level, message, detail) => {
    try {
      if (parentPort) {
        parentPort.postMessage({
          type: 'log',
          level,
          message: String(message),
          detail:
            detail === undefined || detail === null
              ? ''
              : String(detail && detail.stack ? detail.stack : detail),
        });
      }
    } catch (_) {}
  };
  return {
    info(message, detail) { send('info', message, detail); },
    warn(message, detail) { send('warn', message, detail); },
    error(message, detail) { send('error', message, detail); },
  };
}

async function checkQpdfAvailable() {
  try {
    if (saver && typeof saver.isQpdfAvailable === 'function') {
      const ok = await saver.isQpdfAvailable();
      if (ok) return true;
    }
  } catch (_) {}

  try {
    if (qpdfService) {
      if (typeof qpdfService.isQpdfAvailable === 'function') {
        const ok = await qpdfService.isQpdfAvailable();
        if (ok) return true;
      }
      if (typeof qpdfService.checkQpdfAvailable === 'function') {
        const ok = await qpdfService.checkQpdfAvailable();
        if (ok) return true;
      }
    }
  } catch (_) {}

  try {
    require.resolve('@neslinesli93/qpdf-wasm');
    return true;
  } catch (_) {
    return false;
  }
}

const COPY_DECRYPT_MAX_BYTES = 50 * 1024 * 1024;
const COPY_QPDF_MAX_BYTES = 250 * 1024 * 1024;

async function handleProbe(filePath) {
  const logger = makeLogger();
  const qpdfAvailable = await checkQpdfAvailable();

  const result = await saver.probePdfProtectionForPath(filePath, logger, (fraction, label) => {
    postProgress('probe', fraction, label);
  });

  let encryption = result && result.encryption ? result.encryption : null;
  let rebuildRecommended = Boolean(result && result.rebuildRecommended);

  if (result && result.protected && !encryption && typeof saver.describePdfEncryptionForPath === 'function') {
    try {
      encryption = await saver.describePdfEncryptionForPath(filePath, logger);
      rebuildRecommended = Boolean(encryption && encryption.rebuildRecommended);
    } catch (_) {}
  }

  let isProtected = Boolean(result && result.protected);
  let isReadOnly = Boolean(result && result.readOnly);

  // اگر موتور qpdf در دسترس است و فایل رمز عبور واقعی کاربر نیاز ندارد،
  // پیشنهاد بازسازی تصویری (pdf.js rebuild) را غیرفعال می‌کنیم تا از موتور qpdf استفاده شود
  if (qpdfAvailable && encryption && encryption.qpdfSupported !== false) {
    rebuildRecommended = false;
  }

  // جلوگیری از قفل کاذب فایل‌های عادی در پروب سریع (Fast Probe)
  // اگر فایل رمزگذاری نشده (isProtected === false) و فقط هشدار ساختاری جزئی دارد، قابل ویرایش است
  if (!isProtected && isReadOnly && result && result.fast) {
    const invalidCount = Array.isArray(result.invalidObjects) ? result.invalidObjects.length : 0;
    if (invalidCount === 0 && !result.hasEncryptToken) {
      isReadOnly = false;
    }
  }

  postProgress('probe-done', 1, 'بررسیِ محافظت انجام شد.');

  return {
    protected: isProtected,
    qpdfAvailable,
    readOnly: isReadOnly,
    reason: (result && result.reason) || 'unknown',
    pageCount: (result && result.pageCount) || -1,
    hasEncryptToken: Boolean(result && result.hasEncryptToken),
    fast: Boolean(result && result.fast),
    invalidObjects: Array.isArray(result && result.invalidObjects) ? result.invalidObjects.length : 0,
    warningsCount: (result && result.warningsCount) || 0,
    encryption: encryption || undefined,
    rebuildRecommended,
  };
}

async function handleCopy(filePath, tempPath, password) {
  const logger = makeLogger();
  const stat = await fs.promises.stat(filePath);
  const size = stat.size;

  const probe = await saver.probePdfProtectionForPath(filePath, logger, (fraction, label) => {
    postProgress('copy-probe', fraction * 0.05, label);
  });
  postProgress('copy-probe', 0.05, 'بررسیِ محافظت انجام شد.');

  // برای تمام فایل‌های زیر ۲۵۰ مگابایت (چه قفل‌دار، چه فقط‌خواندنی و چه عادی)
  // ابتدا از موتور qpdf و رمزگشای داخلی استفاده می‌کنیم تا یک نسخه کاملاً باز و استاندارد ساخته شود
  if (size <= COPY_QPDF_MAX_BYTES) {
    const bytes = await fs.promises.readFile(filePath);
    postProgress('copy-read', 0.08, 'در حالِ خواندنِ فایل و پردازش با موتور qpdf…');

    if (typeof saver.createUnlockedPdfCopy === 'function') {
      const result = await saver.createUnlockedPdfCopy({
        bytes,
        logger,
        password: typeof password === 'string' ? password : '',
        probeHint: {
          protected: Boolean(probe.protected || probe.readOnly || probe.hasEncryptToken),
          pageCount: probe.pageCount,
          invalidObjects: Array.isArray(probe.invalidObjects) ? probe.invalidObjects : [],
        },
        allowHeavyFallback: size <= COPY_DECRYPT_MAX_BYTES,
        onProgress: (fraction, label) => {
          postProgress('copy', 0.08 + fraction * 0.85, label);
        },
      });

      // اگر فایل با موفقیت توسط qpdf یا pdf-lib باز شد و بایت‌های خروجی آماده است
      if (result && result.success && result.bytes) {
        const done = await writeCopyTemp(result, tempPath);
        postProgress('copy-done', 1, 'نسخهٔ کپیِ قابل‌ویرایش آماده است.');
        return done;
      }

      // اگر createUnlockedPdfCopy اعلام کرد فایل از قبل باز است (alreadyUnlocked)،
      // حتماً با buildUnencryptedCopyBytes (موتور qpdf) فایل خروجی را در tempPath می‌نویسیم
      if (result && result.success && (result.alreadyUnlocked || !result.bytes)) {
        if (typeof saver.buildUnencryptedCopyBytes === 'function') {
          const built = await saver.buildUnencryptedCopyBytes({ bytes, logger });
          if (built && built.bytes) {
            await fs.promises.writeFile(tempPath, Buffer.from(built.bytes));
            postProgress('copy-done', 1, 'نسخهٔ کپی آماده است.');
            return {
              success: true,
              alreadyUnlocked: false,
              binaryCopy: built.unlockedBy === 'binary',
              unlockedBy: built.unlockedBy || 'qpdf',
              pageCount: probe.pageCount,
              textGate: 'not-needed',
              tempPath,
            };
          }
        }
      }

      // اگر فایل رمز عبور واقعی کاربر را می‌خواهد یا رمزگذاری پشتیبانی‌نشده دارد
      if (
        result &&
        (result.code === 'PDF_COPY_PASSWORD_REQUIRED' ||
          result.code === 'PDF_COPY_UNSUPPORTED_ENCRYPTION')
      ) {
        return {
          success: false,
          code: result.code,
          error: result.error || 'ساختِ نسخهٔ کپیِ قابل‌ویرایش انجام نشد.',
          pageCount: probe.pageCount,
        };
      }
    }

    // مسیر جایگزین با buildUnencryptedCopyBytes اگر فایل رمز عبور نداشت
    if (!probe.protected && typeof saver.buildUnencryptedCopyBytes === 'function') {
      const built = await saver.buildUnencryptedCopyBytes({ bytes, logger });
      if (built && built.bytes) {
        await fs.promises.writeFile(tempPath, Buffer.from(built.bytes));
        const tempStat = await fs.promises.stat(tempPath);
        if (built.unlockedBy === 'binary' && tempStat.size !== size) {
          throw new Error('کپیِ باینری ناقص نوشته شد (' + tempStat.size + ' از ' + size + ' بایت).');
        }
        postProgress('copy-done', 1, 'نسخهٔ کپی آماده است.');
        return {
          success: true,
          alreadyUnlocked: false,
          binaryCopy: built.unlockedBy === 'binary',
          unlockedBy: built.unlockedBy || undefined,
          pageCount: probe.pageCount,
          textGate: 'not-needed',
          tempPath,
        };
      }
    }
  }

  // مسیر کپی باینری (فقط برای فایل‌های بسیار حجیم بالای ۲۵۰ مگابایت یا در صورت عدم نیاز به رمزگشایی)
  postProgress('copy-binary', 0.1, 'در حالِ ساختِ کپیِ باینری…');
  await fs.promises.copyFile(filePath, tempPath);
  const tempStat = await fs.promises.stat(tempPath);
  if (tempStat.size !== size) {
    throw new Error('کپیِ باینری ناقص نوشته شد (' + tempStat.size + ' از ' + size + ' بایت).');
  }
  postProgress('copy-binary', 1, 'نسخهٔ کپی آماده است.');
  return {
    success: true,
    alreadyUnlocked: false,
    binaryCopy: true,
    stillEncrypted: Boolean(probe.protected),
    readOnlyCopy: false,
    pageCount: probe.pageCount || -1,
    textGate: 'skipped-binary-copy',
    tempPath,
  };
}

async function handlePrepare(filePath, password, cacheDir) {
  const result = await saver.prepareProtectedPdfForReading({
    filePath,
    password: typeof password === 'string' ? password : '',
    cacheDir: typeof cacheDir === 'string' ? cacheDir : '',
    logger: makeLogger(),
    onProgress: (fraction, label) => {
      postProgress('prepare', fraction, label);
    },
  });
  postProgress('prepare-done', 1, 'آماده‌سازی انجام شد.');
  return {
    status: result.status,
    path: result.path || null,
    pageCount: typeof result.pageCount === 'number' ? result.pageCount : -1,
    reason: result.reason || null,
  };
}

async function writeCopyTemp(result, tempPath) {
  if (!result || !result.bytes) {
    return {
      success: true,
      alreadyUnlocked: true,
      pageCount: result ? result.pageCount : -1,
      textGate: 'not-needed',
    };
  }
  await fs.promises.writeFile(tempPath, Buffer.from(result.bytes));
  return {
    success: true,
    alreadyUnlocked: false,
    binaryCopy: false,
    pageCount: result.pageCount,
    textGate: result.textGate,
    unlockedBy: result.unlockedBy || 'qpdf',
    healed: Boolean(result.healed),
    baselineInvalidObjects: result.baselineInvalidObjects || 0,
    outputInvalidObjects: result.outputInvalidObjects || 0,
    tempPath,
  };
}

if (parentPort) {
  parentPort.on('message', async (msg) => {
    try {
      if (!msg || typeof msg !== 'object') return;
      if (!saver) {
        throw new Error('ماژولِ خروجیِ PDF (pdfAnnotationSaver.js) بارگذاری نشده است.');
      }

      if (msg.type === 'probe') {
        const result = await handleProbe(msg.filePath);
        parentPort.postMessage({ type: 'done', result });
      } else if (msg.type === 'prepare') {
        const result = await handlePrepare(msg.filePath, msg.password, msg.cacheDir);
        parentPort.postMessage({ type: 'done', result });
      } else if (msg.type === 'export') {
        const result = await saver.saveAnnotatedPdf({
          pdfPath: msg.pdfPath,
          pages: msg.pages,
          outputPath: msg.outputPath,
          mode: msg.mode,
          logger: makeLogger(),
          password: typeof msg.password === 'string' ? msg.password : '',
          dataDir: typeof msg.dataDir === 'string' ? msg.dataDir : '',
        });
        parentPort.postMessage({
          type: 'done',
          result: result || { success: false, error: 'ساختِ PDFِ حاشیه‌نویسی‌شده انجام نشد.' },
        });
      } else if (msg.type === 'copy') {
        if (!msg.tempPath || typeof msg.tempPath !== 'string') {
          parentPort.postMessage({ type: 'error', message: 'مسیرِ فایلِ موقتِ کپی مشخص نشده است.' });
          return;
        }
        const result = await handleCopy(msg.filePath, msg.tempPath, msg.password);
        parentPort.postMessage({
          type: 'done',
          result: result || { success: false, error: 'ساختِ نسخهٔ کپی انجام نشد.' },
        });
      }
    } catch (err) {
      try {
        parentPort.postMessage({
          type: 'error',
          message: String((err && err.message) || err),
        });
      } catch (_) {}
    }
  });
}