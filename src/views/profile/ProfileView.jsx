import React, { useState, useRef, useEffect, useMemo } from 'react';
import useSettingsStore from '../../store/useSettingsStore';
import useLibraryStore from '../../store/useLibraryStore';
import useBookmarkStore from '../../store/useBookmarkStore';
import useAppStore from '../../store/useAppStore';
import Icons from '../../components/common/Icons';
import { coreApi } from '../../services/coreApi';
import { readingActivity } from '../../services/readingActivity';
import { computeReadingSummary, formatReadingHours } from '../../utils/readingStats';

const PRESET_GRADIENTS = [
  { id: 'neon-cyan', label: 'نئون سایان', gradient: 'linear-gradient(135deg, #22d3ee 0%, #0f171c 100%)' },
  { id: 'cyber-purple', label: 'سایبر بنفش', gradient: 'linear-gradient(135deg, #bc8cff 0%, #ec4899 100%)' },
  { id: 'deep-blue', label: 'آبی اقیانوسی', gradient: 'linear-gradient(135deg, #3b82f6 0%, #1e3a8a 100%)' },
  { id: 'emerald', label: 'زمردی تیره', gradient: 'linear-gradient(135deg, #10b981 0%, #064e3b 100%)' },
  { id: 'sunset', label: 'غروب نارنجی', gradient: 'linear-gradient(135deg, #f59e0b 0%, #b91c1c 100%)' },
];

// مرحلهٔ ۳۱ — ابزارهایِ شاخص‌هایِ استعداد و نمودارها. همهٔ
// فرمول‌ها، ورودی‌هایِ واقعیِ دیتابیس را می‌گیرند و خروجی،
// همیشه بینِ ۰ تا ۱۰۰ است؛ دادهٔ صفر، صفر می‌دهد، نه عددِ جعلی.
function clampScore(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function skillLabelFor(score) {
  if (score >= 90) return 'نخبه';
  if (score >= 75) return 'پژوهشگرِ ارشد';
  if (score >= 60) return 'خوانندهٔ حرفه‌ای';
  if (score >= 40) return 'در مسیرِ رشد';
  return 'تازه‌کار';
}

// N روزِ اخیرِ تقویمی (محلی) با دقیقه‌هایِ مطالعهٔ هر روز.
// کلیدهایِ دیتابیس، تاریخِ محلیِ YYYY-MM-DD هستند.
function buildLastDays(daysMap, n) {
  const out = [];
  const today = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const entry = (daysMap && daysMap[key]) || {};
    out.push({ key, label: key.slice(5).replace('-', '/'), minutes: Math.round((Number(entry.seconds) || 0) / 60) });
  }
  return out;
}

