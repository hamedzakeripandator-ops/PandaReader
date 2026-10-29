// مرحله ۹ — رمزهایِ عبورِ PDF، فقط در حافظهٔ نشست.
//
// چرا ماژول جدا؟ رمز، هرگز نباید در Zustand یا localStorage بیفتد
// (استور، سریالایز/بازگردانی می‌شود و رمزِ کاربر نباید هیچ‌وقت روی
// دیسک بنشیند). این Map، با بسته شدنِ برنامه از بین می‌رود. کلید،
// مسیرِ نرمال‌شدهٔ فایل است؛ مقدار، رشتهٔ رمزِ واردشده در مودالِ
// PdfViewer است که ساختِ کپیِ بدونِ قفل و ذخیرهٔ حاشیه‌نویسی هم
// از همان رمز استفاده می‌کنند.
const sessionPasswords = new Map();

function normalizePdfPathKey(filePath) {
  return String(filePath || '')
    .trim()
    .replace(/[\\/]+/g, '\\')
    .toLowerCase();
}

export function getPdfSessionPassword(filePath) {
  if (!filePath) return '';
  return sessionPasswords.get(normalizePdfPathKey(filePath)) || '';
}

export function setPdfSessionPassword(filePath, password) {
  if (!filePath) return;
  const key = normalizePdfPathKey(filePath);
  if (typeof password === 'string' && password.length > 0) {
    sessionPasswords.set(key, password);
  } else {
    sessionPasswords.delete(key);
  }
}

export function clearPdfSessionPassword(filePath) {
  if (!filePath) return;
  sessionPasswords.delete(normalizePdfPathKey(filePath));
}

export function hasPdfSessionPassword(filePath) {
  if (!filePath) return false;
  return sessionPasswords.has(normalizePdfPathKey(filePath));
}
