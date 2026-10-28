import React, { useState, useRef, useEffect, useMemo } from 'react';
import useSettingsStore from '../../store/useSettingsStore';
import useLibraryStore from '../../store/useLibraryStore';
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
        if (!isMounted) return;
        const res = await coreApi.getReadingStats();
        if (isMounted && res && res.days) {
          setReadingSummary(computeReadingSummary(res.days));
        } else if (isMounted) {
          setReadingSummary(computeReadingSummary({}));
        }
      } catch (_) {
        if (isMounted) setReadingSummary(computeReadingSummary({}));
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

  // مرحله ۶ ـ بخش الف: «صفحه خوانده‌شده» حالا از آمارِ واقعیِ
  // ثبت‌شده می‌آید، نه از جمعِ شمارهٔ صفحهٔ جاریِ کتاب‌ها (که
  // موقعیتِ فعلی را می‌شمرد، نه صفحاتِ واقعاً خوانده‌شده را، و با
  // هر بار خواندنِ دوباره، دوباره شمرده می‌شد). تا وقتی آمار
  // بارگذاری نشده، null است و در کارت، خطِ تیره نشان داده می‌شود.
  const totalReadPages = readingSummary ? readingSummary.totalPages : null;

  const effectiveLibrary = library || libraryItems || [];
  const totalComics = effectiveLibrary.length;
  const totalFavorites = favorites?.length || 0;

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
};