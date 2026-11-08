import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
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
export function buildTrendSeries(daysMap, n, metric, marksByDay) {
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
// مرحلهٔ ۴۶ §۱ — اسکوپِ پویا و قاعدهٔ سنتز (توابعِ خالص، قابلِ تست در Node).
// کتابی که صفحهٔ جاری‌اش (currentPage) جلوتر از صفحاتِ ثبت‌شده در
// byBookStats است، هرگز صفر نشان داده نمی‌شود: صفحاتِ جاافتاده و زمانِ
// متناسب با آن‌ها، در روزِ آخرین مطالعهٔ همان کتاب سنتز می‌شوند.
// نرخِ ثانیه بر صفحه، اول از اندازه‌گیریِ خودِ اسکوپ، بعد از کلِ
// کتابخانه، و در نهایت ۴۵ ثانیه بر صفحه است (عددِ پیش‌فرضِ اعلام‌شده).
// هر ورودیِ روز که بخشی سنتزشده دارد، synthesized: true می‌گیرد و
// برآورد، هیچ‌جا به‌جایِ دادهٔ اندازه‌گیری‌شده جا زده نمی‌شود.
// فیلدِ تاریخِ آخرین مطالعه در recentItems، lastReadAt است (نه lastRead).
export const STATS_SNAPSHOT_FORMAT = 'comic-reader-stat-view-html-v1';
export const SYNTHESIS_FALLBACK_SECONDS_PER_PAGE = 45;

/** کلیدِ روزِ محلی از رویِ Date، timestamp، یا رشتهٔ ISO (null اگر نامعتبر). */
export function localDayKeyFromValue(value) {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? value : new Date(typeof value === 'number' ? value : String(value));
  if (!Number.isFinite(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function todayLocalDayKey() {
  return localDayKeyFromValue(new Date());
}

function toNonNegNum(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * ساختِ دادهٔ اسکوپ‌شده از رویِ کتاب‌هایِ اسکوپِ فعال.
 * ورودی: { scopeKeys, byBookStats, recentBooks, readingDays,
 *   bookmarksByFile, annotationCounts, includeLibraryDays }
 * در تبِ «آمارِ کل» (includeLibraryDays=true)، روزهایِ دیتابیسِ کلِ
 * کتابخانه مبناست؛ در تبِ سفارشی، فقط روزهایِ همان کتاب‌ها جمع می‌شوند.
 * خروجی: { keys, days, books, notesByDay, bookmarks, highlights,
 *   seconds, pages, hours, speed, progress, totalBooks, finishedBooks,
 *   secondsPerPage, secondsPerPageSource, synthesizedEntries,
 *   totalBookPages, readBookPages }.
 * books[i]: { key, name, seconds, pages, totalPages, currentPage,
 *   synthesizedPages, synthesizedSeconds, dayKeys }.
 * notesByDay: همهٔ بوک‌مارک‌ها و حاشیه‌نویسی‌هایِ کتاب‌هایِ اسکوپ؛
 * نشانه‌هایِ دارایِ تاریخ رویِ روزِ خودشان، و نشانه‌هایِ بدونِ تاریخ،
 * رویِ روزهایِ مطالعهٔ همان کتاب (متناسب با ثانیهٔ همان کتاب در هر
 * روز، با الگوریتمِ باقیماندهٔ بزرگ‌تر) توزیع می‌شوند.
 */
export function buildScopedScopeData(input) {
  const scopeKeysRaw = (input && input.scopeKeys) || [];
  const byBookStats = (input && input.byBookStats) || {};
  const recentBooks = (input && input.recentBooks) || [];
  const readingDays = (input && input.readingDays) || {};
  const bookmarksByFile = (input && input.bookmarksByFile) || {};
  const annotationCounts = (input && input.annotationCounts) || {};
  const includeLibraryDays = Boolean(input && input.includeLibraryDays);

  const seenKeys = new Set();
  const keys = [];
  for (const k of scopeKeysRaw) {
    const key = typeof k === 'string' ? k : '';
    if (!key || seenKeys.has(key)) continue;
    seenKeys.add(key);
    keys.push(key);
  }
  const recentByKey = new Map();
  for (const b of recentBooks) {
    if (b && b.bookKey && !recentByKey.has(b.bookKey)) recentByKey.set(b.bookKey, b);
  }
  // نرخِ اندازه‌گیری‌شدهٔ اسکوپ (ثانیه بر صفحه) + نرخِ کلِ کتابخانه.
  let scopeMeasuredSeconds = 0;
  let scopeMeasuredPages = 0;
  for (const k of keys) {
    const b = byBookStats[k] || {};
    scopeMeasuredSeconds += toNonNegNum(b.totalSeconds);
    scopeMeasuredPages += toNonNegNum(b.totalPages);
  }
  let librarySeconds = 0;
  let libraryPages = 0;
  for (const e of Object.values(readingDays)) {
    librarySeconds += toNonNegNum(e && e.seconds);
    libraryPages += toNonNegNum(e && e.pages);
  }
  let secondsPerPage = SYNTHESIS_FALLBACK_SECONDS_PER_PAGE;
  let secondsPerPageSource = 'fallback';
  if (scopeMeasuredPages > 0 && scopeMeasuredSeconds > 0) {
    secondsPerPage = scopeMeasuredSeconds / scopeMeasuredPages;
    secondsPerPageSource = 'scope';
  } else if (libraryPages > 0 && librarySeconds > 0) {
    secondsPerPage = librarySeconds / libraryPages;
    secondsPerPageSource = 'library';
  }

  const days = {};
  const putDay = (dayKey, seconds, pages, synthesized) => {
    if (!dayKey || (seconds <= 0 && pages <= 0)) return;
    if (!days[dayKey]) days[dayKey] = { seconds: 0, pages: 0 };
    days[dayKey].seconds += seconds;
    days[dayKey].pages += pages;
    if (synthesized) days[dayKey].synthesized = true;
  };
  if (includeLibraryDays) {
    for (const [dayKey, e] of Object.entries(readingDays)) {
      putDay(dayKey, toNonNegNum(e && e.seconds), toNonNegNum(e && e.pages), false);
    }
  }
  const books = [];
  let synthesizedEntries = 0;
  for (const k of keys) {
    const b = byBookStats[k] || {};
    const book = recentByKey.get(k) || null;
    const measuredSeconds = toNonNegNum(b.totalSeconds);
    const measuredPages = toNonNegNum(b.totalPages);
    const totalPages = Math.floor(toNonNegNum(book && book.totalPages));
    const currentPage = Math.floor(toNonNegNum(book && (book.currentPage || book.lastPage)));
    const bookDays = (b.days && typeof b.days === 'object') ? b.days : {};
    const dayKeys = [];
    // وزنِ توزیعِ نشانه‌هایِ بدونِ تاریخ: فقط ثانیه/صفحهٔ همین کتاب
    // در هر روز (نه مجموعِ روزِ اسکوپ که کتاب‌هایِ دیگر هم در آن‌اند).
    const dayWeights = {};
    for (const [dayKey, e] of Object.entries(bookDays)) {
      const ds = toNonNegNum(e && e.seconds);
      const dp = toNonNegNum(e && e.pages);
      dayWeights[dayKey] = ds > 0 ? ds : (dp > 0 ? dp * 45 : 1);
      if (!includeLibraryDays) {
        putDay(dayKey, ds, dp, false);
      }
      dayKeys.push(dayKey);
    }
    // سنتز: صفحاتِ خوانده‌شدهٔ واقعی (currentPage) که در byBook ثبت نشده‌اند.
    let synthPages = 0;
    let synthSeconds = 0;
    let synthDay = null;
    const readPages = totalPages > 0 ? Math.min(currentPage, totalPages) : currentPage;
    if (readPages > 1 && readPages > measuredPages) {
      synthPages = readPages - measuredPages;
      synthSeconds = Math.round(synthPages * secondsPerPage);
      synthDay = localDayKeyFromValue((book && (book.lastReadAt || book.updatedAt || book.lastRead)) || null) || todayLocalDayKey();
      putDay(synthDay, synthSeconds, synthPages, true);
      synthesizedEntries += 1;
      dayWeights[synthDay] = (dayWeights[synthDay] || 0) + synthSeconds;
      if (!dayKeys.includes(synthDay)) dayKeys.push(synthDay);
    }
    const name = (book && (book.name || book.fileName)) || k;
    books.push({
      key: k,
      name,
      seconds: measuredSeconds + synthSeconds,
      pages: measuredPages + synthPages,
      totalPages,
      currentPage,
      synthesizedPages: synthPages,
      synthesizedSeconds: synthSeconds,
      dayKeys,
      dayWeights,
    });
  }

  // نشانه‌ها: بوک‌مارک‌هایِ تاریخ‌دار رویِ روزِ خودشان؛ باقی‌مانده +
  // حاشیه‌نویسی‌ها (که تاریخ ندارند) رویِ روزهایِ همان کتاب توزیع می‌شوند.
  const notesByDay = {};
  let bookmarksTotal = 0;
  let highlightsTotal = 0;
  const addNote = (dayKey, count) => {
    if (!dayKey || count <= 0) return;
    notesByDay[dayKey] = (notesByDay[dayKey] || 0) + count;
  };
  for (const bk of books) {
    const list = Array.isArray(bookmarksByFile[bk.key]) ? bookmarksByFile[bk.key] : [];
    const annCount = Math.floor(toNonNegNum(annotationCounts[bk.key]));
    bookmarksTotal += list.length;
    highlightsTotal += annCount;
    let dated = 0;
    for (const mark of list) {
      const dayKey = localDayKeyFromValue(mark && (mark.createdAt || mark.created_at));
      if (dayKey) {
        addNote(dayKey, 1);
        dated += 1;
      }
    }
    const undated = Math.max(0, list.length - dated) + annCount;
    if (undated <= 0) continue;
    let distDays = bk.dayKeys.filter((dk) => days[dk] && (days[dk].seconds > 0 || days[dk].pages > 0));
    if (distDays.length === 0) {
      const srcBook = recentByKey.get(bk.key);
      const fb = localDayKeyFromValue((srcBook && (srcBook.lastReadAt || srcBook.updatedAt || srcBook.lastRead)) || null) || todayLocalDayKey();
      distDays = [fb];
    }
    const weights = distDays.map((dk) => Math.max(1, Number((bk.dayWeights && bk.dayWeights[dk]) || 0)));
    const totalW = weights.reduce((s, w) => s + w, 0) || 1;
    const exact = weights.map((w) => (undated * w) / totalW);
    const floors = exact.map((e) => Math.floor(e));
    let assigned = floors.reduce((s, f) => s + f, 0);
    const order = exact
      .map((e, i) => ({ i, frac: e - Math.floor(e) }))
      .sort((a, b) => b.frac - a.frac || a.i - b.i);
    let oi = 0;
    while (assigned < undated && oi < order.length) {
      floors[order[oi].i] += 1;
      assigned += 1;
      oi += 1;
    }
    floors.forEach((c, i) => addNote(distDays[i], c));
  }

  let seconds = 0;
  let pages = 0;
  let totalBookPages = 0;
  let readBookPages = 0;
  let finishedBooks = 0;
  for (const bk of books) {
    seconds += bk.seconds;
    pages += bk.pages;
    if (bk.totalPages > 0) {
      totalBookPages += bk.totalPages;
      readBookPages += Math.min(bk.totalPages, bk.pages);
      if (Math.max(bk.currentPage, bk.pages) >= bk.totalPages) finishedBooks += 1;
    }
  }
  const hours = seconds / 3600;
  return {
    keys,
    days,
    books,
    notesByDay,
    bookmarks: bookmarksTotal,
    highlights: highlightsTotal,
    seconds,
    pages,
    hours,
    speed: hours > 0 ? pages / hours : 0,
    progress: totalBookPages > 0 ? Math.round((readBookPages / totalBookPages) * 100) : 0,
    totalBooks: books.length,
    finishedBooks,
    secondsPerPage,
    secondsPerPageSource,
    synthesizedEntries,
    totalBookPages,
    readBookPages,
  };
}

/**
 * ساختِ اسنپ‌شاتِ گزارشِ HTML با شکلِ دقیقِ قرارداد (ورکرِ B مصرف می‌کند؛
 * شکل را تغییر ندهید): { format, exportedAt, statView, snapshotData }.
 */
export function createStatsSnapshotPayload(input) {
  const statView = (input && input.statView) || {};
  const days = (input && input.days) || {};
  const notesByDay = (input && input.notesByDay) || {};
  const books = (input && input.books) || [];
  const aptitude = (input && input.aptitude) || [];
  const summary = (input && input.summary) || {};
  const goal = (input && input.goal) || null;
  const cleanDays = {};
  for (const [key, e] of Object.entries(days)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue;
    const entry = { seconds: Math.max(0, Math.floor(Number((e && e.seconds) || 0))), pages: Math.max(0, Math.floor(Number((e && e.pages) || 0))) };
    if (e && e.synthesized === true) entry.synthesized = true;
    cleanDays[key] = entry;
  }
  const cleanNotes = {};
  for (const [key, v] of Object.entries(notesByDay)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue;
    cleanNotes[key] = Math.max(0, Math.floor(Number(v) || 0));
  }
  return {
    format: STATS_SNAPSHOT_FORMAT,
    exportedAt: Date.now(),
    statView: {
      id: String(statView.id || ''),
      name: String(statView.name || ''),
      color: String(statView.color || '#22d3ee'),
      bookKeys: Array.isArray(statView.bookKeys) ? [...statView.bookKeys] : [],
      linkedLibraryFolderIds: Array.isArray(statView.linkedLibraryFolderIds) ? [...statView.linkedLibraryFolderIds] : [],
      linkedFavoriteFolderIds: Array.isArray(statView.linkedFavoriteFolderIds) ? [...statView.linkedFavoriteFolderIds] : [],
      metrics: Array.isArray(statView.metrics) ? [...statView.metrics] : [],
      goalHours: statView.goalHours === null || statView.goalHours === undefined ? null : Number(statView.goalHours) || 0,
      goalPages: statView.goalPages === null || statView.goalPages === undefined ? null : Number(statView.goalPages) || 0,
    },
    snapshotData: {
      days: cleanDays,
      notesByDay: cleanNotes,
      books: books.map((b) => ({ key: String((b && b.key) || ''), name: String((b && b.name) || ''), seconds: Math.max(0, Math.floor(Number((b && b.seconds) || 0))), pages: Math.max(0, Math.floor(Number((b && b.pages) || 0))), totalPages: Math.max(0, Math.floor(Number((b && b.totalPages) || 0))) })),
      aptitude: aptitude.map((a) => ({ id: String((a && a.id) || ''), name: String((a && a.name) || ''), short: String((a && a.short) || ''), value: Math.max(0, Math.min(100, Math.round(Number((a && a.value) || 0)))), color: String((a && a.color) || '#22d3ee'), desc: String((a && a.desc) || '') })),
      summary: {
        seconds: Math.max(0, Math.floor(Number(summary.seconds) || 0)),
        pages: Math.max(0, Math.floor(Number(summary.pages) || 0)),
        hours: Number(summary.hours) || 0,
        speed: Number(summary.speed) || 0,
        progress: Math.max(0, Math.min(100, Math.round(Number(summary.progress) || 0))),
        bookmarks: Math.max(0, Math.floor(Number(summary.bookmarks) || 0)),
        highlights: Math.max(0, Math.floor(Number(summary.highlights) || 0)),
        totalBooks: Math.max(0, Math.floor(Number(summary.totalBooks) || 0)),
        finishedBooks: Math.max(0, Math.floor(Number(summary.finishedBooks) || 0)),
        currentStreak: Math.max(0, Math.floor(Number(summary.currentStreak) || 0)),
        bestStreak: Math.max(0, Math.floor(Number(summary.bestStreak) || 0)),
        todayPages: Math.max(0, Math.floor(Number(summary.todayPages) || 0)),
        todaySeconds: Math.max(0, Math.floor(Number(summary.todaySeconds) || 0)),
        todayGoalPages: Math.max(0, Math.floor(Number(summary.todayGoalPages) || 0)),
      },
      goal: goal ? { hours: Number(goal.hours) || 0, pages: Number(goal.pages) || 0 } : null,
    },
  };
}

/**
 * تجزیهٔ فایلِ درون‌ریزی (HTMLِ استخراج‌شده یا JSONِ خام) به آماربندی.
 * برمی‌گرداند آماربندیِ پاک‌سازی‌شده، یا null اگر فایل معتبر نیست.
 * اعتبارسنجی: format باید 'comic-reader-stat-view-html-v1' باشد و
 * statView باید id/name/color رشته‌ای، bookKeys آرایه‌ای از رشته‌ها،
 * metrics آرایه، و goalHours/goalPages عدد یا null داشته باشد.
 * مرحلهٔ ۴۹ §۴: linkedLibraryFolderIds و linkedFavoriteFolderIds، فیلدهایِ
 * تازه‌اند؛ در فایلِ قدیمی اگر نباشند، خالی فرض می‌شوند و اگر باشند، باید
 * آرایه‌ای از رشته‌ها باشند (وگرنه فایل نامعتبر است).
 * شناسهٔ 'all' رزروِ تبِ «آمارِ کل» است؛ اگر فایل آن را داشت، شناسهٔ
 * تازه ساخته می‌شود تا تبِ کل خراب نشود.
 */
export function parseImportedStatView(text) {
  if (typeof text !== 'string' || text.trim() === '') return null;
  const trimmed = text.trim();
  let data = null;
  if (trimmed.startsWith('{')) {
    try {
      data = JSON.parse(trimmed);
    } catch (_) {
      return null;
    }
  } else {
    const m = text.match(/<script[^>]*id=["']cr-exported-stat-view-payload["'][^>]*>([\s\S]*?)<\/script>/i);
    if (!m) return null;
    try {
      data = JSON.parse(m[1]);
    } catch (_) {
      return null;
    }
  }
  if (!data || data.format !== STATS_SNAPSHOT_FORMAT) return null;
  const sv = data.statView;
  if (!sv || typeof sv !== 'object') return null;
  if (typeof sv.id !== 'string' || sv.id.trim() === '') return null;
  if (typeof sv.name !== 'string' || sv.name.trim() === '') return null;
  if (typeof sv.color !== 'string' || sv.color.trim() === '') return null;
  if (!Array.isArray(sv.bookKeys) || !sv.bookKeys.every((k) => typeof k === 'string')) return null;
  if (sv.linkedLibraryFolderIds !== undefined && (!Array.isArray(sv.linkedLibraryFolderIds) || !sv.linkedLibraryFolderIds.every((k) => typeof k === 'string'))) return null;
  if (sv.linkedFavoriteFolderIds !== undefined && (!Array.isArray(sv.linkedFavoriteFolderIds) || !sv.linkedFavoriteFolderIds.every((k) => typeof k === 'string'))) return null;
  if (!Array.isArray(sv.metrics)) return null;
  if (!(sv.goalHours === null || typeof sv.goalHours === 'number')) return null;
  if (!(sv.goalPages === null || typeof sv.goalPages === 'number')) return null;
  if (!data.snapshotData || typeof data.snapshotData !== 'object') return null;
  let id = sv.id;
  if (id === 'all') id = `cv-imported-${Date.now()}`;
  return {
    id,
    name: sv.name.trim(),
    color: sv.color,
    bookKeys: [...new Set(sv.bookKeys.filter(Boolean))],
    linkedLibraryFolderIds: [...new Set((Array.isArray(sv.linkedLibraryFolderIds) ? sv.linkedLibraryFolderIds : []).filter(Boolean))],
    linkedFavoriteFolderIds: [...new Set((Array.isArray(sv.linkedFavoriteFolderIds) ? sv.linkedFavoriteFolderIds : []).filter(Boolean))],
    metrics: sv.metrics.filter((m) => typeof m === 'string'),
    goalHours: sv.goalHours === null ? 0 : Number(sv.goalHours) || 0,
    goalPages: sv.goalPages === null ? 0 : Number(sv.goalPages) || 0,
  };
}

// ============================================================================
// مرحلهٔ ۴۹ §۴ — سازندهٔ آماربندیِ پوشه‌محور (توابعِ خالص، قابلِ تست در Node).
// پوشه‌ها، کتاب‌ها را به اسکوپ اضافه می‌کنند؛ انتخابِ دستیِ bookKeys
// دست‌نخورده می‌ماند و عضویتِ پوشه، در لحظهٔ محاسبه حل می‌شود، نه در
// لحظهٔ ساختِ آماربندی — پس کتابی که بعداً به پوشه اضافه شود، خودبه‌خود
// واردِ آمارِ همان آماربندی می‌شود.
// شکلِ فرض‌شدهٔ استور (ورکرِ C اضافه می‌کند؛ این‌جا فقط مصرف می‌شود):
//   state.libraryFolders: [{ id, name, color, icon, createdAt }] (موجود است)
//   state.favoriteFolders: [{ id, name, color, icon, createdAt }] (جدید،
//     مستقل از libraryFolders؛ اگر هنوز در استور نباشد، [] فرض می‌شود)
//   state.favorites: [{ path | filePath, favoriteFolderId?, folderId?, ... }]
//     favoriteFolderId، فیلدِ جدیدِ مستقلِ ورکرِ C است؛ اگر رویِ ردیف
//     نباشد (دادهٔ قدیمیِ مرحلهٔ ۴۸)، folderIdِ همان ردیف جایگزین می‌شود،
//     چون در مرحلهٔ ۴۸ پوشهٔ علاقه‌مندی‌ها همان پوشهٔ کتابخانه بود.
// کتابِ پوشهٔ کتابخانه: ردیفِ libraryItems با همان folderId.
// کتابِ پوشهٔ علاقه‌مندی: ردیفِ favorites با همان favoriteFolderId
//   (یا folderId در دادهٔ قدیمی).
// ============================================================================

/** پاک‌سازیِ فهرستِ شناسهٔ پوشه: فقط رشته‌هایِ غیرِ خالی، بدونِ تکرار. */
export function normalizeFolderIdList(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const v of value) {
    if (typeof v !== 'string') continue;
    const id = v.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** خواندنِ فیلدهایِ پوشهٔ یک آماربندی (قدیمی‌ها: خالی). */
export function cleanStatViewFolders(view) {
  if (!view || typeof view !== 'object') return { linkedLibraryFolderIds: [], linkedFavoriteFolderIds: [] };
  return {
    linkedLibraryFolderIds: normalizeFolderIdList(view.linkedLibraryFolderIds),
    linkedFavoriteFolderIds: normalizeFolderIdList(view.linkedFavoriteFolderIds),
  };
}

/** پوشهٔ مؤثرِ یک ردیفِ علاقه‌مندی: favoriteFolderId اگر هست، وگرنه folderId. */
export function effectiveFavoriteFolderId(fav) {
  if (!fav || typeof fav !== 'object') return null;
  const next = fav.favoriteFolderId;
  if (typeof next === 'string' && next.trim() !== '') return next;
  const legacy = fav.folderId;
  if (typeof legacy === 'string' && legacy.trim() !== '') return legacy;
  return null;
}

/** تعدادِ کتاب‌هایِ یک پوشه (برایِ چیپِ انتخاب: کتابخانه یا علاقه‌مندی). */
export function countFolderBooks(kind, folderId, libraryItems, favorites) {
  if (!folderId) return 0;
  if (kind === 'favorite') {
    return (Array.isArray(favorites) ? favorites : []).filter((f) => effectiveFavoriteFolderId(f) === folderId).length;
  }
  return (Array.isArray(libraryItems) ? libraryItems : []).filter((item) => item && item.folderId === folderId).length;
}

/**
 * حلِ پویایِ کلیدِ کتاب‌هایِ پوشه‌هایِ پیوندخوردهٔ یک آماربندی.
 * ورودی: { linkedLibraryFolderIds, linkedFavoriteFolderIds, libraryItems,
 *   favorites }؛ خروجی: کلیدهایِ نرمال‌شدهٔ کتاب‌ها، بدونِ تکرار.
 * فقط در لحظهٔ محاسبه خوانده می‌شود — کتابِ تازه‌اضافه‌شده به پوشه،
 * خودبه‌خود در اسکوپ می‌آید.
 */
export function resolveFolderBookKeys(input) {
  const libIds = new Set(normalizeFolderIdList(input && input.linkedLibraryFolderIds));
  const favIds = new Set(normalizeFolderIdList(input && input.linkedFavoriteFolderIds));
  const out = [];
  const seen = new Set();
  const pushKey = (rawPath) => {
    const key = normalizeBookKeyLocal(rawPath || '');
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(key);
  };
  if (libIds.size > 0) {
    for (const item of (input && input.libraryItems) || []) {
      if (item && typeof item.folderId === 'string' && libIds.has(item.folderId)) {
        pushKey(item.path || item.filePath);
      }
    }
  }
  if (favIds.size > 0) {
    for (const fav of (input && input.favorites) || []) {
      if (fav && favIds.has(effectiveFavoriteFolderId(fav))) {
        pushKey(fav.path || fav.filePath);
      }
    }
  }
  return out;
}

/** اسکوپِ کاملِ یک آماربندی: bookKeys دستی + کلیدهایِ پوشه‌هایِ پیوندخورده. */
export function resolveStatViewScopeKeys(view, input) {
  const manual = Array.isArray(view && view.bookKeys) ? view.bookKeys.filter((k) => typeof k === 'string' && k !== '') : [];
  const folders = cleanStatViewFolders(view);
  const fromFolders = resolveFolderBookKeys({
    linkedLibraryFolderIds: folders.linkedLibraryFolderIds,
    linkedFavoriteFolderIds: folders.linkedFavoriteFolderIds,
    libraryItems: input && input.libraryItems,
    favorites: input && input.favorites,
  });
  const seen = new Set();
  const out = [];
  for (const k of [...manual, ...fromFolders]) {
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

/** پیشنهادِ نام و رنگِ آماربندی از رویِ پوشهٔ انتخاب‌شده (فقط وقتی نام خالی است). */
export function suggestViewFromFolder(folder) {
  if (!folder || typeof folder !== 'object') return null;
  const name = typeof folder.name === 'string' ? folder.name.trim() : '';
  if (!name) return null;
  return {
    name,
    color: typeof folder.color === 'string' && folder.color.trim() !== '' ? folder.color : '#22d3ee',
  };
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

// ============================================================================
// مرحلهٔ ۴۴ §۲ — داشبوردِ نئونِ ۶ نموداره (انتقال از dashboard-source.html).
// همهٔ کمک‌ها خالص‌اند و برایِ تستِ واحد، نام‌دار صادر می‌شوند.
// باگ‌هایِ رفع‌شده نسبت به HTML:
//   (۱) مثلث‌هایِ بالا/پایین حذف و با «+» و «−» جایگزین شد؛
//   (۲) تابعِ ساختگیِ gen(n,s) حذف شد — سری‌ها از دادهٔ واقعی می‌آیند؛
//   (۳) گاردِ تقسیم بر صفر با Math.max(1, ...) در هر ۶ نمودار + الگوریتمِ
//       باقیماندهٔ بزرگ‌تر برایِ وافلی (دقیقاً ۱۰۰ کاشی)؛
//   (۴) هیچ لیسنری رویِ document نیست — تولتیپ فقط با رویدادهایِ محلیِ React؛
//   (۵) ورود با keyframeهایِ مرحلهٔ ۴۹ (بدونِ کلاسِ .in و بدونِ ماشهٔ
//       دوفازی — ماشهٔ مرحلهٔ ۴۸ حذف شد، چون keyframe با fill-mode هر دو
//       جهت، رویِ مانت اجرا می‌شود)، و Count-Up با یک حلقهٔ اصلیِ مشترک.
// مرحلهٔ ۴۶ §۳: انیمیشن‌هایِ بی‌نهایت حذف شدند (.fill::after ایستا، .spin و
// .eyebrow فقط ۲ دورِ ورودی)؛ هاور و Count-Up بدونِ setState و با ref؛
// ۶ کارتِ نمودار، memo جدا شدند؛ گرادیان‌ها و سایه‌ها سبک‌تر شدند.
// مرحلهٔ ۴۸ §۳ — سرعت و انیمیشنِ پروفایل: گرادیانِ شعاعیِ .dash44 حذف شد
// (پس‌زمینهٔ تختِ #0a0e14)، will-change از .reveal و .spin و contain از
// .card برداشته شد، و پهنایِ .dash44 به ۱۰۶۰ پیکسل در وسط محدود شد؛ چون در
// کد هیچ قانونِ .wrap یا عددِ ۱۲۲۰ وجود نداشت، ظرفِ واقعی .dash44 است.
// مرحلهٔ ۴۹ §۱ — موتورِ keyframe (ورکرِ B): سقفِ ۱۰۶۰ پیکسلِ مرحلهٔ ۴۸
// (که کاربر آن را سطحی دانست) برداشته شد و پنل به پهنایِ کامل برگشت
// (width:100% با سقفِ ۱۴۴۰ پیکسل)؛ ورودِ transitionمحورِ .reveal.in با
// ۷ keyframe با fill-mode هر دو جهت جایگزین شد (فقط transform و opacity
// و stroke-dashoffset — بدونِ layout و reflow)؛ ماشهٔ دوفازیِ مرحلهٔ ۴۸
// حذف شد (دیگر لازم نیست: keyframe رویِ مانت اجرا می‌شود)؛ هاورِ هر ۶
// نمودار با !important رویِ transform حفظ شده است، چون انیمیشنِ با fill
// هر دو جهت، وگرنه هاورِ بدونِ !important را می‌بلعد.
// ============================================================================

const DASH44_ACC = ['#22d3ee', '#a78bfa', '#34d399', '#fbbf24', '#f472b6', '#60a5fa', '#fb7185'];

const DASH44_DUAL_METRICS = [
  { id: 'minutes', label: 'زمان مطالعه', unit: 'دقیقه' },
  { id: 'pages', label: 'صفحات خوانده‌شده', unit: 'صفحه' },
  { id: 'marks', label: 'یادداشت‌ها و بوک‌مارک‌ها', unit: 'نشانه' },
  { id: 'speed', label: 'سرعت مطالعه (صفحه بر ساعت)', unit: 'صفحه در ساعت' },
];
const DASH44_DUAL_RANGES = [7, 14, 30, 90];

/** کمانِ SVG بینِ دو زاویه (همان arcP در HTML). */
export function dashArcPath(cx, cy, r, a0, a1) {
  const x0 = cx + r * Math.cos(a0);
  const y0 = cy + r * Math.sin(a0);
  const x1 = cx + r * Math.cos(a1);
  const y1 = cy + r * Math.sin(a1);
  const laf = (a1 - a0) > Math.PI ? 1 : 0;
  return 'M' + x0.toFixed(1) + ',' + y0.toFixed(1) + ' A' + r + ',' + r + ' 0 ' + laf + ' 1 ' + x1.toFixed(1) + ',' + y1.toFixed(1);
}

/**
 * تخصیصِ کاشی‌هایِ وافلی با الگوریتمِ باقیماندهٔ بزرگ‌تر: دقیقاً ۱۰۰ کاشی.
 * خروجی، آرایه‌ای ۱۰۰تایی از شناسهٔ کتاب (یا ۱- برایِ کاشیِ خاکستریِ خالی) است.
 * اگر کلِ زمان صفر باشد یا کتابی نباشد، هر ۱۰۰ کاشی خاکستریِ کم‌رنگ‌اند.
 */
export function largestRemainderTiles(values, total) {
  const out = new Array(100).fill(-1);
  const safeTotal = Math.max(0, Number(total) || 0);
  const vals = (values || []).map((v) => Math.max(0, Number(v) || 0));
  if (safeTotal <= 0 || vals.length === 0) return out;
  const exact = vals.map((v) => (v / safeTotal) * 100);
  const floors = exact.map((e) => Math.floor(e));
  let assigned = floors.reduce((s, f) => s + f, 0);
  const order = exact
    .map((e, i) => ({ i, frac: e - Math.floor(e) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  let k = 0;
  while (assigned < 100 && k < order.length) {
    floors[order[k].i] += 1;
    assigned += 1;
    k += 1;
  }
  let t = 0;
  floors.forEach((count, bi) => {
    for (let j = 0; j < count && t < 100; j++) {
      out[t] = bi;
      t += 1;
    }
  });
  return out;
}

/** میانگینِ متحرکِ ۳ روزه (سریِ B در نمودارِ ۶ — واقعی، نه ساختگی). */
export function movingAverage3(values) {
  const arr = (values || []).map((v) => Number(v) || 0);
  return arr.map((v, i) => {
    const win = arr.slice(Math.max(0, i - 2), i + 1);
    return win.reduce((s, x) => s + x, 0) / Math.max(1, win.length);
  });
}

/** سقفِ محورِ عمودیِ نمودارِ ۶؛ هرگز صفر نیست تا تقسیم بر صفر پیش نیاید. */
export function dualScaleMax(maxV) {
  const m = Math.max(0, Number(maxV) || 0);
  return Math.max(50, Math.ceil(m / 50) * 50);
}

/** شعاعِ تیکِ ساعتِ ماه از رویِ دقیقه؛ سقفِ ۱۸۰ دقیقه تا از قاب بیرون نزند. */
export function clockRadiusFor(minutes) {
  return 70 + Math.min(180, Math.max(0, Number(minutes) || 0)) * 0.55;
}

/** مسیرِ پلکانیِ تراس (نمودارِ ۵) + مختصاتِ y هر روز؛ ورودیِ خالی، مسیرِ خالی می‌دهد. */
export function terracePaths(week, mx) {
  if (!week || week.length === 0) return { ys: [], stroke: '', fill: '' };
  const safeMx = Math.max(1, Number(mx) || 0);
  const ys = week.map((w) => 222 - ((Number(w.minutes) || 0) / safeMx) * 168);
  let stroke = 'M960,' + ys[0];
  let fill = 'M960,232 L960,' + ys[0];
  for (let i = 0; i < 7; i++) {
    const xr = 940 - i * 132;
    const xl = xr - 132;
    if (i) stroke += ' L' + xr + ',' + ys[i];
    stroke += ' L' + xl + ',' + ys[i];
    fill += ' L' + xr + ',' + ys[i] + ' L' + xl + ',' + ys[i];
  }
  fill += ' L36,232 Z';
  return { ys, stroke, fill };
}

/** عدد، بدونِ اعشارِ اضافی: صحیح، همان عدد؛ وگرنه یک رقمِ اعشار. */
export function dashFormatNum(v) {
  const n = Number(v) || 0;
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** شمارندهٔ Count-Up با منحنیِ 1 - Math.pow(1 - p, 3) در ۱۳۰۰ میلی‌ثانیه (همان cu در HTML). */
// ============================================================================
// مرحلهٔ ۴۷ §۱ — موتورِ داشبورد رویِ موتورِ HTMLِ خروجی (statsHtmlExport).
// به‌جایِ ۶ کارتِ memoشدهٔ JSX + شمارنده‌هایِ هوک‌محور + مانتِ مرحله‌ای،
// داشبورد این‌جا یک رشتهٔ DOM/SVG است که با dangerouslySetInnerHTML سوار
// می‌شود و ورودِ آن در مرحلهٔ ۴۹ با ۷ keyframe با fill-mode هر دو جهت +
// شمارندهٔ مستقیمِ cu(el) انجام می‌شود — دقیقاً همان الگویِ Qwen_html و
// statsHtmlExport:
//   .reveal → keyframe رویِ مانت اجرا می‌شود و به هیچ کلاسِ .in و هیچ
//   ماشهٔ دوفازی نیاز ندارد (ماشهٔ مرحلهٔ ۴۸ در مرحلهٔ ۴۹ حذف شد؛ با
//   fill-mode هر دو جهت، حالتِ آغازین از فریمِ اول ثبت است و ورود، حتی
//   در پنجرهٔ کامل که همهٔ کارت‌ها از فریمِ اول دیده می‌شوند، بلعیده
//   نمی‌شود)؛
//   .cu → هر عنصر فقط یک بار، با همان منحنیِ 1 - Math.pow(1 - p, 3) در
//   ۱۳۰۰ میلی‌ثانیه می‌شمرد (بدونِ هیچ useState/useEffect در شمارنده)، ولی
//   همهٔ عنصرها در یک حلقهٔ اصلیِ مشترک (masterCountUpLoop) می‌شمرند، نه
//   هر کدام با یک زنجیرهٔ جداگانهٔ requestAnimationFrame؛
//   هاورِ نمودارِ ۶ با rAF مهار می‌شود (حداکثر یک به‌روزرسانی در هر فریم)
//   و روزِ فعال با کلاسِ hot رویِ دایره‌ها بزرگ می‌شود.
//   تولتیپ، هایلایتِ بلاب و هاورِ نمودارِ ۶ → رویدادهایِ delegated فقط
//   رویِ همین ریشه (هیچ لیسنری رویِ document نیست، مثلِ رفعِ باگِ ۴ در
//   مرحلهٔ ۴۴)؛ قرص‌هایِ نمودارِ ۶ → فقط SVG همان نمودار را عوض می‌کنند،
//   بدونِ setState و بدونِ بازسازیِ ۵ نمودارِ دیگر.
// انیمیشن‌هایِ ورودیِ HTML (@keyframes beat/slide/rot) فقط در ورود اجرا
// می‌شوند و بعد می‌ایستند (۲ دور)؛ در حالتِ سکون، هیچ انیمیشنِ بی‌نهایتی
// نیست (قاعدهٔ مرحلهٔ ۴۶ حفظ شده است).
// همهٔ رشته‌هایِ نمایشیِ پویا با escHtml گریز می‌شوند (JSX خودبه‌خود گریز
// می‌کرد؛ رشتهٔ HTML این کار را نمی‌کند).
// ============================================================================

/** گریزِ متن برایِ جاسازیِ امن در رشتهٔ HTML (نامِ کتاب، نامِ آماربندی، ...). */
function escHtml(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------------------------------------------------------------------------
// کشِ سطحِ ماژولِ داشبورد + تصمیمِ تک‌ضربه‌ایِ به‌روزرسانی (خالص، قابلِ تست).
// ---------------------------------------------------------------------------

/** آخرین دادهٔ خامِ داشبورد؛ بازگشت به تبِ پروفایل، بی‌درنگ از همین کش رندر می‌شود. */
let cachedProfileDashboardData = null;

/** مرحلهٔ ۵۰ §۴ — شمارندهٔ سراسریِ چرخهٔ مانتِ پروفایل: هر مانتِ تازهٔ
 * ProfileView (ورودِ دوباره به تب) یک عددِ تازه می‌گیرد تا کلیدِ موتورِ
 * داشبورد عوض شود و ورودِ keyframeها از نو اجرا شود. */
let profileMountCycleSeq = 0;

/** خواندنِ کش برایِ تست و برایِ مقدارِ اولیهٔ useState (فقط خواندنی). */
export function getCachedProfileDashboardData() {
  return cachedProfileDashboardData;
}

/** شکلِ خالیِ دادهٔ خامِ داشبورد (وقتی IPC هیچ‌چیزِ معتبری نداد). */
export function emptyDashboardData() {
  return {
    days: {},
    byBook: {},
    totalAppSeconds: 0,
    annotationTotals: null,
    annotationCounts: {},
    customStatViews: [],
    loadedAt: 0,
  };
}

/** امضایِ قابلِ مقایسهٔ دادهٔ خام (برایِ تشخیصِ «داده عوض شده است یا نه»). */
export function dashboardDataSignature(data) {
  if (!data) return '';
  try {
    return JSON.stringify([
      data.days || {},
      data.byBook || {},
      Number(data.totalAppSeconds) || 0,
      data.annotationTotals || null,
      data.annotationCounts || {},
      data.customStatViews || [],
    ]);
  } catch (_) {
    return String((data && data.loadedAt) || 0);
  }
}

/** آیا دو نسخهٔ دادهٔ خام، از نظرِ محتوایِ نمایشی یکسان‌اند؟ */
export function isSameDashboardData(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  return dashboardDataSignature(a) === dashboardDataSignature(b);
}

/**
 * تصمیمِ به‌روزرسانیِ پس‌زمینه: دادهٔ تازه، فقط وقتی جایگزین می‌شود که
 * واقعاً با کش فرق داشته باشد؛ وگرنه همان کش می‌ماند و هیچ setStateای
 * لازم نیست (بازگشت به تب، ۰ میلی‌ثانیه و بدونِ چشمک).
 */
export function mergeDashboardRefresh(cached, fresh) {
  if (!fresh) return { next: cached || null, changed: false };
  if (!cached) return { next: fresh, changed: true };
  if (isSameDashboardData(cached, fresh)) return { next: cached, changed: false };
  return { next: fresh, changed: true };
}

/**
 * ساختِ یک نسخهٔ دادهٔ خام از ۴ پاسخِ IPC. اگر آمارِ مطالعه معتبر نباشد،
 * null برمی‌گردد تا فراخواننده، کش را نگه دارد (نه این‌که داشبورد را خالی کند).
 * GET_ANNOTATION_TOTALS جدا نگه داشته می‌شود چون پاسخش با سه تایِ دیگر
 * هم‌پوشانی ندارد؛ در مرحلهٔ ۴۶ هم هیچ‌جا نمایش داده نمی‌شد و این‌جا هم
 * فقط برایِ قرارداد ذخیره می‌شود، نه برایِ رندر.
 */
export function buildDashboardDataFromReplies(statsRes, totalsRes, countsRes, viewsRes, fallbackViews) {
  if (!statsRes || !statsRes.days) return null;
  let views = null;
  if (viewsRes && viewsRes.type === 'done' && Array.isArray(viewsRes.views)) views = viewsRes.views;
  if (views === null && Array.isArray(fallbackViews)) views = fallbackViews;
  if (views === null) views = [];
  let totals = null;
  if (totalsRes && totalsRes.type === 'done') {
    totals = {
      totalItems: Number(totalsRes.totalItems) || 0,
      annotatedPages: Number(totalsRes.annotatedPages) || 0,
      annotatedFiles: Number(totalsRes.annotatedFiles) || 0,
    };
  }
  const counts = (countsRes && countsRes.type === 'done' && countsRes.counts) ? countsRes.counts : {};
  return {
    days: statsRes.days || {},
    byBook: statsRes.byBook || {},
    totalAppSeconds: Number(statsRes.totalAppSeconds) || 0,
    annotationTotals: totals,
    annotationCounts: counts,
    customStatViews: views,
    loadedAt: Date.now(),
  };
}

/** خواندنِ پشتیبانِ آماربندی‌ها از localStorage وقتی IPC چیزی نداد (مثلِ مرحلهٔ ۴۶). */
export function readCustomStatViewsFallback() {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem('comicReader.customStatViews.v1');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch (_) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// شمارندهٔ مستقیمِ cu(el) — همان cu در Qwen_html (بدونِ هوک، بدونِ setState).
// مرحلهٔ ۴۸ §۳ — فقط یک حلقهٔ اصلیِ مشترک (masterCountUpLoop): در پایه، هر
// عنصرِ .cu زنجیرهٔ requestAnimationFrame خودش را می‌ساخت (تک‌تابعِ cu ولی
// به‌تعدادِ عنصرها زنجیرهٔ هم‌زمان)؛ حالا همهٔ عنصرها در یک صف‌اند و یک
// requestAnimationFrame در هر فریم، همه را با هم به‌روز می‌کند. منحنی و زمان
// (۱۳۰۰ میلی‌ثانیه) و «هر عنصر فقط یک بار» دقیقاً مثلِ قبل است.
// شمارِ واقعیِ پایه: ۵ رخدادِ requestAnimationFrame در کلِ فایل (یکی کامنت،
// ۴ تا کد: ۲ تا در همین تیک، ۱ برایِ go نمودارِ ۶، ۱ در renderDualInto) و
// فقط ۱ حلقهٔ شمارنده — ادعایِ ۱۳ حلقه تأیید نشد.
// ---------------------------------------------------------------------------

// مرحلهٔ ۵۱ §۵ — مهارِ شمارنده: آخرین زمانِ تیکِ واقعاً اجرا شده؛ null یعنی
// هنوز هیچ تیکی اجرا نشده است (تیکِ اول، بی‌درنگ اجرا می‌شود).
let masterCountUpLastTickMs = null;

/** صفِ فعالِ شمارنده‌ها + پرچمِ درحال‌اجرا بودنِ حلقهٔ اصلی (سطحِ ماژول). */
const masterCountUpQueue = [];
let masterCountUpRunning = false;

/** یک فریمِ حلقهٔ اصلی: همهٔ عنصرهایِ صف را با همان منحنیِ قبلی به‌روز می‌کند. */
function masterCountUpTick(now) {
  const nowMs = typeof now === 'number' ? now : performance.now();
  // مرحلهٔ ۵۱ §۵ — مهار به هر ۴۵ میلی‌ثانیه (حدودِ ۲۲ به‌روزرسانی در ثانیه):
  // فریم‌هایِ زودتر، بدونِ هیچ لمسِ DOM رد می‌شوند و حلقه ادامه می‌یابد.
  if (masterCountUpLastTickMs !== null && nowMs - masterCountUpLastTickMs < 45) {
    if (masterCountUpQueue.length > 0) {
      requestAnimationFrame(masterCountUpTick);
    } else {
      masterCountUpRunning = false;
    }
    return;
  }
  masterCountUpLastTickMs = nowMs;
  let i = 0;
  while (i < masterCountUpQueue.length) {
    const item = masterCountUpQueue[i];
    const p = Math.min((nowMs - item.start) / 1300, 1);
    const nextStr = String(Math.round(item.goal * (1 - Math.pow(1 - p, 3))));
    // مرحلهٔ ۵۱ §۵ — گاردِ نوشتهٔ تکراری: اگر عددِ گرد شده عوض نشده،
    // textContent اصلاً لمس نمی‌شود (بدونِ بازچیدمانِ DOM).
    if (item.el._lastText !== nextStr) {
      item.el._lastText = nextStr;
      item.el.textContent = nextStr;
    }
    if (p >= 1) {
      masterCountUpQueue.splice(i, 1);
    } else {
      i += 1;
    }
  }
  if (masterCountUpQueue.length > 0) {
    requestAnimationFrame(masterCountUpTick);
  } else {
    masterCountUpRunning = false;
  }
}

/** شمارشِ ۰ تا هدف با منحنیِ 1 - Math.pow(1 - p, 3) در ۱۳۰۰ میلی‌ثانیه؛ هر عنصر فقط یک بار. */
function dashCountUp(el) {
  if (!el || el._dashCounted) return;
  el._dashCounted = true;
  const goal = Math.max(0, Math.floor(Number(el.getAttribute('data-cu')) || 0));
  masterCountUpQueue.push({ el, goal, start: performance.now() });
  if (!masterCountUpRunning) {
    masterCountUpRunning = true;
    requestAnimationFrame(masterCountUpTick);
  }
}

// ---------------------------------------------------------------------------
// سیم‌کشیِ موتور (شمارنده + go نمودارِ ۶ + تولتیپ + بلاب + هاورِ نمودارِ ۶).
// فقط رویِ همین ریشه کار می‌کند؛ خروجی، تابعِ پاک‌سازی است.
// ---------------------------------------------------------------------------

/** نوشتنِ پنلِ HUD نمودارِ ۶ برایِ روزِ i (مستقیم رویِ DOM، بدونِ setState).
    مرحلهٔ ۴۸ §۳ — روزِ فعال با کلاسِ hot رویِ دایره‌هایِ .pdA و .pdB بزرگ
    می‌شود؛ با showXl=false (ترکِ نمودار) همهٔ hotها پاک می‌شوند. */
function writeDualHud(root, dual, i, showXl) {
  if (!root || !dual || !dual.trend || dual.trend.length === 0) return;
  const idx = Math.max(0, Math.min(dual.trend.length - 1, i));
  const item = dual.trend[idx];
  if (!item) return;
  const setText = (sel, value) => {
    const el = root.querySelector(sel);
    if (el) el.textContent = value;
  };
  setText('[data-hud-date]', 'روز ' + item.label);
  setText('[data-hud-a]', dashFormatNum(dual.a[idx]));
  setText('[data-hud-b]', dashFormatNum(dual.b[idx]));
  const setDualHot = (sel) => {
    const nodes = root.querySelectorAll(sel);
    nodes.forEach((node, k) => { node.classList.toggle('hot', showXl && k === idx); });
  };
  setDualHot('.pdA');
  setDualHot('.pdB');
  const xl = root.querySelector('[data-dual-xl]');
  if (xl) {
    const xv = 40 + idx * dual.step;
    xl.setAttribute('x1', String(xv));
    xl.setAttribute('x2', String(xv));
    xl.style.opacity = showXl ? '1' : '0';
  }
}

/** هاور رویِ SVG نمودارِ ۶: نزدیک‌ترین روز به مکانِ ماوس را در HUD نشان می‌دهد.
    مرحلهٔ ۴۸ §۳ — به‌جایِ خودِ رویداد، فقط clientX گرفته می‌شود تا هاورِ
    مهارشده با rAF بتواند آخرین مکان را تا فریمِ بعد نگه دارد. */
function updateDualHover(root, svg, clientX) {
  const dual = root._dashDual;
  if (!dual || !dual.trend || dual.trend.length === 0) return;
  const rect = svg.getBoundingClientRect();
  const x = ((clientX - rect.left) / Math.max(1, rect.width)) * 1000;
  const i = Math.round((x - 40) / Math.max(1, dual.step));
  writeDualHud(root, dual, i, true);
}

/** ترکِ نمودارِ ۶: HUD به آخرین روز برمی‌گردد و خطِ عمودی پنهان می‌شود. */
function resetDualHover(root) {
  const dual = root._dashDual;
  if (!dual || !dual.trend || dual.trend.length === 0) return;
  writeDualHud(root, dual, dual.trend.length - 1, false);
}

/**
 * سیم‌کشیِ یک ریشهٔ موتور: ورودِ .reveal در مرحلهٔ ۵۰ §۴ دیده‌محور است —
 * IntersectionObserver با ریشهٔ کانتینرِ اسکرول، آستانهٔ ۰٫۱۶ و حاشیهٔ
 * پایینِ ۴۰- پیکسل کارت‌ها را رصد می‌کند و فقط کارتِ در دید، .in-view
 * می‌گیرد (کارتِ در دیدِ لحظهٔ باز شدن پس از rAF + ۶۰ میلی‌ثانیه)؛ با
 * .in-view، هم keyframeهایِ DASH44_CSS و هم شمارنده‌هایِ .cu همان کارت
 * از صفر شروع می‌شوند. این تابع همچنین کلاسِ go را رویِ SVG نمودارِ ۶
 * می‌گذارد (برایِ محوشدنِ خط‌ها و ناحیه‌ها)، و تولتیپ و هایلایتِ بلاب با
 * delegation و هاورِ مهارشده با rAF + قرص‌هایِ نمودارِ ۶ را سیم‌کشی می‌کند.
 * onDual، فقط برایِ میزبانِ داشبورد داده می‌شود؛ بقیهٔ میزبان‌ها null می‌گیرند.
 */
export function wireDashEngine(root, onDual, onGoalChange) {
  if (!root) return () => {};
  const aborter = new AbortController();
  const signal = aborter.signal;
  const tip = root.querySelector('.dash44Tip');
  // مرحلهٔ ۵۰ §۴ — ورودِ دیده‌محور (به‌جایِ keyframe رویِ مانت در مرحلهٔ ۴۹):
  // کارت‌هایِ .reveal فقط وقتی .in-view می‌گیرند که IntersectionObserver
  // آن‌ها را در دیدِ واقعیِ کاربر ببیند؛ تا پیش از آن، DASH44_CSS آن‌ها را
  // در حالتِ آمادهٔ شروع نگه می‌دارد (opacity:0 و اجزایِ نمودار در نقطهٔ
  // صفر). شمارنده‌هایِ .cu هم فقط برایِ همان کارتِ واردشده، در
  // masterCountUpQueue استارت می‌خورند (هر عنصر فقط یک بار — گاردِ
  // _dashCounted در dashCountUp). کارت‌هایِ در دیدِ لحظهٔ باز شدن، پس از
  // یک requestAnimationFrame + setTimeout ۶۰ میلی‌ثانیه‌ای وارد می‌شوند؛
  // کارت‌هایِ پایین‌تر دقیقاً با entry.isIntersecting وارد می‌شوند.
  // کلاسِ go رویِ SVG نمودارِ ۶ مثلِ قبل، با rAF رویِ مانت گذاشته می‌شود
  // (محوِ خط‌ها و ناحیه‌ها — keyframe نیست و به .in-view گره نخورده است).
  let revealObserver = null;
  let initialRevealSettled = false;
  const revealTimers = [];
  const revealRafs = [];
  const revealCard = (card) => {
    if (!card || card.classList.contains('in-view')) return;
    card.classList.add('in-view');
    if (revealObserver) revealObserver.unobserve(card);
    card.querySelectorAll('.cu').forEach(dashCountUp);
  };
  const revealCardSoon = (card) => {
    if (!card || card.classList.contains('in-view')) return;
    const rafId = requestAnimationFrame(() => {
      const timerId = setTimeout(() => { revealCard(card); }, 60);
      revealTimers.push(timerId);
    });
    revealRafs.push(rafId);
  };
  // نزدیک‌ترین جدِ اسکرول‌شوندهٔ ریشه (کانتینرِ پروفایل با overflowY:auto)؛
  // اگر پیدا نشد، null می‌ماند یعنی ریشهٔ مشاهده‌گر، همان viewport است.
  let scrollContainerEl = null;
  if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
    let ancestor = root.parentElement;
    while (ancestor) {
      let overflowY = '';
      try { overflowY = window.getComputedStyle(ancestor).overflowY || ''; } catch (_) { overflowY = ''; }
      if (overflowY === 'auto' || overflowY === 'scroll') { scrollContainerEl = ancestor; break; }
      ancestor = ancestor.parentElement;
    }
  }
  if (typeof IntersectionObserver !== 'undefined') {
    revealObserver = new IntersectionObserver((entries) => {
      const firstBatch = !initialRevealSettled;
      initialRevealSettled = true;
      entries.forEach((entry) => {
        if (!entry || !entry.isIntersecting) return;
        if (firstBatch) revealCardSoon(entry.target);
        else revealCard(entry.target);
      });
    }, { root: scrollContainerEl, threshold: 0.16, rootMargin: '0px 0px -40px 0px' });
    root.querySelectorAll('.reveal').forEach((card) => { revealObserver.observe(card); });
  } else {
    // اگر IntersectionObserver در دسترس نباشد، همهٔ کارت‌ها پس از یک فریم
    // + ۶۰ میلی‌ثانیه وارد می‌شوند تا هیچ کارتی پنهان نماند.
    root.querySelectorAll('.reveal').forEach(revealCardSoon);
  }
  root.querySelectorAll('[data-dual-svg]').forEach((svg) => {
    requestAnimationFrame(() => { svg.classList.add('go'); });
  });
  const showTip = (text, x, y) => {
    if (!tip) return;
    tip.textContent = text;
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
    tip.classList.add('on');
  };
  const hideTip = () => {
    if (tip) tip.classList.remove('on');
  };
  const setBlobHot = (idx) => {
    root.querySelectorAll('[data-blob-idx]').forEach((el) => {
      el.classList.toggle('hot', el.getAttribute('data-blob-idx') === String(idx));
    });
  };
  const clearBlobHot = () => {
    root.querySelectorAll('[data-blob-idx]').forEach((el) => { el.classList.remove('hot'); });
  };
  root.addEventListener('mouseover', (e) => {
    const target = e.target && e.target.closest ? e.target.closest('[data-tip]') : null;
    if (target) showTip(target.getAttribute('data-tip') || '', e.clientX, e.clientY);
    else hideTip();
    const blobEl = e.target && e.target.closest ? e.target.closest('[data-blob-idx]') : null;
    if (blobEl) setBlobHot(blobEl.getAttribute('data-blob-idx'));
    else clearBlobHot();
  }, { signal });
  // مرحلهٔ ۴۸ §۳ — هاورِ نمودارِ ۶ با rAF مهار می‌شود: در پایه، هر رویدادِ
  // mousemove مستقیم updateDualHover را صدا می‌زد (بدونِ مهار)؛ حالا فقط
  // آخرین مکانِ ماوس نگه داشته می‌شود و حداکثر یک به‌روزرسانی در هر فریم
  // انجام می‌شود. نوشتن، هنوز مستقیم رویِ DOM است و هیچ setStateای نیست.
  let dualHoverRaf = 0;
  let dualHoverPending = null;
  const flushDualHover = () => {
    dualHoverRaf = 0;
    if (!dualHoverPending) return;
    const pending = dualHoverPending;
    dualHoverPending = null;
    updateDualHover(root, pending.svg, pending.clientX);
  };
  root.addEventListener('mousemove', (e) => {
    if (tip && tip.classList.contains('on')) {
      tip.style.left = e.clientX + 'px';
      tip.style.top = e.clientY + 'px';
    }
    const svg = e.target && e.target.closest ? e.target.closest('[data-dual-svg]') : null;
    if (svg) {
      dualHoverPending = { svg, clientX: e.clientX };
      if (!dualHoverRaf) dualHoverRaf = requestAnimationFrame(flushDualHover);
    }
  }, { signal });
  root.addEventListener('mouseout', (e) => {
    const svg = e.target && e.target.closest ? e.target.closest('[data-dual-svg]') : null;
    if (svg && e.relatedTarget && !svg.contains(e.relatedTarget)) resetDualHover(root);
    if (e.relatedTarget && e.relatedTarget.closest && !e.relatedTarget.closest('[data-tip]')) hideTip();
    if (!e.relatedTarget || !e.relatedTarget.closest || !e.relatedTarget.closest('[data-blob-idx]')) clearBlobHot();
  }, { signal });
  root.addEventListener('click', (e) => {
    if (!onDual) return;
    const metricEl = e.target && e.target.closest ? e.target.closest('[data-dual-metric]') : null;
    const rangeEl = e.target && e.target.closest ? e.target.closest('[data-dual-range]') : null;
    if (metricEl) onDual(root, Number(metricEl.getAttribute('data-dual-metric')) || 0, null);
    else if (rangeEl) onDual(root, null, Number(rangeEl.getAttribute('data-dual-range')) || 0);
  }, { signal });
  // مرحلهٔ ۵۱ §۳ — ویرایشِ مستقیمِ عددِ هدف در کارتِ «هدف امروز»: رویِ
  // عددِ هدف (span[data-goal-edit] از buildGoalHtml) کلیک می‌شود و یک
  // ورودیِ عددی + دکمهٔ ذخیره جایش می‌نشیند؛ Enter یا دکمهٔ ذخیره، مقدار را
  // با گاردِ Math.max(1, parseInt(val, 10) || 50) به onGoalChange می‌دهد
  // (۰ و NaN هرگز به درصدِ هدف نمی‌رسند) و عددِ تازه بی‌درنگ نمایش داده
  // می‌شود؛ Escape یا کلیکِ بیرون، ویرایش را لغو می‌کند و عددِ قبلی
  // برمی‌گردد. بازسازیِ رشته توسطِ React انجام می‌شود؛ اگر رشته عوض نشد
  // (همان عدد)، همین‌جا عدد نمایش داده می‌شود تا ورودی جا نماند.
  root.addEventListener('click', (e) => {
    if (typeof onGoalChange !== 'function') return;
    const goalEl = e.target && e.target.closest ? e.target.closest('[data-goal-edit]') : null;
    if (!goalEl || goalEl.querySelector('input')) return;
    const previousText = goalEl.textContent;
    const previousGoal = previousText.trim();
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '1';
    input.max = '10000';
    input.value = previousGoal;
    input.setAttribute('aria-label', 'هدف روزانه به صفحه');
    input.className = 'goalNumInput';
    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.textContent = 'ذخیره';
    saveBtn.className = 'goalNumSave';
    goalEl.textContent = '';
    goalEl.appendChild(input);
    goalEl.appendChild(saveBtn);
    input.focus();
    input.select();
    let settled = false;
    const commit = (save) => {
      if (settled) return;
      settled = true;
      if (save) {
        const nextGoal = Math.max(1, parseInt(input.value, 10) || 50);
        onGoalChange(String(nextGoal));
        goalEl.textContent = String(nextGoal);
      } else {
        goalEl.textContent = previousText;
      }
    };
    input.addEventListener('keydown', (ke) => {
      if (ke.key === 'Enter') { ke.preventDefault(); commit(true); }
      else if (ke.key === 'Escape') { ke.preventDefault(); commit(false); }
    });
    input.addEventListener('blur', (be) => {
      if (be.relatedTarget === saveBtn) return;
      commit(false);
    });
    saveBtn.addEventListener('mousedown', (me) => { me.preventDefault(); commit(true); });
    saveBtn.addEventListener('click', () => { commit(true); });
  }, { signal });
  return () => {
    if (revealObserver) revealObserver.disconnect();
    revealTimers.forEach((timerId) => { clearTimeout(timerId); });
    revealRafs.forEach((rafId) => { cancelAnimationFrame(rafId); });
    if (dualHoverRaf) cancelAnimationFrame(dualHoverRaf);
    aborter.abort();
  };
}

// ---------------------------------------------------------------------------
// مدلِ نمودارِ ۶ (خالص؛ همان useMemoهایِ مرحلهٔ ۴۶، بیرون کشیده‌شده تا مسیرِ
// دستوریِ قرص‌ها و مسیرِ React از یک کد استفاده کنند).
// ---------------------------------------------------------------------------

/** سریِ دوتاییِ نمودارِ ۶: A = مقدارِ واقعیِ روزانه، B = میانگینِ متحرکِ ۳ روزه. */
export function buildDualSeriesData(scopedDays, notesByDay, metricIdx, rangeIdx) {
  const metric = DASH44_DUAL_METRICS[metricIdx] || DASH44_DUAL_METRICS[0];
  const range = DASH44_DUAL_RANGES[rangeIdx] || DASH44_DUAL_RANGES[1];
  const trend = buildTrendSeries(scopedDays, range, metric.id, notesByDay);
  const a = trend.map((d) => d.value);
  const b = movingAverage3(a);
  return { trend, a, b, metric };
}

/** هندسهٔ SVG نمودارِ ۶ (نقاط، خط‌هایِ هموار، ناحیه‌ها، گامِ افقی). */
export function buildDualGeomData(series, scale) {
  const n = series.trend.length;
  const W = 1000;
  const H = 360;
  const P = 40;
  const base = H - 40;
  const sc = 240 / Math.max(1, scale);
  const step = n > 1 ? (W - 2 * P) / (n - 1) : 0;
  const pts = (vals) => vals.map((v, i) => ({ x: P + i * step, y: base - v * sc }));
  const pa = pts(series.a);
  const pb = pts(series.b);
  const lineA = buildSmoothPath(pa);
  const lineB = buildSmoothPath(pb);
  const areaA = pa.length > 0 ? lineA + ' L ' + pa[pa.length - 1].x + ' ' + base + ' L ' + pa[0].x + ' ' + base + ' Z' : '';
  const areaB = pb.length > 0 ? lineB + ' L ' + pb[pb.length - 1].x + ' ' + base + ' L ' + pb[0].x + ' ' + base + ' Z' : '';
  return { pa, pb, lineA, lineB, areaA, areaB, step, base };
}

/** مدلِ کاملِ نمودارِ ۶ برایِ یک معیار و بازه (سری + مقیاس + هندسه). */
export function buildDualModel(scopedDays, notesByDay, metricIdx, rangeIdx) {
  const series = buildDualSeriesData(scopedDays, notesByDay, metricIdx, rangeIdx);
  const scale = dualScaleMax(Math.max(1, ...series.a, ...series.b));
  const geom = buildDualGeomData(series, scale);
  return { series, geom, scale, metricIdx, rangeIdx };
}

// ---------------------------------------------------------------------------
// سازنده‌هایِ رشتهٔ HTMLِ ۶ نمودار (همان ساختارِ JSX در مرحلهٔ ۴۶؛ فقط
// به رشته تبدیل شده‌اند تا موتور، یک‌ضربه رندر کند).
// ---------------------------------------------------------------------------

/** نمودارِ ۱ — گیج‌هایِ ۷ روزهٔ صفحات + تغییر نسبت به روزِ قبل. */
function buildDialHtml(dial) {
  const gauges = [...dial].reverse().map((d, ri) => {
    const cx = 930 - ri * 140;
    const cy = 95;
    const R = 52;
    const a0 = Math.PI * 0.75;
    const sw = Math.PI * 1.5 * (d.pages / Math.max(1, d.max));
    const len = R * sw;
    const acc = DASH44_ACC[ri % DASH44_ACC.length];
    const deltaTxt = d.delta === null ? '' : (d.delta >= 0 ? '+' : '−') + Math.abs(d.delta);
    const deltaCol = d.delta === null ? 'var(--c3)' : (d.delta >= 0 ? 'var(--c3)' : 'var(--c5)');
    const ticks = [0, 1, 2, 3, 4].map((k) => {
      const an = a0 + (Math.PI * 1.5 * k) / 4;
      return '<line class="dtick" x1="' + (cx + Math.cos(an) * 60).toFixed(1) + '" y1="' + (cy + Math.sin(an) * 60).toFixed(1) + '" x2="' + (cx + Math.cos(an) * 66).toFixed(1) + '" y2="' + (cy + Math.sin(an) * 66).toFixed(1) + '" />';
    }).join('');
    const arc = sw > 0.02
      ? '<path class="darcGlow" style="--len:' + len.toFixed(1) + ';--d:' + (ri * 100) + 'ms;color:' + acc + ';stroke:currentColor" d="' + dashArcPath(cx, cy, R, a0, a0 + sw) + '" />'
        + '<path class="darc" style="--len:' + len.toFixed(1) + ';--d:' + (ri * 100) + 'ms;color:' + acc + ';stroke:currentColor" d="' + dashArcPath(cx, cy, R, a0, a0 + sw) + '" />'
      : '';
    const delta = deltaTxt
      ? '<text class="ddl" x="' + cx + '" y="' + (cy + 26) + '" text-anchor="middle" fill="' + deltaCol + '">' + deltaTxt + '</text>'
      : '';
    return '<g class="dialG" data-tip="' + escHtml(d.label + ' — ' + d.pages + ' صفحه') + '">'
      + '<path class="dtrack" d="' + dashArcPath(cx, cy, R, a0, a0 + Math.PI * 1.5) + '" />'
      + arc + ticks
      + '<text class="dnum num cu" x="' + cx + '" y="' + (cy + 8) + '" text-anchor="middle" data-cu="' + d.pages + '">' + d.pages + '</text>'
      + delta
      + '<text x="' + cx + '" y="' + (cy + 88) + '" text-anchor="middle">' + escHtml(d.label) + '</text>'
      + '</g>';
  }).join('');
  return '<section class="card reveal" style="--tag:var(--c1)">'
    + '<h2>نمودار ۱ — گیج‌های هفتهٔ خواندن</h2>'
    + '<p class="mut">هر روز یک گیجِ ۲۷۰ درجه با درجه‌بندی؛ عددِ مرکز = صفحات دقیق، عددِ پایین = تغییر نسبت به روز قبل</p>'
    + '<svg class="chart" viewBox="0 0 1000 210" style="margin-top:16px">' + gauges + '</svg>'
    + '</section>';
}

/** نمودارِ ۲ — بلابِ استعداد و مهارت مطالعه (۵ شاخصِ اسکوپ‌شده). */
function buildBlobHtml(blob) {
  const grid = [0.33, 0.66, 1].map((f) => '<circle class="bgrid" cx="' + blob.c + '" cy="' + blob.cy + '" r="' + (blob.R * f).toFixed(1) + '" />').join('');
  const spokes = blob.list.map((s, i) => {
    const x = blob.c + Math.cos(blob.ax(i)) * blob.R;
    const y = blob.cy + Math.sin(blob.ax(i)) * blob.R;
    return '<line class="bsp" x1="' + blob.c + '" y1="' + blob.cy + '" x2="' + x.toFixed(1) + '" y2="' + y.toFixed(1) + '" />';
  }).join('');
  const vertices = blob.pts.map((p, i) => {
    const s = blob.list[i];
    return '<circle class="bvHalo" cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="9" style="--dd:' + (0.45 + i * 0.11).toFixed(2) + 's;stroke:' + escHtml(s.color) + '" data-blob-idx="' + i + '" />'
      + '<circle class="bv" cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="5.5" style="--dd:' + (0.45 + i * 0.11).toFixed(2) + 's;stroke:' + escHtml(s.color) + ';color:' + escHtml(s.color) + '" data-blob-idx="' + i + '" data-tip="' + escHtml(s.name + ' — ' + s.value + ' از 100') + '" />';
  }).join('');
  const labels = blob.list.map((s, i) => {
    const x = blob.c + Math.cos(blob.ax(i)) * blob.R * 1.26;
    const y = blob.cy + Math.sin(blob.ax(i)) * blob.R * 1.26;
    const co = Math.cos(blob.ax(i));
    const an = co > 0.35 ? 'start' : (co < -0.35 ? 'end' : 'middle');
    return '<text class="blab" x="' + x.toFixed(1) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="' + an + '" style="--dd:' + (0.45 + i * 0.11).toFixed(2) + 's">' + escHtml(s.short) + '</text>';
  }).join('');
  const poly = blob.path
    ? '<path class="blobGlow" d="' + blob.path + '" stroke="url(#bS)" /><path class="blobP" d="' + blob.path + '" fill="url(#bG)" stroke="url(#bS)" stroke-width="2.5" stroke-linejoin="round" />'
    : '';
  const chips = blob.list.length > 0
    ? blob.list.map((s, i) => '<div class="chip" style="--ac:' + escHtml(s.color) + ';--d:' + (0.15 + i * 0.09).toFixed(2) + 's" data-blob-idx="' + i + '"><i></i><div><h4>' + escHtml(s.name) + '</h4><p>' + escHtml(s.desc) + '</p><div class="cbar" style="--w:' + s.value + '%"><i></i></div></div><b class="num cu" data-cu="' + s.value + '">' + s.value + '</b></div>').join('')
    : '<p class="mut">در حال بارگذاریِ آمار…</p>';
  return '<section class="card reveal" style="--tag:var(--c2)">'
    + '<h2>نمودار ۲ — بلابِ استعداد و مهارت مطالعه</h2>'
    + '<p class="mut">یک شکل ارگانیک برای پنج شاخص؛ هاور روی رأس‌ها یا کارت‌ها همگام می‌شود.</p>'
    + '<div class="blobWrap"><div class="blobRel"><svg class="chart" viewBox="0 0 340 320">'
    + '<defs><linearGradient id="bS" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#22d3ee" /><stop offset="1" stop-color="#a78bfa" /></linearGradient>'
    + '<radialGradient id="bG"><stop offset="0" stop-color="rgba(34,211,238,.30)" /><stop offset="1" stop-color="rgba(167,139,250,.10)" /></radialGradient></defs>'
    + '<circle class="spin" cx="' + blob.c + '" cy="' + blob.cy + '" r="132" />'
    + grid + spokes
    + '<g id="bpoly">' + poly + vertices + '</g>'
    + labels
    + '</svg></div><div class="chips">' + chips + '</div></div>'
    + '</section>';
}

/** نمودارِ ۳ — موزاییکِ سهم کتاب‌ها (دقیقاً ۱۰۰ کاشی با باقیماندهٔ بزرگ‌تر). */
function buildWaffleHtml(waffle) {
  const tiles = waffle.tiles.map((bi, t) => {
    const row = Math.floor(t / 10);
    const col = 9 - (t % 10);
    const x = 10 + col * 40;
    const y = 10 + row * 40;
    const entry = bi < 0 ? null : waffle.entries[bi];
    const color = bi < 0 ? '#22303c' : DASH44_ACC[bi % DASH44_ACC.length];
    const pct = entry ? Math.round((entry.seconds / Math.max(1, waffle.totalSeconds)) * 100) : 0;
    const tip = entry ? entry.name + ' — ' + pct + '٪ (' + Math.round(entry.seconds / 60) + ' دقیقه)' : 'بدونِ زمانِ ثبت‌شده';
    return '<rect class="wtile" x="' + x + '" y="' + y + '" width="34" height="34" rx="8" fill="' + color + '" fill-opacity="' + (bi < 0 ? 0.35 : 0.7) + '" style="--d:' + (t * 9) + 'ms" data-tip="' + escHtml(tip) + '" />';
  }).join('');
  const legend = waffle.entries.length > 0
    ? waffle.entries.map((e, i) => {
      const pct = Math.round((e.seconds / Math.max(1, waffle.totalSeconds)) * 100);
      const tilesCount = waffle.tiles.filter((bi) => bi === i).length;
      return '<div class="chip" style="--ac:' + DASH44_ACC[i % DASH44_ACC.length] + ';--d:' + (0.2 + i * 0.08).toFixed(2) + 's"><i></i><div><h4>' + escHtml(e.name) + '</h4><p>' + Math.round(e.seconds / 60) + ' دقیقه · ' + tilesCount + ' کاشی</p></div><b class="num">' + pct + '٪</b></div>';
    }).join('')
    : '<p class="mut">هنوز زمانِ ثبت‌شده‌ای برایِ کتاب‌هایِ این تب وجود ندارد؛ پس از چند نشستِ مطالعه، موزاییک این‌جا پر می‌شود.</p>';
  return '<section class="card reveal" style="--tag:var(--c4)">'
    + '<h2>نمودار ۳ — موزاییکِ سهم کتاب‌ها</h2>'
    + '<p class="mut">هر کاشی = دقیقاً ۱٪ از زمان مطالعه؛ مجموع زمان: <b class="num">' + waffle.totalMinutes + '</b> دقیقه</p>'
    + '<svg class="chart waffleSvg" viewBox="0 0 410 410" style="margin-top:14px;max-width:430px;margin-inline:auto">' + tiles + '</svg>'
    + '<div class="wleg chips">' + legend + '</div>'
    + '</section>';
}

/** نمودارِ ۴ — ساعتِ ماه: تیک‌های دقیقه‌ایِ ۳۰ روزِ اخیر. */
function buildClockHtml(clock, streak) {
  const rings = [60, 120, 180].map((gm) => '<g><circle class="cring" cx="170" cy="170" r="' + clockRadiusFor(gm).toFixed(1) + '" /><text class="glab" x="176" y="' + (170 - clockRadiusFor(gm) - 5).toFixed(1) + '">' + gm + '</text></g>').join('');
  const ticks = clock.days.map((d, i) => {
    const a = -Math.PI / 2 + i * (Math.PI * 2 / 30);
    const r1 = clockRadiusFor(d.minutes);
    const len = Math.max(r1 - 70, 2);
    const stroke = d.minutes > 0 ? 'rgba(34,211,238,' + (0.35 + 0.55 * (Math.min(d.minutes, 180) / 180)).toFixed(2) + ')' : '#22303c';
    return '<line class="ctic" style="--len:' + len.toFixed(1) + ';--d:' + (i * 35) + 'ms" x1="' + (170 + Math.cos(a) * 70).toFixed(1) + '" y1="' + (170 + Math.sin(a) * 70).toFixed(1) + '" x2="' + (170 + Math.cos(a) * r1).toFixed(1) + '" y2="' + (170 + Math.sin(a) * r1).toFixed(1) + '" stroke="' + stroke + '" data-tip="' + escHtml(d.label + ' — ' + d.minutes + ' دقیقه') + '" />';
  }).join('');
  const maxLabel = clock.days[clock.maxI] ? 'روز ' + clock.days[clock.maxI].label : '—';
  return '<section class="card reveal" style="--d:.1s;--tag:var(--c3)">'
    + '<h2>نمودار ۴ — ساعتِ ماه: تیک‌های دقیقه‌ای</h2>'
    + '<p class="mut">هر تیک یک روز؛ طول تیک روی خط‌کش حلقه‌ای (۶۰ / ۱۲۰ / ۱۸۰ دقیقه) قابل سنجش است</p>'
    + '<div class="clockWrap"><div class="clockRel"><svg class="chart" viewBox="0 0 340 340">'
    + rings + ticks
    + '<text class="cnum num cu" x="170" y="166" text-anchor="middle" data-cu="' + clock.total + '">' + clock.total + '</text>'
    + '<text x="170" y="186" text-anchor="middle">دقیقه در ۳۰ روز</text>'
    + '<text class="cstk" x="170" y="206" text-anchor="middle">' + streak + ' روز پیوسته</text>'
    + '</svg></div><div class="chips">'
    + '<div class="chip" style="--ac:var(--c1);--d:.1s"><i></i><div><h4>مجموع دقیقه</h4><p>سی روز اخیر</p></div><b class="num">' + clock.total + '</b></div>'
    + '<div class="chip" style="--ac:var(--c3);--d:.2s"><i></i><div><h4>روزهای فعال</h4><p>از ۳۰ روز</p></div><b class="num">' + clock.active + '</b></div>'
    + '<div class="chip" style="--ac:var(--c5);--d:.3s"><i></i><div><h4>سنگین‌ترین روز</h4><p>' + escHtml(maxLabel) + '</p></div><b class="num">' + clock.maxV + '</b></div>'
    + '</div></div></section>';
}

/** نمودارِ ۵ — تراسِ روزهای هفته (شنبه تا جمعه). */
function buildTerraceHtml(dow, dowMax, bestDow, terrace) {
  const best = bestDow && bestDow.minutes > 0
    ? '<p class="mut">پربازده‌ترین روزِ هفتهٔ شما: ' + escHtml(bestDow.label) + ' (' + bestDow.minutes + ' دقیقه، ' + bestDow.pages + ' صفحه)</p>'
    : '';
  const cols = dow.map((w, i) => {
    const xr = 940 - i * 132;
    const cx = xr - 66;
    const col = w.minutes === dowMax && w.minutes > 0 ? 'var(--c5)' : 'var(--c1)';
    const y = terrace.ys[i];
    return '<g><rect class="tcol" x="' + (xr - 132) + '" y="26" width="132" height="206" data-tip="' + escHtml(w.label + ' — ' + w.minutes + ' دقیقه') + '" />'
      + '<circle class="terHalo" cx="' + cx + '" cy="' + y + '" r="10" style="--d:' + (0.35 + i * 0.09).toFixed(2) + 's;stroke:' + col + '" />'
      + '<circle class="terDot" cx="' + cx + '" cy="' + y + '" r="6" fill="' + col + '" style="--d:' + (0.35 + i * 0.09).toFixed(2) + 's;color:' + col + '" data-tip="' + escHtml(w.label + ' — ' + w.minutes + ' دقیقه') + '" />'
      + '<text class="terLv" x="' + cx + '" y="' + (y - 14) + '" text-anchor="middle" style="--d:' + (0.35 + i * 0.09).toFixed(2) + 's">' + w.minutes + '</text>'
      + '<text x="' + cx + '" y="252" text-anchor="middle">' + escHtml(w.label) + '</text></g>';
  }).join('');
  return '<section class="card reveal" style="--tag:var(--c5)">'
    + '<h2>نمودار ۵ — تراسِ روزهای هفته</h2>'
    + '<p class="mut">پله‌ها سطحِ دقیقهٔ هر روز را نشان می‌دهند؛ اعداد روی هر پله درج شده‌اند</p>'
    + best
    + '<svg class="chart" viewBox="0 0 1000 262" style="margin-top:16px">'
    + '<defs><linearGradient id="terG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgba(34,211,238,.30)" /><stop offset="1" stop-color="rgba(34,211,238,.02)" /></linearGradient></defs>'
    + (terrace.fill ? '<path class="terF" fill="url(#terG)" d="' + terrace.fill + '" />' : '')
    + (terrace.stroke ? '<path class="terGlow" d="' + terrace.stroke + '" />' : '')
    + (terrace.stroke ? '<path class="terL" d="' + terrace.stroke + '" />' : '')
    + cols
    + '</svg></section>';
}

/** SVG نمودارِ ۶ (روبانِ دوتایی) برایِ یک مدل؛ ورودِ پردهٔ clip با keyframe رویِ مانت است (بدونِ کلاسِ go)؛ کلاسِ go فقط محوشدنِ خط‌ها و ناحیه‌ها را می‌سازد. */
function buildDualSvgHtml(model) {
  const dual = model.series;
  const geom = model.geom;
  const scale = model.scale;
  const grid = [];
  for (let v = 0; v <= scale; v += 50) {
    const gy = 320 - (v * 240) / scale;
    grid.push('<g><line class="grid" x1="40" y1="' + gy.toFixed(1) + '" x2="960" y2="' + gy.toFixed(1) + '" /><text class="glab" x="34" y="' + (gy + 3).toFixed(1) + '" text-anchor="end">' + v + '</text></g>');
  }
  const dotsA = geom.pa.map((p, i) => '<circle class="pdA" cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="4.5" data-tip="' + escHtml('روز ' + dual.trend[i].label + ' — ' + dual.metric.label + ': ' + dashFormatNum(dual.a[i]) + ' ' + dual.metric.unit) + '" />').join('');
  const dotsB = geom.pb.map((p, i) => '<circle class="pdB" cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="4" data-tip="' + escHtml('روز ' + dual.trend[i].label + ' — میانگینِ متحرکِ ۳ روزه: ' + dashFormatNum(dual.b[i]) + ' ' + dual.metric.unit) + '" />').join('');
  const endLabels = geom.pa.length > 0
    ? '<text class="elab" x="' + (geom.pa[geom.pa.length - 1].x - 10).toFixed(1) + '" y="' + (geom.pa[geom.pa.length - 1].y - 10).toFixed(1) + '" text-anchor="end" fill="var(--c1)">' + dashFormatNum(dual.a[dual.a.length - 1]) + '</text>'
      + '<text class="elab" x="' + (geom.pb[geom.pb.length - 1].x - 10).toFixed(1) + '" y="' + (geom.pb[geom.pb.length - 1].y + 18).toFixed(1) + '" text-anchor="end" fill="var(--c5)">' + dashFormatNum(dual.b[dual.b.length - 1]) + '</text>'
    : '';
  const lastIdx = Math.max(0, dual.trend.length - 1);
  const xlX = 40 + lastIdx * geom.step;
  return '<svg class="chart dualSvg" viewBox="0 0 1000 360" data-dual-svg="1">'
    + '<defs><linearGradient id="gA" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgba(34,211,238,.42)" /><stop offset="1" stop-color="rgba(34,211,238,.02)" /></linearGradient>'
    + '<linearGradient id="gB2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgba(244,114,182,.34)" /><stop offset="1" stop-color="rgba(244,114,182,.02)" /></linearGradient>'
    + '<clipPath id="clipMain"><rect x="0" y="0" width="1000" height="360" /></clipPath></defs>'
    + grid.join('')
    + '<g clipPath="url(#clipMain)">'
    + (geom.areaA ? '<path class="arA" fill="url(#gA)" d="' + geom.areaA + '" />' : '')
    + (geom.areaB ? '<path class="arB" fill="url(#gB2)" d="' + geom.areaB + '" />' : '')
    + (geom.lineA ? '<path class="eAGlow" d="' + geom.lineA + '" />' : '')
    + (geom.lineA ? '<path class="eA" d="' + geom.lineA + '" />' : '')
    + (geom.lineB ? '<path class="eBGlow" d="' + geom.lineB + '" />' : '')
    + (geom.lineB ? '<path class="eB" d="' + geom.lineB + '" />' : '')
    + '</g>' + dotsA + dotsB + endLabels
    + '<line class="xl" data-dual-xl="1" x1="' + xlX + '" x2="' + xlX + '" y1="28" y2="332" style="opacity:0" />'
    + '</svg>';
}

/** کارتِ کاملِ نمودارِ ۶ (قرص‌ها + پنلِ HUD + جایگاهِ SVG + یادداشتِ معیارِ نشانه‌ها). */
function buildDualSectionHtml(model) {
  const dual = model.series;
  const metricPills = DASH44_DUAL_METRICS.map((m, i) => '<button type="button" class="pill' + (model.metricIdx === i ? ' on' : '') + '" data-dual-metric="' + i + '">' + escHtml(m.label) + '</button>').join('');
  const rangePills = DASH44_DUAL_RANGES.map((r, i) => '<button type="button" class="pill' + (model.rangeIdx === i ? ' on' : '') + '" data-dual-range="' + i + '">' + r + ' روز</button>').join('');
  const lastIdx = dual.trend.length - 1;
  const last = dual.trend[lastIdx];
  return '<section class="card reveal" style="--tag:var(--c6)">'
    + '<div class="lineHead"><div><h2>نمودار ۶ — روبانِ عملکرد با پنل خوانش دقیق</h2>'
    + '<p class="mut">پنل شیشه‌ای همیشه اعداد دقیق روز را نشان می‌دهد؛ با حرکت ماوس روی نمودار، روز به‌روز می‌شود</p></div>'
    + '<div class="pills">' + metricPills + '</div>'
    + '<div class="pills">' + rangePills + '</div></div>'
    + '<div class="wbox"><div class="hud">'
    + '<span data-hud-date="1">' + (last ? 'روز ' + escHtml(last.label) : '—') + '</span>'
    + '<div><i style="background:var(--c1)"></i><span data-hud-metric="1">' + escHtml(dual.metric.label) + '</span> <b data-hud-a="1">' + (last ? dashFormatNum(dual.a[lastIdx]) : '—') + '</b> <span data-hud-unit="1">' + escHtml(dual.metric.unit) + '</span></div>'
    + '<div><i style="background:var(--c5)"></i>میانگینِ متحرکِ ۳ روزه <b data-hud-b="1">' + (last ? dashFormatNum(dual.b[lastIdx]) : '—') + '</b> <span data-hud-unit="1">' + escHtml(dual.metric.unit) + '</span></div>'
    + '</div><div data-dual-svg-wrap="1">' + buildDualSvgHtml(model) + '</div></div>'
    + '<p class="mut" data-dual-marks-note="1"' + (model.metricIdx === 2 ? '' : ' style="display:none"') + '>در این نمودار، همهٔ بوک‌مارک‌ها و حاشیه‌نویسی‌هایِ کتاب‌هایِ این اسکوپ شمرده می‌شوند؛ نشانه‌هایِ بدونِ تاریخ، رویِ روزهایِ مطالعهٔ همان کتاب توزیع شده‌اند.</p>'
    + '</section>';
}

/**
 * بازنویسیِ دستوریِ نمودارِ ۶ پس از کلیک رویِ قرص‌ها: فقط SVG عوض می‌شود،
 * قرص‌ها و HUD به‌روز می‌شوند و ورودِ clip دوباره اجرا می‌شود — بدونِ
 * setState و بدونِ دست‌زدن به ۵ نمودارِ دیگر.
 */
function renderDualInto(root, model) {
  if (!root || !model) return;
  const wrap = root.querySelector('[data-dual-svg-wrap]');
  if (wrap) wrap.innerHTML = buildDualSvgHtml(model);
  root.querySelectorAll('[data-dual-metric]').forEach((el) => {
    el.classList.toggle('on', Number(el.getAttribute('data-dual-metric')) === model.metricIdx);
  });
  root.querySelectorAll('[data-dual-range]').forEach((el) => {
    el.classList.toggle('on', Number(el.getAttribute('data-dual-range')) === model.rangeIdx);
  });
  const metricEl = root.querySelector('[data-hud-metric]');
  if (metricEl) metricEl.textContent = model.series.metric.label;
  root.querySelectorAll('[data-hud-unit]').forEach((el) => {
    el.textContent = model.series.metric.unit;
  });
  root._dashDual = {
    trend: model.series.trend,
    a: model.series.a,
    b: model.series.b,
    metric: model.series.metric,
    step: model.geom.step,
  };
  resetDualHover(root);
  const note = root.querySelector('[data-dual-marks-note]');
  if (note) note.style.display = model.metricIdx === 2 ? '' : 'none';
  const svg = wrap ? wrap.querySelector('[data-dual-svg]') : null;
  if (svg) requestAnimationFrame(() => { svg.classList.add('go'); });
}

// ---------------------------------------------------------------------------
// رشتهٔ کاملِ داشبورد و رشتهٔ هدفِ روزانه (ورودیِ میزبان‌هایِ موتور).
// ---------------------------------------------------------------------------

/** بلوکِ هدفِ روزانه (بالایِ مرکزِ فرمان؛ همان محتوایِ مرحلهٔ ۴۶). */
export function buildGoalHtml(scopedSummary, dailyGoal) {
  if (!scopedSummary) {
    return '<div class="reveal"><p class="eyebrow"><i></i> هدفِ روزانهٔ مطالعه</p>'
      + '<div class="dashTitle">در حال بارگذاریِ آمار…</div></div>';
  }
  const goal = Number(dailyGoal) || 50;
  const pct = Math.min(100, Math.round((scopedSummary.todayPages / Math.max(1, goal)) * 100));
  const minutes = Math.round((scopedSummary.todaySeconds || 0) / 60);
  const done = scopedSummary.todayPages >= goal ? ' هدفِ امروز کامل شد.' : '';
  return '<div class="reveal"><p class="eyebrow"><i></i> هدفِ روزانهٔ مطالعه</p>'
    + '<div class="dashTitle">هدف امروز: <em class="num cu" data-cu="' + scopedSummary.todayPages + '">' + scopedSummary.todayPages + '</em> از <span class="num goalNumEditable" data-goal-edit="1" title="برایِ ویرایشِ هدف کلیک کن">' + goal + '</span> صفحه</div>'
    + '<div class="goal"><span class="badge num">' + pct + '٪</span><div class="track"><i class="fill" style="--w:' + pct + '%"></i></div></div>'
    + '<p class="mut">امروز ' + minutes + ' دقیقه مطالعه در این اسکوپ ثبت شده است.' + escHtml(done) + '</p></div>';
}

/** رشتهٔ کاملِ داشبوردِ ۶ نموداره (هدر + نمودارهایِ ۱ تا ۶ + پانوشت + تولتیپ). */
export function buildDashboardHtml(input) {
  const dial = input.dial;
  const blob = input.blob;
  const waffle = input.waffle;
  const clock = input.clock;
  const dow = input.dow;
  const dowMax = input.dowMax;
  const bestDow = input.bestDow;
  const terrace = input.terrace;
  const dual = input.dual;
  const scopedSummary = input.scopedSummary;
  const scopedData = input.scopedData;
  const activeView = input.activeView;
  const streak = scopedSummary ? scopedSummary.currentStreak : 0;
  const header = scopedSummary
    ? '<div class="dashTitle">' + (activeView ? 'آماربندی «' + escHtml(activeView.name) + '»' : 'آمار کل کتابخانه') + '</div>'
      + '<p class="mut">' + escHtml('مجموعِ این اسکوپ: ' + formatReadingHours(scopedSummary.totalSeconds) + ' مطالعه، ' + scopedSummary.totalPages + ' صفحه، در ' + scopedData.totalBooks + ' کتاب — نمودارهایِ زیر، فقط برایِ همین اسکوپ حساب شده‌اند.') + '</p>'
    : '<div class="dashTitle">در حال بارگذاریِ آمار…</div>';
  return '<div class="reveal"><p class="eyebrow"><i></i> داشبوردِ تحلیلیِ چندنموداره و خودشناسی مطالعه</p>'
    + header
    + '</div>'
    + buildDialHtml(dial)
    + buildBlobHtml(blob)
    + '<div class="two">' + buildWaffleHtml(waffle) + buildClockHtml(clock, streak) + '</div>'
    + buildTerraceHtml(dow, dowMax, bestDow, terrace)
    + buildDualSectionHtml(dual)
    + '<p class="dashFoot">فونت استعداد + Manrope — تمام نمودارها SVG دست‌ساز، بدون کتابخانهٔ خارجی</p>'
    + '<div class="dash44Tip"></div>';
}

// ---------------------------------------------------------------------------
// میزبانِ memoشدهٔ موتور: یک div که رشتهٔ HTML را می‌گیرد و با یک افکت،
// سیم‌کشیِ ورود/شمارنده/تولتیپ را رویِ همان رشته انجام می‌دهد. تا وقتی
// رشته عوض نشده، React به DOM دست نمی‌زند (مرزِ memo برایِ داشبورد).
// مرحلهٔ ۴۹ §۱ — امضایِ دادهٔ موتور (dataSignatureKey) و مقایسه‌گرِ
// دقیقِ رشته‌ایِ HtmlEngine: امضا، خودِ رشتهٔ HTML است (بدونِ هش — پس
// هیچ ریسکِ برخوردی نیست) و مقایسه‌گر، وقتی رشته دقیقاً یکی است، بازرندر
// را می‌گیرد؛ پس DOM نمودارها دقیقاً یک بار ساخته می‌شود و وسطِ انیمیشن
// بازسازی نمی‌شود. وقتی داده عوض شود، رشته هم عوض می‌شود و بازسازی انجام
// می‌شود. dual و onDual و className و style هم با هویتِ مرجع مقایسه
// می‌شوند، چون سیم‌کشیِ دستوریِ نمودارِ ۶ (_dashDual) به آن‌ها وابسته است؛
// در عمل، هر تغییرِ dual، رشتهٔ HTML را هم عوض می‌کند (رشته از همان مدل
// ساخته می‌شود)، پس این شرطِ اضافه، فقط یک گاردِ ایمنی است و جلویِ
// بازسازیِ لازم را نمی‌گیرد.
// ---------------------------------------------------------------------------

/** امضایِ قابلِ مقایسهٔ رشتهٔ HTML موتور (خودِ رشته؛ بدونِ هش). */
export function dataSignatureKey(html) {
  return typeof html === 'string' ? html : '';
}

/** مقایسه‌گرِ memo موتورِ HTML: رشتهٔ یکسان یعنی بازسازی لازم نیست. */
export function htmlEngineAreEqual(prev, next) {
  if (!prev || !next) return false;
  if (dataSignatureKey(prev.html) !== dataSignatureKey(next.html)) return false;
  if (prev.dual !== next.dual) return false;
  if (prev.onDual !== next.onDual) return false;
  if (prev.onGoalChange !== next.onGoalChange) return false;
  if (prev.className !== next.className) return false;
  if (prev.style !== next.style) return false;
  return true;
}

const HtmlEngine = React.memo(function HtmlEngine({ html, className, style, dual, onDual, onGoalChange }) {
  const rootRef = useRef(null);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    if (dual) {
      root._dashDual = {
        trend: dual.series.trend,
        a: dual.series.a,
        b: dual.series.b,
        metric: dual.series.metric,
        step: dual.geom.step,
      };
    }
    return wireDashEngine(root, onDual || null, onGoalChange || null);
  }, [html, dual, onDual, onGoalChange]);
  return <div ref={rootRef} className={className} style={style} dangerouslySetInnerHTML={{ __html: html }} />;
}, htmlEngineAreEqual);

// استایلِ ثابتِ میزبانِ هدف (شیءِ سطحِ ماژول تا memoِ HtmlEngine با هویتِ
// تازهٔ style در هر رندر بی‌اثر نشود).
const GOAL_HOST_STYLE = { padding: '20px 22px' };


// هویتِ بصریِ کاملِ HTML — به‌صورتِ <style> داخلیِ کامپوننت (بدونِ فایلِ CSS جدا).
// پیشوندِ .js در HTML با .dash44 جایگزین شده است؛ #tip و #hud هم کلاس شده‌اند.
const DASH44_CSS = `
.dash44{--bg:#0a0e14;--card:#10161f;--card2:#0d131b;--line:#1e2a38;--line2:#2b3b4e;--ink:#eaf2fa;--mut:#9aa8b8;--c1:#22d3ee;--c2:#a78bfa;--c3:#34d399;--c4:#fbbf24;--c5:#f472b6;--c6:#60a5fa;--c7:#fb7185;background:var(--bg);color:var(--ink);font-family:'Estedad','Manrope',Tahoma,sans-serif;border:1px solid var(--line);border-radius:18px;padding:26px;box-sizing:border-box;width:100%;max-width:1440px;margin-inline:auto}
.dash44 .num,.dash44 b{font-family:'Manrope','Estedad',Tahoma}
.dash44 svg text{font-family:'Estedad',Tahoma;fill:var(--mut);font-size:11px}
.dash44 .reveal:not(.in-view){opacity:0;transform:translate3d(0,28px,0)}
.dash44 .reveal.in-view{animation:dashRevealIn .75s cubic-bezier(.2,.75,.2,1) var(--d,0s) both}
.dash44 .reveal:not(.in-view) .fill,.dash44 .reveal:not(.in-view) .cbar i,.dash44 .reveal:not(.in-view) #clipMain rect{transform:scaleX(0)}
.dash44 .reveal:not(.in-view) .darc,.dash44 .reveal:not(.in-view) .darcGlow,.dash44 .reveal:not(.in-view) .ctic{stroke-dashoffset:var(--len)}.dash44 .reveal:not(.in-view) .terL{stroke-dashoffset:2400}
.dash44 .reveal:not(.in-view) #bpoly,.dash44 .reveal:not(.in-view) .bv,.dash44 .reveal:not(.in-view) .terDot{opacity:0;transform:scale(0)}
.dash44 .reveal:not(.in-view) .wtile{opacity:0}
@keyframes dashRevealIn{from{opacity:0;transform:translate3d(0,24px,0)}to{opacity:1;transform:translate3d(0,0,0)}}
@keyframes dashFillBar{from{transform:scaleX(0)}to{transform:scaleX(1)}}
@keyframes dashStrokeSweep{from{stroke-dashoffset:var(--len)}to{stroke-dashoffset:0}}
@keyframes dashPopScale{0%{opacity:0;transform:scale(0)}75%{opacity:1;transform:scale(1.06)}100%{opacity:1;transform:scale(1)}}
@keyframes dashTileFade{from{opacity:0}to{opacity:1}}
@keyframes dashChipBar{from{transform:scaleX(0)}to{transform:scaleX(1)}}
@keyframes dashLineDraw{from{stroke-dashoffset:2400;fill-opacity:0}to{stroke-dashoffset:0;fill-opacity:1}}
@keyframes dashCurtainOpen{from{transform:scaleX(0)}to{transform:scaleX(1)}}
.dash44 .eyebrow{display:flex;gap:10px;align-items:center;color:var(--mut);font-size:12.5px}
.dash44 .eyebrow i{width:8px;height:8px;border-radius:50%;background:var(--c3);box-shadow:0 0 12px var(--c3);animation:dash44beat 1.8s ease 2}
@keyframes dash44beat{50%{transform:scale(1.5);opacity:.5}}
.dash44 .dashTitle{font-size:clamp(25px,3.8vw,40px);font-weight:800;margin:12px 0 20px}
.dash44 .dashTitle em{font-style:normal;color:var(--c1);text-shadow:0 0 22px rgba(34,211,238,.5)}
.dash44 .goal{display:flex;align-items:center;gap:14px}
.dash44 .goalNumEditable{cursor:pointer;border-bottom:1px dashed rgba(34,211,238,.6)}
.dash44 .goalNumEditable:hover{color:var(--c1)}
.dash44 .goalNumInput{width:96px;font:inherit;color:var(--ink);background:#0d131b;border:1px solid var(--c1);border-radius:8px;padding:2px 8px;direction:ltr;text-align:center}
.dash44 .goalNumSave{font:inherit;font-size:12px;color:#04121a;background:linear-gradient(90deg,var(--c1),#67e8f9);border:0;border-radius:99px;padding:3px 10px;cursor:pointer;margin-inline-start:6px}
.dash44 .badge{color:#04121a;background:linear-gradient(90deg,var(--c1),#67e8f9);padding:6px 15px;border-radius:99px;font-weight:800;font-size:12.5px;box-shadow:0 0 22px rgba(34,211,238,.45)}
.dash44 .track{flex:1;height:12px;border-radius:99px;background:#141c27;overflow:hidden;position:relative}
.dash44 .fill{position:absolute;inset:0;border-radius:inherit;background:linear-gradient(90deg,var(--c1),var(--c3));box-shadow:0 0 24px rgba(34,211,238,.55);width:var(--w);transform:scaleX(0);transform-origin:right center}
.dash44 .reveal.in-view .fill{animation:dashFillBar 1.4s cubic-bezier(.2,.8,.2,1) .2s both}
.dash44 .fill::after{content:"";position:absolute;inset:0;background:repeating-linear-gradient(45deg,rgba(255,255,255,.22) 0 10px,transparent 10px 20px);animation:dash44slide 1.1s linear 2}
.dash44 .card{position:relative;background:var(--card);border:1px solid var(--line);border-radius:18px;padding:26px;margin-top:26px;overflow:hidden;transition:transform .35s cubic-bezier(.2,.8,.2,1),border-color .35s,box-shadow .35s}
.dash44 .card::before{content:"";position:absolute;top:0;right:0;width:42%;height:2px;background:linear-gradient(90deg,var(--c1),transparent);opacity:.7}
.dash44 .card:hover{transform:translateY(-5px) !important;border-color:var(--line2);box-shadow:0 12px 28px rgba(0,0,0,.4)}
.dash44 h2{font-size:16.5px;font-weight:700;display:flex;align-items:center;gap:9px}
.dash44 h2::before{content:"";width:8px;height:8px;border-radius:2px;background:var(--tag,var(--c1));box-shadow:0 0 10px var(--tag,var(--c1))}
.dash44 .mut{color:var(--mut);font-size:12.5px;margin-top:7px;line-height:1.9}
.dash44 .two{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.dash44 svg.chart{width:100%;height:auto;display:block}
.dash44.is-scrolling svg.chart{pointer-events:none}
.dash44 .dtrack{fill:none;stroke:rgba(255,255,255,.08);stroke-width:9;stroke-linecap:round}
.dash44 .darc{fill:none;stroke-width:9;stroke-linecap:round;stroke-dasharray:var(--len);stroke-dashoffset:var(--len);transition:stroke-width .25s}
.dash44 .reveal.in-view .darc{animation:dashStrokeSweep 1.2s cubic-bezier(.2,.8,.2,1) var(--d,.1s) both}
.dash44 .darcGlow{fill:none;stroke-width:13;stroke-linecap:round;opacity:.22;stroke-dasharray:var(--len);stroke-dashoffset:var(--len)}
.dash44 .reveal.in-view .darcGlow{animation:dashStrokeSweep 1.2s cubic-bezier(.2,.8,.2,1) var(--d,.1s) both}
.dash44 .dialG{cursor:pointer;transition:transform .25s ease}
.dash44 .dialG:hover .darc{stroke-width:13.5px !important}
.dash44 .dialG:hover{transform:translateY(-3px)}
.dash44 .dtick{stroke:rgba(255,255,255,.22);stroke-width:2}
.dash44 .dnum{fill:var(--ink);font-size:20px;font-weight:700;font-family:'Manrope',Tahoma}
.dash44 .ddl{font-size:10px;font-family:'Manrope',Tahoma}
.dash44 .blobWrap{display:flex;gap:28px;align-items:center;flex-wrap:wrap;margin-top:16px}
.dash44 .blobRel{width:340px;max-width:100%;margin:auto;flex-shrink:0}
.dash44 .spin{fill:none;stroke:rgba(34,211,238,.28);stroke-width:1.5;stroke-dasharray:3 10;transform-box:fill-box;transform-origin:center;animation:dash44rot 1.5s linear 2}
@keyframes dash44rot{to{transform:rotate(360deg)}}
@keyframes dash44slide{to{background-position:28px 0}}
.dash44 .bgrid{fill:none;stroke:rgba(255,255,255,.07)}
.dash44 .bsp{stroke:rgba(255,255,255,.09)}
.dash44 #bpoly{transform-box:fill-box;transform-origin:center;transform:scale(0)}
.dash44 .reveal.in-view #bpoly{animation:dashPopScale .65s cubic-bezier(.22,1,.36,1) var(--d,.2s) both}
.dash44 .blobGlow{fill:none;stroke-width:7;stroke-linejoin:round;opacity:.22}
.dash44 .bv{fill:var(--bg);stroke-width:2.5;cursor:pointer;transform-box:fill-box;transform-origin:center;transform:scale(0);transition:r .2s,stroke-width .2s}
.dash44 .reveal.in-view .bv{animation:dashPopScale .65s cubic-bezier(.22,1,.36,1) var(--dd,var(--d,.2s)) both}
.dash44 .bvHalo{fill:none;stroke-width:2;opacity:.25;transform-box:fill-box;transform-origin:center;transform:scale(0)}
.dash44 .reveal.in-view .bvHalo{animation:dashPopScale .65s cubic-bezier(.22,1,.36,1) var(--dd,var(--d,.2s)) both}
.dash44 .bv:hover,.dash44 .bv.hot{transform:scale(1.45) !important;stroke-width:3.5px !important;transition:transform .22s cubic-bezier(.22,1,.36,1),stroke-width .2s ease}
.dash44 .blab{opacity:0}
.dash44 .reveal.in-view .blab{animation:dashRevealIn .6s ease var(--dd,.2s) both}
.dash44 .chips{flex:1;min-width:240px;display:grid;gap:10px}
.dash44 .chip{display:grid;grid-template-columns:auto 1fr auto;gap:12px;align-items:center;border:1px solid var(--line);background:var(--card2);border-radius:14px;padding:12px 14px;cursor:pointer;transition:border-color .35s,box-shadow .35s}
.dash44 .reveal.in-view .chip{animation:dashRevealIn .75s cubic-bezier(.2,.75,.2,1) var(--d,0s) both}
.dash44 .chip.hot,.dash44 .chip:hover{border-color:var(--ac);transform:translateX(-3px) !important;box-shadow:0 0 0 1px var(--ac);transition:transform .22s cubic-bezier(.22,1,.36,1),border-color .35s,box-shadow .35s}
.dash44 .chip i{width:10px;height:10px;border-radius:3px;background:var(--ac);box-shadow:0 0 10px var(--ac)}
.dash44 .chip h4{font-size:12.5px;font-weight:600}
.dash44 .chip p{font-size:10.5px;color:var(--mut);margin-top:3px}
.dash44 .cbar{height:4px;border-radius:99px;background:#182231;overflow:hidden;margin-top:7px}
.dash44 .cbar i{display:block;height:100%;width:var(--w);border-radius:inherit;background:var(--ac);box-shadow:0 0 8px var(--ac);transform:scaleX(0);transform-origin:right center}
.dash44 .reveal.in-view .cbar i{animation:dashChipBar 1.2s cubic-bezier(.2,.8,.2,1) calc(var(--d,.1s) + .3s) both}
.dash44 .chip b{font-size:17px;color:var(--ac);text-shadow:0 0 12px var(--ac)}
.dash44 .wtile{cursor:pointer;transition:fill-opacity .25s}
.dash44 .reveal.in-view .wtile{animation:dashTileFade .5s ease var(--d,.2s) both}
.dash44 .wtile:hover{transform-box:fill-box;transform-origin:center;transform:scale(1.16) !important;fill-opacity:1 !important;transition:transform .22s cubic-bezier(.22,1,.36,1),fill-opacity .2s ease}
.dash44 .reveal.in-view .waffleSvg{animation:dashPopScale .65s cubic-bezier(.22,1,.36,1) .1s both}
.dash44 .wleg{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:16px}
.dash44 .clockWrap{display:flex;gap:26px;align-items:center;flex-wrap:wrap;margin-top:14px}
.dash44 .clockRel{width:330px;max-width:100%;margin:auto;flex-shrink:0}
.dash44 .cring{fill:none;stroke:rgba(255,255,255,.09);stroke-dasharray:2 6}
.dash44 .glab{font-family:'Manrope',Tahoma;font-size:9px;fill:var(--mut)}
.dash44 .ctic{stroke-width:6;stroke-linecap:round;cursor:pointer;stroke-dasharray:var(--len);stroke-dashoffset:var(--len);transition:stroke-width .2s}
.dash44 .reveal.in-view .ctic{animation:dashStrokeSweep 1.2s cubic-bezier(.2,.8,.2,1) var(--d,.1s) both}
.dash44 .ctic:hover{stroke-width:10px !important;transition:stroke-width .2s ease}
.dash44 .cnum{fill:var(--ink);font-size:26px;font-weight:800;font-family:'Manrope',Tahoma}
.dash44 .cstk{fill:var(--c1);font-size:11px}
.dash44 .terF{fill-opacity:0}
.dash44 .reveal.in-view .terF{animation:dashLineDraw 1.5s cubic-bezier(.4,0,.2,1) .25s both}
.dash44 .terL{fill:none;stroke:var(--c1);stroke-width:2.5;stroke-linejoin:round;stroke-dasharray:2400;stroke-dashoffset:2400}
.dash44 .reveal.in-view .terL{animation:dashLineDraw 1.5s cubic-bezier(.4,0,.2,1) .25s both}
.dash44 .terGlow{fill:none;stroke:var(--c1);stroke-width:7;stroke-linejoin:round;opacity:.22;stroke-dasharray:2400;stroke-dashoffset:2400}
.dash44 .reveal.in-view .terGlow{animation:dashLineDraw 1.5s cubic-bezier(.4,0,.2,1) .25s both}
.dash44 .terDot{cursor:pointer;transform-box:fill-box;transform-origin:center;transform:scale(0);transition:r .2s}
.dash44 .reveal.in-view .terDot{animation:dashPopScale .65s cubic-bezier(.22,1,.36,1) var(--d,.2s) both}
.dash44 .terHalo{fill:none;stroke-width:2;opacity:.25;transform-box:fill-box;transform-origin:center;transform:scale(0)}
.dash44 .reveal.in-view .terHalo{animation:dashPopScale .65s cubic-bezier(.22,1,.36,1) var(--d,.2s) both}
.dash44 .terDot:hover,.dash44 .terDot.hot{transform:scale(1.45) !important;transition:transform .22s cubic-bezier(.22,1,.36,1)}
.dash44 .terLv{opacity:0}
.dash44 .reveal.in-view .terLv{animation:dashRevealIn .6s ease var(--dd,.2s) both}
.dash44 .tcol{fill:transparent}
.dash44 .lineHead{display:flex;justify-content:space-between;gap:14px;flex-wrap:wrap;align-items:flex-start}
.dash44 .pills{display:flex;gap:8px;flex-wrap:wrap}
.dash44 .pill{font-family:inherit;font-size:11.5px;color:var(--mut);background:var(--card2);border:1px solid var(--line);border-radius:99px;padding:8px 15px;cursor:pointer;transition:.3s}
.dash44 .pill:hover{color:var(--ink);border-color:var(--line2);transform:translateY(-2px)}
.dash44 .pill.on{color:#04121a;background:linear-gradient(90deg,var(--c1),#67e8f9);border-color:transparent;font-weight:700;box-shadow:0 0 20px rgba(34,211,238,.4)}
.dash44 .wbox{position:relative;margin-top:16px;border:1px solid var(--line);border-radius:16px;background:var(--card2);padding:10px}
.dash44 .hud{position:absolute;top:18px;left:18px;background:rgba(13,19,27,.95);border:1px solid var(--line2);border-radius:12px;padding:10px 14px;font-size:11.5px;display:grid;gap:6px;pointer-events:none;box-shadow:0 10px 26px rgba(0,0,0,.45);min-width:150px;z-index:2}
.dash44 .hud span{color:var(--mut);font-size:10.5px}
.dash44 .hud div{display:flex;gap:7px;align-items:center}
.dash44 .hud i{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.dash44 .hud b{margin-inline-start:6px;color:var(--ink)}
.dash44 #clipMain rect{transform:scaleX(0);transform-origin:100% 50%;transform-box:fill-box}
.dash44 .reveal.in-view #clipMain rect{animation:dashCurtainOpen 1.5s cubic-bezier(.4,0,.2,1) .15s both}
.dash44 .grid{stroke:rgba(255,255,255,.06)}
.dash44 .arA,.dash44 .arB,.dash44 .eA,.dash44 .eB{transition:opacity 1s .6s;opacity:0}
.dash44 svg.go .arA,.dash44 svg.go .arB,.dash44 svg.go .eA,.dash44 svg.go .eB{opacity:1}
.dash44 .eA{fill:none;stroke:var(--c1);stroke-width:2.4}
.dash44 .eB{fill:none;stroke:var(--c5);stroke-width:2.2}
.dash44 .eAGlow,.dash44 .eBGlow{transition:opacity 1s .6s;opacity:0}
.dash44 .eAGlow{fill:none;stroke:var(--c1);stroke-width:7}
.dash44 .eBGlow{fill:none;stroke:var(--c5);stroke-width:6.5}
.dash44 svg.go .eAGlow{opacity:.22}
.dash44 svg.go .eBGlow{opacity:.22}
.dash44 .pdA,.dash44 .pdB{fill:var(--bg);stroke-width:2.5;cursor:pointer;transition:r .2s,stroke-width .2s}
.dash44 .pdA{stroke:var(--c1)}
.dash44 .pdB{stroke:var(--c5)}
.dash44 .pdA:hover,.dash44 .pdB:hover{r:7}
.dash44 .pdA.hot,.dash44 .pdB.hot{r:7.5;stroke-width:3.5px}
.dash44 .elab{font-family:'Manrope',Tahoma;font-size:11px;font-weight:700}
.dash44 .xl{stroke:rgba(255,255,255,.28);stroke-dasharray:3 5;opacity:0;transition:.2s}
.dash44 .dualSvg:hover .xl{opacity:1}
.dash44 .dashFoot{margin-top:46px;text-align:center;color:var(--mut);font-size:11.5px}
.dash44Tip{position:fixed;z-index:60;pointer-events:none;background:rgba(13,19,27,.95);border:1px solid rgba(34,211,238,.4);color:var(--ink);padding:8px 13px;border-radius:11px;font-size:12px;opacity:0;transform:translate(-50%,-135%);transition:.2s;box-shadow:0 10px 30px rgba(0,0,0,.55)}
.dash44Tip.on{opacity:1;transform:translate(-50%,-145%)}
@media(max-width:900px){.dash44 .two{grid-template-columns:1fr}.dash44 .blobWrap,.dash44 .clockWrap{gap:14px}.dash44 .wleg{grid-template-columns:1fr}}
@media(prefers-reduced-motion:reduce){.dash44 *{animation:none!important;transition:none!important}.dash44 .reveal,.dash44 .reveal:not(.in-view){opacity:1;transform:none}.dash44 .fill,.dash44 .cbar i{transform:none}.dash44 .darc,.dash44 .darcGlow,.dash44 .ctic{stroke-dashoffset:0}.dash44 #bpoly,.dash44 .bv,.dash44 .bvHalo,.dash44 .wtile,.dash44 .terDot,.dash44 .terHalo{transform:scale(1)}.dash44 .terL,.dash44 .terGlow{stroke-dashoffset:0}.dash44 .terF{fill-opacity:1}.dash44 #clipMain rect{transform:scaleX(1)}.dash44 .chip,.dash44 .blab,.dash44 .terLv{opacity:1;transform:none}}
`;


export default function ProfileView() {
  const profile = useSettingsStore((state) => state.profile);
  const updateProfile = useSettingsStore((state) => state.updateProfile);
  const setProfileAvatar = useSettingsStore((state) => state.setProfileAvatar);
  const initSettings = useSettingsStore((state) => state.initSettings);
  // مرحلهٔ ۴۷ §۱ — اشتراکِ هدفمند به‌جایِ کلِ استور: هر تغییرِ کتابخانه،
  // دیگر کلِ پروفایل را بازرندر نمی‌کند؛ فقط همین سه برشِ خوانده‌شده.
  const libraryItems = useLibraryStore((state) => state.libraryItems);
  const recentItems = useLibraryStore((state) => state.recentItems);
  const favorites = useLibraryStore((state) => state.favorites || []);
  const totalFavorites = useLibraryStore((state) => (Array.isArray(state.favorites) ? state.favorites.length : 0));
  // مرحلهٔ ۴۹ §۴ — پوشه‌ها فقط خوانده می‌شوند (مصرف‌کننده): libraryFolders
  // از قبل در استور است؛ favoriteFolders را ورکرِ C به استور و دیتابیس
  // اضافه می‌کند — اگر هنوز نباشد، [] فرض می‌شود تا این فایل، پیش از
  // ادغامِ ورکرِ C هم سالم بماند. شکلِ فرض‌شده: { id, name, color, ... }
  // برایِ هر دو فهرست؛ فیلدِ favoriteFolderId رویِ ردیفِ favorites هم
  // از ورکرِ C می‌آید (در resolveFolderBookKeys با folderId جایگزین می‌شود).
  const libraryFolders = useLibraryStore((state) => state.libraryFolders || []);
  const favoriteFolders = useLibraryStore((state) => state.favoriteFolders || []);
  const showToast = useAppStore((state) => state.showToast);
  const pendingStatViewAction = useAppStore((state) => state.pendingStatViewAction);
  const clearPendingStatViewAction = useAppStore((state) => state.clearPendingStatViewAction);
  const startStatsSelectionInRecent = useAppStore((state) => state.startStatsSelectionInRecent);

  const [username, setUsername] = useState(profile?.username || 'Haamed');
  const [subtitle, setSubtitle] = useState(profile?.subtitle || 'توسعه‌دهنده و کمیک‌خوان حرفه‌ای');
  const [dailyGoal, setDailyGoal] = useState(profile?.dailyGoalPages || 50);
  const [isProcessingImg, setIsProcessingImg] = useState(false);
  // مرحلهٔ ۴۷ §۱ — دادهٔ خامِ داشبورد در یک شیءِ واحد (dashboardRawData) با
  // دقیقاً یک setState در بارگذاری؛ مشتق‌ها (readingDays و ...) از همین
  // شیء خوانده می‌شوند و هیچ setStateِ جداگانه‌ای ندارند. مقدارِ اولیه،
  // کشِ سطحِ ماژول است تا بازگشت به تب، بی‌درنگ رندر شود.
  const [dashboardRawData, setDashboardRawData] = useState(() => cachedProfileDashboardData);
  const dashboardRawDataRef = useRef(cachedProfileDashboardData);
  const readingDays = dashboardRawData ? dashboardRawData.days : {};
  const byBookStats = dashboardRawData ? dashboardRawData.byBook : {};
  const annotationCounts = dashboardRawData ? dashboardRawData.annotationCounts : {};
  const customStatViews = dashboardRawData ? dashboardRawData.customStatViews : [];
  const totalAppSeconds = dashboardRawData ? Number(dashboardRawData.totalAppSeconds) || 0 : 0;
  // annotationTotals در مرحلهٔ ۴۶ هم هیچ‌جا نمایش داده نمی‌شد؛ فقط برایِ
  // قراردادِ IPC نگه داشته می‌شود (در Promise.all خوانده و ذخیره می‌شود).
  const annotationTotals = dashboardRawData ? dashboardRawData.annotationTotals : null;
  const readingSummary = useMemo(() => (dashboardRawData ? computeReadingSummary(dashboardRawData.days) : null), [dashboardRawData]);
  // مرحلهٔ ۳۵ §۱: آمار به تفکیکِ کتاب + فیلترِ کتاب‌هایِ اخیر +
  // آماربندی‌هایِ سفارشی (مرحلهٔ ۳۶: فیلترِ پروفایل حذف شد؛ انتخاب در Recent است).
  const bookmarksByFile = useBookmarkStore((state) => state.bookmarksByFile);
  const [activeStatTab, setActiveStatTab] = useState('all');
  // مرحلهٔ ۵۰ §۴ — mountCycleId: هر بار که ProfileView از نو سوار می‌شود
  // (ورودِ دوباره به تبِ پروفایل)، شمارندهٔ سراسریِ profileMountCycleSeq
  // یک عددِ تازه می‌دهد؛ و هر بار که activeStatTab عوض شود، این افکت یک
  // واحد اضافه می‌کند (اجرایِ اول رد می‌شود، چون مانتِ اول خودش تازه
  // است). mountCycleId رویِ key هر دو HtmlEngine می‌نشیند، پس موتور از
  // نو ساخته می‌شود و ورودِ keyframeها همیشه تازه اجرا می‌شود — حتی وقتی
  // رشتهٔ HTML با ورودِ قبل یکی است و memoِ HtmlEngine وگرنه بازرندر را
  // می‌گرفت. بدونِ این کلید، بازگشت به تب هیچ ورودی نداشت.
  const [mountCycleId, setMountCycleId] = useState(() => { profileMountCycleSeq += 1; return profileMountCycleSeq; });
  const mountCycleFirstTabRef = useRef(true);
  useEffect(() => {
    if (mountCycleFirstTabRef.current) { mountCycleFirstTabRef.current = false; return; }
    setMountCycleId((prev) => prev + 1);
  }, [activeStatTab]);
  // مرحلهٔ ۵۱ §۳ — ویرایشِ عددِ هدف از کارتِ «هدف امروز»: مقدارِ خامِ
  // ورودیِ عددی، با گاردِ Math.max(1, parseInt(val, 10) || 50) تمیز
  // می‌شود تا ۰ و NaN هرگز به درصدِ هدف نرسند (تقسیم بر صفر ندارد).
  const handleGoalNumberChange = useCallback((rawValue) => {
    setDailyGoal(Math.max(1, parseInt(rawValue, 10) || 50));
  }, []);
  // مرحلهٔ ۵۱ §۵ — لیسنرِ سبکِ اسکرول: رویِ کانتینرِ اسکرولِ پروفایل، با
  // passive:true؛ هنگامِ اسکرول، کلاسِ .is-scrolling رویِ ریشه‌هایِ
  // داشبورد (.dash44) می‌نشیند (CSS زیرِ آن، pointer-events را رویِ
  // svg.chart صفر می‌کند تا هاورها وسطِ اسکرول هزینه نسازند) و ۱۲۰
  // میلی‌ثانیه پس از توقفِ اسکرول برداشته می‌شود. هیچ setStateای نیست.
  useEffect(() => {
    const container = profileScrollRef.current;
    if (!container) return undefined;
    let stopTimer = 0;
    const setScrolling = (on) => {
      const roots = container.querySelectorAll('.dash44');
      roots.forEach((rootEl) => { rootEl.classList.toggle('is-scrolling', on); });
    };
    const onScroll = () => {
      setScrolling(true);
      if (stopTimer) clearTimeout(stopTimer);
      stopTimer = setTimeout(() => { setScrolling(false); }, 120);
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      if (stopTimer) clearTimeout(stopTimer);
      container.removeEventListener('scroll', onScroll);
    };
  }, []);
  const [viewEditor, setViewEditor] = useState(null);
  // مرحلهٔ ۴۷ §۱ — معیار/بازهٔ نمودارِ ۶ در ref نگه داشته می‌شوند تا کلیکِ
  // قرص‌ها، بدونِ setState و بدونِ بازسازیِ ۵ نمودارِ دیگر انجام شود؛
  // تغییرِ تب، مدل را از همین refهایِ جاری می‌سازد.
  const dualMetricRef = useRef(0);
  const dualRangeRef = useRef(1);
  const scopeModelRef = useRef({ scopedDays: {}, notesByDay: {} });
  // مرحلهٔ ۴۶ §۳ — هاورِ بدونِ بازرندر: تولتیپ، هایلایتِ بلاب و پنلِ
  // نمودارِ ۶، مستقیم رویِ DOM نوشته می‌شوند؛ هیچ setStateای در
  // onMouseMove صدا زده نمی‌شود.
  // مرحلهٔ ۴۷ §۱ — تولتیپ، هایلایتِ بلاب و هاورِ نمودارِ ۶ حالا delegated
  // در wireDashEngine انجام می‌شوند (فقط رویِ ریشهٔ موتور)؛ این refها و
  // کالبک‌هایِ React حذف شدند. importFileInputRef می‌ماند (ورودیِ مخفیِ
  // درون‌ریزی در مرکزِ فرمان هنوز به آن نیاز دارد).
  const importFileInputRef = useRef(null);
  // مرحلهٔ ۵۱ §۵ — رفرنسِ کانتینرِ اسکرولِ پروفایل (styles.container با
  // overflowY:auto) برایِ لیسنرِ سبکِ اسکرولِ §۵.
  const profileScrollRef = useRef(null);
  // مرحلهٔ ۴۷ §۱ — پاک‌سازیِ موتور (لغوِ rAF و تایمرِ ماشهٔ ورود و حذفِ
  // لیسنرها) در افکتِ HtmlEngine انجام می‌شود؛ این‌جا چیزی برایِ
  // آزادکردن نمانده است.

  // مرحلهٔ ۳۵ §۱ (ترتیبِ مهم: پیش از scopedAptitudeMetrics و totalReadPages
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
  // مرحلهٔ ۴۷ §۱ — بارگذاریِ تک‌ضربه‌ایِ داشبورد: پس از همان دو انتظارِ
  // فلاشِ مرحلهٔ ۶ (که ترتیب‌شان عمدی است و جلویِ آمارِ کهنه هنگامِ
  // برگشت از ریدر را می‌گیرد)، هر ۴ خواندن با Promise.all موازی
  // می‌شوند و همهٔ پاسخ‌ها با دقیقاً یک setState در dashboardRawData
  // می‌نشینند. اگر کشِ ماژول موجود باشد، رندرِ اول بی‌درنگ از کش است
  // و تازه‌سازی فقط در پس‌زمینه انجام می‌شود؛ اگر دادهٔ تازه با کش
  // یکی باشد، هیچ setStateای هم در پس‌زمینه رخ نمی‌دهد.
  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        if (readingActivity && typeof readingActivity.waitForPendingFlush === 'function') {
          await readingActivity.waitForPendingFlush();
        }
        if (readingActivity && typeof readingActivity.waitForAppFlush === 'function') {
          await readingActivity.waitForAppFlush();
        }
        if (!isMounted) return;
        const safeDbAction = (action) => {
          if (!coreApi || typeof coreApi.dbAction !== 'function') return Promise.resolve(null);
          try {
            return Promise.resolve(coreApi.dbAction({ action, payload: {} })).catch(() => null);
          } catch (_) {
            return Promise.resolve(null);
          }
        };
        const safeReadingStats = () => {
          try {
            return Promise.resolve(coreApi.getReadingStats()).catch(() => null);
          } catch (_) {
            return Promise.resolve(null);
          }
        };
        const [statsRes, totalsRes, countsRes, viewsRes] = await Promise.all([
          safeReadingStats(),
          safeDbAction('GET_ANNOTATION_TOTALS'),
          safeDbAction('GET_ANNOTATION_COUNTS'),
          safeDbAction('GET_CUSTOM_STAT_VIEWS'),
        ]);
        if (!isMounted) return;
        const fallbackViews = readCustomStatViewsFallback();
        const fresh = buildDashboardDataFromReplies(statsRes, totalsRes, countsRes, viewsRes, fallbackViews);
        const decided = mergeDashboardRefresh(cachedProfileDashboardData, fresh);
        if (!decided.next) {
          const empty = emptyDashboardData();
          cachedProfileDashboardData = empty;
          if (isMounted) setDashboardRawData(empty);
          return;
        }
        if (!decided.changed) return;
        cachedProfileDashboardData = decided.next;
        if (isMounted) setDashboardRawData(decided.next);
      } catch (_) {
        if (!isMounted) return;
        if (!cachedProfileDashboardData) {
          const empty = emptyDashboardData();
          cachedProfileDashboardData = empty;
          setDashboardRawData(empty);
        }
      }
    })();
    return () => { isMounted = false; };
  }, []);
  // آینهٔ ref از دادهٔ خام، برایِ نوشتنِ آماربندی‌ها بدونِ خواندنِ stateِ کهنه.
  useEffect(() => {
    dashboardRawDataRef.current = dashboardRawData;
  }, [dashboardRawData]);
  // مرحلهٔ ۴۷ §۱ — تنها نویسندهٔ آماربندی‌ها: کشِ ماژول + state را با هم
  // به‌روز می‌کند (یک setState) و فقط وقتی persist درست باشد، در
  // localStorage و دیتابیس هم می‌نویسد.
  const applyCustomStatViews = useCallback((next, persist = true) => {
    const prev = dashboardRawDataRef.current || emptyDashboardData();
    const updated = { ...prev, customStatViews: Array.isArray(next) ? next : [], loadedAt: Date.now() };
    cachedProfileDashboardData = updated;
    dashboardRawDataRef.current = updated;
    setDashboardRawData(updated);
    if (!persist) return;
    try { localStorage.setItem('comicReader.customStatViews.v1', JSON.stringify(updated.customStatViews)); } catch (_) {}
    if (coreApi && coreApi.dbAction) coreApi.dbAction({ action: 'SAVE_CUSTOM_STAT_VIEWS', payload: { views: updated.customStatViews } }).catch(() => {});
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

  // مرحلهٔ ۳۱ — شمارندهٔ بوک‌مارک‌ها (الگویِ سایدبار).
  const totalBookmarkCount = useBookmarkStore((state) => state.totalBookmarkCount);
  const loadAllBookmarks = useBookmarkStore((state) => state.loadAllBookmarks);
  useEffect(() => {
    if (loadAllBookmarks) loadAllBookmarks();
  }, [loadAllBookmarks]);

  // مرحله ۶ ـ بخش الف: «صفحه خوانده‌شده» حالا از آمارِ واقعیِ
  // ثبت‌شده می‌آید، نه از جمعِ شمارهٔ صفحهٔ جاریِ کتاب‌ها (که
  // موقعیتِ فعلی را می‌شمرد، نه صفحاتِ واقعاً خوانده‌شده را، و با
  // هر بار خواندنِ دوباره، دوباره شمرده می‌شد). تا وقتی آمار
  // بارگذاری نشده، null است و در کارت، خطِ تیره نشان داده می‌شود.
  const totalReadPages = effectiveSummary ? effectiveSummary.totalPages : null;

  const effectiveLibrary = libraryItems || [];
  const totalComics = effectiveLibrary.length;

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
  // مرحلهٔ ۴۶ §۱: نسخهٔ سراسریِ ۵ شاخصِ استعداد حذف شد؛ نسخهٔ
  // اسکوپ‌شده (scopedAptitudeMetrics) پایین‌تر، بعد از activeView، با همان
  // فرمول‌ها ولی فقط از کتاب‌هایِ اسکوپِ فعال حساب می‌شود.

  // مرحلهٔ ۴۶ §۱ — اسکوپِ پویا: همهٔ مشتق‌هایِ داشبورد، فقط از
  // scopedData می‌آیند. در تبِ «آمارِ کل»، اسکوپ، کلِ کتابخانه است
  // (روزهایِ دیتابیس + همهٔ کتاب‌هایِ دارایِ آمار)؛ در تبِ سفارشی،
  // فقط کتاب‌هایِ bookKeys همان آماربندی. effectiveSummary فقط برایِ
  // هدرِ پروفایل (هویتِ سراسریِ کاربر) نگه داشته شده است.
  const activeView = activeStatTab === 'all' ? null : (customStatViews.find((v) => v.id === activeStatTab) || null);
  const viewBookKeys = activeView ? (activeView.bookKeys || []) : [];
  // مرحلهٔ ۴۹ §۴ — کلیدهایِ پوشه‌هایِ پیوندخورده، در هر رندر از
  // libraryItems و favorites خوانده می‌شوند (حلِ پویا): کتابی که بعد از
  // ساختِ آماربندی به پوشه اضافه شود، خودبه‌خود واردِ اسکوپ می‌شود.
  // folderScopeKeys، هم شمارِ نمایشیِ «کتاب‌هایِ افزوده‌شده از پوشه‌ها»
  // است و هم سیگنالِ وابستگیِ scopeKeys.
  const folderScopeKeys = useMemo(() => {
    if (!activeView) return [];
    return resolveFolderBookKeys({
      linkedLibraryFolderIds: activeView.linkedLibraryFolderIds,
      linkedFavoriteFolderIds: activeView.linkedFavoriteFolderIds,
      libraryItems,
      favorites,
    });
  }, [activeView, libraryItems, favorites]);
  const scopeKeys = useMemo(() => {
    if (activeView) return resolveStatViewScopeKeys(activeView, { libraryItems, favorites });
    const merged = [...allRecentKeys];
    for (const k of Object.keys(byBookStats)) {
      if (!merged.includes(k)) merged.push(k);
    }
    return merged;
  }, [activeView, viewBookKeys, folderScopeKeys, libraryItems, favorites, allRecentKeys, byBookStats]);
  const scopedData = useMemo(() => buildScopedScopeData({
    scopeKeys,
    byBookStats,
    recentBooks,
    readingDays,
    bookmarksByFile,
    annotationCounts,
    includeLibraryDays: !activeView,
  }), [scopeKeys, byBookStats, recentBooks, readingDays, bookmarksByFile, annotationCounts, activeView]);
  const scopedDays = scopedData.days;
  const scopedSummary = useMemo(() => (readingSummary === null ? null : computeReadingSummary(scopedDays)), [readingSummary, scopedDays]);
  // مرحلهٔ ۴۶ §۱ — ۵ شاخصِ استعداد، فقط از کتاب‌هایِ اسکوپ (همان
  // فرمول‌هایِ مرحلهٔ ۳۱، با ورودی‌هایِ اسکوپ‌شده: زمان و صفحات و
  // روزهایِ اسکوپ، بوک‌مارک و حاشیه‌نویسیِ همین کتاب‌ها، و کتاب‌هایِ
  // تمام‌شدهٔ همین اسکوپ).
  const scopedAptitudeMetrics = useMemo(() => {
    if (!scopedSummary) return null;
    const totalSeconds = Number(scopedSummary.totalSeconds) || 0;
    const totalPages = Number(scopedSummary.totalPages) || 0;
    const totalDays = Math.max(1, Number(scopedSummary.totalDays) || 0);
    const bestStreak = Number(scopedSummary.bestStreak) || 0;
    const avgDailyMin = totalSeconds / totalDays / 60;
    const studyPresence = totalSeconds / Math.max(1, Number(totalAppSeconds) || 0);
    const focus = clampScore(0.6 * Math.min(100, (avgDailyMin / 60) * 100) + 0.4 * Math.min(1, studyPresence) * 100);
    const pagesPerHour = totalSeconds > 0 ? totalPages / (totalSeconds / 3600) : 0;
    const avgDailyPages = totalPages / totalDays;
    const velocity = clampScore(0.5 * Math.min(100, (pagesPerHour / 40) * 100) + 0.5 * Math.min(100, (avgDailyPages / 50) * 100));
    const markCount = (Number(scopedData.bookmarks) || 0) + (Number(scopedData.highlights) || 0);
    const density = markCount / totalDays;
    const analytical = clampScore(0.5 * Math.min(100, (density / 2) * 100) + 0.5 * Math.min(100, (markCount / 40) * 100));
    const stamina = clampScore(0.5 * Math.min(100, (bestStreak / 30) * 100) + 0.3 * Math.min(100, (Number(scopedSummary.totalDays) || 0) / 90 * 100) + 0.2 * Math.min(100, (totalSeconds / 360000) * 100));
    const overall = clampScore(0.3 * focus + 0.25 * analytical + 0.2 * velocity + 0.25 * stamina);
    return [
      { id: 'focus', name: 'استعدادِ تمرکزِ عمیق', short: 'تمرکز', value: focus, color: '#00f2fe', desc: `میانگینِ ${Math.round(avgDailyMin)} دقیقه مطالعه در روز` },
      { id: 'analytical', name: 'استعدادِ تحلیل و پژوهشگری', short: 'تحلیل', value: analytical, color: '#7c3aed', desc: `${markCount} بوک‌مارک و حاشیه‌نویسی` },
      { id: 'velocity', name: 'چابکیِ پردازشِ بصری', short: 'سرعت', value: velocity, color: '#10b981', desc: `${Math.round(pagesPerHour)} صفحه در ساعت` },
      { id: 'stamina', name: 'استقامت و پیوستگیِ ذهنی', short: 'استقامت', value: stamina, color: '#f59e0b', desc: `بهترین رکورد: ${bestStreak} روزِ پیوسته` },
      { id: 'overall', name: 'امتیازِ جامعِ استعدادِ مطالعه', short: 'جامع', value: overall, color: '#ec4899', desc: `${scopedData.finishedBooks} کتابِ تمام‌شده از ${scopedData.totalBooks} عنوان` },
    ];
  }, [scopedSummary, totalAppSeconds, scopedData]);
  const viewStats = useMemo(() => {
    if (!activeView) return null;
    return {
      seconds: scopedData.seconds,
      pages: scopedData.pages,
      hours: scopedData.hours,
      speed: scopedData.speed,
      progress: scopedData.progress,
      bookmarks: scopedData.bookmarks,
      highlights: scopedData.highlights,
    };
  }, [activeView, scopedData]);

  // مرحلهٔ ۳۶ §۴: داده‌هایِ داشبوردِ چندنموداره برایِ تبِ فعال.
  const dashDays = scopedDays;
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
    const entries = (scopedData.books || [])
      .filter((e) => (Number(e.seconds) || 0) > 0 || (Number(e.pages) || 0) > 0)
      .map((e) => ({ key: e.key, name: e.name || e.key, seconds: Number(e.seconds) || 0, pages: Number(e.pages) || 0 }));
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
  }, [scopedData]);
  const dashFormatShare = useMemo(() => {
    const totals = { pdf: 0, epub: 0, comic: 0 };
    for (const e of (scopedData.books || [])) {
      const book = recentBooks.find((rb) => rb.bookKey === e.key);
      const kind = book ? (book.type === 'pdf' ? 'pdf' : (book.type === 'epub' ? 'epub' : 'comic')) : 'comic';
      totals[kind] += Number(e.seconds) || 0;
    }
    const total = totals.pdf + totals.epub + totals.comic;
    return { ...totals, total };
  }, [scopedData, recentBooks]);
  const heatColorFor = (m) => (m <= 0 ? '#1f2937' : (m <= 15 ? '#164e63' : (m <= 45 ? '#0e7490' : (m <= 120 ? '#06b6d4' : '#22d3ee'))));

  // مرحلهٔ ۴۴ §۲ — داده‌هایِ داشبوردِ نئون برایِ تبِ فعال (آمارِ کل یا آماربندیِ سفارشی).
  // نمودارِ ۱ — گیج‌هایِ ۷ روزهٔ صفحات (قدیمی‌ترین تا امروز) + تغییر نسبت به روزِ قبل.
  const dashDial = useMemo(() => {
    const days = buildTrendSeries(scopedDays, 7, 'pages');
    const mx = Math.max(1, ...days.map((d) => d.value));
    return days.map((d, i) => {
      const prev = i > 0 ? days[i - 1].value : null;
      return { key: d.key, label: d.label, pages: d.value, delta: prev === null ? null : d.value - prev, max: mx };
    });
  }, [scopedDays]);
  // نمودارِ ۲ — بلابِ Catmull-Rom بسته از رویِ ۵ شاخصِ واقعیِ استعداد (scopedAptitudeMetrics).
  const dashBlob = useMemo(() => {
    const list = scopedAptitudeMetrics || [];
    const c = 170;
    const cy = 160;
    const R = 104;
    const n = list.length;
    if (n === 0) return { list, pts: [], path: '', c, cy, R, n: 0 };
    const ax = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const pts = list.map((s, i) => [c + Math.cos(ax(i)) * R * (s.value / 100), cy + Math.sin(ax(i)) * R * (s.value / 100)]);
    let d = 'M' + pts[0][0].toFixed(1) + ',' + pts[0][1].toFixed(1);
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i - 1 + n) % n];
      const p1 = pts[i];
      const p2 = pts[(i + 1) % n];
      const p3 = pts[(i + 2) % n];
      const c1x = p1[0] + (p2[0] - p0[0]) / 6;
      const c1y = p1[1] + (p2[1] - p0[1]) / 6;
      const c2x = p2[0] - (p3[0] - p1[0]) / 6;
      const c2y = p2[1] - (p3[1] - p1[1]) / 6;
      d += ' C' + c1x.toFixed(1) + ',' + c1y.toFixed(1) + ' ' + c2x.toFixed(1) + ',' + c2y.toFixed(1) + ' ' + p2[0].toFixed(1) + ',' + p2[1].toFixed(1);
    }
    d += 'Z';
    return { list, pts, path: d, c, cy, R, n, ax };
  }, [scopedAptitudeMetrics]);
  // نمودارِ ۳ — موزاییکِ وافلی از سهمِ واقعیِ کتاب‌ها (dashDonut) با باقیماندهٔ بزرگ‌تر.
  const dashWaffle = useMemo(() => {
    const entries = (dashDonut && dashDonut.entries) || [];
    const totalSeconds = Math.max(0, (dashDonut && dashDonut.totalSeconds) || 0);
    const tiles = largestRemainderTiles(entries.map((e) => e.seconds), totalSeconds);
    return { entries, totalSeconds, totalMinutes: Math.round(totalSeconds / 60), tiles };
  }, [dashDonut]);
  // نمودارِ ۴ — ساعتِ ماه از رویِ دقیقه‌هایِ واقعیِ ۳۰ روزِ اخیر (dashHeat).
  const dashClock = useMemo(() => {
    const days = (dashHeat || []).map((d) => ({ ...d, minutes: Math.max(0, d.minutes || 0) }));
    const total = days.reduce((s, d) => s + d.minutes, 0);
    const active = days.filter((d) => d.minutes > 0).length;
    let maxV = 0;
    let maxI = 0;
    days.forEach((d, i) => {
      if (d.minutes > maxV) { maxV = d.minutes; maxI = i; }
    });
    return { days, total, active, maxV, maxI };
  }, [dashHeat]);
  // نمودارِ ۵ — تراسِ شنبه تا جمعه از رویِ dashDow (مسیرِ پلکانی + مختصاتِ y).
  const dashTerrace = useMemo(() => terracePaths(dashDow, dashDowMax), [dashDow, dashDowMax]);
  // نمودارِ ۶ — روبانِ دوتایی (مدلِ خالصِ مرحلهٔ ۴۶؛ معیار/بازه از ref خوانده
  // می‌شوند تا قرص‌ها بدونِ setState کار کنند؛ تغییرِ اسکوپ، مدل را دوباره می‌سازد).
  const dashDual = useMemo(() => buildDualModel(scopedDays, scopedData.notesByDay, dualMetricRef.current, dualRangeRef.current), [scopedDays, scopedData]);
  // مرحلهٔ ۴۷ §۱ — رشته‌هایِ HTMLِ موتور: هدفِ روزانه و داشبوردِ ۶ نموداره،
  // فقط وقتی اسکوپ یا تب عوض شود، دوباره ساخته می‌شوند؛ ویرایشِ فیلدهایِ
  // متنیِ پروفایل، رشته را عوض نمی‌کند و انیمیشن را از نو شروع نمی‌کند.
  const goalHtml = useMemo(() => buildGoalHtml(scopedSummary, dailyGoal), [scopedSummary, dailyGoal]);
  const dashboardHtml = useMemo(() => buildDashboardHtml({
    dial: dashDial,
    blob: dashBlob,
    waffle: dashWaffle,
    clock: dashClock,
    dow: dashDow,
    dowMax: dashDowMax,
    bestDow: dashBestDow,
    terrace: dashTerrace,
    dual: dashDual,
    scopedSummary,
    scopedData,
    activeView,
  }), [dashDial, dashBlob, dashWaffle, dashClock, dashTerrace, dashDow, dashDowMax, dashBestDow, dashDual, scopedSummary, scopedData, activeView]);
  // همگام‌سازیِ مدلِ اسکوپ برایِ مسیرِ دستوریِ قرص‌هایِ نمودارِ ۶.
  useEffect(() => {
    scopeModelRef.current = { scopedDays, notesByDay: scopedData.notesByDay };
  });
  // مرحلهٔ ۴۷ §۱ — کلیکِ قرص‌هایِ نمودارِ ۶، کاملاً دستوری: refها به‌روز
  // می‌شوند و فقط SVG همان نمودار عوض می‌شود؛ هیچ setStateای رخ نمی‌دهد.
  const handleDualPills = useCallback((root, metricIdx, rangeIdx) => {
    if (metricIdx !== null && metricIdx !== undefined) dualMetricRef.current = metricIdx;
    if (rangeIdx !== null && rangeIdx !== undefined) dualRangeRef.current = rangeIdx;
    const snap = scopeModelRef.current || { scopedDays: {}, notesByDay: {} };
    const model = buildDualModel(snap.scopedDays, snap.notesByDay, dualMetricRef.current, dualRangeRef.current);
    renderDualInto(root, model);
  }, []);



  // مرحلهٔ ۴۹ §۴ — انتخابِ سریعِ پوشه برایِ آماربندی (دو گروهِ چیپ):
  // گروهِ ۱ پوشه‌هایِ کتابخانه، گروهِ ۲ پوشه‌هایِ علاقه‌مندی‌ها؛ هر چیپ،
  // نقطهٔ رنگ + نام + تعدادِ کتاب دارد و چندانتخابی است. در فرمِ ویرایش،
  // فقط viewEditor عوض می‌شود (ذخیره با دکمهٔ «ذخیرهٔ آماربندی»)؛ در مرکزِ
  // فرمان، تغییر بلافاصله رویِ همان آماربندی ذخیره می‌شود. اگر در فرم،
  // نام هنوز خالی باشد و پوشه‌ای انتخاب شود، نام و رنگِ آن پوشه به‌عنوانِ
  // پیشنهاد رویِ فرم می‌نشیند (نامِ تایپ‌شده هرگز بازنویسی نمی‌شود).
  const toggleEditorFolder = useCallback((kind, folder) => {
    if (!folder || !folder.id) return;
    setViewEditor((prev) => {
      if (!prev) return prev;
      const key = kind === 'favorite' ? 'linkedFavoriteFolderIds' : 'linkedLibraryFolderIds';
      const current = normalizeFolderIdList(prev[key]);
      const isSelected = current.includes(folder.id);
      const nextIds = isSelected ? current.filter((id) => id !== folder.id) : [...current, folder.id];
      const next = { ...prev, [key]: nextIds };
      if (!isSelected && !(prev.name || '').trim()) {
        const suggestion = suggestViewFromFolder(folder);
        if (suggestion) {
          next.name = suggestion.name;
          next.color = suggestion.color;
        }
      }
      return next;
    });
  }, []);
  const toggleActiveViewFolder = useCallback((kind, folder) => {
    if (!folder || !folder.id || !activeView) return;
    const key = kind === 'favorite' ? 'linkedFavoriteFolderIds' : 'linkedLibraryFolderIds';
    const current = normalizeFolderIdList(activeView[key]);
    const nextIds = current.includes(folder.id) ? current.filter((id) => id !== folder.id) : [...current, folder.id];
    const nextView = { ...activeView, [key]: nextIds };
    const next = customStatViews.map((v) => (v.id === activeView.id ? nextView : v));
    applyCustomStatViews(next);
  }, [activeView, customStatViews, applyCustomStatViews]);
  // رندرِ دو گروهِ چیپِ پوشه (کتابخانه + علاقه‌مندی‌ها) برایِ فرم و مرکزِ فرمان.
  const renderFolderPickerGroups = (linkedLibIds, linkedFavIds, onToggle) => {
    const libIds = normalizeFolderIdList(linkedLibIds);
    const favIds = normalizeFolderIdList(linkedFavIds);
    const renderGroup = (kind, folders, selectedIds, emptyText) => (
      <div>
        <p style={{ ...styles.sectionDesc, marginBottom: 6 }}>{kind === 'favorite' ? 'پوشه‌های علاقه‌مندی‌ها:' : 'پوشه‌های کتابخانه:'}</p>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {(folders || []).map((f) => {
            const isSelected = selectedIds.includes(f.id);
            const count = countFolderBooks(kind, f.id, libraryItems, favorites);
            return (
              <button key={f.id} type="button" onClick={() => onToggle(kind, f)} title={f.name} style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12, cursor: 'pointer', padding: '5px 10px', borderRadius: 99, border: isSelected ? '1px solid #22d3ee' : '1px solid var(--border)', background: isSelected ? 'rgba(34,211,238,0.15)' : 'rgba(255,255,255,0.05)', color: 'var(--text)', fontFamily: 'inherit' }}>
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: f.color || '#22d3ee', flexShrink: 0 }} />
                <span>{f.name}</span>
                <span style={{ color: 'var(--muted)' }}>({count} کتاب)</span>
              </button>
            );
          })}
          {(folders || []).length === 0 && (<span style={styles.sectionDesc}>{emptyText}</span>)}
        </div>
      </div>
    );
    return (
      <div>
        {renderGroup('library', libraryFolders, libIds, 'هنوز پوشه‌ای در کتابخانه نساخته‌ای؛ از نمای کتابخانه پوشه بساز.')}
        {renderGroup('favorite', favoriteFolders, favIds, 'هنوز پوشه‌ای برای علاقه‌مندی‌ها نساخته‌ای؛ از نمای علاقه‌مندی‌ها پوشه بساز.')}
      </div>
    );
  };

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
      linkedLibraryFolderIds: normalizeFolderIdList(viewEditor.linkedLibraryFolderIds),
      linkedFavoriteFolderIds: normalizeFolderIdList(viewEditor.linkedFavoriteFolderIds),
      metrics: (viewEditor.metrics || []).length ? viewEditor.metrics : ['hours', 'pages'],
      goalHours: Number(viewEditor.goalHours) || 0,
      goalPages: Number(viewEditor.goalPages) || 0,
    };
    const next = viewEditor.id
      ? customStatViews.map((v) => (v.id === view.id ? view : v))
      : [...customStatViews, view];
    applyCustomStatViews(next);
    setActiveStatTab(view.id);
    setViewEditor(null);
    showToast('آماربندیِ سفارشی ذخیره شد', { type: 'success' });
  };
  const handleDeleteCustomView = (id) => {
    const next = customStatViews.filter((v) => v.id !== id);
    applyCustomStatViews(next);
    if (activeStatTab === id) setActiveStatTab('all');
    showToast('آماربندی حذف شد', { type: 'info' });
  };
  // مرحلهٔ ۴۶ §۲ — اسنپ‌شاتِ آماربندیِ فعال (شکلِ دقیقِ قرارداد با
  // src/utils/statsHtmlExport.js؛ تغییرِ شکل، وارداتِ ورکرِ B را می‌شکند).
  const buildScopedStatsSnapshot = () => {
    const statView = activeView
      ? { id: activeView.id, name: activeView.name, color: activeView.color || '#22d3ee', bookKeys: [...(activeView.bookKeys || [])], linkedLibraryFolderIds: [...normalizeFolderIdList(activeView.linkedLibraryFolderIds)], linkedFavoriteFolderIds: [...normalizeFolderIdList(activeView.linkedFavoriteFolderIds)], metrics: [...(activeView.metrics || [])], goalHours: Number(activeView.goalHours) || 0, goalPages: Number(activeView.goalPages) || 0 }
      : { id: 'all', name: 'آمار کل کتابخانه', color: '#22d3ee', bookKeys: [...scopedData.keys], linkedLibraryFolderIds: [], linkedFavoriteFolderIds: [], metrics: CUSTOM_VIEW_METRICS.map((m) => m.id), goalHours: null, goalPages: null };
    const goal = activeView && ((Number(activeView.goalHours) || 0) > 0 || (Number(activeView.goalPages) || 0) > 0)
      ? { hours: Number(activeView.goalHours) || 0, pages: Number(activeView.goalPages) || 0 }
      : null;
    return createStatsSnapshotPayload({
      statView,
      days: scopedDays,
      notesByDay: scopedData.notesByDay,
      books: scopedData.books,
      aptitude: scopedAptitudeMetrics || [],
      summary: {
        seconds: scopedSummary ? scopedSummary.totalSeconds : 0,
        pages: scopedSummary ? scopedSummary.totalPages : 0,
        hours: scopedData.hours,
        speed: scopedData.speed,
        progress: scopedData.progress,
        bookmarks: scopedData.bookmarks,
        highlights: scopedData.highlights,
        totalBooks: activeView ? scopedData.totalBooks : totalComics,
        finishedBooks: activeView ? scopedData.finishedBooks : finishedBooks,
        currentStreak: scopedSummary ? scopedSummary.currentStreak : 0,
        bestStreak: scopedSummary ? scopedSummary.bestStreak : 0,
        todayPages: scopedSummary ? scopedSummary.todayPages : 0,
        todaySeconds: scopedSummary ? scopedSummary.todaySeconds : 0,
        todayGoalPages: Number(dailyGoal) || 50,
      },
      goal,
    });
  };
  const handleExportStatsHtml = async () => {
    try {
      const snapshot = buildScopedStatsSnapshot();
      let html = null;
      try {
        const mod = await import('../../utils/statsHtmlExport');
        if (mod && typeof mod.generateStandaloneStatsHtmlReport === 'function') {
          html = mod.generateStandaloneStatsHtmlReport(snapshot);
        }
      } catch (_) {
        html = null;
      }
      if (!html || typeof html !== 'string') {
        showToast('ساختِ گزارشِ HTML ممکن نشد؛ فایلِ سازندهٔ گزارش هنوز در پروژه نیست', { type: 'error' });
        return;
      }
      const stamp = new Date();
      const stampText = `${stamp.getFullYear()}-${String(stamp.getMonth() + 1).padStart(2, '0')}-${String(stamp.getDate()).padStart(2, '0')}`;
      const fileName = `comic-reader-stats-${snapshot.statView.id}-${stampText}.html`;
      if (coreApi && typeof coreApi.exportStatsHtml === 'function') {
        const res = await coreApi.exportStatsHtml(html, fileName);
        if (res && res.success) {
          showToast('گزارشِ HTML با موفقیت استخراج شد', { type: 'success' });
        } else if (res && (res.canceled || res.cancelled)) {
          showToast('استخراجِ گزارش لغو شد', { type: 'info' });
        } else {
          showToast(`استخراجِ گزارش ممکن نشد: ${res && res.error ? res.error : 'خطایِ نامشخص'}`, { type: 'error' });
        }
        return;
      }
      // جایگزینِ رندرر: دانلودِ مستقیمِ Blob وقتی کانالِ IPC هنوز نیست.
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => { URL.revokeObjectURL(url); }, 5000);
      showToast('گزارشِ HTML دانلود شد', { type: 'success' });
    } catch (_) {
      showToast('استخراجِ گزارشِ HTML ممکن نشد', { type: 'error' });
    }
  };
  const handleImportStatsFile = async (e) => {
    const file = e && e.target && e.target.files ? e.target.files[0] : null;
    if (e && e.target) e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const view = parseImportedStatView(text);
      if (!view) {
        showToast('فایلِ انتخاب‌شده، گزارشِ معتبرِ آماربندی نیست', { type: 'error' });
        return;
      }
      const next = customStatViews.some((v) => v.id === view.id)
        ? customStatViews.map((v) => (v.id === view.id ? view : v))
        : [...customStatViews, view];
      applyCustomStatViews(next);
      setActiveStatTab(view.id);
      showToast('آماربندی با موفقیت درون‌ریزی شد', { type: 'success' });
    } catch (_) {
      showToast('درون‌ریزیِ فایل ممکن نشد', { type: 'error' });
    }
  };


  // مرحلهٔ ۳۶ §۳: مصرفِ اقدامِ معلقِ Recent — فعال‌سازیِ تب یا باز کردنِ
  // پنجرهٔ نهایی‌سازی با کتاب‌هایِ انتخاب‌شده؛ فقط یک بار مصرف می‌شود.
  useEffect(() => {
    if (!pendingStatViewAction) return;
    if (pendingStatViewAction.type === 'activate') {
      try {
        const raw = localStorage.getItem('comicReader.customStatViews.v1');
        const list = raw ? JSON.parse(raw) : [];
        if (Array.isArray(list)) applyCustomStatViews(list, false);
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
        linkedLibraryFolderIds: base ? normalizeFolderIdList(base.linkedLibraryFolderIds) : [],
        linkedFavoriteFolderIds: base ? normalizeFolderIdList(base.linkedFavoriteFolderIds) : [],
        metrics: base && Array.isArray(base.metrics) && base.metrics.length ? [...base.metrics] : ['hours', 'pages'],
        goalHours: base ? (Number(base.goalHours) || 0) : 0,
        goalPages: base ? (Number(base.goalPages) || 0) : 0,
      });
      if (typeof clearPendingStatViewAction === 'function') clearPendingStatViewAction();
    }
  }, [pendingStatViewAction, customStatViews, clearPendingStatViewAction]);

  return (
    <div ref={profileScrollRef} style={styles.container}>
      <style>{DASH44_CSS}</style>
      <div style={styles.innerRtlWrap}>
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

      {/* مرحلهٔ ۴۷ §۱ — هدفِ روزانهٔ مطالعه، بالایِ مرکزِ فرمان: موتورِ HTML
      (رشته + keyframeهایِ مرحلهٔ ۴۹ + شمارندهٔ مستقیمِ cu) به‌جایِ Count-Upِ هوک‌محور؛
      بدونِ هیچ setStateای در مانت. */}
      <HtmlEngine key={'dash-goal-' + mountCycleId} html={goalHtml} className="dash44" style={GOAL_HOST_STYLE} dual={null} onDual={null} onGoalChange={handleGoalNumberChange} />

      {/* مرحلهٔ ۴۵ §۲: قابِ یکپارچه و متصلِ آماربندی — تب‌ها، کتاب‌هایِ عضو، هدف و فرمِ ساخت/ویرایش در یک قابِ واحد و متصل‌اند؛ نمودارهایِ زیر، برایِ تبِ فعال حساب می‌شوند. */}
      <div style={styles.statsCommandCard}>
        <div style={styles.sectionHeaderRow}>
          <span style={{ color: 'var(--accent)', display: 'flex' }}>
            <Icons.Eye size={18} />
          </span>
          <h4 style={styles.sectionTitle}>مرکزِ فرمانِ آماربندی</h4>
        </div>
        <p style={{ ...styles.sectionDesc, marginTop: '8px' }}>
          تب‌هایِ آماربندی، کتاب‌هایِ عضو، هدف و فرمِ ساخت و ویرایش در یک قابِ واحد و متصل‌اند؛ نمودارهایِ زیر، برایِ تبِ فعال حساب می‌شوند.
        </p>
        <div style={styles.statsCommandRow}>
          <button type="button" onClick={() => setActiveStatTab('all')} style={activeStatTab === 'all' ? { ...styles.chartToggleBtn, ...styles.chartToggleBtnActive } : styles.chartToggleBtn}>آمارِ کلِ کتابخانه</button>
          {customStatViews.map((v) => (
            <button key={v.id} type="button" onClick={() => setActiveStatTab(v.id)} style={activeStatTab === v.id ? { ...styles.chartToggleBtn, ...styles.chartToggleBtnActive, borderColor: v.color } : styles.chartToggleBtn}><span style={{ ...styles.statsCommandTabDot, background: v.color }} />{v.name}</button>
          ))}
          <button type="button" onClick={() => { if (typeof startStatsSelectionInRecent === 'function') startStatsSelectionInRecent([], null, 'profile'); }} style={styles.statsCommandCreateBtn}>+ ساخت آماربندی جدید (انتخاب از موارد اخیر)</button>
          <button type="button" onClick={handleExportStatsHtml} style={styles.statsCommandExportBtn}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12" /><path d="M6 11l6 6 6-6" /><path d="M4 21h16" /></svg>
            <span>استخراج گزارش HTML (با نمودارها)</span>
          </button>
          <button type="button" onClick={() => { if (importFileInputRef.current) importFileInputRef.current.click(); }} style={styles.statsCommandExportBtn}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 21V9" /><path d="M6 13l6-6 6 6" /><path d="M4 3h16" /></svg>
            <span>درون‌ریزی آماربندی (Import HTML)</span>
          </button>
          <input ref={importFileInputRef} type="file" accept=".html,.htm,.json" style={{ display: 'none' }} onChange={handleImportStatsFile} />
        </div>
        <div style={styles.statsCommandRow2}>
          {activeView ? (
            <>
              <p style={styles.sectionDesc}>
                نمودار و کارت‌هایِ زیر، فقط برای آماربندیِ «{activeView.name}» حساب شده‌اند.
              </p>
              <div style={styles.statsCommandChips}>
                {(activeView.bookKeys || []).map((k) => {
                  const b = recentBooks.find((rb) => rb.bookKey === k);
                  return (<span key={k} style={styles.statsCommandChip}>{b ? (b.name || b.fileName || k) : k}</span>);
                })}
                {(activeView.bookKeys || []).length === 0 && (<span style={styles.sectionDesc}>هیچ کتابی در این آماربندی نیست؛ با دکمهٔ «تغییر کتاب‌ها در Recent» کتاب انتخاب کن.</span>)}
              </div>
              <p style={styles.sectionDesc}>انتخابِ سریعِ پوشه — کتاب‌هایِ پوشه، خودبه‌خود به این آماربندی اضافه می‌شوند؛ کتابی که بعداً به پوشه اضافه شود هم می‌آید:</p>
              {renderFolderPickerGroups(activeView.linkedLibraryFolderIds, activeView.linkedFavoriteFolderIds, toggleActiveViewFolder)}
              {folderScopeKeys.length > 0 && (
                <p style={styles.sectionDesc}>
                  از پوشه‌هایِ بالا، {folderScopeKeys.filter((k) => !(activeView.bookKeys || []).includes(k)).length} کتابِ تازه (جدا از کتاب‌هایِ دستی) به این آماربندی اضافه شده است.
                </p>
              )}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" onClick={() => setViewEditor({ id: activeView.id, name: activeView.name, color: activeView.color, bookKeys: [...(activeView.bookKeys || [])], metrics: [...(activeView.metrics || [])], goalHours: activeView.goalHours || 0, goalPages: activeView.goalPages || 0, linkedLibraryFolderIds: [...normalizeFolderIdList(activeView.linkedLibraryFolderIds)], linkedFavoriteFolderIds: [...normalizeFolderIdList(activeView.linkedFavoriteFolderIds)] })} style={{ ...styles.chartToggleBtn, marginRight: 8 }}>تنظیمات و هدفِ این آماربندی</button>
                <button type="button" onClick={() => { const paths = (activeView.bookKeys || []).map((k) => { const b = recentBooks.find((rb) => rb.bookKey === k); return b ? (b.path || b.filePath || '') : ''; }).filter(Boolean); if (typeof startStatsSelectionInRecent === 'function') startStatsSelectionInRecent(paths, activeView.id, 'profile'); }} style={{ ...styles.chartToggleBtn, marginRight: 4 }}>تغییر کتاب‌ها در Recent</button>
                <button type="button" onClick={() => handleDeleteCustomView(activeView.id)} style={{ ...styles.chartToggleBtn, marginRight: 4 }}>حذف</button>
              </div>
              {viewStats && (
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
            </>
          ) : (
            <>
              <p style={styles.sectionDesc}>نمودارهایِ زیر، برایِ آمارِ کلِ کتابخانه حساب شده‌اند.</p>
              {scopedSummary && (
                <div style={styles.statsSummaryGrid}>
                  <div style={styles.statBox}>
                    <strong style={styles.statVal}>{scopedData.hours.toFixed(1)} ساعت</strong>
                    <span style={styles.statLbl}>مجموعِ ساعتِ مطالعه</span>
                  </div>
                  <div style={styles.statBox}>
                    <strong style={styles.statVal}>{scopedData.pages}</strong>
                    <span style={styles.statLbl}>صفحاتِ خوانده‌شده</span>
                  </div>
                  <div style={styles.statBox}>
                    <strong style={styles.statVal}>{scopedData.progress}٪</strong>
                    <span style={styles.statLbl}>پیشرفتِ کلِ کتابخانه</span>
                  </div>
                  <div style={styles.statBox}>
                    <strong style={styles.statVal}>{scopedData.bookmarks}</strong>
                    <span style={styles.statLbl}>بوک‌مارک‌ها</span>
                  </div>
                  <div style={styles.statBox}>
                    <strong style={styles.statVal}>{scopedData.highlights}</strong>
                    <span style={styles.statLbl}>هایلایت‌ها و یادداشت‌ها</span>
                  </div>
                  <div style={styles.statBox}>
                    <strong style={styles.statVal}>{Math.round(scopedData.speed)} صفحه در ساعت</strong>
                    <span style={styles.statLbl}>میانگینِ سرعتِ مطالعه</span>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
        {viewEditor && (
          <div style={styles.statsCommandForm}>
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
              {(viewEditor.bookKeys || []).length === 0 && (<span style={styles.sectionDesc}>هیچ کتابی انتخاب نشده است؛ از دکمهٔ «تغییر کتاب‌ها در Recent» در Recent انتخاب کن.</span>)}
            </div>
            <p style={styles.sectionDesc}>انتخابِ سریع از پوشه‌ها (چندانتخابی؛ کتاب‌هایِ پوشه، خودبه‌خود به این آماربندی اضافه می‌شوند):</p>
            {renderFolderPickerGroups(viewEditor.linkedLibraryFolderIds, viewEditor.linkedFavoriteFolderIds, toggleEditorFolder)}
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

      {/* مرحلهٔ ۴۷ §۱: داشبوردِ نئونِ ۶ نموداره رویِ موتورِ HTMLِ خروجی — یک رشتهٔ
      DOM/SVG، یک setState برایِ داده، و ورود با keyframeهایِ مرحلهٔ ۴۹؛ نمودارِ ۶
      با قرص‌هایِ دستوری به‌روز می‌شود. */}
      <HtmlEngine key={'dash-main-' + mountCycleId} html={dashboardHtml} className="dash44" dual={dashDual} onDual={handleDualPills} />
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
            <label style={styles.label}>هدف مطالعه روزانه (صفحه):</label>
            <input
              type="number"
              min="1"
              max="10000"
              value={dailyGoal}
              onChange={(e) => setDailyGoal(Math.min(10000, Math.max(1, parseInt(e.target.value, 10) || 50)))}
              style={{ ...styles.input, width: 120 }}
              aria-label="هدف مطالعه روزانه به صفحه"
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
    direction: 'ltr',
    userSelect: 'none',
  },
  innerRtlWrap: {
    direction: 'rtl',
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
    flex: 1,
    minWidth: 0,
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
  // مرحلهٔ ۴۵ §۲ — قابِ یکپارچه و متصلِ آماربندی.
  statsCommandCard: {
    backgroundColor: 'var(--card, var(--panel))',
    borderRadius: '18px',
    border: '1px solid var(--line, var(--border))',
    padding: '20px 22px',
    display: 'flex',
    flexDirection: 'column',
    gap: '0',
    contain: 'layout paint',
  },
  statsCommandRow: {
    display: 'flex',
    gap: '6px',
    flexWrap: 'wrap',
    alignItems: 'center',
    marginTop: '12px',
    paddingBottom: '14px',
    borderBottom: '1px solid var(--line, var(--border))',
  },
  statsCommandRow2: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    paddingTop: '14px',
  },
  statsCommandChips: {
    display: 'flex',
    flexWrap: 'wrap',
  },
  statsCommandChip: {
    fontSize: '12px',
    padding: '4px 10px',
    background: 'rgba(34,211,238,0.12)',
    color: 'var(--text)',
    maxWidth: '320px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    border: '1px solid var(--border)',
    margin: '-1px 0 0 -1px',
  },
  statsCommandTabDot: {
    display: 'inline-block',
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    marginInlineEnd: '6px',
    verticalAlign: 'middle',
  },
  statsCommandCreateBtn: {
    padding: '7px 16px',
    borderRadius: '999px',
    border: '1px solid var(--accent)',
    backgroundColor: 'var(--accent)',
    color: '#0a0f13',
    fontFamily: 'var(--font-fa)',
    fontSize: '12px',
    fontWeight: 800,
    cursor: 'pointer',
  },
  statsCommandExportBtn: {
    padding: '7px 14px',
    borderRadius: '999px',
    border: '1px solid var(--border)',
    backgroundColor: 'var(--panel2)',
    color: 'var(--text)',
    fontFamily: 'var(--font-fa)',
    fontSize: '12px',
    fontWeight: 700,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
  },
  statsCommandForm: {
    display: 'grid',
    gap: '10px',
    marginTop: '14px',
    paddingTop: '14px',
    borderTop: '1px solid var(--line, var(--border))',
  },
};