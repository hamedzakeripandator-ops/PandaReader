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

// مرحلهٔ ۳۵ §۱: شاخص‌هایِ قابلِ انتخاب در آماربندیِ سفارشی + رنگ‌ها.
const CUSTOM_VIEW_METRICS = [
  { id: 'hours', label: 'مجموعِ ساعتِ مطالعه' },
  { id: 'pages', label: 'تعدادِ صفحاتِ خوانده‌شده' },
  { id: 'progress', label: 'درصدِ پیشرفتِ کلِ دسته' },
  { id: 'bookmarks', label: 'تعدادِ بوک‌مارک‌ها' },
  { id: 'highlights', label: 'تعدادِ هایلایت‌ها و یادداشت‌ها' },
  { id: 'speed', label: 'میانگینِ سرعتِ مطالعه' },
  { id: 'goal', label: 'هدفِ ساعتی/صفحه‌ای با نوارِ پیشرفت' },
];
const VIEW_COLORS = ['#22d3ee', '#a855f7', '#f59e0b', '#10b981', '#ec4899', '#f97316'];

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

// مرحلهٔ ۳۵ §۱: سریِ روند برای N روزِ اخیرِ تقویمی (محلی) با معیارِ
// قابلِ تغییر: دقیقهٔ مطالعه (پیش‌فرض)، صفحات، یا نشانه‌ها
// (بوک‌مارک‌هایِ دارایِ تاریخِ ساخت). کلیدهایِ دیتابیس، تاریخِ
// محلیِ YYYY-MM-DD هستند. value، مقدارِ همان معیار است و فیلدهایِ
// minutes/pages/marks هم برای سازگاری نگه داشته شده‌اند.
function buildTrendSeries(daysMap, n, metric, marksByDay) {
  const out = [];
  const today = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const entry = (daysMap && daysMap[key]) || {};
    const minutes = Math.round((Number(entry.seconds) || 0) / 60);
    const pages = Number(entry.pages) || 0;
    const marks = (marksByDay && marksByDay[key]) || 0;
    const speed = (Number(entry.seconds) || 0) > 0 ? pages / ((Number(entry.seconds) || 0) / 3600) : 0;
    const value = metric === 'pages' ? pages : (metric === 'marks' ? marks : (metric === 'speed' ? speed : minutes));
    out.push({ key, label: key.slice(5).replace('-', '/'), value, minutes, pages, marks, speed });
  }
  return out;
}

