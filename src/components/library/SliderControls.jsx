// ============================================================================
// src/components/library/SliderControls.jsx — مرحلهٔ ۵۱ §۱
//
// کنترلِ «موجِ صوتی»ِ اسلایدرِ هیرویِ کتابخانه: ردیفِ [قبلی] [نوارِ
// canvas] [بعدی] با ۵ تمپلیتِ قابلِ انتخاب (led / mirror / matrix /
// pendulum / firefly) و یک موتورِ فیزیکیِ مشترک.
//
// مرحلهٔ ۵۱ §۱ — بازگشتِ موتورِ کلاسیکِ مرحلهٔ ۳۷ رویِ هندسهٔ
// تطبیقیِ مرحلهٔ ۵۰: موتورِ مرحلهٔ ۵۰ کامل حذف شد و موتورِ کلاسیک
// با منحنیِ زنگوله‌ای، نفس کشیدن، موجِ ورودِ ماوس و پاپِ پلکانیِ
// تغییرِ اسلاید برگشت؛ هندسهٔ تطبیقیِ G/PITCH بر اساسِ تعدادِ
// اسلایدها حفظ شد.
// مرحلهٔ ۵۲ §۴ — پوشِ زنگوله‌ایِ دو-گوسیِ پهن‌دامنه جایِ گوسیِ باریکِ
// مرحلهٔ ۵۱ را گرفت تا انتهایِ دور هرگز صفرِ تخت نشود؛ هندسهٔ تطبیقی
// به ۵ باندِ پیوسته (computeAdaptiveSliderGeometry) ارتقا یافت.
// هندسهٔ تطبیقیِ ۵ باندیِ مرحلهٔ ۵۲ §۴ (computeAdaptiveSliderGeometry):
// N ≤ 6 → G = 7 و PITCH = 8.5؛ 7 تا 10 → G = 6 و PITCH = 7.5؛
// 11 تا 16 → G = 4 و PITCH = 6.5؛ 17 تا 25 → G = 3 و PITCH = 5.5؛
// N > 25 → G = 2 و PITCH = max(3.5, min(5, 520 / (N * 2)))؛
// عرضِ بوم W = PAD*2 + N*G*PITCH + (N-1)*GAP، HC = 64، MID = 32،
// MIN = 6، MAX = 44. مرکزِ دیداریِ هر ۵ تمپلیت دقیقاً رویِ MID = 32
// است و با مرکزِ دکمه‌هایِ ۳۶ پیکسلیِ قبلی/بعدی هم‌تراز است.
// «میلهٔ پیک» در همهٔ تمپلیت‌ها، میلهٔ مرکزیِ گروهِ فعال است.
// مرحلهٔ ۵۳ مأموریتِ ۲ — نگاشتِ راست‌به‌چپِ گروه‌هایِ دیداری:
// گروهِ دیداریِ اسلاید = (N - 1) - اندیسِ اسلاید؛ اسلایدِ ۱ (اندیسِ ۰)
// راست‌ترین گروه است و اسلایدِ ۲ دومین گروه از راست. همهٔ جاهایی که
// گروهِ فعال، میلهٔ پیک، مرکزِ زنگوله، پاپِ اسلاید، هاور یا کلیک به
// گروه وصل می‌شوند از همین نگاشت استفاده می‌کنند؛ مختصاتِ فیزیکیِ
// ماوس و بوم (چپ‌به‌راست) وارونه نمی‌شوند و فقط تبدیلِ گروه‌به‌اسلاید
// وارونه است. موتورِ مرحلهٔ ۵۲ §۴ (پوشِ دو-گوسی، هندسهٔ تطبیقیِ
// ۵ باندی، تغییرِ اندازهٔ مشروطِ بوم) بدونِ تغییر ماند.
// ============================================================================

import React, { useState, useEffect, useRef } from 'react';
import './SliderControls.css';

// مرحلهٔ ۵۲ §۴ — این شیءِ ثابت فقط پیش‌فرضِ باندِ اول (N ≤ 6) است؛
// هندسهٔ واقعیِ هر تعداد اسلاید از computeAdaptiveSliderGeometry می‌آید.
export const SLIDER_GEOMETRY = {
  barsPerSlide: 7,
  pitch: 8.5,
  gap: 10,
  pad: 10,
  canvasHeight: 64,
  mid: 32,
  min: 6,
  max: 44,
};

