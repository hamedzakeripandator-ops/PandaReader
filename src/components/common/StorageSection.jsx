import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { coreApi } from '../../services/coreApi';
import thumbnailService from '../../services/thumbnailService';
import useLibraryStore from '../../store/useLibraryStore';
import useAppStore from '../../store/useAppStore';
import Icons from './Icons';

// مرحله ۱۰: «مدیریتِ حافظه و پاک‌سازیِ داده‌هایِ کش» — یک مؤلفهٔ
// مشترک برای تبِ «حافظه» در تنظیمات و کارتِ دسترسیِ سریع در صفحهٔ
// اصلی. آمارِ دقیقِ حجم از بک‌اند می‌آید (get-storage-stats) و
// دکمه‌ها، همان کانال‌هایِ بک‌اند را صدا می‌زنند؛ هیچ عددی در
// رندرر حدس زده نمی‌شود. در حالتِ compact، چیدمان فشرده‌تر است و
// دکمهٔ «بازگشت به مسیرِ پیش‌فرض» نشان داده نمی‌شود.

function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return n.toLocaleString('fa-IR') + ' بایت';
  const mb = n / 1048576;
  if (mb < 1024) return mb.toLocaleString('fa-IR', { maximumFractionDigits: 1 }) + ' مگابایت';
  const gb = mb / 1024;
  return gb.toLocaleString('fa-IR', { maximumFractionDigits: 2 }) + ' گیگابایت';
}

function driveLabelOf(dirPath) {
  if (!dirPath || typeof dirPath !== 'string') return '—';
  const m = dirPath.match(/^[A-Za-z]:/);
  if (m) return m[0].toUpperCase();
  return '—';
}

