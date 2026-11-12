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

// این بخش به پیام‌های مدیر (main.js یا ipcHandlers) گوش می‌دهد
parentPort.on('message', async (data) => {
  const { filePath, tempDir } = data; // دریافت آدرس PDF اصلی و پوشه موقت
  
  try {
    // ۱. بررسی وجود فایل اصلی
    if (!fs.existsSync(filePath)) {
      parentPort.postMessage({ type: 'error', message: 'فایل PDF پیدا نشد.' });
      return;
    }

    // ۲. [حیاتی] اطمینان از وجود پوشه موقت (جلوگیری از خطای ENOENT و کرش Worker)
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // ۳. آماده‌سازی مسیر خروجی
    const fileName = path.basename(filePath);
    const outputPath = path.join(tempDir, fileName);

    // ارسال پیام شروع عملیات
    parentPort.postMessage({ type: 'progress', percent: 10 });

    // ۴. محاسبه حجم فایل برای گزارش درصد پیشرفت
    const stat = fs.statSync(filePath);
    const totalBytes = stat.size;
    
    if (totalBytes === 0) {
      parentPort.postMessage({ type: 'error', message: 'فایل PDF خالی یا خراب است.' });
      return;
    }

    let copiedBytes = 0;
    let lastReportedPercent = 0;

    const readStream = fs.createReadStream(filePath);
    const writeStream = fs.createWriteStream(outputPath);

    // ۵. [حیاتی] مدیریت ایمن خطاهای Stream (جلوگیری از کرش خاموش Worker)
    readStream.on('error', (err) => {
      parentPort.postMessage({ type: 'error', message: 'خطا در خواندن فایل: ' + err.message });
      writeStream.destroy(); // بستن Stream مقابل برای جلوگیری از نشت حافظه
    });

    writeStream.on('error', (err) => {
      parentPort.postMessage({ type: 'error', message: 'خطا در نوشتن فایل: ' + err.message });
      readStream.destroy();
    });

    readStream.on('data', (chunk) => {
      copiedBytes += chunk.length;
      const percent = Math.round((copiedBytes / totalBytes) * 100);
      
      // ارسال پیشرفت فقط در صورت تغییر قابل توجه (جلوگیری از ارسال هزاران پیام در ثانیه)
      if (percent >= lastReportedPercent + 10) {
        lastReportedPercent = percent;
        parentPort.postMessage({ type: 'progress', percent });
      }
    });

    // وقتی کپی کردن کاملاً تمام شد
    writeStream.on('finish', () => {
      parentPort.postMessage({ type: 'progress', percent: 100 });
      // ۶. ارسال آدرس فایلِ موقت و امن به مدیر برای نمایش در برنامه
      parentPort.postMessage({ 
        type: 'done', 
        items: [{ path: outputPath, name: fileName }] 
      });
    });

    // شروع عملیات انتقال جریان داده (Piping)
    readStream.pipe(writeStream);

  } catch (error) {
    // catch نهایی برای هر خطای پیش‌بینی نشده
    parentPort.postMessage({ type: 'error', message: 'خطا در آماده‌سازی PDF: ' + error.message });
  }
});