// مرحلهٔ ۵۲ §۴ — هندسهٔ تطبیقیِ پیوستهٔ نوارِ موج در ۵ باند بر اساسِ
// تعدادِ اسلایدها (جایگزینِ باندهایِ ۳ باندیِ مرحلهٔ ۵۱): هر باند
// G و PITCH و GAP و PAD و اندازهٔ نقطه/میله/خانه را متناسب تنظیم
// می‌کند تا عرضِ کلِ نوارِ موج (W) همیشه متناسب در کارتِ اسلاید جا
// شود (فراتر از ۳۵ اسلاید، بوم با maxWidth:100٪ کوچک می‌شود و
// نگاشتِ کلیک با scaleX درست می‌ماند).
// باندها: N ≤ 6 → G = 7، PITCH = 8.5، GAP = 10؛ 7 تا 10 → G = 6،
// PITCH = 7.5، GAP = 8؛ 11 تا 16 → G = 4، PITCH = 6.5، GAP = 7؛
// 17 تا 25 → G = 3، PITCH = 5.5، GAP = 5؛ N > 25 → G = 2،
// PITCH = max(3.5, min(5, 520 / (N * 2)))، GAP = 4.
// اندازه‌هایِ نمایشیِ هر باند (dotR شعاعِ نقطهٔ led/firefly، barW
// پهنایِ میلهٔ mirror، cellS ضلعِ خانهٔ matrix): باندِ ۱ همان
// مقدارهایِ مرحلهٔ ۵۱ است (1.7 / 3 / 4) و در باندهایِ بعدی متناسب
// با کوچک‌شدنِ PITCH کم می‌شود تا نقطه‌ها و میله‌ها رویِ هم نیفتند.
export function computeAdaptiveSliderGeometry(total) {
  const n = Math.max(1, Number(total) || 1);
  if (n <= 6) return { g: 7, pitch: 8.5, gap: 10, pad: 10, dotR: 1.7, barW: 3, cellS: 4 };
  if (n <= 10) return { g: 6, pitch: 7.5, gap: 8, pad: 10, dotR: 1.6, barW: 2.8, cellS: 3.8 };
  if (n <= 16) return { g: 4, pitch: 6.5, gap: 7, pad: 10, dotR: 1.5, barW: 2.6, cellS: 3.5 };
  if (n <= 25) return { g: 3, pitch: 5.5, gap: 5, pad: 8, dotR: 1.4, barW: 2.4, cellS: 3.2 };
  const pitch = Math.max(3.5, Math.min(5, 520 / (n * 2)));
  return { g: 2, pitch, gap: 4, pad: 8, dotR: 1.2, barW: 2, cellS: 3 };
}

// مرحلهٔ ۵۲ §۴ — نامِ قدیمیِ هندسهٔ تطبیقی؛ برایِ سازگاری نگه‌داشته شده
// و به تابعِ تازهٔ computeAdaptiveSliderGeometry وصل است.
export function sliderGeometryFor(total) {
  return computeAdaptiveSliderGeometry(total);
}

const HC = 64;
const MID = 32;
const MIN = 6;
const MAX = 44;

// مرحلهٔ ۵۱ §۱ — خطِ آویزِ پاندول رویِ y = 14 تا وزنه‌ها دورِ
// y = 32 تا 48 بچرخند و مرکزِ دیداری رویِ MID بماند.
const PENDULUM_HANGER_Y = 14;
// مرحلهٔ ۵۱ §۱ — نگاشتِ ارتفاعِ میله (MIN تا MAX) به جایِ وزنهٔ
// پاندول: 32 تا 48 پیکسل، یعنی (MAX - MIN) * 0.42 = 16 پیکسل.
const PENDULUM_SPAN = 0.42;

const COLOR_ACTIVE = '#22d3ee';
const COLOR_PEAK = '#ec4899';
const COLOR_INACTIVE = 'rgba(255,255,255,0.28)';
const COLOR_HOVER_GROUP = 'rgba(255, 255, 255, 0.65)';
const COLOR_HOVER_BAR = 'rgba(255, 255, 255, 0.98)';

// مرحلهٔ ۵۱ §۱ — ضریبِ لغزشِ مرکزِ زنگوله به سمتِ هدف: 0.14 طبقِ
// پرامپتِ مرحلهٔ ۵۱؛ نسخهٔ کلاسیک 0.12 بود.
const BELL_DRIFT = 0.14;
// مرحلهٔ ۵۱ §۱ — پاپِ تغییرِ اسلاید: هر میله با تأخیرِ
// (j % G) * 0.035 ثانیه می‌پرد (پلکانی درونِ گروه).
const POP_STAGGER_SEC = 0.035;
const POP_DECAY_MS = 250;
const POP_GAIN = 0.35;
// مرحلهٔ ۵۱ §۱ — تقویتِ هاور: میلهٔ زیرِ ماوس و هم‌گروهِ آن ۱.۲۵ برابر.
const HOVER_BOOST = 1.25;

export function sliderStripWidth(totalSlides) {
  const n = Math.max(1, Number(totalSlides) || 1);
  const geo = sliderGeometryFor(n);
  return geo.pad * 2 + n * geo.g * geo.pitch + (n - 1) * geo.gap;
}

// مرحلهٔ ۵۲ §۴ — کفِ تعدادِ نقطه‌ها ۳ است تا میله‌هایِ دورِ کم‌ارتفاع
// هم (با پوشِ ≈0.25) دستِ‌کم ۳ نقطه نشان دهند و هرگز تک‌نقطه‌ای نشوند؛
// فرمولِ گرد کردنِ مرحلهٔ ۵۱ (Math.round((v - MIN) / (MAX - MIN) * 9 + 1))
// بررسی و درست تأیید شد و بدونِ تغییر ماند.
export function ledDotCount(v) {
  return Math.max(3, Math.min(11, Math.round(((v - MIN) / (MAX - MIN)) * 9 + 1)));
}

// مرحلهٔ ۵۲ §۴ — کفِ تعدادِ خانه‌ها ۲ است تا ستونِ ماتریس در انتهایِ دور
// هم دستِ‌کم ۲ خانه نشان دهد.
export function matrixCellCount(v) {
  return Math.max(2, Math.min(7, Math.round(v / 8)));
}

