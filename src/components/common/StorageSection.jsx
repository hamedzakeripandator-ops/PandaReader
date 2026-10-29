import React, { useCallback, useEffect, useRef, useState } from 'react';
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

  const handleClearCovers = async () => {
    setBusy('clear');
    setStatus('در حالِ پاک‌سازیِ کشِ کاورها…');
    try {
      const res = await coreApi.clearAllCovers();
      if (res && res.success) {
        try { thumbnailService.clearMemoryCache(); } catch (_) {}
        try { await useLibraryStore.getState().initLibrary(); } catch (_) {}
        setStatus(
          `${formatBytes(res.freedBytes || 0)} آزاد شد (${res.clearedFiles || 0} فایلِ کاور).` +
          (res.keptCustom > 0 ? ` ${res.keptCustom} کاورِ سفارشیِ شما حفظ شد.` : '')
        );
        showToast(`${formatBytes(res.freedBytes || 0)} از کشِ کاورها آزاد شد.`, { type: 'success' });
        loadStats();
      } else {
        setStatus((res && res.error) || 'پاک‌سازیِ کشِ کاورها انجام نشد.');
        showToast((res && res.error) || 'پاک‌سازی انجام نشد.', { type: 'error' });
      }
    } catch (err) {
      setStatus('خطا در پاک‌سازی: ' + (err && err.message ? err.message : String(err)));
      showToast('خطا در پاک‌سازی.', { type: 'error' });
    } finally {
      setBusy(null);
    }
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
          <div style={{ ...rowStyle, borderBottom: 'none', fontWeight: 800 }}>
            <span>مجموعِ فضایِ اشغال‌شده</span>
            <span>{formatBytes(stats.totalSizeBytes)}</span>
          </div>
        </div>
      ) : null}

      <div style={{ display: 'flex', flexDirection: compact ? 'column' : 'row', flexWrap: 'wrap', gap: '8px', marginTop: '12px' }}>
        <button
          type="button"
          onClick={() => armOrRun('prune', handlePrune)}
          disabled={Boolean(busy)}
          style={btnStyle}
        >
          <Icons.Trash size={15} />
          <span>{arm === 'prune' ? 'برای تأیید، دوباره کلیک کنید' : 'حذفِ ردپایِ فایل‌هایِ پاک‌شده از سیستم'}</span>
        </button>
        <button
          type="button"
          onClick={() => armOrRun('clear', handleClearCovers)}
          disabled={Boolean(busy)}
          style={btnDangerStyle}
        >
          {busy === 'clear' ? <Icons.Loader size={15} /> : <Icons.Trash size={15} />}
          <span>{arm === 'clear' ? 'برای تأیید، دوباره کلیک کنید' : 'پاک‌سازیِ کاملِ کشِ کاورها'}</span>
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
          پاک‌سازیِ کاورها، کاورهایِ سفارشی‌ای را که خودتان انتخاب کرده‌اید حفظ می‌کند. حذفِ ردپایِ فایل‌هایِ پاک‌شده، فقط وقتی انجام می‌شود که درایوِ فایل در دسترس باشد؛ اگر درایو جدا شده باشد، کتاب‌ها نگه داشته می‌شوند. تغییرِ محلِ ذخیره، دیتابیس و کاورها را به پوشهٔ جدید منتقل می‌کند و برنامه را دوباره راه‌اندازی می‌کند.
        </div>
      )}

      {status && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12.5px', lineHeight: 1.8, color: 'var(--muted)', marginTop: '10px' }}>
          <Icons.Check size={14} />
          <span>{status}</span>
        </div>
      )}
    </div>
  );
}