// منحنیِ هموارِ Catmull-Rom به بزیر (برایِ خطِ نمودارِ مساحتی).
function buildSmoothPath(pts) {
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`;
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
  }
  return d;
}

// نقطهٔ رادار: زاویهٔ ۰ در بالا، ساعت‌گرد.
function radarPoint(cx, cy, r, index, total, ratio) {
  const angle = (Math.PI * 2 * index) / total - Math.PI / 2;
  return [cx + Math.cos(angle) * r * ratio, cy + Math.sin(angle) * r * ratio];
}

export default function ProfileView() {
  const { profile, updateProfile, setProfileAvatar, initSettings } = useSettingsStore();
  const { library, libraryItems, recentItems, favorites } = useLibraryStore();
  const showToast = useAppStore((state) => state.showToast);

  const [username, setUsername] = useState(profile?.username || 'Haamed');
  const [subtitle, setSubtitle] = useState(profile?.subtitle || 'توسعه‌دهنده و کمیک‌خوان حرفه‌ای');
  const [dailyGoal, setDailyGoal] = useState(profile?.dailyGoalPages || 50);
  const [isProcessingImg, setIsProcessingImg] = useState(false);
  // مرحله ۶ ـ بخش الف: آمارِ واقعیِ مطالعه از دیتابیس. تا وقتی
  // بارگذاری نشده، summary برابر null است تا عددِ جعلی نشان داده نشود.
  const [readingSummary, setReadingSummary] = useState(null);
  // مرحله ۱۴: مجموعِ زمانِ حضور در برنامه.
  const [totalAppSeconds, setTotalAppSeconds] = useState(0);
  // مرحلهٔ ۳۱ — نقشهٔ روزهایِ مطالعه (برایِ نمودارِ ۷/۱۴ روزه)،
  // مجموعِ حاشیه‌نویسی‌ها (از ورکرِ دیتابیس)، بازهٔ نمودار و
  // پرچمِ انیمیشنِ لودِ نمودارها.
  const [readingDays, setReadingDays] = useState({});
  const [annotationTotals, setAnnotationTotals] = useState(null);
  const [chartDays, setChartDays] = useState(14);
  const [isChartAnimated, setIsChartAnimated] = useState(false);
  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        // مرحله ۶ ـ بخش ب: پیش از خواندنِ آمار، منتظرِ اتمامِ فلاشِ
        // در حالِ انجام می‌مانیم؛ وگرنه رفتنِ مستقیم از ریدر به
        // پروفایل، آمارِ لحظاتی پیش را نشان نمی‌داد (مسابقهٔ
        // flush ناهمگام با getReadingStats).
        if (readingActivity && typeof readingActivity.waitForPendingFlush === 'function') {
          await readingActivity.waitForPendingFlush();
        }
        // مرحله ۱۴: مثلِ آمارِ مطالعه، پیش از خواندن، منتظرِ
        // فلاشِ حضور می‌مانیم.
        if (readingActivity && typeof readingActivity.waitForAppFlush === 'function') {
          await readingActivity.waitForAppFlush();
        }
        if (!isMounted) return;
        const res = await coreApi.getReadingStats();
        if (isMounted && res) setTotalAppSeconds(Number(res.totalAppSeconds) || 0);
        if (isMounted && res && res.days) {
          setReadingSummary(computeReadingSummary(res.days));
          setReadingDays(res.days);
        } else if (isMounted) {
          setReadingSummary(computeReadingSummary({}));
          setReadingDays({});
        }
        // مرحلهٔ ۳۱ — مجموعِ حاشیه‌نویسی‌ها از ورکر (فقط خواندنی،
        // بدونِ نوشتن در دیتابیس). خرابی‌اش، شاخص‌ها را خراب
        // نمی‌کند؛ صفر می‌ماند.
        try {
          if (isMounted && coreApi.dbAction) {
            const totals = await coreApi.dbAction({ action: 'GET_ANNOTATION_TOTALS', payload: {} });
            if (isMounted && totals && totals.type === 'done') {
              setAnnotationTotals({
                totalItems: Number(totals.totalItems) || 0,
                annotatedPages: Number(totals.annotatedPages) || 0,
                annotatedFiles: Number(totals.annotatedFiles) || 0,
              });
            }
          }
        } catch (_) {}
      } catch (_) {
        if (isMounted) setReadingSummary(computeReadingSummary({}));
        if (isMounted) setReadingDays({});
      }
    })();
    return () => { isMounted = false; };
  }, []);

  const fileInputRef = useRef(null);

  useEffect(() => {
    if (initSettings) initSettings();
  }, [initSettings]);

  useEffect(() => {
    if (profile?.username) setUsername(profile.username);
    if (profile?.subtitle) setSubtitle(profile.subtitle);
    if (profile?.dailyGoalPages) setDailyGoal(profile.dailyGoalPages);
  }, [profile]);

  // مرحلهٔ ۳۱ — شمارندهٔ بوک‌مارک‌ها (الگویِ سایدبار) و پرچمِ
  // انیمیشنِ نمودارها (یک فریم پس از مانت، تا ترنزیشنِ ۰٫۹
  // ثانیه‌ای از صفر تا مقدارِ واقعی دیده شود).
  const totalBookmarkCount = useBookmarkStore((state) => state.totalBookmarkCount);
  const loadAllBookmarks = useBookmarkStore((state) => state.loadAllBookmarks);
  useEffect(() => {
    if (loadAllBookmarks) loadAllBookmarks();
  }, [loadAllBookmarks]);
  useEffect(() => {
    let rafId = null;
    rafId = requestAnimationFrame(() => setIsChartAnimated(true));
    return () => { if (rafId) cancelAnimationFrame(rafId); };
  }, []);

  // مرحله ۶ ـ بخش الف: «صفحه خوانده‌شده» حالا از آمارِ واقعیِ
  // ثبت‌شده می‌آید، نه از جمعِ شمارهٔ صفحهٔ جاریِ کتاب‌ها (که
  // موقعیتِ فعلی را می‌شمرد، نه صفحاتِ واقعاً خوانده‌شده را، و با
  // هر بار خواندنِ دوباره، دوباره شمرده می‌شد). تا وقتی آمار
  // بارگذاری نشده، null است و در کارت، خطِ تیره نشان داده می‌شود.
  const totalReadPages = readingSummary ? readingSummary.totalPages : null;

  const effectiveLibrary = library || libraryItems || [];
  const totalComics = effectiveLibrary.length;
  const totalFavorites = favorites?.length || 0;

  // مرحلهٔ ۳۱ — کتاب‌هایِ تمام‌شده: پیشرفتِ ۱۰۰٪ یا رسیدنِ
  // صفحهٔ جاری به کلِ صفحه‌ها (برایِ آیتم‌هایِ بدونِ پیشرفت،
  // از lastPage/totalPages حساب می‌شود).
  const finishedBooks = useMemo(() => {
    return effectiveLibrary.filter((item) => {
      if (!item) return false;
      const totalP = Number(item.totalPages) || 0;
      const lastP = Number(item.lastPage || item.currentPage) || 0;
      if (Number(item.progress) >= 100) return true;
      return totalP > 1 && lastP >= totalP;
    }).length;
  }, [effectiveLibrary]);

  // مرحلهٔ ۳۱ — ۵ شاخصِ استعداد (۰ تا ۱۰۰) از آمارِ واقعی.
  // تمرکز: میانگینِ دقیقهٔ مطالعهٔ روزانه (سقفِ ۶۰ دقیقه برایِ
  // نمرهٔ کاملِ این جزء) + نسبتِ مطالعه به حضور در اپ.
  // تحلیل: تراکمِ بوک‌مارک و حاشیه‌نویسی در روز + حجمِ کلِ آن‌ها.
  // سرعتِ بصری: صفحه در ساعت + صفحه در روز (سقف‌هایِ ۴۰ و ۵۰).
  // استقامت: بهترین رکوردِ پیوستگی (سقفِ ۳۰ روز) + روزهایِ فعال
  // (سقفِ ۹۰) + کلِ زمانِ مطالعه (سقفِ ۱۰۰ ساعت).
  // جامع: میانگینِ وزنیِ چهار شاخصِ دیگر.
  const aptitudeMetrics = useMemo(() => {
    if (!readingSummary) return null;
    const totalSeconds = Number(readingSummary.totalSeconds) || 0;
    const totalPages = Number(readingSummary.totalPages) || 0;
    const totalDays = Math.max(1, Number(readingSummary.totalDays) || 0);
    const bestStreak = Number(readingSummary.bestStreak) || 0;
    const avgDailyMin = totalSeconds / totalDays / 60;
    const studyPresence = totalSeconds / Math.max(1, Number(totalAppSeconds) || 0);
    const focus = clampScore(0.6 * Math.min(100, (avgDailyMin / 60) * 100) + 0.4 * Math.min(1, studyPresence) * 100);
    const pagesPerHour = totalSeconds > 0 ? totalPages / (totalSeconds / 3600) : 0;
    const avgDailyPages = totalPages / totalDays;
    const velocity = clampScore(0.5 * Math.min(100, (pagesPerHour / 40) * 100) + 0.5 * Math.min(100, (avgDailyPages / 50) * 100));
    const markCount = (Number(totalBookmarkCount) || 0) + (annotationTotals ? Number(annotationTotals.totalItems) || 0 : 0);
    const density = markCount / totalDays;
    const analytical = clampScore(0.5 * Math.min(100, (density / 2) * 100) + 0.5 * Math.min(100, (markCount / 40) * 100));
    const stamina = clampScore(0.5 * Math.min(100, (bestStreak / 30) * 100) + 0.3 * Math.min(100, (Number(readingSummary.totalDays) || 0) / 90 * 100) + 0.2 * Math.min(100, (totalSeconds / 360000) * 100));
    const overall = clampScore(0.3 * focus + 0.25 * analytical + 0.2 * velocity + 0.25 * stamina);
    return [
      { id: 'focus', name: 'استعدادِ تمرکزِ عمیق', short: 'تمرکز', value: focus, color: '#00f2fe', desc: `میانگینِ ${Math.round(avgDailyMin)} دقیقه مطالعه در روز` },
      { id: 'analytical', name: 'استعدادِ تحلیل و پژوهشگری', short: 'تحلیل', value: analytical, color: '#7c3aed', desc: `${markCount} بوک‌مارک و حاشیه‌نویسی` },
      { id: 'velocity', name: 'چابکیِ پردازشِ بصری', short: 'سرعت', value: velocity, color: '#10b981', desc: `${Math.round(pagesPerHour)} صفحه در ساعت` },
      { id: 'stamina', name: 'استقامت و پیوستگیِ ذهنی', short: 'استقامت', value: stamina, color: '#f59e0b', desc: `بهترین رکورد: ${bestStreak} روزِ پیوسته` },
      { id: 'overall', name: 'امتیازِ جامعِ استعدادِ مطالعه', short: 'جامع', value: overall, color: '#ec4899', desc: `${finishedBooks} کتابِ تمام‌شده از ${totalComics} عنوان` },
    ];
  }, [readingSummary, totalAppSeconds, totalBookmarkCount, annotationTotals, finishedBooks, totalComics]);

  // مرحلهٔ ۳۱ — دادهٔ نمودارِ روند (دقیقهٔ مطالعهٔ هر روز).
  const trendDays = useMemo(() => buildLastDays(readingDays, chartDays), [readingDays, chartDays]);
  const trendMax = Math.max(1, ...trendDays.map((d) => d.minutes));
  const chartW = 640;
  const chartH = 240;
  const chartPad = { l: 8, r: 8, t: 16, b: 30 };
  const chartPts = trendDays.map((d, i) => {
    const x = trendDays.length === 1
      ? chartW / 2
      : chartPad.l + (i / (trendDays.length - 1)) * (chartW - chartPad.l - chartPad.r);
    const y = chartPad.t + (1 - d.minutes / trendMax) * (chartH - chartPad.t - chartPad.b);
    return { x, y };
  });
  const chartLinePath = buildSmoothPath(chartPts);
  const chartAreaPath = chartPts.length > 0
    ? `${chartLinePath} L ${chartPts[chartPts.length - 1].x} ${chartH - chartPad.b} L ${chartPts[0].x} ${chartH - chartPad.b} Z`
    : '';
  const chartBarW = trendDays.length > 1 ? ((chartW - chartPad.l - chartPad.r) / (trendDays.length - 1)) * 0.42 : 24;

  const currentAvatarImg = profile?.avatar || profile?.customAvatar || null;

  const handleSaveTextInfo = () => {
    if (!username.trim()) {
      showToast('نام کاربری نمی‌تواند خالی باشد', { type: 'warning' });
      return;
    }
    updateProfile({
      username: username.trim(),
      subtitle: subtitle.trim(),
      dailyGoalPages: Number(dailyGoal) || 50,
    });
    showToast('اطلاعات پروفایل با موفقیت در دیتابیس ذخیره شد', { type: 'success' });
  };

  const handleSelectGradient = (grad) => {
    updateProfile({
      avatar: null,
      customAvatar: null,
      avatarGradient: grad,
    });
    showToast('طرح گرادیانت آواتار با موفقیت اعمال شد', { type: 'info' });
  };

  const handleImageFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      showToast('لطفاً یک فایل تصویری معتبر انتخاب کنید', { type: 'error' });
      return;
    }

    setIsProcessingImg(true);
    const reader = new FileReader();

    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const size = 256;
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');

        const minDim = Math.min(img.width, img.height);
        const startX = (img.width - minDim) / 2;
        const startY = (img.height - minDim) / 2;

        ctx.drawImage(img, startX, startY, minDim, minDim, 0, 0, size, size);

        const optimizedDataUrl = canvas.toDataURL('image/jpeg', 0.88);
        canvas.width = 0;
        canvas.height = 0;

        setProfileAvatar(optimizedDataUrl, `url("${optimizedDataUrl}") center/cover no-repeat`);

        setIsProcessingImg(false);
        showToast('تصویر آواتار شما ذخیره و در سایدبار اعمال شد', { type: 'success' });
      };

      img.onerror = () => {
        setIsProcessingImg(false);
        showToast('خطا در پردازش فایل تصویر', { type: 'error' });
      };

      img.src = event.target.result;
    };

    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleRemoveCustomAvatar = () => {
    const defaultGrad = PRESET_GRADIENTS[0].gradient;
    updateProfile({
      avatar: null,
      customAvatar: null,
      avatarGradient: defaultGrad,
    });
    showToast('تصویر شخصی حذف شد و آواتار به حالت پیش‌فرض بازگشت', { type: 'info' });
  };

  return (
    <div style={styles.container}>
      {/* هدر بالای پروفایل */}
      <div style={styles.header}>
        <div style={styles.titleWrap}>
          <div style={styles.headerIcon}>
            <Icons.User size={22} />
          </div>
          <div>
            <h2 style={styles.title}>پروفایل و تنظیمات کاربری</h2>
            <span style={styles.subtitle}>
              شخصی‌سازی تصویر، نام کاربری و پایش آمار مطالعه مانهوا
            </span>
          </div>
        </div>
      </div>

      {/* بنر اصلی پروفایل کاربری */}
      <div style={styles.profileHeroCard}>
        <div
          style={{
            ...styles.bigAvatar,
            backgroundImage: currentAvatarImg
              ? `url("${currentAvatarImg}")`
              : profile?.avatarGradient || PRESET_GRADIENTS[0].gradient,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        >
          {!currentAvatarImg && (
            <span style={styles.avatarLetter}>
              {(username || 'H').charAt(0).toUpperCase()}
            </span>
          )}
        </div>

        <div style={styles.heroTextCol}>
          <div style={styles.heroNameRow}>
            <h3 style={styles.heroName}>{username || 'Haamed'}</h3>
            <span style={styles.verifiedTag}>کاربر فعال</span>
          </div>
          <p style={styles.heroSubtitle}>{subtitle || 'کمیک‌خوان حرفه‌ای'}</p>
          <div style={styles.goalTrackWrap}>
            <span>هدف روزانه مطالعه: {dailyGoal} صفحه</span>
          </div>
        </div>

        <div style={styles.statsSummaryGrid}>
          <div style={styles.statBox}>
            <strong style={styles.statVal}>{totalReadPages === null ? '—' : totalReadPages}</strong>
            <span style={styles.statLbl}>صفحه خوانده‌شده</span>
          </div>
          <div style={styles.statBox}>
            <strong style={styles.statVal}>{readingSummary ? `${readingSummary.currentStreak} روز` : '—'}</strong>
            <span style={styles.statLbl}>رکورد پیوستگی جاری</span>
          </div>
          <div style={styles.statBox}>
            <strong style={styles.statVal}>{readingSummary ? formatReadingHours(readingSummary.totalSeconds) : '—'}</strong>
            <span style={styles.statLbl}>زمان مطالعه</span>
          </div>
          <div style={styles.statBox}>
            <strong style={styles.statVal}>{formatReadingHours(totalAppSeconds)}</strong>
            <span style={styles.statLbl}>حضور در برنامه</span>
          </div>
          <div style={styles.statBox}>
            <strong style={styles.statVal}>{totalComics}</strong>
            <span style={styles.statLbl}>عنوان کتابخانه</span>
          </div>
          <div style={styles.statBox}>
            <strong style={styles.statVal}>{totalFavorites}</strong>
            <span style={styles.statLbl}>علاقه‌مندی</span>
          </div>
        </div>
      </div>

      {/* مرحله ۶ ـ بخش الف: آمارِ واقعیِ مطالعه و رکوردِ پیوستگی */}
      <div style={styles.sectionCard}>
        <div style={styles.sectionHeaderRow}>
          <span style={{ color: 'var(--accent)', display: 'flex' }}>
            <Icons.Sparkles size={18} />
          </span>
          <h4 style={styles.sectionTitle}>آمار واقعی مطالعه</h4>
        </div>
        <p style={styles.sectionDesc}>
          از این به بعد، هر صفحه‌ای که در ریدر بخوانی و هر ۳۰ ثانیه حضور در مطالعه، به‌صورت خودکار اینجا ثبت می‌شود. آمارِ قبل از این نسخه، چون ثبت نشده بود، در این کارت‌ها نیست.
        </p>

        {readingSummary ? (
          <>
            <div style={styles.statsSummaryGrid}>
              <div style={styles.statBox}>
                <strong style={styles.statVal}>{readingSummary.currentStreak} روز</strong>
                <span style={styles.statLbl}>رکورد پیوستگی جاری</span>
              </div>
              <div style={styles.statBox}>
                <strong style={styles.statVal}>{readingSummary.bestStreak} روز</strong>
                <span style={styles.statLbl}>بهترین رکورد پیوستگی</span>
              </div>
              <div style={styles.statBox}>
                <strong style={styles.statVal}>{readingSummary.totalPages}</strong>
                <span style={styles.statLbl}>کل صفحات خوانده‌شده</span>
              </div>
              <div style={styles.statBox}>
                <strong style={styles.statVal}>{formatReadingHours(readingSummary.totalSeconds)}</strong>
                <span style={styles.statLbl}>کل زمان مطالعه</span>
              </div>
              <div style={styles.statBox}>
                <strong style={styles.statVal}>{readingSummary.totalDays} روز</strong>
                <span style={styles.statLbl}>روزهای فعال</span>
              </div>
            </div>

            <div style={styles.goalRow}>
              <div style={styles.labelWithVal}>
                <span style={styles.goalLabel}>هدف امروز: {readingSummary.todayPages} از {Number(dailyGoal) || 50} صفحه</span>
                <span style={styles.valBadge}>
                  {Math.min(100, Math.round((readingSummary.todayPages / Math.max(1, Number(dailyGoal) || 50)) * 100))}%
                </span>
              </div>
              <div style={styles.goalBarTrack}>
                <div
                  style={{
                    ...styles.goalBarFill,
                    width: `${Math.min(100, Math.round((readingSummary.todayPages / Math.max(1, Number(dailyGoal) || 50)) * 100))}%`,
                  }}
                />
              </div>
            </div>

            <div style={styles.chartRow}>
              {readingSummary.last7.map((day) => {
                const maxPages = Math.max(1, ...readingSummary.last7.map((d) => d.pages));
                const heightPct = Math.round((day.pages / maxPages) * 100);
                const dayLabel = day.key.slice(5).replace('-', '/');
                return (
                  <div key={day.key} style={styles.chartCol}>
                    <div style={styles.chartBarTrack}>
                      <div style={{ ...styles.chartBarFill, height: `${Math.max(day.pages > 0 ? 8 : 3, heightPct)}%` }} />
                    </div>
                    <span style={styles.chartVal}>{day.pages}</span>
                    <span style={styles.chartLbl}>{dayLabel}</span>
                  </div>
                );
              })}
            </div>
            <p style={styles.sectionDesc}>نمودار: صفحات خوانده‌شده در ۷ روز اخیر (راست به چپ: قدیمی‌ترین تا امروز).</p>
          </>
        ) : (
          <p style={styles.sectionDesc}>در حال بارگذاریِ آمار…</p>
        )}
      </div>

      {/* مرحلهٔ ۳۱ — شاخص‌هایِ استعداد و مهارتِ مطالعه */}
      <div style={styles.sectionCard}>
        <div style={styles.sectionHeaderRow}>
          <span style={{ color: 'var(--accent)', display: 'flex' }}>
            <Icons.Zap size={18} />
          </span>
          <h4 style={styles.sectionTitle}>شاخص‌هایِ استعداد و مهارتِ مطالعه</h4>
        </div>
        <p style={styles.sectionDesc}>
          این عددها از آمارِ واقعیِ خودت حساب می‌شوند (زمانِ مطالعه، صفحه‌هایِ خوانده‌شده، روزهایِ فعال و پیوسته، بوک‌مارک‌ها، حاشیه‌نویسی‌ها و کتاب‌هایِ تمام‌شده)؛ هیچ عددِ فرضی‌ای در آن‌ها نیست.
        </p>
        {aptitudeMetrics ? (
          <>
            <div style={styles.metricGrid}>
              {aptitudeMetrics.map((m) => (
                <div key={m.id} style={m.id === 'overall' ? { ...styles.metricCard, ...styles.metricCardOverall } : styles.metricCard}>
                  <div style={styles.metricRingWrap}>
                    <svg width="64" height="64" viewBox="0 0 64 64">
                      <circle cx="32" cy="32" r="26" fill="none" stroke="var(--border)" strokeWidth="7" />
                      <circle
                        cx="32" cy="32" r="26" fill="none"
                        stroke={m.color} strokeWidth="7" strokeLinecap="round"
                        pathLength={1}
                        strokeDasharray={1}
                        strokeDashoffset={isChartAnimated ? 1 - m.value / 100 : 1}
                        transform="rotate(-90 32 32)"
                        style={{ transition: 'stroke-dashoffset 0.9s cubic-bezier(0.16, 1, 0.3, 1)' }}
                      />
                    </svg>
                    <span style={styles.metricRingVal}>{m.value}</span>
                  </div>
                  <strong style={styles.metricName}>{m.name}</strong>
                  <span style={styles.metricSkill}>سطحِ استعداد: {skillLabelFor(m.value)}</span>
                  <span style={styles.metricDesc}>{m.desc}</span>
                </div>
              ))}
            </div>
            {readingSummary && readingSummary.totalDays === 0 && readingSummary.totalPages === 0 && readingSummary.totalSeconds === 0 && (
              <p style={styles.sectionDesc}>هنوز دادهٔ کافی ثبت نشده است؛ با مطالعهٔ بیشتر، این شاخص‌ها شکل می‌گیرند.</p>
            )}
          </>
        ) : (
          <p style={styles.sectionDesc}>در حال بارگذاریِ آمار…</p>
        )}
      </div>

      {/* مرحلهٔ ۳۱ — نمودارِ گرافیکیِ عملکرد و استعداد با انیمیشنِ لود */}
      <div style={styles.sectionCard}>
        <div style={styles.sectionHeaderRow}>
          <span style={{ color: 'var(--accent)', display: 'flex' }}>
            <Icons.Eye size={18} />
          </span>
          <h4 style={styles.sectionTitle}>نمودارِ گرافیکیِ عملکرد و استعداد</h4>
        </div>
        <p style={styles.sectionDesc}>
          روندِ دقیقه‌هایِ مطالعه در روزهایِ اخیر (ستون + منحنیِ مساحتی با گرادیانِ نئونی) و رادارِ پنج‌ضلعیِ شاخص‌هایِ استعداد؛ هر دو با انیمیشنِ نرمِ ۰٫۹ ثانیه‌ای، از صفر تا مقدارِ واقعی، هنگامِ باز شدنِ صفحه پر می‌شوند.
        </p>
        <div style={styles.chartToggleRow}>
          <span style={styles.chartToggleLabel}>بازهٔ نمودار:</span>
          <button type="button" onClick={() => setChartDays(7)} style={chartDays === 7 ? { ...styles.chartToggleBtn, ...styles.chartToggleBtnActive } : styles.chartToggleBtn}>۷ روز</button>
          <button type="button" onClick={() => setChartDays(14)} style={chartDays === 14 ? { ...styles.chartToggleBtn, ...styles.chartToggleBtnActive } : styles.chartToggleBtn}>۱۴ روز</button>
        </div>
        <div style={styles.chartSvgWrap}>
          <svg width="100%" viewBox={`0 0 ${chartW} ${chartH}`} role="img" aria-label="روندِ مطالعه">
            <defs>
              <linearGradient id="trendAreaGrad" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#00f2fe" />
                <stop offset="100%" stopColor="#7c3aed" />
              </linearGradient>
            </defs>
            {[0.25, 0.5, 0.75, 1].map((f) => (
              <line
                key={f}
                x1={chartPad.l} x2={chartW - chartPad.r}
                y1={chartPad.t + (1 - f) * (chartH - chartPad.t - chartPad.b)}
                y2={chartPad.t + (1 - f) * (chartH - chartPad.t - chartPad.b)}
                stroke="var(--border)" strokeWidth="1" strokeDasharray="3 4"
              />
            ))}
            {trendDays.map((d, i) => {
              const x = chartPts[i] ? chartPts[i].x : 0;
              const barTop = chartPts[i] ? chartPts[i].y : chartH - chartPad.b;
              const barH = chartH - chartPad.b - barTop;
              return (
                <rect
                  key={`bar-${d.key}`}
                  x={x - chartBarW / 2}
                  y={isChartAnimated ? barTop : chartH - chartPad.b}
                  width={chartBarW}
                  height={isChartAnimated ? barH : 0}
                  rx={3}
                  fill="rgba(124, 58, 237, 0.35)"
                  style={{ transition: `height 0.9s cubic-bezier(0.16, 1, 0.3, 1) ${i * 40}ms, y 0.9s cubic-bezier(0.16, 1, 0.3, 1) ${i * 40}ms` }}
                />
              );
            })}
            {chartAreaPath && (
              <path
                d={chartAreaPath}
                fill="url(#trendAreaGrad)"
                opacity={isChartAnimated ? 0.28 : 0}
                style={{ transition: 'opacity 0.9s cubic-bezier(0.16, 1, 0.3, 1)' }}
              />
            )}
            {chartLinePath && (
              <path
                d={chartLinePath}
                fill="none"
                stroke="url(#trendAreaGrad)"
                strokeWidth="2.5"
                strokeLinecap="round"
                pathLength={1}
                strokeDasharray={1}
                strokeDashoffset={isChartAnimated ? 0 : 1}
                style={{ transition: 'stroke-dashoffset 0.9s cubic-bezier(0.16, 1, 0.3, 1)' }}
              />
            )}
            {trendDays.map((d, i) => (
              <g key={`dot-${d.key}`}>
                <circle
                  cx={chartPts[i] ? chartPts[i].x : 0}
                  cy={chartPts[i] ? chartPts[i].y : 0}
                  r={isChartAnimated ? 4.5 : 0}
                  fill="#00f2fe"
                  stroke="#0a0f13"
                  strokeWidth="1.5"
                  style={{ filter: 'drop-shadow(0 0 4px rgba(0, 242, 254, 0.8))', transition: 'r 0.9s cubic-bezier(0.16, 1, 0.3, 1)' }}
                >
                  <title>{`${d.label}: ${d.minutes} دقیقه مطالعه`}</title>
                </circle>
                <text
                  x={chartPts[i] ? chartPts[i].x : 0}
                  y={chartH - 8}
                  textAnchor="middle"
                  fontSize="10"
                  fill="var(--muted)"
                >
                  {d.label}
                </text>
              </g>
            ))}
          </svg>
        </div>
        {aptitudeMetrics && (
          <div style={styles.radarWrap}>
            <svg width="320" height="320" viewBox="0 0 320 320" role="img" aria-label="رادارِ شاخص‌هایِ استعداد">
              {[0.25, 0.5, 0.75, 1].map((f) => {
                const pts = aptitudeMetrics.map((_, i) => radarPoint(160, 150, 105, i, 5, f));
                return (
                  <polygon
                    key={f}
                    points={pts.map((pt) => pt.join(',')).join(' ')}
                    fill="none"
                    stroke="var(--border)"
                    strokeWidth="1"
                  />
                );
              })}
              {aptitudeMetrics.map((_, i) => {
                const [x2, y2] = radarPoint(160, 150, 105, i, 5, 1);
                return <line key={`axis-${i}`} x1={160} y1={150} x2={x2} y2={y2} stroke="var(--border)" strokeWidth="1" />;
              })}
              <g
                style={{
                  transform: isChartAnimated ? 'scale(1)' : 'scale(0)',
                  transformOrigin: '160px 150px',
                  transition: 'transform 0.9s cubic-bezier(0.16, 1, 0.3, 1)',
                }}
              >
                <polygon
                  points={aptitudeMetrics.map((m, i) => radarPoint(160, 150, 105, i, 5, m.value / 100).join(',')).join(' ')}
                  fill="rgba(0, 242, 254, 0.18)"
                  stroke="#00f2fe"
                  strokeWidth="2"
                  strokeLinejoin="round"
                />
                {aptitudeMetrics.map((m, i) => {
                  const [vx, vy] = radarPoint(160, 150, 105, i, 5, m.value / 100);
                  return (
                    <g key={`rv-${m.id}`}>
                      <circle cx={vx} cy={vy} r="4" fill="#00f2fe" stroke="#0a0f13" strokeWidth="1.5">
                        <title>{`${m.name}: ${m.value}`}</title>
                      </circle>
                      <text x={vx} y={vy - 10} textAnchor="middle" fontSize="11" fontWeight="700" fill="var(--text)">{m.value}</text>
                    </g>
                  );
                })}
              </g>
              {aptitudeMetrics.map((m, i) => {
                const [lx, ly] = radarPoint(160, 150, 132, i, 5, 1);
                return (
                  <text key={`rl-${m.id}`} x={lx} y={ly} textAnchor="middle" fontSize="11" fill="var(--muted)">
                    {m.short}
                  </text>
                );
              })}
            </svg>
            <p style={styles.sectionDesc}>رادارِ پنج‌ضلعیِ هر ۵ شاخص؛ چندضلعی از مرکز به بیرون باز می‌شود و عددِ هر رأس، همان شاخص است.</p>
          </div>
        )}
      </div>

      {/* بخش آپلود یا انتخاب آواتار */}
      <div style={styles.sectionCard}>
        <div style={styles.sectionHeaderRow}>
          <span style={{ color: 'var(--accent)', display: 'flex' }}>
            <Icons.Image size={18} />
          </span>
          <h4 style={styles.sectionTitle}>عکس و استایل آواتار</h4>
        </div>
        <p style={styles.sectionDesc}>
          تصویر دلخواه خود را از کامپیوتر بارگذاری کنید یا یکی از طرح‌های نئونی زیر را برگزینید.
        </p>

        <div style={styles.avatarActionsRow}>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleImageFileChange}
          />

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isProcessingImg}
            style={styles.uploadBtn}
          >
            {isProcessingImg ? (
              <>
                <Icons.Loader size={15} />
                <span>در حال فشرده‌سازی...</span>
              </>
            ) : (
              <>
                <Icons.FolderOpen size={15} />
                <span>انتخاب عکس از سیستم</span>
              </>
            )}
          </button>

          {currentAvatarImg && (
            <button
              type="button"
              onClick={handleRemoveCustomAvatar}
              style={styles.removeAvatarBtn}
            >
              <Icons.Trash size={14} />
              <span>حذف عکس شخصی</span>
            </button>
          )}
        </div>

        <div style={styles.presetPaletteRow}>
          <span style={styles.paletteLabel}>انتخاب از گرادیانت‌های نئونی آماده:</span>
          <div style={styles.gradientPills}>
            {PRESET_GRADIENTS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => handleSelectGradient(p.gradient)}
                style={{
                  ...styles.gradientCircleBtn,
                  background: p.gradient,
                  border:
                    !currentAvatarImg && profile?.avatarGradient === p.gradient
                      ? '2px solid #fff'
                      : '2px solid transparent',
                  transform:
                    !currentAvatarImg && profile?.avatarGradient === p.gradient
                      ? 'scale(1.15)'
                      : 'scale(1)',
                }}
                title={p.label}
              />
            ))}
          </div>
        </div>
      </div>

      {/* بخش فرم اطلاعات متنی */}
      <div style={styles.sectionCard}>
        <div style={styles.sectionHeaderRow}>
          <span style={{ color: 'var(--accent)', display: 'flex' }}>
            <Icons.Settings size={18} />
          </span>
          <h4 style={styles.sectionTitle}>مشخصات فردی</h4>
        </div>

        <div style={styles.formGrid}>
          <div style={styles.fieldGroup}>
            <label style={styles.label}>نام نمایشی:</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="مثلاً: Haamed"
              style={styles.input}
            />
          </div>

          <div style={styles.fieldGroup}>
            <label style={styles.label}>بیوگرافی یا عنوان:</label>
            <input
              type="text"
              value={subtitle}
              onChange={(e) => setSubtitle(e.target.value)}
              placeholder="مثلاً: توسعه‌دهنده و مانگا ریدر"
              style={styles.input}
            />
          </div>

          <div style={styles.fieldGroup}>
            <label style={styles.label}>هدف مطالعه روزانه ({dailyGoal} صفحه):</label>
            <input
              type="range"
              min="10"
              max="200"
              step="5"
              value={dailyGoal}
              onChange={(e) => setDailyGoal(e.target.value)}
              style={styles.slider}
            />
          </div>
        </div>

        <div style={styles.saveActionRow}>
          <button type="button" onClick={handleSaveTextInfo} style={styles.saveBtn}>
            <Icons.Check size={16} />
            <span>ذخیره تغییرات در دیتابیس</span>
          </button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  container: {
    flex: 1,
    padding: '18px 22px 28px',
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
    overflowY: 'auto',
    direction: 'rtl',
    userSelect: 'none',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: '14px',
    borderBottom: '1px solid var(--border)',
  },
  titleWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  headerIcon: {
    color: 'var(--accent)',
    backgroundColor: 'rgba(34, 211, 238, 0.1)',
    padding: '10px',
    borderRadius: '12px',
    border: '1px solid rgba(34, 211, 238, 0.3)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontFamily: 'var(--font-fa)',
    fontSize: '20px',
    fontWeight: 800,
    color: 'var(--text)',
    margin: 0,
  },
  subtitle: {
    fontFamily: 'var(--font-fa)',
    fontSize: '12.5px',
    fontWeight: 400,
    color: 'var(--muted)',
  },
  profileHeroCard: {
    backgroundColor: 'var(--panel)',
    borderRadius: '20px',
    border: '1px solid var(--border)',
    padding: '24px',
    display: 'flex',
    alignItems: 'center',
    gap: '22px',
    flexWrap: 'wrap',
    boxShadow: '0 12px 30px rgba(0, 0, 0, 0.45)',
  },
  bigAvatar: {
    width: '84px',
    height: '84px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    boxShadow: '0 8px 22px rgba(0, 0, 0, 0.6)',
    border: '2px solid rgba(34, 211, 238, 0.45)',
    overflow: 'hidden',
  },
  avatarLetter: {
    fontFamily: 'var(--font-latin)',
    fontSize: '34px',
    fontWeight: 800,
    color: '#ffffff',
  },
  heroTextCol: {
    flex: 1,
    minWidth: '220px',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  heroNameRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  heroName: {
    fontFamily: 'var(--font-latin)',
    fontSize: '22px',
    fontWeight: 800,
    color: 'var(--text)',
    margin: 0,
    direction: 'ltr',
  },
  verifiedTag: {
    fontFamily: 'var(--font-fa)',
    fontSize: '10.5px',
    fontWeight: 600,
    color: 'var(--accent)',
    backgroundColor: 'rgba(34, 211, 238, 0.12)',
    padding: '3px 9px',
    borderRadius: '8px',
  },
  heroSubtitle: {
    fontFamily: 'var(--font-fa)',
    fontSize: '13px',
    fontWeight: 400,
    color: 'var(--muted)',
    margin: 0,
  },
  goalTrackWrap: {
    fontFamily: 'var(--font-fa)',
    fontSize: '11.5px',
    fontWeight: 600,
    color: 'var(--accent)',
    marginTop: '4px',
    fontVariantNumeric: 'tabular-nums',
  },
  statsSummaryGrid: {
    display: 'flex',
    gap: '12px',
    flexWrap: 'wrap',
  },
  statBox: {
    backgroundColor: 'var(--panel2)',
    border: '1px solid var(--border)',
    borderRadius: '14px',
    padding: '12px 18px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    minWidth: '100px',
  },
  statVal: {
    fontFamily: 'var(--font-mono)',
    fontSize: '19px',
    fontWeight: 700,
    color: 'var(--text)',
    fontVariantNumeric: 'tabular-nums',
  },
  statLbl: {
    fontFamily: 'var(--font-fa)',
    fontSize: '11px',
    fontWeight: 500,
    color: 'var(--muted)',
    marginTop: '3px',
  },
  goalRow: {
    marginTop: '16px',
  },
  labelWithVal: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
  },
  goalLabel: {
    fontSize: '13px',
    fontWeight: 600,
    color: 'var(--text)',
  },
  valBadge: {
    fontSize: '12px',
    fontWeight: 700,
    color: 'var(--accent)',
    backgroundColor: 'rgba(34, 211, 238, 0.1)',
    borderRadius: '999px',
    padding: '2px 10px',
    fontVariantNumeric: 'tabular-nums',
  },
  goalBarTrack: {
    height: '8px',
    borderRadius: '999px',
    backgroundColor: 'var(--panel2)',
    border: '1px solid var(--border)',
    overflow: 'hidden',
    marginTop: '8px',
  },
  goalBarFill: {
    height: '100%',
    background: 'linear-gradient(90deg, #22d3ee, #10b981)',
    borderRadius: '999px',
    transition: 'width 0.4s ease',
  },
  chartRow: {
    display: 'flex',
    gap: '10px',
    alignItems: 'stretch',
    marginTop: '18px',
  },
  chartCol: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '4px',
    minWidth: 0,
  },
  chartBarTrack: {
    height: '72px',
    width: '100%',
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'center',
    backgroundColor: 'var(--panel2)',
    border: '1px solid var(--border)',
    borderRadius: '8px',
    overflow: 'hidden',
  },
  chartBarFill: {
    width: '100%',
    background: 'linear-gradient(180deg, #22d3ee, #0e7490)',
    minHeight: '3px',
  },
  chartVal: {
    fontSize: '12px',
    fontWeight: 700,
    color: 'var(--text)',
    fontVariantNumeric: 'tabular-nums',
  },
  chartLbl: {
    fontSize: '10.5px',
    color: 'var(--muted)',
    fontVariantNumeric: 'tabular-nums',
  },
  sectionCard: {
    backgroundColor: 'var(--panel)',
    borderRadius: '18px',
    border: '1px solid var(--border)',
    padding: '20px 22px',
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
  },
  sectionHeaderRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  sectionTitle: {
    fontFamily: 'var(--font-fa)',
    fontSize: '16px',
    fontWeight: 800,
    color: 'var(--text)',
    margin: 0,
  },
  sectionDesc: {
    fontFamily: 'var(--font-fa)',
    fontSize: '12.5px',
    fontWeight: 400,
    color: 'var(--muted)',
    margin: 0,
  },
  avatarActionsRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  uploadBtn: {
    padding: '9px 18px',
    borderRadius: '10px',
    backgroundColor: 'rgba(34, 211, 238, 0.12)',
    border: '1px solid var(--accent)',
    color: 'var(--accent)',
    fontFamily: 'var(--font-fa)',
    fontWeight: 700,
    fontSize: '12.5px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '7px',
    transition: 'all 0.15s ease',
  },
  removeAvatarBtn: {
    padding: '9px 14px',
    borderRadius: '10px',
    backgroundColor: 'rgba(248, 81, 73, 0.12)',
    border: '1px solid rgba(248, 81, 73, 0.35)',
    color: 'var(--danger)',
    fontFamily: 'var(--font-fa)',
    fontWeight: 600,
    fontSize: '12.5px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  presetPaletteRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    flexWrap: 'wrap',
    marginTop: '4px',
  },
  paletteLabel: {
    fontFamily: 'var(--font-fa)',
    fontSize: '12.5px',
    color: 'var(--muted)',
  },
  gradientPills: {
    display: 'flex',
    gap: '8px',
  },
  gradientCircleBtn: {
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    cursor: 'pointer',
    boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
    transition: 'all 0.2s ease',
  },
  formGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
    gap: '14px',
  },
  fieldGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  label: {
    fontFamily: 'var(--font-fa)',
    fontSize: '12px',
    fontWeight: 600,
    color: 'var(--muted)',
  },
  input: {
    backgroundColor: 'var(--panel2)',
    border: '1px solid var(--border)',
    borderRadius: '10px',
    padding: '9px 12px',
    color: 'var(--text)',
    fontFamily: 'var(--font-fa)',
    fontSize: '13px',
    outline: 'none',
  },
  slider: {
    accentColor: 'var(--accent)',
    cursor: 'pointer',
    marginTop: '6px',
  },
  saveActionRow: {
    display: 'flex',
    justifyContent: 'flex-end',
    marginTop: '6px',
  },
  saveBtn: {
    padding: '10px 22px',
    borderRadius: '11px',
    backgroundColor: 'var(--accent)',
    color: '#0a0f13',
    border: 'none',
    fontFamily: 'var(--font-fa)',
    fontWeight: 700,
    fontSize: '13px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '7px',
    boxShadow: '0 4px 14px rgba(34, 211, 238, 0.35)',
  },
  // مرحلهٔ ۳۱ — کارت‌هایِ شاخص و نمودارها
  metricGrid: {
    display: 'flex',
    gap: '12px',
    flexWrap: 'wrap',
  },
  metricCard: {
    backgroundColor: 'var(--panel2)',
    border: '1px solid var(--border)',
    borderRadius: '14px',
    padding: '14px 16px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '6px',
    minWidth: '150px',
    flex: '1 1 150px',
  },
  metricCardOverall: {
    borderColor: 'rgba(236, 72, 153, 0.55)',
    boxShadow: '0 0 0 1px rgba(236, 72, 153, 0.25)',
  },
  metricRingWrap: {
    position: 'relative',
    width: '64px',
    height: '64px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  metricRingVal: {
    position: 'absolute',
    fontFamily: 'var(--font-mono)',
    fontSize: '17px',
    fontWeight: 800,
    color: 'var(--text)',
    fontVariantNumeric: 'tabular-nums',
  },
  metricName: {
    fontFamily: 'var(--font-fa)',
    fontSize: '12.5px',
    fontWeight: 800,
    color: 'var(--text)',
    textAlign: 'center',
  },
  metricSkill: {
    fontFamily: 'var(--font-fa)',
    fontSize: '11.5px',
    fontWeight: 700,
    color: 'var(--accent)',
  },
  metricDesc: {
    fontFamily: 'var(--font-fa)',
    fontSize: '11px',
    color: 'var(--muted)',
    textAlign: 'center',
    fontVariantNumeric: 'tabular-nums',
  },
  chartToggleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  chartToggleLabel: {
    fontFamily: 'var(--font-fa)',
    fontSize: '12px',
    color: 'var(--muted)',
  },
  chartToggleBtn: {
    padding: '6px 14px',
    borderRadius: '999px',
    border: '1px solid var(--border)',
    backgroundColor: 'var(--panel2)',
    color: 'var(--text)',
    fontFamily: 'var(--font-fa)',
    fontSize: '12px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  chartToggleBtnActive: {
    backgroundColor: 'var(--accent)',
    color: '#0a0f13',
    borderColor: 'var(--accent)',
  },
  chartSvgWrap: {
    backgroundColor: 'var(--panel2)',
    border: '1px solid var(--border)',
    borderRadius: '12px',
    padding: '10px 8px 2px',
    overflow: 'hidden',
  },
  radarWrap: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '4px',
  },
};