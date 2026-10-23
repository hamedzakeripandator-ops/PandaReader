// ============================================================================
// TurnRefinementEngine.js — موتور اختصاصی نرم‌سازی چرخش‌ها
// طراحی: سلیقه شخصی — «جراحی دقیق، نه بیهوشی عمومی»
//
// مشکل: در محل چرخش، خط چندضلعی به نظر می‌رسه (شکستگی)
// علت: نقطه‌ها در چرخش کم‌ان → کانتور با سگمنت‌های درشت ساخته می‌شه
//
// راه‌حل من:
//   ۱. چرخش‌ها رو با زاویه شناسایی کن (نه با فیلتر کور)
//   ۲. برای چرخش تند: دایره دقیق از ۳ نقطه عبور بده (ریاضی خالص)
//   ۳. برای چرخش ملایم: درون‌یابی با کشش قابل تنظیم
//   ۴. خط‌های راست رو دست نزن!
//
// این با Chaikin فرق داره: Chaikin همه‌جا رو گرد می‌کنه،
// این فقط جاهای شکسته رو ترمیم می‌کنه.
// ============================================================================

/**
 * محاسبه زاویه چرخش در یک نقطه (درجه)
 * ۰ = خط راست، ۱۸۰ = برگشت کامل
 */
export function turningAngle(p0, p1, p2) {
  const v1x = p1.x - p0.x;
  const v1y = p1.y - p0.y;
  const v2x = p2.x - p1.x;
  const v2y = p2.y - p1.y;

  const len1 = Math.sqrt(v1x * v1x + v1y * v1y);
  const len2 = Math.sqrt(v2x * v2x + v2y * v2y);
  if (len1 < 1e-10 || len2 < 1e-10) return 0;

  const dot = (v1x * v2x + v1y * v2y) / (len1 * len2);
  const clamped = Math.max(-1, Math.min(1, dot));
  return Math.acos(clamped) * (180 / Math.PI);
}

/**
 * طبقه‌بندی نقطه بر اساس زاویه چرخش
 */
export function classifyPoint(angleDeg) {
  if (angleDeg < 8) return 'straight';    // خط راست
  if (angleDeg < 25) return 'gentle';     // چرخش ملایم
  if (angleDeg < 70) return 'sharp';       // چرخش تند
  return 'hairpin';                        // سنجاق‌سری
}

/**
 * پیدا کردن مرکز دایره گذرنده از ۳ نقطه
 * برمی‌گرداند: { cx, cy, radius } یا null اگه نقاط هم‌خط باشن
 */
export function circleFrom3Points(p0, p1, p2) {
  const ax = p0.x, ay = p0.y;
  const bx = p1.x, by = p1.y;
  const cx = p2.x, cy = p2.y;

  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-10) return null; // هم‌خط

  const aSq = ax * ax + ay * ay;
  const bSq = bx * bx + by * by;
  const cSq = cx * cx + cy * cy;

  const ux = (aSq * (by - cy) + bSq * (cy - ay) + cSq * (ay - by)) / d;
  const uy = (aSq * (cx - bx) + bSq * (ax - cx) + cSq * (bx - ax)) / d;

  const radius = Math.sqrt((ax - ux) * (ax - ux) + (ay - uy) * (ay - uy));

  return { cx: ux, cy: uy, radius };
}

/**
 * زاویه قطبی یک نقطه نسبت به مرکز
 */
function polarAngle(px, py, cx, cy) {
  return Math.atan2(py - cy, px - cx);
}

/**
 * نمونه‌برداری از کمان دایره بین دو زاویه
 * direction: +1 پادساعتگرد، -1 ساعتگرد
 */
function sampleArc(cx, cy, radius, a0, a1, direction, numSamples) {
  const points = [];

  // نرمال‌سازی جهت
  let start = a0;
  let end = a1;

  if (direction > 0) {
    // پادساعتگرد: end باید بزرگ‌تر از start باشه
    while (end < start) end += Math.PI * 2;
  } else {
    // ساعتگرد: end باید کوچک‌تر از start باشه
    while (end > start) end -= Math.PI * 2;
  }

  for (let i = 0; i <= numSamples; i++) {
    const t = i / numSamples;
    const a = start + (end - start) * t;
    points.push({
      x: cx + radius * Math.cos(a),
      y: cy + radius * Math.sin(a),
    });
  }
  return points;
}

/**
 * تشخیص جهت چرخش (علامت ضرب خارجی)
 */
function turnDirection(p0, p1, p2) {
  const cross = (p1.x - p0.x) * (p2.y - p1.y) - (p1.y - p0.y) * (p2.x - p1.x);
  return cross >= 0 ? 1 : -1;
}

/**
 * ترمیم یک چرخش تند با کمان دایره
 * ورودی: ۳ نقطه (قبل، نقطه چرخش، بعد)
 * خروجی: آرایه نقاط نرم روی کمان
 */
export function refineSharpTurn(p0, p1, p2, numSamples = 8) {
  const circle = circleFrom3Points(p0, p1, p2);

  // اگه دایره معتبر نیست (هم‌خط یا شعاع خیلی بزرگ)، درون‌یابی ساده
  if (!circle || circle.radius > 10000 || circle.radius < 0.5) {
    return interpolateSimple(p0, p1, p2, numSamples);
  }

  const dir = turnDirection(p0, p1, p2);
  const a0 = polarAngle(p0.x, p0.y, circle.cx, circle.cy);
  const a2 = polarAngle(p2.x, p2.y, circle.cx, circle.cy);

  // نمونه‌برداری از کمان — ولی فقط بخش میانی (نزدیک p1)
  // ابتدا و انتها رو نگه می‌داریم تا به بقیه خط بچسبه
  const arcPoints = sampleArc(
    circle.cx, circle.cy, circle.radius,
    a0, a2, dir, numSamples
  );

  // ترکیب: p0 + نقاط میانی کمان + p2
  // (نقاط اول و آخر کمان تقریباً p0 و p2 هستن، پس فقط میانی‌ها رو برمی‌داریم)
  const result = [p0];
  for (let i = 1; i < arcPoints.length - 1; i++) {
    result.push({
      ...arcPoints[i],
      pressure: p1.pressure,
      time: p1.time,
    });
  }
  result.push(p2);

  return result;
}