export default function StorageSection({ compact = false }) {
  const showToast = useAppStore((state) => state.showToast);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [statsError, setStatsError] = useState('');
  const [busy, setBusy] = useState(null); // null | 'prune' | 'clear' | 'change' | 'reset'
  const [arm, setArm] = useState(null); // دکمه‌ای که یک بار کلیک شده و منتظرِ تأییدِ دوم است
  // مرحله ۱۳: مودالِ تأییدِ پاک‌سازی (جایگزینِ کلیکِ دوم برای سه
  // عملیاتِ مخرب؛ تغییرِ مسیر و بازگشت، همان مکانیزمِ قبلی را دارند).
  const [confirmModal, setConfirmModal] = useState(null); // null | { action: 'prune' | 'covers' | 'caches' }
  const [prunePreview, setPrunePreview] = useState(null);
  const [preserveCustom, setPreserveCustom] = useState(true);
  const [includeOrigBackups, setIncludeOrigBackups] = useState(false);
  const [status, setStatus] = useState('');
  const armTimerRef = useRef(null);

  const loadStats = useCallback(async () => {
    if (!coreApi.isAvailable()) {
      setStatsError('آمارِ حافظه فقط در نسخهٔ دسکتاپِ برنامه در دسترس است.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setStatsError('');
    try {
      const res = await coreApi.getStorageStats();
      if (res && res.success && res.stats) {
        setStats(res.stats);
      } else {
        setStatsError((res && res.error) || 'خواندنِ آمارِ حافظه انجام نشد.');
      }
    } catch (err) {
      setStatsError('خطا در خواندنِ آمارِ حافظه: ' + (err && err.message ? err.message : String(err)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStats();
    return () => {
      if (armTimerRef.current) clearTimeout(armTimerRef.current);
    };
  }, [loadStats]);

  const armOrRun = (action, run) => {
    if (arm !== action) {
      setArm(action);
      if (armTimerRef.current) clearTimeout(armTimerRef.current);
      armTimerRef.current = setTimeout(() => setArm(null), 5000);
      return;
    }
    setArm(null);
    if (armTimerRef.current) clearTimeout(armTimerRef.current);
    run();
  };

  // مرحله ۱۳: باز کردنِ مودالِ تأیید با آمارِ تازه (نه حدس و نه
  // عددِ کهنه): برای هرس، پیش‌نمایشِ فقط-خواندنی هم گرفته می‌شود.
  const openConfirm = async (action) => {
    if (!coreApi.isAvailable()) {
      setStatsError('پاک‌سازی فقط در نسخهٔ دسکتاپِ برنامه در دسترس است.');
      return;
    }
    setBusy('preview');
    try {
      const res = await coreApi.getStorageStats();
      if (res && res.success && res.stats) setStats(res.stats);
      if (action === 'prune') {
        const pv = await coreApi.previewPruneMissingFiles();
        setPrunePreview(pv && pv.success ? pv : null);
      }
      setPreserveCustom(true);
      setIncludeOrigBackups(false);
      setConfirmModal({ action });
    } catch (err) {
      showToast('خواندنِ آمارِ تازه انجام نشد.', { type: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const handlePrune = async () => {
    setBusy('prune');
    setStatus('در حالِ بررسیِ فایل‌هایِ حذف‌شده…');
    try {
      const res = await coreApi.pruneMissingFiles();
      if (res && res.success) {
        const removed = Array.isArray(res.removed) ? res.removed : [];
        const removedPaths = removed.map((r) => r.path).filter(Boolean);
        if (removedPaths.length > 0) {
          await useLibraryStore.getState().applyPruneResult(removedPaths);
        }
        const skippedNote = res.skippedCount > 0
          ? ` (${res.skippedCount} مورد به‌خاطرِ در دسترس نبودنِ درایو نگه داشته شد.)`
          : '';
        setStatus(
          removed.length > 0
            ? `${removed.length} فایلِ حذف‌شده از سیستم، از برنامه هم پاک شد.${skippedNote}`
            : `موردی برای پاک‌سازی پیدا نشد.${skippedNote}`
        );
        showToast(
          removed.length > 0
            ? `${removed.length} فایلِ حذف‌شده از سیستم، از برنامه هم پاک شد.`
            : 'فایلِ حذف‌شده‌ای پیدا نشد.',
          { type: removed.length > 0 ? 'success' : 'info' }
        );
        loadStats();
      } else {
        setStatus((res && res.error) || 'پاک‌سازیِ فایل‌هایِ حذف‌شده انجام نشد.');
        showToast((res && res.error) || 'پاک‌سازی انجام نشد.', { type: 'error' });
      }
    } catch (err) {
      setStatus('خطا در پاک‌سازی: ' + (err && err.message ? err.message : String(err)));
      showToast('خطا در پاک‌سازی.', { type: 'error' });
    } finally {
      setBusy(null);
    }
  };

  // مرحله ۱۳: پاک‌سازیِ فقط کاورها — به هیچ کشِ دیگری دست نمی‌زند.
  const handleClearOnlyCovers = async () => {
    setBusy('clearCovers');
    setStatus('در حالِ پاک‌سازیِ کاورها…');
    try {
      const res = await coreApi.clearOnlyCovers({ preserveCustom });
      if (res && res.success) {
        try { thumbnailService.clearMemoryCache(); } catch (_) {}
        try { await useLibraryStore.getState().initLibrary(); } catch (_) {}
        setStatus(
          `${formatBytes(res.freedBytes || 0)} آزاد شد (${res.clearedFiles || 0} فایلِ کاور).` +
          (res.keptCustom > 0 ? ` ${res.keptCustom} کاورِ سفارشیِ شما حفظ شد.` : '')
        );
        showToast(`${formatBytes(res.freedBytes || 0)} از کاورها آزاد شد.`, { type: 'success' });
        loadStats();
      } else {
        setStatus((res && res.error) || 'پاک‌سازیِ کاورها انجام نشد.');
        showToast((res && res.error) || 'پاک‌سازی انجام نشد.', { type: 'error' });
      }
    } catch (err) {
      setStatus('خطا در پاک‌سازی: ' + (err && err.message ? err.message : String(err)));
      showToast('خطا در پاک‌سازی.', { type: 'error' });
    } finally {
      setBusy(null);
    }
  };

  // مرحله ۱۳: پاک‌سازیِ فقط کش‌هایِ موقت — به پوشهٔ covers و
  // کاورهایِ کتابخانه دست نمی‌زند.
  const handleClearOnlyCaches = async () => {
    setBusy('clearCaches');
    setStatus('در حالِ پاک‌سازیِ کش‌هایِ موقت…');
    try {
      const res = await coreApi.clearOnlyCaches({ includeOrigBackups });
      if (res && res.success) {
        setStatus(`${formatBytes(res.freedBytes || 0)} آزاد شد (${res.clearedFiles || 0} فایلِ کشِ موقت).`);
        showToast(`${formatBytes(res.freedBytes || 0)} از کش‌هایِ موقت آزاد شد.`, { type: 'success' });
        loadStats();
      } else {
        setStatus((res && res.error) || 'پاک‌سازیِ کش‌ها انجام نشد.');
        showToast((res && res.error) || 'پاک‌سازی انجام نشد.', { type: 'error' });
      }
    } catch (err) {
      setStatus('خطا در پاک‌سازی: ' + (err && err.message ? err.message : String(err)));
      showToast('خطا در پاک‌سازی.', { type: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const handleModalConfirm = () => {
    if (!confirmModal) return;
    const action = confirmModal.action;
    setConfirmModal(null);
    if (action === 'covers') handleClearOnlyCovers();
    else if (action === 'caches') handleClearOnlyCaches();
    else if (action === 'prune') handlePrune();
  };

  const handleChangeDir = async () => {
    setBusy('change');
    setStatus('در حالِ باز کردنِ پنجرهٔ انتخابِ پوشه…');
    try {
      const res = await coreApi.changeDataDirectory();
      if (res && res.canceled) {
        setStatus('تغییرِ محلِ ذخیره لغو شد.');
      } else if (res && res.success) {
        setStatus('محلِ ذخیره عوض شد؛ برنامه برای فعال‌شدنِ مسیرِ جدید دوباره راه‌اندازی می‌شود. داده‌ها به مسیرِ جدید منتقل شدند.');
        showToast('محلِ ذخیره عوض شد؛ برنامه دوباره راه‌اندازی می‌شود.', { type: 'success' });
      } else {
        setStatus((res && res.error) || 'تغییرِ محلِ ذخیره انجام نشد.');
        showToast((res && res.error) || 'تغییرِ محلِ ذخیره انجام نشد.', { type: 'error' });
      }
    } catch (err) {
      setStatus('خطا در تغییرِ محلِ ذخیره: ' + (err && err.message ? err.message : String(err)));
      showToast('خطا در تغییرِ محلِ ذخیره.', { type: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const handleResetDir = async () => {
    setBusy('reset');
    setStatus('در حالِ بازگشت به مسیرِ پیش‌فرض…');
    try {
      const res = await coreApi.resetDataDirectory();
      if (res && res.success) {
        setStatus('به مسیرِ پیش‌فرض برگشتید؛ برنامه دوباره راه‌اندازی می‌شود. داده‌هایِ قبلی در پوشهٔ قبلی باقی می‌مانند و هر وقت خواستید می‌توانید همان پوشه را دوباره انتخاب کنید.');
        showToast('به مسیرِ پیش‌فرض برگشتید؛ برنامه دوباره راه‌اندازی می‌شود.', { type: 'success' });
      } else {
        setStatus((res && res.error) || 'بازگشت به مسیرِ پیش‌فرض انجام نشد.');
        showToast((res && res.error) || 'بازگشت انجام نشد.', { type: 'error' });
      }
    } catch (err) {
      setStatus('خطا در بازگشت به مسیرِ پیش‌فرض: ' + (err && err.message ? err.message : String(err)));
      showToast('خطا در بازگشت به مسیرِ پیش‌فرض.', { type: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const btnStyle = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    padding: compact ? '8px 12px' : '10px 14px',
    borderRadius: '10px',
    border: '1px solid var(--border)',
    backgroundColor: 'var(--panel2)',
    color: 'var(--text)',
    fontFamily: 'var(--font-fa)',
    fontSize: '13px',
    fontWeight: 600,
    cursor: busy ? 'wait' : 'pointer',
    opacity: busy ? 0.7 : 1,
  };

  const btnDangerStyle = {
    ...btnStyle,
    border: '1px solid rgba(239, 68, 68, 0.45)',
    color: '#ef4444',
  };

  const rowStyle = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    padding: '8px 0',
    borderBottom: '1px solid var(--border)',
    fontSize: '13px',
    lineHeight: 1.8,
  };

  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: '14px',
        backgroundColor: 'var(--panel)',
        padding: compact ? '16px' : '20px',
        color: 'var(--text)',
        fontFamily: 'var(--font-fa)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', marginBottom: compact ? '8px' : '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ color: 'var(--accent)', display: 'flex' }}>
            <Icons.FolderOpen size={20} />
          </span>
          <div>
            <div style={{ fontSize: '15px', fontWeight: 800, lineHeight: 1.6 }}>مدیریتِ حافظه و پاک‌سازیِ داده‌هایِ کش</div>
            {!compact && (
              <div style={{ fontSize: '12.5px', color: 'var(--muted)', lineHeight: 1.8 }}>
                حجمِ دقیقِ داده‌هایِ برنامه، پاک‌سازیِ فایل‌هایِ حذف‌شده از سیستم و انتخابِ درایوِ محلِ ذخیره.
              </div>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={loadStats}
          disabled={loading || Boolean(busy)}
          style={{ ...btnStyle, padding: '7px 10px' }}
          title="به‌روزرسانیِ آمار"
        >
          <Icons.RefreshCw size={14} />
          <span>به‌روزرسانی</span>
        </button>
      </div>

      {loading && !stats ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--muted)', padding: '12px 0' }}>
          <Icons.Loader size={15} />
          <span>در حالِ خواندنِ آمارِ حافظه…</span>
        </div>
      ) : statsError ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#ef4444', padding: '12px 0' }}>
          <Icons.AlertTriangle size={15} />
          <span>{statsError}</span>
        </div>
      ) : stats ? (
        <div style={{ marginBottom: '6px' }}>
          <div style={rowStyle}>
            <span style={{ color: 'var(--muted)' }}>محلِ فعلیِ ذخیرهٔ اطلاعات</span>
            <span style={{ direction: 'ltr', textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%' }}>
              {stats.currentDataDir || '—'}
            </span>
          </div>
          <div style={rowStyle}>
            <span style={{ color: 'var(--muted)' }}>درایوِ محلِ ذخیره</span>
            <span>{driveLabelOf(stats.currentDataDir)}{stats.isPortableMode ? ' (حالتِ قابل‌حمل)' : ''}{stats.isCustomDir ? ' (مسیرِ انتخابیِ شما)' : ''}</span>
          </div>
          <div style={rowStyle}>
            <span style={{ color: 'var(--muted)' }}>حجمِ دیتابیس</span>
            <span>{formatBytes(stats.dbSizeBytes)}</span>
          </div>
          <div style={rowStyle}>
            <span style={{ color: 'var(--muted)' }}>کاورها ({Number(stats.coversCount || 0).toLocaleString('fa-IR')} فایل)</span>
            <span>{formatBytes(stats.coversSizeBytes)}</span>
          </div>
          <div style={rowStyle}>
            <span style={{ color: 'var(--muted)' }}>کشِ موقت و پشتیبان‌هایِ پایه</span>
            <span>{formatBytes(stats.tempCacheSizeBytes)}</span>
          </div>
          <div style={rowStyle}>
            <span style={{ color: 'var(--muted)' }}>— از آن: کشِ بازگشاییِ موقت ({Number(stats.protectedCacheCount || 0).toLocaleString('fa-IR')} فایل)</span>
            <span>{formatBytes(stats.protectedCacheSizeBytes)}</span>
          </div>
          <div style={rowStyle}>
            <span style={{ color: 'var(--muted)' }}>— از آن: استخراجِ موقتِ آرشیوها ({Number(stats.extractedTempCount || 0).toLocaleString('fa-IR')} فایل)</span>
            <span>{formatBytes(stats.extractedTempSizeBytes)}</span>
          </div>
          <div style={rowStyle}>
            <span style={{ color: 'var(--muted)' }}>— از آن: ایندکسِ جستجو ({Number(stats.searchIndexCount || 0).toLocaleString('fa-IR')} فایل)</span>
            <span>{formatBytes(stats.searchIndexSizeBytes)}</span>
          </div>
          <div style={rowStyle}>
            <span style={{ color: 'var(--muted)' }}>— از آن: پشتیبان‌هایِ پایهٔ PDF ({Number(stats.origBackupsCount || 0).toLocaleString('fa-IR')} فایل)</span>
            <span>{formatBytes(stats.origBackupsSizeBytes)}</span>
          </div>
          <div style={{ ...rowStyle, borderBottom: 'none', fontWeight: 800 }}>
            <span>مجموعِ فضایِ اشغال‌شده</span>
            <span>{formatBytes(stats.totalSizeBytes)}</span>
          </div>
        </div>
      ) : null}

      <div style={{ display: 'flex', flexDirection: compact ? 'column' : 'row', flexWrap: 'wrap', gap: '8px', marginTop: '12px' }}>
        <button
          type="button"
          onClick={() => openConfirm('prune')}
          disabled={Boolean(busy)}
          style={btnStyle}
        >
          <Icons.Trash size={15} />
          <span>حذفِ ردپایِ فایل‌هایِ پاک‌شده از سیستم</span>
        </button>
        <button
          type="button"
          onClick={() => openConfirm('covers')}
          disabled={Boolean(busy)}
          style={btnDangerStyle}
        >
          {busy === 'clearCovers' ? <Icons.Loader size={15} /> : <Icons.Trash size={15} />}
          <span>پاک‌سازیِ کاورهای کتابخانه</span>
        </button>
        <button
          type="button"
          onClick={() => openConfirm('caches')}
          disabled={Boolean(busy)}
          style={btnDangerStyle}
        >
          {busy === 'clearCaches' ? <Icons.Loader size={15} /> : <Icons.Trash size={15} />}
          <span>پاک‌سازیِ فایل‌های کش موقت</span>
        </button>
        <button
          type="button"
          onClick={() => armOrRun('change', handleChangeDir)}
          disabled={Boolean(busy) || Boolean(stats && stats.isPortableMode)}
          style={btnStyle}
          title={stats && stats.isPortableMode ? 'در حالتِ قابل‌حمل، محلِ ذخیره قابلِ تغییر نیست.' : undefined}
        >
          <Icons.FolderOpen size={15} />
          <span>{arm === 'change' ? 'برای تأیید، دوباره کلیک کنید' : 'تغییرِ درایو / محلِ ذخیرهٔ اطلاعات…'}</span>
        </button>
        {!compact && (
          <button
            type="button"
            onClick={() => armOrRun('reset', handleResetDir)}
            disabled={Boolean(busy) || !stats || !stats.isCustomDir}
            style={btnStyle}
            title="بازگشت به مسیرِ پیش‌فرض (داده‌هایِ قبلی در پوشهٔ قبلی باقی می‌مانند)"
          >
            <Icons.RefreshCw size={15} />
            <span>{arm === 'reset' ? 'برای تأیید، دوباره کلیک کنید' : 'بازگشت به مسیرِ پیش‌فرض'}</span>
          </button>
        )}
      </div>

            {!compact && (
        <div style={{ fontSize: '12px', lineHeight: 1.9, color: 'var(--muted)', marginTop: '10px' }}>
          پاک‌سازیِ کاورها فقط پوشهٔ کاورها و جدولِ کشِ کاور را پاک می‌کند و به هیچ کشِ دیگری دست نمی‌زند؛ کاورهایِ سفارشی فقط وقتی حفظ می‌شوند که تیکِ «حفظ» در مودالِ تأیید زده شده باشد. پاک‌سازیِ کش‌هایِ موقت، به کاورها و دیتابیس دست نمی‌زند و پشتیبان‌هایِ پایهٔ PDF را فقط با تیکِ خودشان پاک می‌کند. حذفِ ردپایِ فایل‌هایِ پاک‌شده، فقط وقتی انجام می‌شود که درایوِ فایل در دسترس باشد؛ اگر درایو جدا شده باشد، کتاب‌ها نگه داشته می‌شوند. تغییرِ محلِ ذخیره، دیتابیس و کاورها را به پوشهٔ جدید منتقل می‌کند و برنامه را دوباره راه‌اندازی می‌کند.
        </div>
      )}

      {status && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12.5px', lineHeight: 1.8, color: 'var(--muted)', marginTop: '10px' }}>
          <Icons.Check size={14} />
          <span>{status}</span>
        </div>
      )}
      {confirmModal ? createPortal(
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 100010,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(0, 0, 0, 0.62)',
            direction: 'rtl',
            fontFamily: 'var(--font-fa)',
            color: 'var(--text)',
            padding: '16px',
            boxSizing: 'border-box',
          }}
          onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) setConfirmModal(null); }}
        >
          <div
            style={{
              width: 'min(520px, 100%)',
              maxHeight: '86vh',
              overflowY: 'auto',
              backgroundColor: 'var(--panel)',
              border: '1px solid var(--border)',
              borderRadius: '16px',
              boxShadow: '0 24px 64px rgba(0, 0, 0, 0.6)',
              padding: '20px',
              boxSizing: 'border-box',
            }}
          >
            <div style={{ fontSize: '16px', fontWeight: 800, marginBottom: '14px' }}>
              {confirmModal.action === 'covers' ? 'تأیید پاک‌سازیِ کاورهای کتابخانه'
                : confirmModal.action === 'caches' ? 'تأیید پاک‌سازیِ کشِ موقت'
                : 'تأیید حذفِ ردپای فایل‌های پاک‌شده'}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '13px', lineHeight: 1.9, marginBottom: '14px' }}>
              {confirmModal.action === 'covers' && stats ? (
                <>
                  <div>• {Number(stats.coversCount || 0).toLocaleString('fa-IR')} فایل تصویر جلد کتاب (مجموعاً {formatBytes(stats.coversSizeBytes)}) در پوشهٔ کاورها هست.</div>
                  {preserveCustom ? (
                    <div>• {Math.max(0, Number(stats.coversCount || 0) - Number(stats.coverCustomCount || 0)).toLocaleString('fa-IR')} فایل ({formatBytes(Math.max(0, Number(stats.coversSizeBytes || 0) - Number(stats.coverCustomBytes || 0)))}) حذف می‌شود و {Number(stats.coverCustomCount || 0).toLocaleString('fa-IR')} کاورِ سفارشی ({formatBytes(stats.coverCustomBytes)}) حفظ می‌شود.</div>
                  ) : (
                    <div>• همهٔ {Number(stats.coversCount || 0).toLocaleString('fa-IR')} فایل ({formatBytes(stats.coversSizeBytes)}) حذف می‌شود، از جمله کاورهایِ سفارشی.</div>
                  )}
                  <div>• کتاب‌ها و حاشیه‌نویسی‌های شما کاملاً امن و دست‌نخورده باقی می‌مانند و کاورها در بازدید بعدی مجدداً ساخته می‌شوند.</div>
                  <div>• به هیچ کشِ دیگری (پشتیبان‌هایِ پایه، کشِ بازگشایی، ایندکسِ جستجو) دست زده نمی‌شود.</div>
                </>
              ) : null}
              {confirmModal.action === 'caches' && stats ? (
                <>
                  <div>• فایل‌های موقت بازگشایی (protected-cache): {Number(stats.protectedCacheCount || 0).toLocaleString('fa-IR')} فایل ({formatBytes(stats.protectedCacheSizeBytes)}).</div>
                  <div>• استخراجِ موقتِ آرشیوها: {Number(stats.extractedTempCount || 0).toLocaleString('fa-IR')} فایل ({formatBytes(stats.extractedTempSizeBytes)}).</div>
                  <div>• ایندکس‌های موقت جستجو: {Number(stats.searchIndexCount || 0).toLocaleString('fa-IR')} فایل ({formatBytes(stats.searchIndexSizeBytes)}).</div>
                  {includeOrigBackups ? (
                    <div>• پشتیبان‌های پایهٔ PDF (orig-backups): {Number(stats.origBackupsCount || 0).toLocaleString('fa-IR')} فایل ({formatBytes(stats.origBackupsSizeBytes)}).</div>
                  ) : (
                    <div>• پشتیبان‌های پایهٔ PDF (orig-backups) دست نمی‌خورند.</div>
                  )}
                  <div>• کاورهای کتابخانه و دیتابیس شما دست‌نخورده باقی می‌مانند.</div>
                  <div>• اگر کتابی باز است، پس از پاک‌سازی باید دوباره باز شود.</div>
                </>
              ) : null}
              {confirmModal.action === 'prune' ? (
                <>
                  {prunePreview && prunePreview.removedCount > 0 ? (
                    <>
                      <div>• {Number(prunePreview.removedCount).toLocaleString('fa-IR')} فایلِ حذف‌شده از سیستم، از ردپای برنامه هم پاک می‌شود:</div>
                      {(prunePreview.removed || []).slice(0, 8).map((r, i) => (
                        <div key={i} style={{ paddingRight: '16px', color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>• {r.name || r.path}</div>
                      ))}
                      {prunePreview.removedCount > 8 ? (
                        <div style={{ paddingRight: '16px', color: 'var(--muted)' }}>• و {Number(prunePreview.removedCount - 8).toLocaleString('fa-IR')} مورد دیگر…</div>
                      ) : null}
                      {prunePreview.coverFilesDeleted > 0 ? (
                        <div>• {Number(prunePreview.coverFilesDeleted).toLocaleString('fa-IR')} فایل کاورِ وابسته هم ({formatBytes(prunePreview.coverBytesFreed)}) پاک می‌شود.</div>
                      ) : null}
                    </>
                  ) : (
                    <div>• موردی برای حذف پیدا نشد.</div>
                  )}
                  {prunePreview && prunePreview.skippedCount > 0 ? (
                    <div>• {Number(prunePreview.skippedCount).toLocaleString('fa-IR')} مورد به‌خاطرِ در دسترس نبودنِ درایو نگه داشته می‌شود.</div>
                  ) : null}
                  <div>• کتاب‌هایی که فایلشان هنوز هست، دست نمی‌خورند.</div>
                </>
              ) : null}
            </div>
            {confirmModal.action === 'covers' ? (
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', marginBottom: '16px', cursor: 'pointer' }}>
                <input type="checkbox" checked={preserveCustom} onChange={(e) => setPreserveCustom(e.target.checked)} />
                <span>کاورهای سفارشیِ خودم را حفظ کن</span>
              </label>
            ) : null}
            {confirmModal.action === 'caches' ? (
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', marginBottom: '16px', cursor: 'pointer' }}>
                <input type="checkbox" checked={includeOrigBackups} onChange={(e) => setIncludeOrigBackups(e.target.checked)} />
                <span>پشتیبان‌های پایهٔ PDF (orig-backups) هم پاک شوند</span>
              </label>
            ) : null}
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={handleModalConfirm}
                disabled={Boolean(busy)}
                style={{ ...btnStyle, border: '1px solid rgba(239, 68, 68, 0.45)', color: '#ef4444', padding: '10px 18px' }}
              >
                بله، پاک‌سازی انجام شود
              </button>
              <button
                type="button"
                onClick={() => setConfirmModal(null)}
                disabled={Boolean(busy)}
                style={btnStyle}
              >
                انصراف
              </button>
            </div>
          </div>
        </div>,
        document.body
      ) : null}
    </div>
  );
}
