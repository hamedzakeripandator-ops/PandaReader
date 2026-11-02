'use strict';
// ===========================================================================
// مرحله ۱۱ — بازگشاییِ بی‌اتلافِ PDF با @neslinesli93/qpdf-wasm.
//
// موتورِ C++ِ QPDF که به WASM کامپایل شده است: تمامِ استانداردهایِ
// رمزنگاریِ PDF (شاملِ AES-256 با R=5/6 و استریم‌هایِ فشردهٔ
// ObjStm) را بی‌اتلاف باز می‌کند؛ متن‌ها، فونت‌ها، بردارها، لینک‌ها
// و Outline دست‌نخورده می‌مانند، حجمِ خروجی ~۱ برابرِ ورودی است و
// سرچِ متن (Ctrl+F) در فایلِ کپی‌شده ۱۰۰٪ کار می‌کند — دقیقاً همان
// رفتاری که Xodo دارد. این سرویس، «خطِ اول»ِ بازگشایی است؛ اگر
// ماژول در دسترس نباشد، ورودی خیلی بزرگ باشد، یا qpdf خطا بدهد،
// فراخواننده‌ها به مسیرهایِ قبلی (رمزگشاییِ pdf-lib، کپیِ باینری،
// بازسازی از pdf.js) می‌افتند و هیچ‌چیز، بی‌صدا خراب نمی‌شود.
//
// قراردادهایِ اثبات‌شده با هارنسِ Node (qtest.cjs/qtime.cjs،
// ‏@neslinesli93/qpdf-wasm@0.3.0):
//  • پکیج، CommonJS است (main: dist/qpdf.js) و با require بارگذاری
//    می‌شود؛ createModule({locateFile}) یک Promise برمی‌گرداند.
//  • callMain، در موفقیت ۰ و در شکست ۲ برمی‌گرداند و throw نمی‌کند؛
//    پس موفقیت، فقط با «کدِ ۰ + وجودِ فایلِ خروجی + magicِ %PDF-»
//    پذیرفته می‌شود.
//  • خروجیِ خطای qpdf (stderr)، از مسیرِ printErrِ Emscripten
//    نمی‌گذرد: هشدارها به console.error و خطاهایِ اصلی (مثلِ
//    «invalid password») به process.stderr.write می‌روند؛ پس در
//    مدتِ اجرایِ همگامِ callMain، هر دو کانال به‌صورتِ موقت
//    جمع‌آوری می‌شوند تا ترمینالِ کاربر، آلوده نشود.
//  • نمونهٔ WASM، تک‌نمونه و FS مشترک دارد؛ همهٔ فراخوانی‌ها از یک
//    صفِ Promise سریال می‌شوند تا دو بازگشایی، هم‌زمان FS را خراب
//    نکنند.
//  • بارگذاریِ ماژول، تنبل است: اگر پکیج نصب نباشد، require فقط در
//    اولین استفاده شکست می‌خورد و سرویس، «در دسترس نیست»
//    برمی‌گرداند — بارگذاریِ این فایل، هرگز saver/worker را
//    نمی‌شکند.
// ===========================================================================

const path = require('path');

const QPDF_MAX_INPUT_BYTES = 200 * 1024 * 1024;

let createModuleFn = null;
let createModuleFailed = false;
let instancePromise = null;
let queue = Promise.resolve();
let callCounter = 0;

function getCreateModule() {
  if (createModuleFn) return createModuleFn;
  if (createModuleFailed) return null;
  try {
    const loaded = require('@neslinesli93/qpdf-wasm');
    createModuleFn = loaded && loaded.default ? loaded.default : loaded;
    if (typeof createModuleFn !== 'function') {
      createModuleFailed = true;
      return null;
    }
    return createModuleFn;
  } catch (_) {
    createModuleFailed = true;
    return null;
  }
}

function resolveWasmPath() {
  try {
    const pkgPath = require.resolve('@neslinesli93/qpdf-wasm/package.json');
    return path.join(path.dirname(pkgPath), 'dist', 'qpdf.wasm');
  } catch (_) {
    return null;
  }
}

async function getInstance() {
  if (instancePromise) return instancePromise;
  instancePromise = (async () => {
    const createModule = getCreateModule();
    if (!createModule) return null;
    const wasmPath = resolveWasmPath();
    const instance = await createModule({
      locateFile: (file) => (wasmPath && typeof file === 'string' && /qpdf\.wasm$/i.test(file) ? wasmPath : file),
      print: () => {},
      printErr: () => {},
    });
    if (!instance || typeof instance.callMain !== 'function' || !instance.FS) return null;
    return instance;
  })().catch(() => null);
  const resolved = await instancePromise;
  if (!resolved) instancePromise = null;
  return resolved;
}