/**
 * درون‌یابی ساده برای وقتی دایره معتبر نیست
 */
function interpolateSimple(p0, p1, p2, numSamples) {
  const result = [p0];
  // دو سگمنت: p0→p1 و p1→p2
  for (let s = 0; s < 2; s++) {
    const a = s === 0 ? p0 : p1;
    const b = s === 0 ? p1 : p2;
    for (let i = 1; i <= numSamples / 2; i++) {
      const t = i / (numSamples / 2 + 1);
      // smoothstep برای نرمی
      const st = t * t * (3 - 2 * t);
      result.push({
        x: a.x + (b.x - a.x) * st,
        y: a.y + (b.y - a.y) * st,
        pressure: a.pressure,
        time: a.time,
      });
    }
  }
  result.push(p2);
  return result;
}

/**
 * ترمیم چرخش ملایم با اسپلاین کششی
 * tension: ۰ = خیلی نرم، ۱ = سفت (نزدیک به خط اصلی)
 */
export function refineGentleTurn(p0, p1, p2, tension = 0.5, numSamples = 6) {
  // نقطه کنترل میانی با کشش
  // tension بالا = کنترل نزدیک‌تر به p1 = منحنی تیزتر
  const mx = (p0.x + p2.x) / 2;
  const my = (p0.y + p2.y) / 2;

  const cx = mx + (p1.x - mx) * tension;
  const cy = my + (p1.y - my) * tension;

  // منحنی بزیه درجه ۲: p0 → c → p2
  const result = [];
  for (let i = 0; i <= numSamples; i++) {
    const t = i / numSamples;
    const u = 1 - t;
    result.push({
      x: u * u * p0.x + 2 * u * t * cx + t * t * p2.x,
      y: u * u * p0.y + 2 * u * t * cy + t * t * p2.y,
      pressure: p1.pressure,
      time: p1.time,
    });
  }
  return result;
}

/**
 * موتور اصلی ترمیم چرخش
 */
export class TurnRefinementEngine {
  constructor(options = {}) {
    this.sharpThreshold = options.sharpThreshold || 25;   // درجه
    this.gentleThreshold = options.gentleThreshold || 8;   // درجه
    this.sharpSamples = options.sharpSamples || 10;
    this.gentleSamples = options.gentleSamples || 6;
    this.gentleTension = options.gentleTension || 0.6;
    this.maxRadius = options.maxRadius || 5000;
  }

  /**
   * پردازش کامل یک مسیر — نسخه اصلاح‌شده (بدون پرش)
   *
   * منطق: وقتی در p1 چرخش هست، کمان نرمی از p0 به p2 می‌کشیم
   * و p1 (نقطه تیز) رو کاملاً رد می‌کنیم. بعد ایندکس ۲ تا می‌ره جلو.
   */
  process(points) {
    if (!points || points.length < 3) return points ? [...points] : [];

    const result = [{ ...points[0] }];

    let i = 1;
    while (i < points.length - 1) {
      // p0 = آخرین نقطه خروجی (نه لزوماً points[i-1])
      const p0 = result[result.length - 1];
      const p1 = points[i];
      const p2 = points[i + 1];

      const angle = turningAngle(p0, p1, p2);
      const type = classifyPoint(angle);

      if (type === 'straight') {
        // خط راست: همون نقطه رو اضافه کن
        result.push({ ...p1 });
        i++;
      } else if (type === 'gentle') {
        // چرخش ملایم: بزیه از p0 به p2
        const refined = refineGentleTurn(
          p0, p1, p2,
          this.gentleTension,
          this.gentleSamples
        );
        // refined[0] ≈ p0 (قبلاً اضافه شده)، پس از ایندکس ۱ شروع می‌کنیم
        for (let j = 1; j < refined.length; j++) {
          result.push(refined[j]);
        }
        i += 2; // p1 و p2 مصرف شدن (p2 آخر کمانه)
      } else {
        // چرخش تند/سنجاق‌سری: کمان دایره از p0 به p2
        const refined = refineSharpTurn(p0, p1, p2, this.sharpSamples);
        for (let j = 1; j < refined.length; j++) {
          result.push(refined[j]);
        }
        i += 2;
      }
    }

    // نقاط باقی‌مونده
    while (i < points.length) {
      result.push({ ...points[i] });
      i++;
    }

    return result;
  }

  /**
   * آمار برای دیباگ: چند چرخش از هر نوع پیدا شد
   */
  analyze(points) {
    const stats = { straight: 0, gentle: 0, sharp: 0, hairpin: 0, angles: [] };
    if (!points || points.length < 3) return stats;

    for (let i = 1; i < points.length - 1; i++) {
      const angle = turningAngle(points[i-1], points[i], points[i+1]);
      const type = classifyPoint(angle);
      stats[type]++;
      stats.angles.push({ index: i, angle: Math.round(angle * 10) / 10, type });
    }
    return stats;
  }
}

export default TurnRefinementEngine;
