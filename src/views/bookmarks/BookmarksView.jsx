import React, { useEffect, useMemo, useRef, useState } from 'react';
import useBookmarkStore from '../../store/useBookmarkStore';
import useAppStore from '../../store/useAppStore';
import { coreApi } from '../../services/coreApi';
import BookmarkMarker from '../../components/reader/BookmarkMarker';
import {
  BOOKMARK_TEMPLATES,
  BOOKMARK_TEMPLATE_MAP,
  resolveBookmarkImage,
} from '../../components/reader/bookmarkTemplates';
import Icons from '../../components/common/Icons';

// مرحله ۱۴: نمایِ سراسریِ «بوک‌مارک‌ها» — زیرِ «موارد اخیر» در
// سایدبار. دو بخش دارد: (۱) همهٔ بوک‌مارک‌هایِ همهٔ کتاب‌ها با
// پرشِ مستقیم به همان صفحه و همان مختصاتِ عمودی؛ (۲) مدیریتِ
// ساخت‌هایِ سفارشی (پریست‌ها) و گالری، حتی وقتی هیچ کتابی باز
// نیست. باز کردنِ کتاب، از همان مسیرِ processFiles انجام می‌شود
// که نماهایِ دیگر هم استفاده می‌کنند.

const FOCAL_OPTIONS = [
  { id: 'center', label: 'وسط' },
  { id: 'top', label: 'بالا' },
  { id: 'bottom', label: 'پایین' },
];

function fileBaseName(filePath) {
  return String(filePath || '').split(/[\\/]/).pop() || filePath || '';
}