// آیا موتورِ qpdf در این پروسه قابلِ بارگذاری است؟ (بهترین‌تلاش؛
// بارگذاریِ WASM ~۲۰ میلی‌ثانیه است و نتیجه کش می‌شود.)
async function isQpdfAvailable() {
  try {
    const instance = await getInstance();
    return Boolean(instance);
  } catch (_) {
    return false;
  }
}

function enqueue(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

// بازگشاییِ بایت‌ها با qpdf. password فقط وقتی پاس داده می‌شود که
// رشتهٔ ناتهی باشد (رمزِ نشستِ فایل)؛ در غیرِ این صورت، qpdf رمزِ
// خالی را خودش امتحان می‌کند.
async function unlockPdfBytes(bytes, password) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  if (buf.length < 8 || buf.slice(0, 5).toString('latin1') !== '%PDF-') {
    return { ok: false, reason: 'not-a-pdf' };
  }
  if (buf.length > QPDF_MAX_INPUT_BYTES) {
    return { ok: false, reason: 'too-large' };
  }
  return enqueue(async () => {
    const instance = await getInstance();
    if (!instance) return { ok: false, reason: 'qpdf-unavailable' };
    const id = ++callCounter;
    const inName = '/qpdf-in-' + id + '.pdf';
    const outName = '/qpdf-out-' + id + '.pdf';
    const captured = [];
    const origError = console.error;
    const origWarn = console.warn;
    const origStderrWrite = process.stderr && process.stderr.write ? process.stderr.write.bind(process.stderr) : null;
    try {
      try { instance.FS.unlink(inName); } catch (_) {}
      try { instance.FS.unlink(outName); } catch (_) {}
      instance.FS.writeFile(inName, new Uint8Array(buf));
      const args = [];
      if (typeof password === 'string' && password.length > 0) args.push('--password=' + password);
      args.push('--decrypt', inName, outName);
      let code = null;
      let threw = null;
      // مرحله ۱۱: خروجیِ qpdf از دو کانال می‌آید (اثباتِ تجربی با
      // qchan2.cjs): هشدارها از console.error، و خطاهایِ اصلی
      // (مثلِ «invalid password») از process.stderr.write. هر دو،
      // فقط در مدتِ اجرایِ همگامِ callMain جمع‌آوری می‌شوند تا
      // ترمینالِ کاربر آلوده نشود؛ callMain همگام است و JS
      // تک‌نخی است، پس هیچ کدِ دیگری در این بازه اجرا نمی‌شود.
      console.error = (...a) => { try { captured.push(a.map(String).join(' ')); } catch (_) {} };
      console.warn = (...a) => { try { captured.push(a.map(String).join(' ')); } catch (_) {} };
      if (origStderrWrite) {
        try {
          process.stderr.write = (chunk) => { try { captured.push(String(chunk)); } catch (_) {} return true; };
        } catch (_) {}
      }
      try {
        code = instance.callMain(args);
      } catch (err) {
        threw = err;
      } finally {
        console.error = origError;
        console.warn = origWarn;
        if (origStderrWrite) {
          try { process.stderr.write = origStderrWrite; } catch (_) {}
        }
      }
      if (threw) {
        return { ok: false, reason: 'qpdf-threw', code: null, stderr: captured.join('\n').slice(0, 500) };
      }
      // مرحلهٔ ۳۳ — کدِ ۳ هم، وقتی خروجیِ سالم دارد، موفقیت است
      // (هشدارِ qpdf، نه شکست). هر کدِ دیگری، همچنان شکست است؛
      // و بررسی‌های خروجیِ پایین‌تر (وجودِ فایل، طول، هدرِ %PDF-)
      // برای کدِ ۳ هم دقیقاً مثلِ کدِ ۰ اجرا می‌شوند.
      if (code !== 0 && code !== 3) {
        return { ok: false, reason: 'qpdf-exit-' + String(code), code, stderr: captured.join('\n').slice(0, 500) };
      }
      let out = null;
      try {
        out = instance.FS.readFile(outName);
      } catch (_) {
        out = null;
      }
      if (!out || out.length < 8) {
        return { ok: false, reason: 'qpdf-no-output', code, stderr: captured.join('\n').slice(0, 500) };
      }
      const outBuf = Buffer.from(out);
      if (outBuf.slice(0, 5).toString('latin1') !== '%PDF-') {
        return { ok: false, reason: 'qpdf-bad-output', code, stderr: captured.join('\n').slice(0, 500) };
      }
      return { ok: true, bytes: outBuf, stderr: captured.join('\n').slice(0, 200) };
    } catch (err) {
      try { console.error = origError; } catch (_) {}
      try { console.warn = origWarn; } catch (_) {}
      return { ok: false, reason: 'qpdf-error', message: String((err && err.message) || err) };
    } finally {
      try { instance.FS.unlink(inName); } catch (_) {}
      try { instance.FS.unlink(outName); } catch (_) {}
    }
  });
}

module.exports = { unlockPdfBytes, isQpdfAvailable, QPDF_MAX_INPUT_BYTES };