function clamp01(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// مرحلهٔ ۵۱ §۱ — buildBarParams: پارامترهایِ موتورِ کلاسیک برایِ
// هر میله، با بازه‌هایِ پرامپتِ مرحلهٔ ۵۱: base در 0.55 تا 1.0،
// spd در 0.07 تا 0.19، ph در 0 تا 2π، fr در 1.0 تا 2.6،
// jit در 0.85 تا 1.15. seed فقط با تغییرِ اسلاید عوض می‌شود،
// نه در هاور؛ پس هاور هیچ‌وقت پارامترها را بازسازی نمی‌کند.
export function buildBarParams(total, activeIndex) {
  const seed = (Number(activeIndex) || 0) + 1;
  const geo = sliderGeometryFor(total);
  const bars = total * geo.g;
  const params = [];
  for (let j = 0; j < bars; j++) {
    const rnd = mulberry32(seed * 1000003 + j * 9176 + 13);
    const base = 0.55 + rnd() * 0.45;
    const spd = 0.07 + rnd() * 0.12;
    const ph = rnd() * Math.PI * 2;
    const fr = 1.0 + rnd() * 1.6;
    const jit = 0.85 + rnd() * 0.30;
    params.push({ base, spd, ph, fr, jit });
  }
  return params;
}

// مرحلهٔ ۵۲ §۴ — پوشِ زنگوله‌ایِ دو-گوسیِ پهن‌دامنه (تابعِ خالص؛
// تست‌ها از همین‌جا می‌خوانند): هستهٔ باریک (coreBell) قلهٔ مرکز را
// تیز نگه می‌دارد، بالِ پهن (wideWing) دنباله را تا انتهایِ نوار
// زنده نگه می‌دارد و کفِ محیطی (ambientFloor) هرگز اجازهٔ صفرِ تخت
// نمی‌دهد؛ maxSpan طوری انتخاب می‌شود که پوش رویِ کلِ نوار پخش شود.
// مرکز دقیقاً ۱٫۰ است و مقدار با فاصله از مرکز یکنواخت کم می‌شود.
export function bellEnvelope(j, refCenter, g, bars, ts) {
  const G = Math.max(1, Number(g) || 1);
  const B = Math.max(1, Number(bars) || 1);
  const maxSpan = Math.max(G * 2, B * 0.72);
  const normDist = Math.abs(j - refCenter) / maxSpan;
  const coreBell = Math.exp(-Math.pow(normDist * 2.1, 2));
  const wideWing = Math.exp(-Math.pow(normDist * 1.05, 1.6));
  const ambientFloor = 0.18 + 0.06 * Math.sin(ts * 1.3 + j * 0.7);
  return Math.min(1, ambientFloor + (1 - ambientFloor) * (0.58 * coreBell + 0.42 * wideWing));
}

// مرحلهٔ ۵۲ §۴ — ارتفاعِ هدفِ کلاسیکِ یک میله (تابعِ خالص؛
// حلقهٔ فریم و تست‌ها از همین‌جا می‌خوانند): پوشِ دو-گوسیِ پهن‌دامنهٔ
// bellEnvelope دورِ refCenter جایِ گوسیِ باریکِ مرحلهٔ ۵۱ را گرفت،
// نفس کشیدن با دامنهٔ ۰.۰۵، دامنهٔ پایهٔ base، پاپِ گروهِ فعال و
// تقویتِ ۱.۲۵ گروهِ زیرِ ماوس.
// تغییرِ امضا نسبت به مرحلهٔ ۵۱: پارامترِ bellSigma حذف شد و جایش
// g (میله در هر گروه) و bars (تعدادِ کلِ میله‌ها) آمد؛ تنها فراخوان
// همین فایل است (حلقهٔ رندر) و فراخوانِ دیگری در مرحله‌هایِ ۵۰ و ۵۱ نیست.
export function classicBarHeight(p, j, ts, refCenter, g, bars, isActiveGroup, isHoverGroup, pop = 1) {
  const env = bellEnvelope(j, refCenter, g, bars, ts);
  const breath = 1 + 0.05 * Math.sin(ts * p.fr * 2.2 + p.ph);
  let h = MIN + (MAX - MIN) * env * breath * p.base;
  if (isActiveGroup) h *= pop;
  if (isHoverGroup) h *= HOVER_BOOST;
  return clamp01(h, MIN, MAX);
}

// مرحلهٔ ۵۱ §۱ — پاپِ پلکانیِ یک میله: تأخیرِ پلکانی و واپاشیِ
// نماییِ ۲۵۰ میلی‌ثانیه‌ای با بهرهٔ ۰.۳۵.
// مرحلهٔ ۵۳ مأموریتِ ۲ — پلکان راست‌به‌چپ است: (G - 1 - (j % G)) * 0.035
// ثانیه؛ پس راست‌ترین میلهٔ گروهِ فعال اول می‌پرد و موج به سمتِ چپ می‌رود.
export function slidePopFor(j, g, popAgeMs) {
  const staggerMs = (g - 1 - (j % g)) * POP_STAGGER_SEC * 1000;
  const effAge = Math.max(0, popAgeMs - staggerMs);
  return 1 + POP_GAIN * Math.exp(-effAge / POP_DECAY_MS);
}

// مرحلهٔ ۵۳ مأموریتِ ۲ — نگاشتِ راست‌به‌چپِ گروه‌به‌اسلاید (تابع‌هایِ
// خالص؛ تست‌ها از همین‌جا می‌خوانند): گروهِ دیداریِ فیزیکی (۰ = چپ‌ترین
// گروهِ بوم) به اندیسِ اسلاید و برعکس؛ هر دو تبدیل، وارونِ یکدیگرند و
// فرمولِ هر دو (N - 1) - x است.
export function visualGroupForSlide(slideIndex, total) {
  const n = Math.max(1, Number(total) || 1);
  const sIdx = clamp01(Math.floor(Number(slideIndex) || 0), 0, n - 1);
  return (n - 1) - sIdx;
}

export function slideIndexForVisualGroup(visualGroup, total) {
  const n = Math.max(1, Number(total) || 1);
  const vg = clamp01(Math.floor(Number(visualGroup) || 0), 0, n - 1);
  return (n - 1) - vg;
}

function barX(j, geo) {
  const g = Math.floor(j / geo.g);
  return geo.pad + j * geo.pitch + g * geo.gap;
}

// نگاشتِ مختصاتِ x روی بوم به {group, bar} (یا null در فاصله‌ها).
function barAtX(x, total, geo) {
  const rel = x - geo.pad;
  if (rel < 0) return null;
  const groupSpan = geo.g * geo.pitch + geo.gap;
  const g = Math.floor(rel / groupSpan);
  if (g < 0 || g >= total) return null;
  const within = rel - g * groupSpan;
  if (within >= geo.g * geo.pitch) return null;
  const b = Math.floor(within / geo.pitch);
  if (b < 0 || b >= geo.g) return null;
  return { group: g, bar: g * geo.g + b };
}

// مرحلهٔ ۵۳ مأموریتِ ۲ — پارامترِ active این تابع، گروهِ دیداریِ فعال
// (فیزیکی، چپ‌به‌راست) است، نه اندیسِ اسلاید؛ فراخوان‌ها activeVisualGroup می‌دهند.
function groupColor(j, activeVisualGroup, hoverGroup, hoverBar, geo) {
  if (hoverBar === j) return COLOR_HOVER_BAR;
  const g = Math.floor(j / geo.g);
  if (g === activeVisualGroup) return COLOR_ACTIVE;
  if (hoverGroup === g) return COLOR_HOVER_GROUP;
  return COLOR_INACTIVE;
}

function rr(ctx, x, y, w, h, r) {
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
  } else {
    ctx.beginPath();
    ctx.rect(x, y, w, h);
  }
}