export default function BookmarksView({ onOpenComic }) {
  const allBookmarkFiles = useBookmarkStore((state) => state.allBookmarkFiles);
  const allBookmarksLoaded = useBookmarkStore((state) => state.allBookmarksLoaded);
  const loadAllBookmarks = useBookmarkStore((state) => state.loadAllBookmarks);
  // مرحلهٔ ۵۷، مأموریت ۱ — شمارندهٔ واکنش‌گرِ جهش‌هایِ بوک‌مارک/پریست؛
  // سیگنالِ صریحِ بی‌اعتبارسازی برایِ مشتقِ memoشدهٔ پایین است.
  const bookmarkVersion = useBookmarkStore((state) => state.bookmarkVersion);
  const preferences = useBookmarkStore((state) => state.preferences);
  const loadPreferences = useBookmarkStore((state) => state.loadPreferences);
  const savePreset = useBookmarkStore((state) => state.savePreset);
  const updatePreset = useBookmarkStore((state) => state.updatePreset);
  const deletePreset = useBookmarkStore((state) => state.deletePreset);
  const deleteBookmarkBackground = useBookmarkStore((state) => state.deleteBookmarkBackground);
  const deleteBookmark = useBookmarkStore((state) => state.deleteBookmark);
  const requestJump = useBookmarkStore((state) => state.requestJump);
  const backgrounds = useBookmarkStore((state) => state.backgrounds);
  const loadBackgrounds = useBookmarkStore((state) => state.loadBackgrounds);
  const showToast = useAppStore((state) => state.showToast);

  const [presetTemplate, setPresetTemplate] = useState('MARGIN');
  const [presetImage, setPresetImage] = useState(null);
  const [presetImageTouched, setPresetImageTouched] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [presetSide, setPresetSide] = useState('right');
  const [presetFocal, setPresetFocal] = useState('center');
  const [presetSaving, setPresetSaving] = useState(false);
  const [openingPath, setOpeningPath] = useState(null);
  // مرحله ۱۵: شناسهٔ ساختی که در حالِ ویرایش است (null یعنی ساختِ تازه).
  const [editingPresetId, setEditingPresetId] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    loadPreferences();
    loadAllBookmarks();
    loadBackgrounds();
  }, [loadPreferences, loadAllBookmarks, loadBackgrounds]);

  const savedPresets = preferences.savedPresets || [];

  const bookEntries = useMemo(() => {
    return Object.entries(allBookmarkFiles)
      .map(([filePath, entry]) => ({
        filePath,
        fileName: entry.fileName || fileBaseName(filePath),
        bookmarks: [...(entry.bookmarks || [])].sort((a, b) => a.page - b.page || a.yRatio - b.yRatio),
      }))
      .filter((e) => e.bookmarks.length > 0)
      .sort((a, b) => String(a.fileName).localeCompare(String(b.fileName)));
  // مرحلهٔ ۵۷، مأموریت ۱ — با هر جهش، بازمحاسبه می‌شود، حتی اگر
  // ارجاعِ کش در مسیرِ آینده‌ای به‌روز نشده باشد.
  }, [allBookmarkFiles, bookmarkVersion]);

  const totalCount = useMemo(
    () => bookEntries.reduce((sum, e) => sum + e.bookmarks.length, 0),
    [bookEntries]
  );

  const handleOpenBookmark = async (filePath, bm) => {
    if (!filePath || openingPath) return;
    setOpeningPath(filePath);
    try {
      if (typeof onOpenComic === 'function') await onOpenComic(filePath);
    } catch (_) {}
    requestJump(filePath, bm.page, bm.yRatio);
    setOpeningPath(null);
  };

  const handleDeleteBookmark = async (filePath, id) => {
    await deleteBookmark(filePath, id);
  };

  const resetPresetForm = () => {
    setPresetName('');
    setPresetImage(null);
    setPresetImageTouched(false);
    setPresetTemplate('MARGIN');
    setPresetSide('right');
    setPresetFocal('center');
    setEditingPresetId(null);
  };

  const handleEditPreset = (preset) => {
    if (!preset) return;
    setPresetTemplate(preset.template || 'MARGIN');
    setPresetImage(preset.image || null);
    setPresetImageTouched(true);
    setPresetName(preset.name || '');
    setPresetSide(preset.side || 'right');
    setPresetFocal(preset.focalPoint || 'center');
    setEditingPresetId(preset.id);
  };

  const handleSavePreset = async () => {
    if (presetSaving) return;
    setPresetSaving(true);
    try {
      if (editingPresetId) {
        const updated = await updatePreset(editingPresetId, {
          name: presetName.trim(),
          template: presetTemplate,
          image: presetImageTouched ? presetImage : null,
          focalPoint: presetFocal,
          side: presetSide,
        });
        if (updated) {
          showToast('تغییرهایِ این ساخت ذخیره شد.', { type: 'success' });
          resetPresetForm();
        }
      } else {
        const created = await savePreset({
          name: presetName.trim(),
          template: presetTemplate,
          image: presetImageTouched ? presetImage : null,
          focalPoint: presetFocal,
          side: presetSide,
        });
        if (created) {
          showToast('ساختِ سفارشی ذخیره شد و در همهٔ کتاب‌ها در دسترس است.', { type: 'success' });
          setPresetName('');
          setPresetImage(null);
          setPresetImageTouched(false);
        }
      }
    } finally {
      setPresetSaving(false);
    }
  };

  // مرحله ۱۵: افزودنِ عکس با انتخاب‌گرِ فایلِ وب (نه دیالوگِ
  // showOpenDialog الکترون): مسیرها با getFilePath خوانده و با
  // همان کانالِ واردکننده، در پوشهٔ نرم‌افزار کپی می‌شوند.
  const handleAddFilesFromInput = async (e) => {
    const files = Array.from((e.target && e.target.files) || []);
    if (e.target) e.target.value = '';
    if (files.length === 0) return;
    const paths = files.map((f) => {
      try {
        return coreApi.getFilePath ? coreApi.getFilePath(f) : (f.path || '');
      } catch (_) {
        return f.path || '';
      }
    }).filter(Boolean);
    if (paths.length === 0) {
      showToast('مسیرِ فایل‌ها خوانده نشد.', { type: 'error' });
      return;
    }
    try {
      const res = await coreApi.importBookmarkBackgroundFiles(paths);
      if (res && res.success) {
        const n = (res.imported || []).length;
        const s = (res.skipped || []).length;
        if (n > 0) showToast(`${n} عکس واردِ پوشه شد.`, { type: 'success' });
        if (s > 0) showToast(`${s} فایل رد شد (فقط عکس‌هایِ مجاز وارد می‌شوند).`, { type: 'info' });
        if (n === 0 && s === 0) showToast('فایلی وارد نشد.', { type: 'info' });
        await loadBackgrounds(true);
      } else {
        showToast((res && res.error) || 'وارد کردنِ عکس‌ها انجام نشد.', { type: 'error' });
      }
    } catch (_) {
      showToast('وارد کردنِ عکس‌ها انجام نشد.', { type: 'error' });
    }
  };

  const handleDeleteBackground = async (bg) => {
    if (!bg || bg.source !== 'folder') return;
    const ok = await deleteBookmarkBackground(bg.name);
    if (ok) showToast('عکس از پوشه حذف شد.', { type: 'success' });
  };

  const handleOpenFolder = async () => {
    try {
      const res = await coreApi.openBookmarkBackgroundsFolder();
      if (!res || !res.success) showToast((res && res.error) || 'باز کردنِ پوشه انجام نشد.', { type: 'error' });
      else showToast('پوشهٔ تصاویر باز شد.', { type: 'success' });
    } catch (_) {
      showToast('باز کردنِ پوشه انجام نشد.', { type: 'error' });
    }
  };

  const draftPreset = {
    id: 'preset-preview',
    page: 1,
    yRatio: 0,
    side: presetSide,
    template: presetTemplate,
    image: presetImageTouched ? presetImage : null,
    focalPoint: presetFocal,
    name: presetName.trim(),
  };
  const draftPresetImage =
    (presetImageTouched ? presetImage : null) || resolveBookmarkImage(draftPreset, preferences);

  return (
    <div style={styles.view}>
      <div style={styles.viewInner}>
      <div style={styles.header}>
        <span style={{ color: 'var(--accent)', display: 'flex' }}>
          <Icons.Bookmark size={22} />
        </span>
        <div>
          <div style={styles.title}>بوک‌مارک‌ها</div>
          <div style={styles.subtitle}>
            {totalCount > 0
              ? `${totalCount.toLocaleString('fa-IR')} بوک‌مارک در ${bookEntries.length.toLocaleString('fa-IR')} کتاب`
              : 'هنوز بوک‌مارکی ثبت نشده است'}
          </div>
        </div>
      </div>

      <div style={styles.sectionTitle}>همهٔ بوک‌مارک‌هایِ من در کلِ کتاب‌ها</div>
      {!allBookmarksLoaded ? (
        <div style={styles.empty}>در حالِ خواندنِ بوک‌مارک‌ها…</div>
      ) : bookEntries.length === 0 ? (
        <div style={styles.empty}>
          هنوز بوک‌مارکی ثبت نشده است. اول در همین صفحه، پایین، یک تمپلیت بسازید؛
          بعد در محیطِ مطالعه، با راست‌کلیک رویِ هر نقطهٔ صفحه، یکی از تمپلیت‌هایِ
          خودتان را انتخاب کنید تا همان بوک‌مارک ساخته شود.
        </div>
      ) : (
        bookEntries.map((entry) => (
          <div key={entry.filePath} style={styles.bookBlock}>
            <div style={styles.bookName} title={entry.filePath}>
              <Icons.BookOpen size={15} />
              <span>{entry.fileName}</span>
              <span style={styles.bookCount}>{entry.bookmarks.length.toLocaleString('fa-IR')} بوک‌مارک</span>
            </div>
            <div style={styles.cardGrid}>
              {entry.bookmarks.map((bm) => {
                const imageUrl = resolveBookmarkImage(bm, preferences);
                const templateLabel = BOOKMARK_TEMPLATE_MAP[bm.template]?.faLabel || bm.template;
                return (
                  <div key={bm.id} style={styles.card}>
                    <button
                      type="button"
                      onClick={() => handleOpenBookmark(entry.filePath, bm)}
                      disabled={openingPath === entry.filePath}
                      style={styles.cardMain}
                      title="باز کردنِ کتاب و پرش به همین نقطه"
                    >
                      <div style={styles.markerBox}>
                        <div style={{ transform: 'scale(0.42)', transformOrigin: 'top center', height: '270px' }}>
                          <BookmarkMarker bookmark={bm} imageUrl={imageUrl} onOpen={null} onDelete={null} />
                        </div>
                      </div>
                      <div style={styles.cardMeta}>
                        <span style={styles.cardName}>{bm.name || `تمپلیتِ ${templateLabel}`}</span>
                        <span style={styles.cardSub}>
                          صفحه {bm.page.toLocaleString('fa-IR')} • {Math.round(bm.yRatio * 100).toLocaleString('fa-IR')}٪ از بالایِ صفحه
                          • {bm.side === 'left' ? 'حاشیهٔ چپ' : 'حاشیهٔ راست'}
                        </span>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteBookmark(entry.filePath, bm.id)}
                      style={styles.cardDel}
                      title="حذفِ این بوک‌مارک"
                    >
                      <Icons.X size={13} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}

      <div style={styles.sectionTitle}>استودیویِ ساخت و مدیریتِ تمپلیت‌ها و تصاویر</div>
      <div style={styles.presetPanel}>
        <div style={styles.presetSub}>ساخت‌هایِ سفارشیِ من (در همهٔ کتاب‌ها در دسترس‌اند)</div>
        {savedPresets.length === 0 ? (
          <div style={styles.emptySmall}>هنوز ساختی ذخیره نشده است؛ پایین، یکی بسازید.</div>
        ) : (
          <div style={styles.presetList}>
            {savedPresets.map((preset) => {
              const imageUrl = resolveBookmarkImage(preset, preferences);
              const templateLabel = BOOKMARK_TEMPLATE_MAP[preset.template]?.faLabel || preset.template;
              return (
                <div key={preset.id} style={styles.presetRow}>
                  <div style={styles.presetThumb}>
                    <div style={{ transform: 'scale(0.3)', transformOrigin: 'top center', height: '270px' }}>
                      <BookmarkMarker
                        bookmark={{ ...preset, page: 1, yRatio: 0 }}
                        imageUrl={imageUrl}
                        onOpen={null}
                        onDelete={null}
                      />
                    </div>
                  </div>
                  <div style={styles.presetInfo}>
                    <span style={styles.presetName}>{preset.name || `ساختِ ${templateLabel}`}</span>
                    <span style={styles.presetSub2}>
                      تمپلیتِ {templateLabel} • {preset.side === 'left' ? 'حاشیهٔ چپ' : 'حاشیهٔ راست'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleEditPreset(preset)}
                    style={{ ...styles.presetDel, color: 'var(--accent)' }}
                    title="ویرایشِ این ساخت"
                  >
                    <Icons.Edit3 size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => deletePreset(preset.id)}
                    style={styles.presetDel}
                    title="حذفِ این ساخت"
                  >
                    <Icons.Trash size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <div style={styles.presetSub}>ساختِ تازه (بدونِ نیاز به باز بودنِ کتاب)</div>
        <div style={styles.templateGrid}>
          {BOOKMARK_TEMPLATES.map((t) => {
            const isActive = presetTemplate === t.id;
            const cellImage =
              (presetImageTouched ? presetImage : null) ||
              (preferences.templateImages && preferences.templateImages[t.id]) ||
              preferences.globalImage ||
              null;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setPresetTemplate(t.id)}
                style={{
                  ...styles.templateCell,
                  border: isActive ? '2px solid var(--accent)' : '1px solid var(--border)',
                  backgroundColor: isActive ? 'rgba(34, 211, 238, 0.08)' : 'var(--panel2)',
                }}
              >
                <div style={{ height: '118px', overflow: 'hidden', display: 'flex', justifyContent: 'center' }}>
                  <div style={{ transform: 'scale(0.42)', transformOrigin: 'top center', height: '270px' }}>
                    <BookmarkMarker
                      bookmark={{ id: 'cell', page: 1, yRatio: 0, side: 'right', template: t.id, image: cellImage, focalPoint: presetFocal, name: '' }}
                      imageUrl={cellImage}
                      onOpen={() => setPresetTemplate(t.id)}
                      onDelete={null}
                    />
                  </div>
                </div>
                <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text)', marginTop: '2px' }}>{t.faLabel}</div>
              </button>
            );
          })}
        </div>

        <div style={styles.galleryRow}>
          <button type="button" onClick={() => loadBackgrounds(true)} style={styles.btn}>
            <Icons.RefreshCw size={14} />
            <span>تازه‌سازیِ پوشه</span>
          </button>
          <button type="button" onClick={handleOpenFolder} style={styles.btn}>
            <Icons.FolderOpen size={14} />
            <span>باز کردنِ پوشه در اکسپلورر</span>
          </button>
          <button type="button" onClick={() => fileInputRef.current && fileInputRef.current.click()} style={styles.btn}>
            <Icons.Plus size={14} />
            <span>+ افزودن عکس به پوشه</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleAddFilesFromInput}
            style={{ display: 'none' }}
          />
        </div>
        <div style={styles.galleryStrip}>
          <button
            type="button"
            onClick={() => { setPresetImage(null); setPresetImageTouched(true); }}
            style={{
              ...styles.galleryThumbBtn,
              border: presetImageTouched && presetImage === null ? '2px solid var(--accent)' : '1px solid var(--border)',
              background: 'repeating-linear-gradient(45deg,#e5e7eb 0 10px,#f3f4f6 10px 20px)',
              color: '#374151',
            }}
          >
            بدونِ عکس
          </button>
          {backgrounds.map((bg) => {
            const isActive = presetImageTouched && presetImage === bg.url;
            return (
              <div key={bg.id} style={{ position: 'relative', flexShrink: 0 }}>
                <button
                  type="button"
                  onClick={() => { setPresetImage(bg.url); setPresetImageTouched(true); }}
                  title={bg.name}
                  style={{
                    ...styles.galleryThumbBtn,
                    border: isActive ? '2px solid var(--accent)' : '1px solid var(--border)',
                    padding: 0,
                    overflow: 'hidden',
                  }}
                >
                  <img src={bg.url} alt={bg.name} draggable={false} style={{ width: '72px', height: '100px', objectFit: 'cover', display: 'block' }} />
                </button>
                {bg.source === 'folder' ? (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); handleDeleteBackground(bg); }}
                    title="حذفِ این عکس از پوشه"
                    style={{
                      position: 'absolute',
                      top: '4px',
                      left: '4px',
                      width: '22px',
                      height: '22px',
                      borderRadius: '50%',
                      border: 'none',
                      backgroundColor: 'rgba(17, 24, 39, 0.85)',
                      color: '#f87171',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      padding: 0,
                    }}
                  >
                    <Icons.Trash size={12} />
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>

        <div style={styles.formRow}>
          <input
            value={presetName}
            onChange={(e) => setPresetName(e.target.value)}
            placeholder="نامِ دلخواهِ ساخت (اختیاری؛ خالی یعنی نامِ تمپلیت)"
            style={styles.input}
          />
          <div style={{ display: 'flex', gap: '8px' }}>
            {[
              { id: 'right', label: 'حاشیهٔ راست' },
              { id: 'left', label: 'حاشیهٔ چپ' },
            ].map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setPresetSide(s.id)}
                style={{ ...styles.btn, border: presetSide === s.id ? '2px solid var(--accent)' : '1px solid var(--border)' }}
              >
                {s.label}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            {FOCAL_OPTIONS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setPresetFocal(f.id)}
                style={{ ...styles.btn, border: presetFocal === f.id ? '2px solid var(--accent)' : '1px solid var(--border)' }}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ width: '68px', transform: 'scale(0.72)', transformOrigin: 'top right', height: '194px', overflow: 'hidden', flexShrink: 0 }}>
            <BookmarkMarker bookmark={draftPreset} imageUrl={draftPresetImage} onOpen={null} onDelete={null} />
          </div>
          <button
            type="button"
            onClick={handleSavePreset}
            disabled={presetSaving}
            style={{ ...styles.btn, backgroundColor: 'var(--accent)', color: '#0a0f13', border: '1px solid var(--accent)', padding: '10px 18px', fontSize: '13.5px' }}
          >
            {presetSaving ? 'در حالِ ذخیره…' : editingPresetId ? 'ذخیرهٔ تغییرهایِ این ساخت' : '+ ساخت و افزودن به لیستِ تمپلیت‌های من'}
          </button>
          {editingPresetId ? (
            <button type="button" onClick={resetPresetForm} style={styles.btn}>
              لغو ویرایش
            </button>
          ) : null}
        </div>
      </div>
      </div>
    </div>
  );
}

const styles = {
  view: {
    padding: '20px',
    maxWidth: '1100px',
    margin: '0 auto',
    width: '100%',
    boxSizing: 'border-box',
    direction: 'ltr',
    fontFamily: 'var(--font-fa)',
    color: 'var(--text)',
    overflowY: 'auto',
    height: '100%',
  },
  // مرحله ۴۴: قفلِ جهت — پوسته ltr، محتوایِ درونی rtl تا نوارِ اسکرول در سمتِ راست بماند
  viewInner: {
    direction: 'rtl',
    width: '100%',
    boxSizing: 'border-box',
  },
  header: { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' },
  title: { fontSize: '20px', fontWeight: 800 },
  subtitle: { fontSize: '12.5px', color: 'var(--muted)', marginTop: '2px' },
  sectionTitle: { fontSize: '15px', fontWeight: 800, margin: '22px 0 12px' },
  empty: { fontSize: '13px', color: 'var(--muted)', lineHeight: 2, backgroundColor: 'var(--panel2)', border: '1px solid var(--border)', borderRadius: '12px', padding: '16px' },
  emptySmall: { fontSize: '12.5px', color: 'var(--muted)', lineHeight: 1.9, marginBottom: '12px' },
  bookBlock: { marginBottom: '18px' },
  bookName: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13.5px', fontWeight: 700, marginBottom: '10px', overflow: 'hidden' },
  bookCount: { fontSize: '11.5px', color: 'var(--muted)', fontWeight: 500 },
  cardGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: '12px' },
  card: { position: 'relative', backgroundColor: 'var(--panel2)', border: '1px solid var(--border)', borderRadius: '14px', padding: '12px', overflow: 'hidden' },
  cardMain: { display: 'flex', gap: '12px', alignItems: 'flex-start', width: '100%', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-fa)', color: 'var(--text)', textAlign: 'right', padding: 0 },
  markerBox: { width: '68px', height: '118px', overflow: 'hidden', flexShrink: 0 },
  cardMeta: { display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 0 },
  cardName: { fontSize: '13px', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  cardSub: { fontSize: '11.5px', color: 'var(--muted)', lineHeight: 1.8 },
  cardDel: { position: 'absolute', top: '8px', left: '8px', background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer', padding: '4px', display: 'flex' },
  presetPanel: { backgroundColor: 'var(--panel)', border: '1px solid var(--border)', borderRadius: '16px', padding: '18px' },
  presetSub: { fontSize: '13px', fontWeight: 800, marginBottom: '10px' },
  presetList: { display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '18px' },
  presetRow: { display: 'flex', alignItems: 'center', gap: '12px', backgroundColor: 'var(--panel2)', border: '1px solid var(--border)', borderRadius: '12px', padding: '10px 12px' },
  presetThumb: { width: '68px', height: '82px', overflow: 'hidden', flexShrink: 0 },
  presetInfo: { display: 'flex', flexDirection: 'column', gap: '4px', flex: 1, minWidth: 0 },
  presetName: { fontSize: '13px', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  presetSub2: { fontSize: '11.5px', color: 'var(--muted)' },
  presetDel: { background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '6px', display: 'flex' },
  templateGrid: { display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '10px', marginBottom: '16px' },
  templateCell: { borderRadius: '12px', padding: '8px 4px 6px', cursor: 'pointer', fontFamily: 'var(--font-fa)' },
  galleryRow: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '10px' },
  btn: { display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 12px', borderRadius: '10px', border: '1px solid var(--border)', backgroundColor: 'var(--panel2)', color: 'var(--text)', fontFamily: 'var(--font-fa)', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer' },
  galleryStrip: { display: 'flex', gap: '10px', overflowX: 'auto', paddingBottom: '8px', marginBottom: '16px' },
  galleryThumbBtn: { minWidth: '72px', height: '100px', borderRadius: '10px', cursor: 'pointer', fontFamily: 'var(--font-fa)', fontSize: '11px', fontWeight: 700, backgroundColor: 'var(--panel2)' },
  formRow: { display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '16px' },
  input: { flex: '1 1 220px', padding: '9px 12px', borderRadius: '10px', border: '1px solid var(--border)', backgroundColor: 'var(--panel2)', color: 'var(--text)', fontFamily: 'var(--font-fa)', fontSize: '13px', outline: 'none' },
};
