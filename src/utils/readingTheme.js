// ============================================================================
// readingTheme.js — فیلترِ CSSِ تمِ مطالعه (فقط روی لایهٔ نمایشِ صفحه)
//
// مرحله ۶ ـ بخش الف: تم‌ها فقط روی عنصرِ تصویرِ صفحه (img/canvas)
// اعمال می‌شوند، نه روی هیچ ancestorای که لایهٔ حاشیه‌نویسی یا تولبار
// را در بر بگیرد؛ پس رنگِ ابزارها و مختصاتِ بومِ حاشیه‌نویسی، دست
// نخورده می‌مانند (فیلترِ CSS، چیدمان را هم عوض نمی‌کند). این تابع
// خالص است و در Node تست می‌شود.
// ============================================================================

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, Number(n) || 0));

/**
 * @param {'default'|'sepia'|'night'} theme
 * @param {number} brightness - 0.6 تا 1.1 (ضریبِ روشنایی)
 * @param {number} warmth - 0 تا 0.4 (گرمای اضافی، فقط در تم‌های رنگی)
 * @returns {string} مقدارِ CSS filter، یا 'none' وقتی هیچ اثری لازم نیست.
 */
export function getReadingThemeFilter(theme, brightness = 1, warmth = 0) {
  const b = clamp(brightness, 0.6, 1.1);
  const w = clamp(warmth, 0, 0.4);

  if (theme === 'sepia') {
    const sepiaAmount = Math.min(0.85, 0.45 + w).toFixed(2);
    return `sepia(${sepiaAmount}) brightness(${b.toFixed(2)}) contrast(0.97)`;
  }
  if (theme === 'night') {
    const dimmed = (b * 0.78).toFixed(2);
    const sepiaAmount = (0.18 + w * 0.5).toFixed(2);
    return `brightness(${dimmed}) contrast(0.92) sepia(${sepiaAmount})`;
  }
  // پیش‌فرض: فقط روشناییِ انتخابیِ کاربر، اگر از ۱ متفاوت است.
  if (Math.abs(b - 1) < 0.005) return 'none';
  return `brightness(${b.toFixed(2)})`;
}