// مرحلهٔ ۳۵ §۱: نرمال‌سازیِ مسیرِ کتاب (همان قاعدهٔ ورکرِ دیتابیس:
// trim + همهٔ اسلش‌ها به بک‌اسلش + lowercase) تا کلیدِ byBook با
// کلیدِ لیستِ اخیر یکی شود.
function normalizeBookKeyLocal(p) {
  if (!p || typeof p !== 'string') return '';
  return p.trim().replace(/\//g, '\\').toLowerCase();
}

// مرحلهٔ ۳۵ §۱: کلیدِ تاریخِ محلی از رویِ timestamp (برایِ سریِ نشانه‌ها).
function localDateKeyFromTs(ts) {
  const d = new Date(Number(ts));
  if (!Number.isFinite(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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

export default function ProfileView() {
  const { profile, updateProfile, setProfileAvatar, initSettings } = useSettingsStore();
  const { library, libraryItems, recentItems, favorites } = useLibraryStore();
  const showToast = useAppStore((state) => state.showToast);
  const pendingStatViewAction = useAppStore((state) => state.pendingStatViewAction);
  const clearPendingStatViewAction = useAppStore((state) => state.clearPendingStatViewAction);
  const startStatsSelectionInRecent = useAppStore((state) => state.startStatsSelectionInRecent);

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
  // مرحلهٔ ۳۵ §۱: آمار به تفکیکِ کتاب + فیلترِ کتاب‌هایِ اخیر +
  // آماربندی‌هایِ سفارشی (مرحلهٔ ۳۶: فیلترِ پروفایل حذف شد؛ انتخاب در Recent است).
  const [byBookStats, setByBookStats] = useState({});
  const [annotationCounts, setAnnotationCounts] = useState({});
  const bookmarksByFile = useBookmarkStore((state) => state.bookmarksByFile);
  const [chartMetric, setChartMetric] = useState('minutes');
  const [hoverDayIndex, setHoverDayIndex] = useState(null);
  const [customStatViews, setCustomStatViews] = useState([]);
  const [activeStatTab, setActiveStatTab] = useState('all');
  const [viewEditor, setViewEditor] = useState(null);
  // مرحلهٔ ۳۵ §۱ (ترتیبِ مهم: پیش از aptitudeMetrics و totalReadPages
  // تعریف می‌شوند تا TDZ پیش نیاید): کتاب‌هایِ اخیرِ یکتا + روزهایِ
  // مؤثر + خلاصهٔ مؤثر.
  const recentBooks = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const it of (recentItems || [])) {
      if (!it) continue;
      const key = normalizeBookKeyLocal(it.path || it.filePath || '');
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({ ...it, bookKey: key });
    }
    return out;
  }, [recentItems]);
  const allRecentKeys = useMemo(() => recentBooks.map((b) => b.bookKey), [recentBooks]);
  // مرحلهٔ ۳۶ §۳: نوارِ انتخابِ کتاب از پروفایل حذف شد؛ انتخاب،
  // فقط در Recent انجام می‌شود. تبِ «آمارِ کل» = همهٔ روزهایِ دیتابیس.
  const effectiveDays = readingDays;
  const effectiveSummary = useMemo(() => (readingSummary === null ? null : computeReadingSummary(effectiveDays)), [readingSummary, effectiveDays]);
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
          if (isMounted && res && res.byBook) setByBookStats(res.byBook);
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
        try {
          if (isMounted && coreApi.dbAction) {
            const counts = await coreApi.dbAction({ action: 'GET_ANNOTATION_COUNTS', payload: {} });
            if (isMounted && counts && counts.type === 'done' && counts.counts) setAnnotationCounts(counts.counts);
          }
        } catch (_) {}
        try {
          let views = null;
          if (coreApi.dbAction) {
            const vres = await coreApi.dbAction({ action: 'GET_CUSTOM_STAT_VIEWS', payload: {} });
            if (vres && vres.type === 'done' && Array.isArray(vres.views)) views = vres.views;
          }
          if (views === null) {
            try {
              const raw = localStorage.getItem('comicReader.customStatViews.v1');
              if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) views = parsed;
              }
            } catch (_) {}
          }
          if (isMounted && Array.isArray(views)) setCustomStatViews(views);
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
  const totalReadPages = effectiveSummary ? effectiveSummary.totalPages : null;

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
    if (!effectiveSummary) return null;
    const totalSeconds = Number(effectiveSummary.totalSeconds) || 0;
    const totalPages = Number(effectiveSummary.totalPages) || 0;
    const totalDays = Math.max(1, Number(effectiveSummary.totalDays) || 0);
    const bestStreak = Number(effectiveSummary.bestStreak) || 0;
    const avgDailyMin = totalSeconds / totalDays / 60;
    const studyPresence = totalSeconds / Math.max(1, Number(totalAppSeconds) || 0);
    const focus = clampScore(0.6 * Math.min(100, (avgDailyMin / 60) * 100) + 0.4 * Math.min(1, studyPresence) * 100);
    const pagesPerHour = totalSeconds > 0 ? totalPages / (totalSeconds / 3600) : 0;
    const avgDailyPages = totalPages / totalDays;
    const velocity = clampScore(0.5 * Math.min(100, (pagesPerHour / 40) * 100) + 0.5 * Math.min(100, (avgDailyPages / 50) * 100));
    const markCount = (Number(totalBookmarkCount) || 0) + (annotationTotals ? Number(annotationTotals.totalItems) || 0 : 0);
    const density = markCount / totalDays;
    const analytical = clampScore(0.5 * Math.min(100, (density / 2) * 100) + 0.5 * Math.min(100, (markCount / 40) * 100));
    const stamina = clampScore(0.5 * Math.min(100, (bestStreak / 30) * 100) + 0.3 * Math.min(100, (Number(effectiveSummary.totalDays) || 0) / 90 * 100) + 0.2 * Math.min(100, (totalSeconds / 360000) * 100));
    const overall = clampScore(0.3 * focus + 0.25 * analytical + 0.2 * velocity + 0.25 * stamina);
    return [
      { id: 'focus', name: 'استعدادِ تمرکزِ عمیق', short: 'تمرکز', value: focus, color: '#00f2fe', desc: `میانگینِ ${Math.round(avgDailyMin)} دقیقه مطالعه در روز` },
      { id: 'analytical', name: 'استعدادِ تحلیل و پژوهشگری', short: 'تحلیل', value: analytical, color: '#7c3aed', desc: `${markCount} بوک‌مارک و حاشیه‌نویسی` },
      { id: 'velocity', name: 'چابکیِ پردازشِ بصری', short: 'سرعت', value: velocity, color: '#10b981', desc: `${Math.round(pagesPerHour)} صفحه در ساعت` },
      { id: 'stamina', name: 'استقامت و پیوستگیِ ذهنی', short: 'استقامت', value: stamina, color: '#f59e0b', desc: `بهترین رکورد: ${bestStreak} روزِ پیوسته` },
      { id: 'overall', name: 'امتیازِ جامعِ استعدادِ مطالعه', short: 'جامع', value: overall, color: '#ec4899', desc: `${finishedBooks} کتابِ تمام‌شده از ${totalComics} عنوان` },
    ];
  }, [effectiveSummary, totalAppSeconds, totalBookmarkCount, annotationTotals, finishedBooks, totalComics]);

  // نشانه‌هایِ هر روز برایِ معیارِ «یادداشت‌ها و بوک‌مارک‌ها» — فقط
  // بوک‌مارک‌هایِ دارایِ تاریخِ ساخت (حاشیه‌نویسی‌ها createdAt ندارند).
  const marksByDay = useMemo(() => {
    const out = {};
    const files = bookmarksByFile || {};
    for (const list of Object.values(files)) {
      if (!Array.isArray(list)) continue;
      for (const b of list) {
        const key = localDateKeyFromTs(b && b.createdAt);
        if (key) out[key] = (out[key] || 0) + 1;
      }
    }
    return out;
  }, [bookmarksByFile]);
  // تبِ فعالِ آماربندیِ سفارشی و روزهایِ آن (در تبِ «آمارِ کل»،
  // روزهایِ مؤثرِ فیلترِ کتاب‌ها استفاده می‌شوند).
  const activeView = activeStatTab === 'all' ? null : (customStatViews.find((v) => v.id === activeStatTab) || null);
  const viewBookKeys = activeView ? (activeView.bookKeys || []) : [];
  const viewDays = useMemo(() => {
    if (!activeView) return effectiveDays;
    const merged = {};
    for (const k of viewBookKeys) {
      const days = (byBookStats[k] && byBookStats[k].days) || {};
      for (const [date, e] of Object.entries(days)) {
        if (!merged[date]) merged[date] = { seconds: 0, pages: 0 };
        merged[date].seconds += Number(e.seconds) || 0;
        merged[date].pages += Number(e.pages) || 0;
      }
    }
    return merged;
  }, [activeView, viewBookKeys, byBookStats, effectiveDays]);
  const viewStats = useMemo(() => {
    if (!activeView) return null;
    let seconds = 0;
    let pages = 0;
    let totalBookPages = 0;
    let readBookPages = 0;
    for (const k of viewBookKeys) {
      const b = byBookStats[k] || {};
      seconds += Number(b.totalSeconds) || 0;
      pages += Number(b.totalPages) || 0;
      const book = recentBooks.find((rb) => rb.bookKey === k);
      const tp = Number(book?.totalPages) || 0;
      if (tp > 0) {
        totalBookPages += tp;
        readBookPages += Math.min(tp, Number(b.totalPages) || 0);
      }
    }
    let bookmarks = 0;
    for (const k of viewBookKeys) {
      const list = bookmarksByFile?.[k];
      if (Array.isArray(list)) bookmarks += list.length;
    }
    let highlights = 0;
    for (const k of viewBookKeys) highlights += Number(annotationCounts[k]) || 0;
    const hours = seconds / 3600;
    return {
      seconds,
      pages,
      hours,
      speed: hours > 0 ? pages / hours : 0,
      progress: totalBookPages > 0 ? Math.round((readBookPages / totalBookPages) * 100) : 0,
      bookmarks,
      highlights,
    };
  }, [activeView, viewBookKeys, byBookStats, recentBooks, bookmarksByFile, annotationCounts]);
  const chartDaysMap = activeView ? viewDays : effectiveDays;
  // مرحلهٔ ۳۵ §۱: دادهٔ نمودارِ روند — معیارِ قابلِ تغییر روی روزهایِ
  // نمودار (تبِ فعال). trendMax هرگز صفر نیست تا مختصاتِ SVG به
  // NaN نرسد؛ paddingِ بالا/پایین، بریده‌شدنِ دایره‌هایِ اوج را
  // مهار می‌کند (t:24 و b:32).
  const trendDays = useMemo(() => buildTrendSeries(chartDaysMap, chartDays, chartMetric, marksByDay), [chartDaysMap, chartDays, chartMetric, marksByDay]);
  const trendMax = Math.max(1, ...trendDays.map((d) => d.value));
  const chartW = 640;
  const chartH = 240;
  const chartPad = { l: 8, r: 8, t: 24, b: 32 };
  const chartPts = trendDays.map((d, i) => {
    const x = trendDays.length === 1
      ? chartW / 2
      : chartPad.l + (i / (trendDays.length - 1)) * (chartW - chartPad.l - chartPad.r);
    const y = chartPad.t + (1 - d.value / trendMax) * (chartH - chartPad.t - chartPad.b);
    return { x, y };
  });
  const chartLinePath = buildSmoothPath(chartPts);
  const chartAreaPath = chartPts.length > 0
    ? `${chartLinePath} L ${chartPts[chartPts.length - 1].x} ${chartH - chartPad.b} L ${chartPts[0].x} ${chartH - chartPad.b} Z`
    : '';

  // مرحلهٔ ۳۶ §۴: خطِ میانگینِ متحرکِ ۳ روزه روی نمودارِ روند.
  const trendMovingAvg = useMemo(() => trendDays.map((d, i) => {
    const win = trendDays.slice(Math.max(0, i - 2), i + 1);
    return win.reduce((s, x) => s + x.value, 0) / Math.max(1, win.length);
  }), [trendDays]);
  const trendAvgPts = trendMovingAvg.map((v, i) => {
    const x = trendDays.length === 1 ? chartW / 2 : chartPad.l + (i / (trendDays.length - 1)) * (chartW - chartPad.l - chartPad.r);
    const y = chartPad.t + (1 - v / trendMax) * (chartH - chartPad.t - chartPad.b);
    return { x, y };
  });
  const trendAvgPath = buildSmoothPath(trendAvgPts);

  // مرحلهٔ ۳۶ §۴: داده‌هایِ داشبوردِ چندنموداره برایِ تبِ فعال.
  const dashDays = chartDaysMap;
  const dashDow = useMemo(() => {
    const labels = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'];
    const order = [6, 0, 1, 2, 3, 4, 5];
    const sums = order.map(() => ({ seconds: 0, pages: 0 }));
    for (const [key, e] of Object.entries(dashDays || {})) {
      const d = new Date(`${key}T00:00:00`);
      if (Number.isNaN(d.getTime())) continue;
      const idx = order.indexOf(d.getDay());
      if (idx < 0) continue;
      sums[idx].seconds += Number(e.seconds) || 0;
      sums[idx].pages += Number(e.pages) || 0;
    }
    return sums.map((s, i) => ({ label: labels[i], minutes: Math.round(s.seconds / 60), pages: s.pages, seconds: s.seconds }));
  }, [dashDays]);
  const dashDowMax = Math.max(1, ...dashDow.map((d) => d.minutes));
  const dashBestDow = dashDow.reduce((best, cur) => (cur.minutes > (best ? best.minutes : 0) ? cur : best), null);
  const dashHeat = useMemo(() => {
    const out = [];
    const today = new Date();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const entry = (dashDays && dashDays[key]) || {};
      out.push({ key, label: key.slice(5).replace('-', '/'), minutes: Math.round((Number(entry.seconds) || 0) / 60) });
    }
    return out;
  }, [dashDays]);
  const dashDonut = useMemo(() => {
    const keys = activeView ? viewBookKeys : allRecentKeys;
    const entries = (keys || []).map((k) => {
      const b = byBookStats[k] || {};
      const book = recentBooks.find((rb) => rb.bookKey === k);
      return { key: k, name: book ? (book.name || book.fileName || k) : k, seconds: Number(b.totalSeconds) || 0, pages: Number(b.totalPages) || 0 };
    }).filter((e) => e.seconds > 0 || e.pages > 0);
    const totalSeconds = entries.reduce((s, e) => s + e.seconds, 0);
    const totalPages = entries.reduce((s, e) => s + e.pages, 0);
    const top = entries.sort((a, b) => b.seconds - a.seconds).slice(0, 6);
    const rest = entries.slice(6);
    const restSeconds = rest.reduce((s, e) => s + e.seconds, 0);
    const shown = restSeconds > 0 ? [...top, { key: '__rest__', name: 'سایر کتاب‌ها', seconds: restSeconds, pages: rest.reduce((s, e) => s + e.pages, 0) }] : top;
    const C = 2 * Math.PI * 70;
    let acc = 0;
    const slices = shown.map((e, i) => {
      const frac = totalSeconds > 0 ? e.seconds / totalSeconds : 0;
      const slice = { ...e, frac, pct: Math.round(frac * 100), color: VIEW_COLORS[i % VIEW_COLORS.length], dash: frac * C, offset: -acc * C };
      acc += frac;
      return slice;
    });
    return { entries: shown, slices, totalSeconds, totalPages, C };
  }, [activeView, viewBookKeys, allRecentKeys, byBookStats, recentBooks]);
  const dashFormatShare = useMemo(() => {
    const totals = { pdf: 0, epub: 0, comic: 0 };
    const keys = activeView ? viewBookKeys : allRecentKeys;
    for (const k of (keys || [])) {
      const book = recentBooks.find((rb) => rb.bookKey === k);
      const kind = book ? (book.type === 'pdf' ? 'pdf' : (book.type === 'epub' ? 'epub' : 'comic')) : 'comic';
      totals[kind] += Number((byBookStats[k] || {}).totalSeconds) || 0;
    }
    const total = totals.pdf + totals.epub + totals.comic;
    return { ...totals, total };
  }, [activeView, viewBookKeys, allRecentKeys, byBookStats, recentBooks]);
  const heatColorFor = (m) => (m <= 0 ? '#1f2937' : (m <= 15 ? '#164e63' : (m <= 45 ? '#0e7490' : (m <= 120 ? '#06b6d4' : '#22d3ee'))));
  const dashFactorBooks = activeView ? viewBookKeys.map((k) => recentBooks.find((rb) => rb.bookKey === k)).filter(Boolean) : recentBooks;
  const dashFactors = useMemo(() => {
    const daysArr = Object.values(dashDays || {});
    const totalSeconds = daysArr.reduce((s, e) => s + (Number(e.seconds) || 0), 0);
    const totalPages = daysArr.reduce((s, e) => s + (Number(e.pages) || 0), 0);
    const activeDayCount = daysArr.filter((e) => (Number(e.seconds) || 0) > 0 || (Number(e.pages) || 0) > 0).length;
    const hours = totalSeconds / 3600;
    const speed = hours > 0 ? totalPages / hours : 0;
    const minutesPerPage = totalPages > 0 ? (totalSeconds / 60) / totalPages : 0;
    let remaining = 0;
    let finished = 0;
    let inProgress = 0;
    let weightedRead = 0;
    let weightedTotal = 0;
    for (const b of dashFactorBooks) {
      const tp = Number(b.totalPages) || 0;
      const lp = Number(b.lastPage || b.currentPage) || 0;
      if (tp > 0) {
        weightedTotal += tp;
        weightedRead += Math.min(tp, lp);
        remaining += Math.max(0, tp - lp);
        if (lp >= tp) finished += 1; else inProgress += 1;
      }
    }
    const progress = weightedTotal > 0 ? Math.round((weightedRead / weightedTotal) * 100) : 0;
    const etaHours = speed > 0 ? remaining / speed : 0;
    let marks = 0;
    if (activeView) {
      for (const k of viewBookKeys) marks += (bookmarksByFile && bookmarksByFile[k] ? bookmarksByFile[k].length : 0) + (Number(annotationCounts[k]) || 0);
    } else {
      marks = (Number(totalBookmarkCount) || 0) + (annotationTotals ? Number(annotationTotals.totalItems) || 0 : 0);
    }
    const density = totalPages > 0 ? (marks / totalPages) * 100 : 0;
    let longestMinutes = 0;
    let longestLabel = '—';
    for (const [key, e] of Object.entries(dashDays || {})) {
      const m = Math.round((Number(e.seconds) || 0) / 60);
      if (m > longestMinutes) { longestMinutes = m; longestLabel = key.slice(5).replace('-', '/'); }
    }
    const avgMinutesPerActiveDay = activeDayCount > 0 ? (totalSeconds / 60) / activeDayCount : 0;
    const globalReadingSeconds = Object.values(readingDays || {}).reduce((s, e) => s + (Number(e.seconds) || 0), 0);
    const focusPurity = totalAppSeconds > 0 ? Math.round((globalReadingSeconds / totalAppSeconds) * 100) : null;
    return {
      totalSeconds, totalPages, speed, minutesPerPage, remaining, finished, inProgress,
      progress, etaHours, marks, density, longestMinutes, longestLabel,
      avgMinutesPerActiveDay, activeDayCount, focusPurity,
      focusLevel: focusPurity === null ? '—' : (focusPurity >= 70 ? 'تمرکزِ بالا' : (focusPurity >= 40 ? 'تمرکزِ متوسط' : 'تمرکزِ پراکنده')),
      densityStyle: density >= 20 ? 'مطالعهٔ عمیقِ پژوهشی' : (density >= 8 ? 'مطالعهٔ فعال' : 'مرورِ سریع'),
    };
  }, [dashDays, dashFactorBooks, activeView, viewBookKeys, bookmarksByFile, annotationCounts, totalBookmarkCount, annotationTotals, totalAppSeconds, readingDays]);


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

  const fieldStyle = {
    width: '100%',
    boxSizing: 'border-box',
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    color: 'var(--text)',
    padding: '7px 10px',
    fontFamily: 'inherit',
    fontSize: 13,
  };
  const handleSaveCustomView = () => {
    const name = (viewEditor?.name || '').trim();
    if (!name) {
      showToast('نامِ آماربندی نمی‌تواند خالی باشد', { type: 'warning' });
      return;
    }
    const view = {
      id: viewEditor.id || `cv-${Date.now()}`,
      name,
      color: viewEditor.color || '#22d3ee',
      bookKeys: viewEditor.bookKeys || [],
      metrics: (viewEditor.metrics || []).length ? viewEditor.metrics : ['hours', 'pages'],
      goalHours: Number(viewEditor.goalHours) || 0,
      goalPages: Number(viewEditor.goalPages) || 0,
    };
    const next = viewEditor.id
      ? customStatViews.map((v) => (v.id === view.id ? view : v))
      : [...customStatViews, view];
    setCustomStatViews(next);
    try { localStorage.setItem('comicReader.customStatViews.v1', JSON.stringify(next)); } catch (_) {}
    if (coreApi.dbAction) coreApi.dbAction({ action: 'SAVE_CUSTOM_STAT_VIEWS', payload: { views: next } }).catch(() => {});
    setActiveStatTab(view.id);
    setViewEditor(null);
    showToast('آماربندیِ سفارشی ذخیره شد', { type: 'success' });
  };
  const handleDeleteCustomView = (id) => {
    const next = customStatViews.filter((v) => v.id !== id);
    setCustomStatViews(next);
    try { localStorage.setItem('comicReader.customStatViews.v1', JSON.stringify(next)); } catch (_) {}
    if (coreApi.dbAction) coreApi.dbAction({ action: 'SAVE_CUSTOM_STAT_VIEWS', payload: { views: next } }).catch(() => {});
    if (activeStatTab === id) setActiveStatTab('all');
    showToast('آماربندی حذف شد', { type: 'info' });
  };

  // مرحلهٔ ۳۶ §۳: مصرفِ اقدامِ معلقِ Recent — فعال‌سازیِ تب یا باز کردنِ
  // پنجرهٔ نهایی‌سازی با کتاب‌هایِ انتخاب‌شده؛ فقط یک بار مصرف می‌شود.
  useEffect(() => {
    if (!pendingStatViewAction) return;
    if (pendingStatViewAction.type === 'activate') {
      try {
        const raw = localStorage.getItem('comicReader.customStatViews.v1');
        const list = raw ? JSON.parse(raw) : [];
        if (Array.isArray(list)) setCustomStatViews(list);
      } catch (_) {}
      setActiveStatTab(pendingStatViewAction.viewId);
      if (typeof clearPendingStatViewAction === 'function') clearPendingStatViewAction();
      return;
    }
    if (pendingStatViewAction.type === 'edit') {
      const paths = pendingStatViewAction.paths || [];
      const bookKeys = paths.map((p) => normalizeBookKeyLocal(p)).filter(Boolean);
      let base = pendingStatViewAction.id ? (customStatViews.find((v) => v.id === pendingStatViewAction.id) || null) : null;
      if (!base && pendingStatViewAction.id) {
        try {
          const raw = localStorage.getItem('comicReader.customStatViews.v1');
          const list = raw ? JSON.parse(raw) : [];
          if (Array.isArray(list)) base = list.find((v) => v.id === pendingStatViewAction.id) || null;
        } catch (_) {}
      }
      setViewEditor({
        id: base ? base.id : null,
        name: base ? base.name : '',
        color: base ? base.color : '#22d3ee',
        bookKeys,
        metrics: base && Array.isArray(base.metrics) && base.metrics.length ? [...base.metrics] : ['hours', 'pages'],
        goalHours: base ? (Number(base.goalHours) || 0) : 0,
        goalPages: base ? (Number(base.goalPages) || 0) : 0,
      });
      if (typeof clearPendingStatViewAction === 'function') clearPendingStatViewAction();
    }
  }, [pendingStatViewAction, customStatViews, clearPendingStatViewAction]);

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
            <strong style={styles.statVal}>{effectiveSummary ? `${effectiveSummary.currentStreak} روز` : '—'}</strong>
            <span style={styles.statLbl}>رکورد پیوستگی جاری</span>
          </div>
          <div style={styles.statBox}>
            <strong style={styles.statVal}>{effectiveSummary ? formatReadingHours(effectiveSummary.totalSeconds) : '—'}</strong>
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

        {effectiveSummary ? (
          <>
            <div style={styles.statsSummaryGrid}>
              <div style={styles.statBox}>
                <strong style={styles.statVal}>{effectiveSummary.currentStreak} روز</strong>
                <span style={styles.statLbl}>رکورد پیوستگی جاری</span>
              </div>
              <div style={styles.statBox}>
                <strong style={styles.statVal}>{effectiveSummary.bestStreak} روز</strong>
                <span style={styles.statLbl}>بهترین رکورد پیوستگی</span>
              </div>
              <div style={styles.statBox}>
                <strong style={styles.statVal}>{effectiveSummary.totalPages}</strong>
                <span style={styles.statLbl}>کل صفحات خوانده‌شده</span>
              </div>
              <div style={styles.statBox}>
                <strong style={styles.statVal}>{formatReadingHours(effectiveSummary.totalSeconds)}</strong>
                <span style={styles.statLbl}>کل زمان مطالعه</span>
              </div>
              <div style={styles.statBox}>
                <strong style={styles.statVal}>{effectiveSummary.totalDays} روز</strong>
                <span style={styles.statLbl}>روزهای فعال</span>
              </div>
            </div>

            <div style={styles.goalRow}>
              <div style={styles.labelWithVal}>
                <span style={styles.goalLabel}>هدف امروز: {effectiveSummary.todayPages} از {Number(dailyGoal) || 50} صفحه</span>
                <span style={styles.valBadge}>
                  {Math.min(100, Math.round((effectiveSummary.todayPages / Math.max(1, Number(dailyGoal) || 50)) * 100))}%
                </span>
              </div>
              <div style={styles.goalBarTrack}>
                <div
                  style={{
                    ...styles.goalBarFill,
                    width: `${Math.min(100, Math.round((effectiveSummary.todayPages / Math.max(1, Number(dailyGoal) || 50)) * 100))}%`,
                  }}
                />
              </div>
            </div>

            <div style={styles.chartRow}>
              {effectiveSummary.last7.map((day) => {
                const maxPages = Math.max(1, ...effectiveSummary.last7.map((d) => d.pages));
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ position: 'relative', width: 56, height: 56, flexShrink: 0 }}>
                      <svg width="56" height="56" viewBox="0 0 56 56">
                        <circle cx="28" cy="28" r="22" fill="none" stroke="var(--border)" strokeWidth="6" />
                        <circle
                          cx="28" cy="28" r="22" fill="none"
                          stroke={m.color} strokeWidth="6" strokeLinecap="round"
                          pathLength={1}
                          strokeDasharray={1}
                          strokeDashoffset={isChartAnimated ? 1 - m.value / 100 : 1}
                          transform="rotate(-90 28 28)"
                          style={{ transition: 'stroke-dashoffset 0.9s cubic-bezier(0.16, 1, 0.3, 1)' }}
                        />
                      </svg>
                      <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700 }}>{m.value}</span>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <strong style={styles.metricName}>{m.name}</strong>
                      <span style={styles.metricSkill}>سطحِ استعداد: {skillLabelFor(m.value)}</span>
                    </div>
                  </div>
                  <div style={{ height: 8, borderRadius: 99, background: 'rgba(255,255,255,0.08)', overflow: 'hidden', marginTop: 10 }}>
                    <div style={{ height: '100%', width: isChartAnimated ? `${m.value}%` : '0%', background: m.color, borderRadius: 99, transition: 'width 0.9s cubic-bezier(0.16, 1, 0.3, 1)' }} />
                  </div>
                  <span style={styles.metricDesc}>{m.desc}</span>
                </div>
              ))}
            </div>
            {effectiveSummary && effectiveSummary.totalDays === 0 && effectiveSummary.totalPages === 0 && effectiveSummary.totalSeconds === 0 && (
              <p style={styles.sectionDesc}>هنوز دادهٔ کافی ثبت نشده است؛ با مطالعهٔ بیشتر، این شاخص‌ها شکل می‌گیرند.</p>
            )}
          </>
        ) : (
          <p style={styles.sectionDesc}>در حال بارگذاریِ آمار…</p>
        )}
      </div>

      {/* مرحلهٔ ۳۵ §۱: نمودارِ مساحتیِ هموار + تب‌های آماربندیِ سفارشی */}
      <div style={styles.sectionCard}>
        <div style={styles.sectionHeaderRow}>
          <span style={{ color: 'var(--accent)', display: 'flex' }}>
            <Icons.Eye size={18} />
          </span>
          <h4 style={styles.sectionTitle}>نمودارِ گرافیکیِ عملکرد و استعداد</h4>
        </div>
        <p style={styles.sectionDesc}>
          نمودارِ مساحتیِ هموار با گرادیانِ نئونی (فیروزه‌ای به بنفش) روی پس‌زمینهٔ تیره، با نقطه‌هایِ تعاملی و کارتِ شناورِ اطلاعات. ستون‌هایِ قدیمی و رادارِ پنج‌ضلعیِ مرحلهٔ ۳۱ حذف شده‌اند تا نمودار خلوت و خوانا باشد.
        </p>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
          <button type="button" onClick={() => setActiveStatTab('all')} style={activeStatTab === 'all' ? { ...styles.chartToggleBtn, ...styles.chartToggleBtnActive } : styles.chartToggleBtn}>آمارِ کل</button>
          {customStatViews.map((v) => (
            <button key={v.id} type="button" onClick={() => setActiveStatTab(v.id)} style={activeStatTab === v.id ? { ...styles.chartToggleBtn, ...styles.chartToggleBtnActive, borderColor: v.color } : styles.chartToggleBtn}>{v.name}</button>
          ))}
          <button type="button" onClick={() => { if (typeof startStatsSelectionInRecent === 'function') startStatsSelectionInRecent([], null, 'profile'); }} style={styles.chartToggleBtn}>+ ساخت آماربندی جدید</button>
        </div>
        {activeView && (
          <p style={styles.sectionDesc}>
            نمودار و کارت‌هایِ زیر، فقط برای آماربندیِ «{activeView.name}» حساب شده‌اند.
            <button type="button" onClick={() => setViewEditor({ id: activeView.id, name: activeView.name, color: activeView.color, bookKeys: [...(activeView.bookKeys || [])], metrics: [...(activeView.metrics || [])], goalHours: activeView.goalHours || 0, goalPages: activeView.goalPages || 0 })} style={{ ...styles.chartToggleBtn, marginRight: 8 }}>ویرایش</button>
            <button type="button" onClick={() => { const paths = (activeView.bookKeys || []).map((k) => { const b = recentBooks.find((rb) => rb.bookKey === k); return b ? (b.path || b.filePath || '') : ''; }).filter(Boolean); if (typeof startStatsSelectionInRecent === 'function') startStatsSelectionInRecent(paths, activeView.id, 'profile'); }} style={{ ...styles.chartToggleBtn, marginRight: 4 }}>تغییر کتاب‌های این آماربندی</button>
            <button type="button" onClick={() => handleDeleteCustomView(activeView.id)} style={{ ...styles.chartToggleBtn, marginRight: 4 }}>حذف</button>
          </p>
        )}
        <div style={styles.chartToggleRow}>
          <span style={styles.chartToggleLabel}>معیارِ نمودار:</span>
          <button type="button" onClick={() => setChartMetric('minutes')} style={chartMetric === 'minutes' ? { ...styles.chartToggleBtn, ...styles.chartToggleBtnActive } : styles.chartToggleBtn}>زمان مطالعه</button>
          <button type="button" onClick={() => setChartMetric('pages')} style={chartMetric === 'pages' ? { ...styles.chartToggleBtn, ...styles.chartToggleBtnActive } : styles.chartToggleBtn}>صفحات خوانده‌شده</button>
          <button type="button" onClick={() => setChartMetric('marks')} style={chartMetric === 'marks' ? { ...styles.chartToggleBtn, ...styles.chartToggleBtnActive } : styles.chartToggleBtn}>یادداشت‌ها و بوک‌مارک‌ها</button>
          <button type="button" onClick={() => setChartMetric('speed')} style={chartMetric === 'speed' ? { ...styles.chartToggleBtn, ...styles.chartToggleBtnActive } : styles.chartToggleBtn}>سرعت مطالعه (صفحه بر ساعت)</button>
          <span style={{ ...styles.chartToggleLabel, marginRight: 12 }}>بازه:</span>
          <button type="button" onClick={() => setChartDays(7)} style={chartDays === 7 ? { ...styles.chartToggleBtn, ...styles.chartToggleBtnActive } : styles.chartToggleBtn}>۷ روز</button>
          <button type="button" onClick={() => setChartDays(14)} style={chartDays === 14 ? { ...styles.chartToggleBtn, ...styles.chartToggleBtnActive } : styles.chartToggleBtn}>۱۴ روز</button>
          <button type="button" onClick={() => setChartDays(30)} style={chartDays === 30 ? { ...styles.chartToggleBtn, ...styles.chartToggleBtnActive } : styles.chartToggleBtn}>۳۰ روز</button>
          <button type="button" onClick={() => setChartDays(90)} style={chartDays === 90 ? { ...styles.chartToggleBtn, ...styles.chartToggleBtnActive } : styles.chartToggleBtn}>۹۰ روز</button>
        </div>
        <div style={{ background: '#0d131a', borderRadius: 14, padding: 12, border: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ ...styles.chartSvgWrap, position: 'relative' }}>
            <svg
              width="100%"
              viewBox={`0 0 ${chartW} ${chartH}`}
              role="img"
              aria-label="روندِ مطالعه"
              onMouseMove={(e) => {
                try {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const fx = (e.clientX - rect.left) / Math.max(1, rect.width);
                  const idx = Math.round(fx * (trendDays.length - 1));
                  setHoverDayIndex(Math.max(0, Math.min(trendDays.length - 1, idx)));
                } catch (_) {}
              }}
              onMouseLeave={() => setHoverDayIndex(null)}
            >
              <defs>
                <linearGradient id="trendAreaGrad35" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.45" />
                  <stop offset="100%" stopColor="#a855f7" stopOpacity="0.02" />
                </linearGradient>
                <linearGradient id="trendLineGrad35" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#22d3ee" />
                  <stop offset="100%" stopColor="#a855f7" />
                </linearGradient>
              </defs>
              {[0.25, 0.5, 0.75, 1].map((f) => (
                <line key={f} x1={chartPad.l} x2={chartW - chartPad.r} y1={chartPad.t + (1 - f) * (chartH - chartPad.t - chartPad.b)} y2={chartPad.t + (1 - f) * (chartH - chartPad.t - chartPad.b)} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
              ))}
              {chartAreaPath && (
                <path d={chartAreaPath} fill="url(#trendAreaGrad35)" opacity={isChartAnimated ? 1 : 0} style={{ transition: 'opacity 0.9s cubic-bezier(0.16, 1, 0.3, 1)' }} />
              )}
              {chartLinePath && (
                <path d={chartLinePath} fill="none" stroke="url(#trendLineGrad35)" strokeWidth="2.5" strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={isChartAnimated ? 0 : 1} style={{ transition: 'stroke-dashoffset 0.9s cubic-bezier(0.16, 1, 0.3, 1)' }} />
              )}
              {trendAvgPath && (
                <path d={trendAvgPath} fill="none" stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="5 4" strokeLinecap="round" opacity={0.9} />
              )}
              {trendDays.map((d, i) => (
                <g key={`dot-${d.key}`}>
                  <circle cx={chartPts[i] ? chartPts[i].x : 0} cy={chartPts[i] ? chartPts[i].y : 0} r={isChartAnimated ? 4.5 : 0} fill="#22d3ee" stroke="#0d131a" strokeWidth="1.5" style={{ filter: 'drop-shadow(0 0 4px rgba(0, 242, 254, 0.8))', transition: 'r 0.9s cubic-bezier(0.16, 1, 0.3, 1)' }}>
                    <title>{`${d.label}: ${d.value} ${chartMetric === 'minutes' ? 'دقیقه' : (chartMetric === 'pages' ? 'صفحه' : (chartMetric === 'speed' ? 'صفحه در ساعت' : 'نشانه'))}`}</title>
                  </circle>
                  <text x={chartPts[i] ? chartPts[i].x : 0} y={chartH - 8} textAnchor="middle" fontSize="10" fill="var(--muted)">{d.label}</text>
                </g>
              ))}
              {hoverDayIndex !== null && chartPts[hoverDayIndex] && (
                <line x1={chartPts[hoverDayIndex].x} x2={chartPts[hoverDayIndex].x} y1={chartPad.t} y2={chartH - chartPad.b} stroke="rgba(255,255,255,0.25)" strokeWidth="1" strokeDasharray="3 3" />
              )}
            </svg>
            {hoverDayIndex !== null && trendDays[hoverDayIndex] && chartPts[hoverDayIndex] && (
              <div style={{ position: 'absolute', left: `${(chartPts[hoverDayIndex].x / chartW) * 100}%`, top: `${(chartPts[hoverDayIndex].y / chartH) * 100}%`, transform: 'translate(-50%, -130%)', background: 'rgba(13,19,26,0.95)', border: '1px solid rgba(34,211,238,0.4)', borderRadius: 10, padding: '6px 10px', fontSize: 12, color: '#fff', whiteSpace: 'nowrap', pointerEvents: 'none', zIndex: 3 }}>
                {trendDays[hoverDayIndex].label} · {trendDays[hoverDayIndex].value} {chartMetric === 'minutes' ? 'دقیقه مطالعه' : (chartMetric === 'pages' ? 'صفحه' : (chartMetric === 'speed' ? 'صفحه در ساعت' : 'یادداشت و بوک‌مارک'))}
              </div>
            )}
          </div>
        </div>
        <p style={styles.sectionDesc}>یادداشت‌ها و بوک‌مارک‌ها در نمودار، فقط بوک‌مارک‌هایِ دارایِ تاریخِ ساخت هستند؛ حاشیه‌نویسی‌ها تاریخِ ساخت ندارند و در این معیار شمرده نمی‌شوند.</p>
        {activeView && viewStats && (
          <div style={styles.statsSummaryGrid}>
            {(activeView.metrics || []).includes('hours') && (
              <div style={styles.statBox}>
                <strong style={styles.statVal}>{viewStats.hours.toFixed(1)} ساعت</strong>
                <span style={styles.statLbl}>مجموعِ ساعتِ مطالعه</span>
              </div>
            )}
            {(activeView.metrics || []).includes('pages') && (
              <div style={styles.statBox}>
                <strong style={styles.statVal}>{viewStats.pages}</strong>
                <span style={styles.statLbl}>صفحاتِ خوانده‌شده</span>
              </div>
            )}
            {(activeView.metrics || []).includes('progress') && (
              <div style={styles.statBox}>
                <strong style={styles.statVal}>{viewStats.progress}٪</strong>
                <span style={styles.statLbl}>پیشرفتِ کلِ دسته</span>
              </div>
            )}
            {(activeView.metrics || []).includes('bookmarks') && (
              <div style={styles.statBox}>
                <strong style={styles.statVal}>{viewStats.bookmarks}</strong>
                <span style={styles.statLbl}>بوک‌مارک‌ها</span>
              </div>
            )}
            {(activeView.metrics || []).includes('highlights') && (
              <div style={styles.statBox}>
                <strong style={styles.statVal}>{viewStats.highlights}</strong>
                <span style={styles.statLbl}>هایلایت‌ها و یادداشت‌ها</span>
              </div>
            )}
            {(activeView.metrics || []).includes('speed') && (
              <div style={styles.statBox}>
                <strong style={styles.statVal}>{Math.round(viewStats.speed)} صفحه در ساعت</strong>
                <span style={styles.statLbl}>میانگینِ سرعتِ مطالعه</span>
              </div>
            )}
            {(activeView.metrics || []).includes('goal') && (
              <div style={styles.statBox}>
                <strong style={styles.statVal}>
                  {activeView.goalHours > 0 ? `${Math.min(100, Math.round((viewStats.hours / activeView.goalHours) * 100))}٪ از هدفِ ساعتی` : (activeView.goalPages > 0 ? `${Math.min(100, Math.round((viewStats.pages / activeView.goalPages) * 100))}٪ از هدفِ صفحه‌ای` : 'هدفی تعیین نشده است')}
                </strong>
                <span style={styles.statLbl}>هدفِ دلخواه</span>
                {activeView.goalHours > 0 && (
                  <div style={styles.goalBarTrack}>
                    <div style={{ ...styles.goalBarFill, width: `${Math.min(100, (viewStats.hours / activeView.goalHours) * 100)}%` }} />
                  </div>
                )}
                {activeView.goalPages > 0 && (
                  <div style={styles.goalBarTrack}>
                    <div style={{ ...styles.goalBarFill, width: `${Math.min(100, (viewStats.pages / activeView.goalPages) * 100)}%` }} />
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        {viewEditor && (
          <div style={{ marginTop: 14, padding: 12, borderRadius: 12, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)' }}>
            <h5 style={{ margin: '0 0 10px', fontSize: 14 }}>{viewEditor.id ? 'ویرایشِ آماربندی' : 'ساختِ آماربندی جدید'}</h5>
            <input type="text" value={viewEditor.name} onChange={(e) => setViewEditor({ ...viewEditor, name: e.target.value })} placeholder="نامِ آماربندی (مثلاً مطالعهٔ آناتومی)" style={fieldStyle} />
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '10px 0', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>رنگ:</span>
              {VIEW_COLORS.map((c) => (
                <button key={c} type="button" onClick={() => setViewEditor({ ...viewEditor, color: c })} title={c} style={{ width: 26, height: 26, borderRadius: '50%', background: c, border: viewEditor.color === c ? '2px solid #fff' : '2px solid transparent', cursor: 'pointer', padding: 0 }} />
              ))}
            </div>
            <p style={styles.sectionDesc}>کتاب‌هایِ عضوِ این دسته (انتخاب، فقط از Recent انجام می‌شود):</p>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
              {(viewEditor.bookKeys || []).map((k) => {
                const b = recentBooks.find((rb) => rb.bookKey === k);
                return (<span key={k} style={{ fontSize: 12, padding: '4px 10px', borderRadius: 99, background: 'rgba(34,211,238,0.12)', color: 'var(--text)', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b ? (b.name || b.fileName || k) : k}</span>);
              })}
              {(viewEditor.bookKeys || []).length === 0 && (<span style={styles.sectionDesc}>هیچ کتابی انتخاب نشده است؛ از دکمهٔ «تغییر کتاب‌های این آماربندی» در Recent انتخاب کن.</span>)}
            </div>
            <p style={styles.sectionDesc}>شاخص‌هایی که می‌خواهی ببینی:</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
              {CUSTOM_VIEW_METRICS.map((m) => (
                <label key={m.id} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, cursor: 'pointer', padding: '5px 9px', borderRadius: 99, background: viewEditor.metrics.includes(m.id) ? 'rgba(34,211,238,0.15)' : 'rgba(255,255,255,0.05)' }}>
                  <input type="checkbox" checked={viewEditor.metrics.includes(m.id)} onChange={() => setViewEditor({ ...viewEditor, metrics: viewEditor.metrics.includes(m.id) ? viewEditor.metrics.filter((x) => x !== m.id) : [...viewEditor.metrics, m.id] })} style={{ accentColor: '#22d3ee', cursor: 'pointer' }} />
                  {m.label}
                </label>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
              <label style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', gap: 6, alignItems: 'center' }}>
                هدفِ ساعتی:
                <input type="number" min={0} value={viewEditor.goalHours} onChange={(e) => setViewEditor({ ...viewEditor, goalHours: Number(e.target.value) || 0 })} style={{ ...fieldStyle, width: 90 }} />
              </label>
              <label style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', gap: 6, alignItems: 'center' }}>
                هدفِ صفحه‌ای:
                <input type="number" min={0} value={viewEditor.goalPages} onChange={(e) => setViewEditor({ ...viewEditor, goalPages: Number(e.target.value) || 0 })} style={{ ...fieldStyle, width: 90 }} />
              </label>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={handleSaveCustomView} style={{ ...styles.chartToggleBtn, ...styles.chartToggleBtnActive }}>ذخیرهٔ آماربندی</button>
              <button type="button" onClick={() => setViewEditor(null)} style={styles.chartToggleBtn}>انصراف</button>
            </div>
          </div>
        )}
      </div>

      {/* مرحلهٔ ۳۶ §۴: داشبوردِ چندنموداره و فاکتورهایِ خودشناسی برایِ تبِ فعال */}
      <div style={styles.sectionCard}>
        <div style={styles.sectionHeaderRow}>
          <span style={{ color: 'var(--accent)', display: 'flex' }}>
            <Icons.Eye size={18} />
          </span>
          <h4 style={styles.sectionTitle}>داشبوردِ تحلیلیِ چندنموداره و خودشناسی</h4>
        </div>
        <p style={styles.sectionDesc}>
          {activeView ? `برایِ آماربندیِ «${activeView.name}»` : 'برایِ آمارِ کل'} — نمودارهایِ ۲ تا ۴ و فاکتورهایِ ۱ تا ۵ در همین بخش‌اند؛ فاکتورِ ۶ (۵ شاخصِ استعداد) در بخشِ شاخص‌هایِ استعدادِ همین صفحه حفظ شده است.
        </p>
        <h5 style={{ margin: '14px 0 8px', fontSize: 14 }}>نمودارِ ۲ — عملکرد در روزهایِ هفته</h5>
        {dashBestDow && dashBestDow.minutes > 0 && (
          <p style={styles.sectionDesc}>پربازده‌ترین روزِ هفتهٔ شما: {dashBestDow.label} ({dashBestDow.minutes} دقیقه، {dashBestDow.pages} صفحه)</p>
        )}
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', background: '#0d131a', borderRadius: 14, padding: '14px 12px', border: '1px solid rgba(255,255,255,0.06)' }}>
          {dashDow.map((d) => (
            <div key={d.label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 11, color: 'var(--text)' }}>{d.minutes} د</span>
              <div style={{ width: '100%', maxWidth: 44, height: 120, display: 'flex', alignItems: 'flex-end' }}>
                <div style={{ width: '100%', height: `${Math.max(2, Math.round((d.minutes / dashDowMax) * 120))}px`, borderRadius: '6px 6px 2px 2px', background: dashBestDow && d.label === dashBestDow.label && d.minutes > 0 ? '#ec4899' : '#22d3ee' }} />
              </div>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>{d.label}</span>
            </div>
          ))}
        </div>
        <h5 style={{ margin: '18px 0 8px', fontSize: 14 }}>نمودارِ ۳ — سهمِ کتاب‌ها از زمانِ مطالعه</h5>
        {dashDonut.totalSeconds > 0 ? (
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', background: '#0d131a', borderRadius: 14, padding: 14, border: '1px solid rgba(255,255,255,0.06)' }}>
            <svg width="180" height="180" viewBox="0 0 180 180" role="img" aria-label="سهم کتاب‌ها">
              {dashDonut.slices.map((s) => (
                <circle key={s.key} cx="90" cy="90" r="70" fill="none" stroke={s.color} strokeWidth="26" strokeDasharray={`${s.dash} ${Math.max(0, dashDonut.C - s.dash)}`} strokeDashoffset={s.offset} transform="rotate(-90 90 90)">
                  <title>{`${s.name}: ${s.pct}٪`}</title>
                </circle>
              ))}
            </svg>
            <div style={{ flex: 1, minWidth: 200, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {dashDonut.slices.map((s) => (
                <div key={s.key} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12 }}>
                  <span style={{ width: 12, height: 12, borderRadius: 3, background: s.color, flexShrink: 0 }} />
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text)' }}>{s.name}</span>
                  <span style={{ color: 'var(--muted)' }}>{s.pct}٪</span>
                </div>
              ))}
              <p style={{ fontSize: 11, color: 'var(--muted)', margin: '6px 0 0' }}>
                سهمِ فرمت‌ها از زمان: PDF {dashFormatShare.total > 0 ? Math.round((dashFormatShare.pdf / dashFormatShare.total) * 100) : 0}٪ · EPUB {dashFormatShare.total > 0 ? Math.round((dashFormatShare.epub / dashFormatShare.total) * 100) : 0}٪ · کمیک {dashFormatShare.total > 0 ? Math.round((dashFormatShare.comic / dashFormatShare.total) * 100) : 0}٪
              </p>
            </div>
          </div>
        ) : (
          <p style={styles.sectionDesc}>هنوز زمانِ ثبت‌شده‌ای برایِ کتاب‌هایِ این تب وجود ندارد؛ پس از چند نشستِ مطالعه، دونات این‌جا پر می‌شود.</p>
        )}
        <h5 style={{ margin: '18px 0 8px', fontSize: 14 }}>نمودارِ ۴ — نقشهٔ حرارتیِ پیوستگیِ ۳۰ روزه</h5>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', background: '#0d131a', borderRadius: 14, padding: 14, border: '1px solid rgba(255,255,255,0.06)' }}>
          {dashHeat.map((d) => (
            <div key={d.key} title={`${d.label}: ${d.minutes} دقیقه`} style={{ width: 18, height: 18, borderRadius: 4, background: heatColorFor(d.minutes) }} />
          ))}
        </div>
        <p style={{ fontSize: 11, color: 'var(--muted)', margin: '6px 0 0' }}>از خاکستریِ تیره (۰ دقیقه) تا فیروزه‌ایِ درخشان (بیش از ۱۲۰ دقیقه در روز).</p>
        <h5 style={{ margin: '18px 0 8px', fontSize: 14 }}>فاکتورهایِ خودشناسی (۱ تا ۵)</h5>
        <div style={styles.statsSummaryGrid}>
          <div style={styles.statBox}>
            <strong style={styles.statVal}>{dashFactors.focusPurity === null ? '—' : `${dashFactors.focusPurity}٪`}</strong>
            <span style={styles.statLbl}>ضریبِ تمرکزِ خالص (سراسریِ برنامه) — {dashFactors.focusLevel}</span>
          </div>
          <div style={styles.statBox}>
            <strong style={styles.statVal}>{Math.round(dashFactors.speed)} صفحه در ساعت</strong>
            <span style={styles.statLbl}>سرعتِ واقعی · {dashFactors.minutesPerPage.toFixed(1)} دقیقه به ازایِ هر صفحه · {dashFactors.remaining} صفحهٔ باقیمانده · تخمینِ اتمام: {dashFactors.speed > 0 ? `${dashFactors.etaHours.toFixed(1)} ساعت` : '—'}</span>
          </div>
          <div style={styles.statBox}>
            <strong style={styles.statVal}>{dashFactors.density.toFixed(1)} در هر ۱۰۰ صفحه</strong>
            <span style={styles.statLbl}>عمقِ تعامل (بوک‌مارک و حاشیه‌نویسی) — {dashFactors.densityStyle} · مجموعِ نشانه‌ها: {dashFactors.marks}</span>
          </div>
          <div style={styles.statBox}>
            <strong style={styles.statVal}>{Math.round(dashFactors.avgMinutesPerActiveDay)} دقیقه در روزِ فعال</strong>
            <span style={styles.statLbl}>میانگینِ طولِ نشست · طولانی‌ترین روز: {dashFactors.longestLabel} ({dashFactors.longestMinutes} دقیقه) · روزهایِ فعال: {dashFactors.activeDayCount}</span>
          </div>
          <div style={styles.statBox}>
            <strong style={styles.statVal}>{dashFactors.progress}٪ پیشرفتِ وزنی</strong>
            <span style={styles.statLbl}>نرخِ پیشروی و تکمیل — {dashFactors.finished} کتابِ تکمیل‌شده در برابرِ {dashFactors.inProgress} کتابِ در حالِ مطالعه</span>
          </div>
        </div>
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