// مرحلهٔ ۵۱ §۱ — رسمِ ۵ تمپلیت رویِ بوم؛ مرکزِ دیداریِ هر ۵ تمپلیت
// دقیقاً رویِ MID = 32 است (هم‌تراز با مرکزِ دکمه‌هایِ قبلی/بعدی).
// برایِ تستِ مرکزِ دیداری با بومِ ساختگی صادر شده است.
// مرحلهٔ ۵۲ §۴ — اندازهٔ نقطه/میله/خانه از geo می‌آید (dotR/barW/cellS)
// و با باندِ هندسه متناسب کوچک می‌شود؛ اگر geo قدیمی فاقدِ این
// میدان‌ها باشد، مقدارهایِ مرحلهٔ ۵۱ به‌عنوانِ پیش‌فرض به کار می‌روند.
export function drawVariant(ctx, variant, v, params, active, hoverGroup, hoverBar, t, geo) {
  // مرحلهٔ ۵۳ مأموریتِ ۲ — نگاشتِ راست‌به‌چپ: active اندیسِ اسلاید است
  // (۰ = اسلایدِ اول) و گروهِ دیداریِ آن در بومِ فیزیکی (چپ‌به‌راست)
  // وارونه است: activeVisualGroup = (N - 1) - active؛ اسلایدِ ۱
  // راست‌ترین گروه است. N از تعدادِ میله‌ها (v.length) و G به دست می‌آید.
  // hoverGroup و hoverBar فیزیکی‌اند و وارونه نمی‌شوند. این نگاشت در هر
  // ۵ تمپلیت (led / mirror / matrix / pendulum / firefly) اعمال می‌شود.
  const totalGroups = Math.max(1, Math.round(v.length / Math.max(1, geo.g)));
  const safeActiveSlide = clamp01(Math.floor(Number(active) || 0), 0, totalGroups - 1);
  const activeVisualGroup = (totalGroups - 1) - safeActiveSlide;
  const peakBar = activeVisualGroup * geo.g + Math.floor((geo.g - 1) / 2);
  const dotR = geo.dotR || 1.7;
  const barW = geo.barW || 3;
  const cellS = geo.cellS || 4;
  const bars = v.length;
  // مرحلهٔ ۳۷ §۱: هالهٔ ظریفِ سایان پشتِ میلهٔ زیرِ ماوس (همهٔ تمپلیت‌ها).
  if (hoverBar !== null && hoverBar !== undefined && hoverBar >= 0 && hoverBar < v.length) {
    const hx = barX(hoverBar, geo);
    const hh = v[hoverBar];
    ctx.save();
    ctx.shadowColor = 'rgba(34, 211, 238, 0.55)';
    ctx.shadowBlur = 10;
    ctx.fillStyle = 'rgba(34, 211, 238, 0.10)';
    rr(ctx, hx - 3, MID - hh / 2 - 4, 7, hh + 8, 3.5);
    ctx.fill();
    ctx.restore();
  }
  if (variant === 'led') {
    for (let j = 0; j < bars; j++) {
      const x = barX(j, geo);
      const n = ledDotCount(v[j]);
      for (let r = 0; r < n; r++) {
        const isPeakTop = j === peakBar && r === n - 1;
        ctx.beginPath();
        // مرحلهٔ ۵۱ §۱ — ستونِ نقطه‌ها دقیقاً رویِ MID وسط‌چین است:
        // نقطهٔ میانی رویِ y = 32 می‌نشیند، نه رویِ کفِ بوم.
        ctx.arc(x, MID + ((n - 1) / 2 - r) * 5, dotR, 0, Math.PI * 2);
        ctx.fillStyle = isPeakTop ? COLOR_PEAK : groupColor(j, activeVisualGroup, hoverGroup, hoverBar, geo);
        ctx.fill();
      }
    }
    return;
  }
  if (variant === 'matrix') {
    for (let j = 0; j < bars; j++) {
      const x = barX(j, geo);
      const n = matrixCellCount(v[j]);
      const g = Math.floor(j / geo.g);
      const p = params[j] || {};
      for (let r = 0; r < n; r++) {
        let fill;
        if (j === peakBar && r === n - 1) {
          fill = COLOR_PEAK;
        } else if (hoverBar === j) {
          fill = COLOR_HOVER_BAR;
        } else if (g === activeVisualGroup) {
          const flicker = r === n - 1 ? 1 : 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(t * 0.002 * (p.fr || 1) + (p.ph || 0) + r));
          fill = `rgba(34, 211, 238, ${flicker.toFixed(3)})`;
        } else if (hoverGroup === g) {
          fill = COLOR_HOVER_GROUP;
        } else {
          fill = COLOR_INACTIVE;
        }
        // مرحلهٔ ۵۱ §۱ — ستونِ خانه‌ها دقیقاً رویِ MID وسط‌چین است:
        // خانهٔ میانی رویِ y = 32 می‌نشیند، نه رویِ کفِ بوم.
        rr(ctx, x - cellS / 2, MID - cellS / 2 + ((n - 1) / 2 - r) * (cellS * 2), cellS, cellS, cellS * 0.3);
        ctx.fillStyle = fill;
        ctx.fill();
      }
    }
    return;
  }
  if (variant === 'pendulum') {
    ctx.beginPath();
    ctx.moveTo(geo.pad, PENDULUM_HANGER_Y);
    ctx.lineTo(geo.pad + bars * geo.pitch + Math.floor((bars - 1) / geo.g) * geo.gap, PENDULUM_HANGER_Y);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.stroke();
    for (let j = 0; j < bars; j++) {
      const x = barX(j, geo);
      const p = params[j] || {};
      // مرحلهٔ ۵۱ §۱ — jit در 0.85 تا 1.15 به دامنهٔ کلاسیکِ
      // تابِ 1.5 تا 4.5 پیکسل نگاشت می‌شود تا تاب با بازهٔ تازه
      // یک‌شکل و بیش‌ازحد بزرگ نشود.
      const jitNorm = clamp01(((p.jit || 1) - 0.85) / 0.30, 0, 1);
      const sway = Math.sin(t * 0.0022 + (p.ph || 0)) * (1.5 + jitNorm * 3);
      const bx = x + sway;
      // مرحلهٔ ۵۱ §۱ — وزنه دورِ y = 32 تا 48 می‌چرخد: رشته از
      // خطِ آویزِ y = 14 تا وزنه کشیده می‌شود و مرکزِ دیداریِ
      // رشته و وزنه رویِ MID می‌ماند.
      const by = MID + (v[j] - MIN) * PENDULUM_SPAN;
      ctx.beginPath();
      ctx.moveTo(x, PENDULUM_HANGER_Y);
      ctx.lineTo(bx, by);
      ctx.strokeStyle = groupColor(j, activeVisualGroup, hoverGroup, hoverBar, geo);
      ctx.lineWidth = 1.3;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(bx, by, (j === peakBar ? 3.6 : 2.6) * (dotR / 1.7), 0, Math.PI * 2);
      ctx.fillStyle = j === peakBar ? COLOR_PEAK : groupColor(j, activeVisualGroup, hoverGroup, hoverBar, geo);
      ctx.fill();
    }
    return;
  }
  if (variant === 'firefly') {
    for (let j = 0; j < bars; j++) {
      const x = barX(j, geo);
      const p = params[j] || {};
      for (let k = 1; k <= 3; k++) {
        const px = x + Math.sin(t * 0.0011 * (p.fr || 1) + (p.ph || 0) + k * 1.7) * (1.5 + k);
        // مرحلهٔ ۵۱ §۱ — سه نقطه دورِ MID متقارن‌اند: k = 1 پایینِ
        // MID، k = 2 رویِ MID، k = 3 بالایِ MID؛ پس مرکزِ دیداری
        // دقیقاً y = 32 است، نه کفِ بوم. هر سه نقطه هم‌اندازه‌اند
        // (شعاعِ 1.9) تا نقطهٔ بالایی با جرمِ بیشتر، مرکز را بالا
        // نکشد؛ فقط نقطهٔ پیکِ صورتی بزرگ‌تر است (شعاعِ 3).
        const py = MID + (2 - k) * (v[j] / 3) + Math.cos(t * 0.0013 * ((p.spd || 0.05) * 8 + 1) + k * 2.1) * 2;
        const isPeakTop = j === peakBar && k === 3;
        ctx.beginPath();
        ctx.arc(px, py, (isPeakTop ? 3 : 1.9) * (dotR / 1.7), 0, Math.PI * 2);
        ctx.fillStyle = isPeakTop ? COLOR_PEAK : groupColor(j, activeVisualGroup, hoverGroup, hoverBar, geo);
        ctx.globalAlpha = k < 3 && !isPeakTop ? 0.75 : 1;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
    return;
  }
  // پیش‌فرض: mirror — میلهٔ گردِ وسط‌چین روی MID با دایرهٔ صورتیِ پیک.
  // مرحلهٔ ۵۱ §۱ — میله‌ها از پیش رویِ MID وسط‌چین بودند و همان‌طور ماندند.
  for (let j = 0; j < bars; j++) {
    const x = barX(j, geo);
    rr(ctx, x - barW / 2, MID - v[j] / 2, barW, v[j], barW / 2);
    ctx.fillStyle = groupColor(j, activeVisualGroup, hoverGroup, hoverBar, geo);
    ctx.fill();
  }
  const peakX = barX(peakBar, geo);
  ctx.beginPath();
  ctx.arc(peakX, MID - v[peakBar] / 2 - 6, 2.6, 0, Math.PI * 2);
  ctx.fillStyle = COLOR_PEAK;
  ctx.fill();
}

export default function SliderControls({ currentIndex, total, count, onPrev, onNext, onSelect, variant = 'mirror' }) {
  const canvasRef = useRef(null);
  const hoverRef = useRef({ group: null, bar: null });
  const paramsRef = useRef(null);
  const vRef = useRef([]);
  const popRef = useRef(0);
  const variantRef = useRef(variant);
  variantRef.current = variant;
  // مرحلهٔ ۵۱ §۱ — بازگشتِ bellRef و entryRefِ کلاسیکِ مرحلهٔ ۳۷:
  // مرکزِ منحنیِ زنگوله‌ای (به‌نرمی به سمتِ میلهٔ زیرِ ماوس
  // می‌لغزد)، موجِ سینوسیِ ورود (سمتِ ورود + زمانِ ورود)، و
  // دکمهٔ قبلی/بعدیِ زیرِ ماوس.
  const bellRef = useRef(null);
  const entryRef = useRef({ side: null, t0: 0 });
  // مرحلهٔ ۵۳ مأموریتِ ۲ — نگه‌داشتنِ تعدادِ قبلیِ اسلایدها تا با تغییرِ
  // N، مرکزِ زنگوله بی‌درنگ رویِ گروهِ دیداریِ فعال بنشیند (نه با لغزش).
  const prevTotalRef = useRef(null);
  const [hoveredBtn, setHoveredBtn] = useState(null);

  const safeTotal = Math.max(1, Number(total ?? count) || 1);
  const safeIndex = clamp01(Math.floor(Number(currentIndex) || 0), 0, safeTotal - 1);
  // مرحلهٔ ۵۲ §۴: هندسهٔ تطبیقیِ ۵ باندی از تعدادِ واقعیِ اسلایدها.
  const geo = sliderGeometryFor(safeTotal);
  const G = geo.g;
  const W = sliderStripWidth(safeTotal);
  // مرحلهٔ ۵۳ مأموریتِ ۲ — گروهِ دیداریِ اسلایدِ فعال در چیدمانِ
  // راست‌به‌چپ: activeVisualGroup = (N - 1) - activeSlide؛ اسلایدِ ۱
  // (اندیسِ ۰) راست‌ترین گروه است.
  const activeVisualGroup = (safeTotal - 1) - safeIndex;

  // اندازهٔ بوم با dpr (حداکثر ۲).
  // مرحلهٔ ۵۲ §۴ — بررسیِ مغایرتِ ۱: اندازهٔ بوم فقط همین‌جا و فقط
  // وقتی W عوض می‌شود تنظیم می‌شود (وابستگیِ [W])؛ در هر فریم فقط
  // ctx.clearRect(0, 0, W, HC) صدا می‌شود و canvas.width هرگز در
  // حلقهٔ رندر دست نمی‌خورد — پس چیزی برایِ «رفع» نبود و همین‌طور ماند.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(HC * dpr);
  }, [W]);

  // پارامترهایِ موتور فقط با تغییرِ اسلاید عوض می‌شوند (نه در هاور)؛
  // ارتفاع‌ها پیوستگی‌شان را حفظ می‌کنند (فقط ورودی‌هایِ تازه با MIN).
  // مرحلهٔ ۵۱ §۱ — پیشگیری: با تغییرِ تعداد، آرایه‌هایِ vRef و
  // paramsRef به طولِ تازهٔ B = count * G ساخته می‌شوند و bellRef
  // در [0, B-1] بسته می‌شود تا NaN هرگز واردِ ارتفاعِ میله‌ها نشود.
  // مرحلهٔ ۵۲ §۴ — بررسیِ مغایرتِ ۲: نمونه‌برداریِ بدونِ پرشِ مرحلهٔ ۵۱
  // (حملِ مقدارهایِ قبلی، مقدارِ غیرمتناهی → MIN، بستنِ bellRef در
  // [0, B-1]) بررسی و درست تأیید شد و بدونِ تغییر ماند.
  useEffect(() => {
    paramsRef.current = buildBarParams(safeTotal, safeIndex);
    const prev = vRef.current || [];
    const next = new Array(safeTotal * G);
    for (let j = 0; j < next.length; j++) {
      next[j] = j < prev.length && Number.isFinite(prev[j]) ? prev[j] : MIN;
    }
    vRef.current = next;
    if (bellRef.current !== null && bellRef.current !== undefined && Number.isFinite(bellRef.current)) {
      bellRef.current = clamp01(bellRef.current, 0, next.length - 1);
    }
    // مرحلهٔ ۵۳ مأموریتِ ۲ (BUG 4) — با تغییرِ تعدادِ اسلایدها (یا در
    // اولین اجرا)، مرکزِ زنگوله بی‌درنگ رویِ مرکزِ گروهِ دیداریِ فعال
    // می‌نشیند: activeVisualGroup * G + (G - 1) / 2؛ با تغییرِ صرفِ
    // اسلاید، لغزشِ نرمِ BELL_DRIFT حفظ می‌شود و اینجا دست نمی‌خورد.
    if (prevTotalRef.current !== safeTotal) {
      prevTotalRef.current = safeTotal;
      bellRef.current = activeVisualGroup * G + (G - 1) / 2;
    }
    popRef.current = performance.now();
  }, [safeTotal, safeIndex]);

  // حلقهٔ رندر — مرحلهٔ ۵۱ §۱: موتورِ کلاسیکِ زنگوله‌ای با
  // نفس کشیدن، موجِ ورود و پاپِ پلکانی. همیشه فعال است (حتی اگر
  // ویندوز رویِ کاهشِ انیمیشن باشد؛ انتخابِ صریحِ تسکِ مرحلهٔ ۳۷)؛
  // فقط وقتی تب پنهان است (document.hidden) فریم کشیده نمی‌شود.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    let raf = 0;
    const draw = (t) => {
      const params = paramsRef.current;
      const v = vRef.current;
      if (!params || !v || v.length !== params.length) return;
      if (document.hidden) {
        raf = requestAnimationFrame(draw);
        return;
      }
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, HC);
      const active = safeIndex;
      const hover = hoverRef.current;
      // مرحلهٔ ۵۳ مأموریتِ ۲ — مرکزِ قلهٔ زنگوله رویِ گروهِ دیداریِ
      // فعال است (راست‌به‌چپ): activeCenterBar = activeVisualGroup * G
      // + (G - 1) / 2؛ با هاور، مرکز به سمتِ میلهٔ فیزیکیِ زیرِ ماوس
      // می‌لغزد (مختصاتِ ماوس وارونه نمی‌شود).
      const activeCenterBar = activeVisualGroup * G + (G - 1) / 2;
      // مرکزِ منحنیِ زنگوله‌ای به‌نرمی به سمتِ میلهٔ زیرِ ماوس می‌لغزد
      // و با رفتنِ ماوس، به مرکزِ گروهِ فعال برمی‌گردد.
      if (bellRef.current === null || bellRef.current === undefined || !Number.isFinite(bellRef.current)) {
        bellRef.current = activeCenterBar;
      }
      const hoverTarget = (hover.bar !== null && hover.bar !== undefined) ? hover.bar : activeCenterBar;
      bellRef.current += (hoverTarget - bellRef.current) * BELL_DRIFT;
      bellRef.current = clamp01(bellRef.current, 0, params.length - 1);
      const refCenter = bellRef.current;
      const popAge = Math.max(0, t - popRef.current);
      // t به ثانیه برگردانده می‌شود تا فرمولِ نفس کشیدن با بسامدِ
      // داده‌شده بچرخد (tِ خامِ میلی‌ثانیه‌ای، موج را به فلیکر
      // تبدیل می‌کرد).
      const ts = t * 0.001;
      for (let j = 0; j < params.length; j++) {
        const p = params[j];
        // مرحلهٔ ۵۳ مأموریتِ ۲ — نگاشتِ راست‌به‌چپِ هر میله: گروهِ
        // دیداریِ فیزیکیِ میله و اندیسِ اسلایدِ آن؛ گروهِ فعال وقتی
        // است که اندیسِ اسلایدش با اسلایدِ فعال برابر باشد. هاور
        // فیزیکی است (hover.group گروهِ چپ‌به‌راستِ زیرِ ماوس است).
        const barVisualGroup = Math.floor(j / G);
        const barSlideIndex = (safeTotal - 1) - barVisualGroup;
        const isActiveGroup = barSlideIndex === active;
        const pop = slidePopFor(j, G, popAge);
        let h = classicBarHeight(p, j, ts, refCenter, G, params.length, isActiveGroup, hover.group === barVisualGroup, pop);
        // موجِ سینوسیِ ورود: جبهه از سمتِ ورودِ ماوس در طولِ میله‌ها
        // حرکت می‌کند و در ۴۵۰ms محو می‌شود.
        const entry = entryRef.current;
        if (entry.side) {
          const progress = Math.min(1, Math.max(0, (t - entry.t0) / 450));
          if (progress >= 1) {
            entryRef.current = { side: null, t0: 0 };
          } else {
            const frontX = entry.side === 'left' ? progress * W : W - progress * W;
            h += 9 * Math.exp(-Math.pow((barX(j, geo) - frontX) / 26, 2)) * (1 - progress * 0.5);
          }
        }
        h = clamp01(h, MIN, MAX);
        v[j] += (h - v[j]) * (0.09 + p.spd);
      }
      drawVariant(ctx, variantRef.current, v, params, active, hover.group, hover.bar, t, geo);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [safeTotal, safeIndex, W]);

  const canvasX = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return -1;
    const rect = canvas.getBoundingClientRect();
    const scaleX = W / Math.max(1, rect.width);
    const mouseX = (e.clientX - rect.left) * scaleX;
    return mouseX;
  };

  const handleCanvasClick = (e) => {
    const hit = barAtX(canvasX(e), safeTotal, geo);
    if (hit && typeof onSelect === 'function') {
      // مرحلهٔ ۵۳ مأموریتِ ۲ (BUG 1) — hit.group گروهِ دیداریِ فیزیکی
      // (چپ‌به‌راست) است؛ اندیسِ اسلایدِ آن وارونه است:
      // targetSlideIdx = (N - 1) - clickedVisualGroup.
      const clickedVisualGroup = hit.group;
      const targetSlideIdx = (safeTotal - 1) - clickedVisualGroup;
      onSelect(targetSlideIdx);
    }
  };

  const handleCanvasPointerMove = (e) => {
    const hit = barAtX(canvasX(e), safeTotal, geo);
    hoverRef.current = hit ? hit : { group: null, bar: null };
  };

  const handleCanvasPointerEnter = (e) => {
    const x = canvasX(e);
    entryRef.current = { side: x < W / 2 ? 'left' : 'right', t0: performance.now() };
  };

  const handleCanvasMouseEnter = (e) => {
    handleCanvasPointerEnter(e);
  };

  const handleCanvasPointerLeave = () => {
    hoverRef.current = { group: null, bar: null };
    entryRef.current = { side: null, t0: 0 };
  };

  const handleCanvasMouseMove = (e) => {
    handleCanvasPointerMove(e);
  };

  const handleCanvasMouseLeave = () => {
    handleCanvasPointerLeave();
  };

  return (
    <div className="eq-controls" dir="ltr" style={{ direction: 'ltr', display: 'inline-flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: '14px', height: 64, maxWidth: '100%' }}>
      {/* مرحلهٔ ۵۳ مأموریتِ ۲ — چیدمانِ راست‌به‌چپ: اسلایدِ بعد به سمتِ چپ
          است، پس دکمهٔ سمتِ چپ «بعدی» و دکمهٔ سمتِ راست «قبلی» است؛
          شورون‌ها در جهتِ حرکت می‌مانند (چپ = بعد، راست = قبل). */}
      <button type="button" className="eq-nav" onClick={onNext} onMouseEnter={() => setHoveredBtn('next')} onMouseLeave={() => setHoveredBtn(null)} title="اسلاید بعدی" aria-label="اسلاید بعدی" dir="ltr" style={{ direction: 'ltr', width: 36, height: 36, borderRadius: '50%', background: hoveredBtn === 'next' ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.08)', border: hoveredBtn === 'next' ? '1px solid #22d3ee' : '1px solid rgba(255,255,255,0.15)', color: '#ffffff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, margin: 0, alignSelf: 'center', outline: 'none', flexShrink: 0, transform: hoveredBtn === 'next' ? 'scale(1.12) translateY(-1px)' : 'none', boxShadow: hoveredBtn === 'next' ? '0 0 14px rgba(34, 211, 238, 0.45)' : 'none', transition: 'all 0.22s cubic-bezier(0.16, 1, 0.3, 1)' }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: 'none', display: 'block' }}>
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>
      <div className="eq-canvas-wrap" style={{ display: 'flex', alignItems: 'center', flexShrink: 1, minWidth: 0 }}>
        <canvas
          ref={canvasRef}
          style={{ width: W, maxWidth: '100%', height: 'auto', display: 'block', cursor: 'pointer' }}
          onClick={handleCanvasClick}
          onMouseMove={handleCanvasMouseMove}
          onMouseLeave={handleCanvasMouseLeave}
          onMouseEnter={handleCanvasMouseEnter}
          onPointerMove={handleCanvasPointerMove}
          onPointerEnter={handleCanvasPointerEnter}
          onPointerLeave={handleCanvasPointerLeave}
        />
        {Array.from({ length: safeTotal }).map((_, i) => (
          <button
            key={i}
            type="button"
            className="visually-hidden"
            aria-label={`اسلاید ${i + 1}`}
            onClick={() => { if (typeof onSelect === 'function') onSelect(i); }}
          >
            اسلاید {i + 1}
          </button>
        ))}
      </div>
      <button type="button" className="eq-nav" onClick={onPrev} onMouseEnter={() => setHoveredBtn('prev')} onMouseLeave={() => setHoveredBtn(null)} title="اسلاید قبلی" aria-label="اسلاید قبلی" dir="ltr" style={{ direction: 'ltr', width: 36, height: 36, borderRadius: '50%', background: hoveredBtn === 'prev' ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.08)', border: hoveredBtn === 'prev' ? '1px solid #22d3ee' : '1px solid rgba(255,255,255,0.15)', color: '#ffffff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, margin: 0, alignSelf: 'center', outline: 'none', flexShrink: 0, transform: hoveredBtn === 'prev' ? 'scale(1.12) translateY(-1px)' : 'none', boxShadow: hoveredBtn === 'prev' ? '0 0 14px rgba(34, 211, 238, 0.45)' : 'none', transition: 'all 0.22s cubic-bezier(0.16, 1, 0.3, 1)' }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: 'none', display: 'block' }}>
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>
    </div>
  );
}
