import React, { useEffect, useRef, useState } from 'react';
import Icons from '../common/Icons';
import { BOOKMARK_TEMPLATE_MAP } from './bookmarkTemplates';

// مرحله ۱۳: مارکرِ بوک‌مارکِ دیجیتال — ابعادِ ثابتِ ۶۸×۲۷۰،
// عکس ۲۳۲ پیکسلی بالا + نام ۳۸ پیکسلی زیرِ عکس (هرگز رویِ عکس
// نیست) + دکمهٔ حذفِ ۲۲ پیکسلی که فقط در هاور دیده می‌شود.
// همهٔ انیمیشن‌ها فقط با transform/opacity/filter هستند و
// prefers-reduced-motion رعایت می‌شود. استایل‌ها یک بار در
// document.head تزریق می‌شوند تا :hover و keyframesها کار کنند
// (استایلِ درون‌خطی، hover ندارد).

const MARKER_CSS = `
.bm-marker{width:68px;height:270px;display:flex;flex-direction:column;background:#fff;filter:drop-shadow(0 6px 8px rgba(0,0,0,.2));cursor:pointer;position:relative;user-select:none;flex-shrink:0;transition:transform .3s ease,border-color .3s ease,box-shadow .3s ease,filter .3s ease}
.bm-img{height:232px;overflow:hidden;position:relative;flex-shrink:0;background:#f3f4f6}
.bm-img img{width:100%;height:100%;object-fit:cover;display:block;pointer-events:none}
.bm-ph{width:100%;height:100%;background:repeating-linear-gradient(45deg,#e5e7eb 0 10px,#f3f4f6 10px 20px)}
.bm-name{height:38px;min-height:38px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:bold;color:#111827;background:#fff;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;padding:0 4px;direction:rtl;font-family:var(--font-fa,inherit);box-sizing:border-box}
.bm-name-input{height:38px;min-height:38px;width:100%;box-sizing:border-box;border:1px solid #c9a227;outline:none;background:#fffbe6;color:#111827;font-size:11px;font-weight:bold;text-align:center;font-family:var(--font-fa,inherit);padding:0 4px}
.bm-x{position:absolute;top:-9px;left:50%;transform:translateX(-50%);width:22px;height:22px;border-radius:50%;background:#111827;color:#fff;display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .2s ease;border:none;cursor:pointer;z-index:5;padding:0}
.bm-marker:hover .bm-x{opacity:1}
.bm--MARGIN{border:2px solid #c9a227;box-sizing:border-box}
.bm--MARGIN:hover{transform:translateY(-4px);border-color:#facc15}
.bm--SLANT{transform:rotate(3deg);transform-origin:top center}
.bm--SLANT:hover{transform:rotate(0deg)}
.bm--ARROW .bm-img{clip-path:polygon(0 0,100% 0,100% 82%,50% 100%,0 82%)}
@keyframes bm-bounce{0%,100%{transform:translateY(0)}50%{transform:translateY(6px)}}
.bm--ARROW:hover{animation:bm-bounce .6s ease-in-out infinite}
.bm--MIRROR .bm-img{height:160px}
.bm-reflect{height:72px;overflow:hidden;position:relative;flex-shrink:0}
.bm-reflect img{width:100%;height:100%;object-fit:cover;display:block;transform:scaleY(-1);opacity:.6;-webkit-mask-image:linear-gradient(to bottom,black,transparent);mask-image:linear-gradient(to bottom,black,transparent);transition:opacity .3s ease;pointer-events:none}
.bm--MIRROR:hover .bm-reflect img{opacity:1}
.bm--DIAGONAL .bm-img{clip-path:polygon(0 28px,100% 0,100% 100%,0 100%)}
.bm--DIAGONAL:hover{transform:translateY(-5px)}
.bm-back{position:absolute;top:12px;right:-6px;width:100%;height:232px;opacity:.45;filter:grayscale(1);background-size:cover;z-index:0;transition:transform .3s ease;pointer-events:none}
.bm--OFFSET .bm-img{position:relative;z-index:1}
.bm--OFFSET:hover .bm-back{transform:translate(-3px,-6px)}
.bm--FLIP{perspective:600px}
.bm-flip-inner{position:relative;width:100%;height:232px;transform-style:preserve-3d;transition:transform .6s ease;flex-shrink:0}
.bm-face{position:absolute;inset:0;backface-visibility:hidden;-webkit-backface-visibility:hidden;overflow:hidden}
.bm-face img{width:100%;height:100%;object-fit:cover;display:block;pointer-events:none}
.bm-face-back{transform:rotateY(180deg);background:#111827}
.bm-face-back img{transform:scaleX(-1)}
.bm--FLIP:hover .bm-flip-inner{transform:rotateY(180deg)}
.bm--ZOOM .bm-img img{transition:transform .4s ease}
.bm--ZOOM:hover .bm-img img{transform:scale(1.18);transform-origin:center}
@keyframes bm-sway{0%,100%{transform:rotate(-3deg)}50%{transform:rotate(3deg)}}
.bm--SWAY{transform-origin:top center}
.bm--SWAY:hover{animation:bm-sway 1.2s ease-in-out infinite}
@keyframes bm-glow-pulse{0%,100%{box-shadow:0 0 24px 6px rgba(201,162,39,.55)}50%{box-shadow:0 0 12px 3px rgba(201,162,39,.3)}}
.bm--GLOW:hover{animation:bm-glow-pulse 1.6s ease-in-out infinite}
.bm--FLOAT:hover{transform:translateY(-10px);filter:drop-shadow(0 16px 14px rgba(0,0,0,.3))}
.bm--SLIDE .bm-img img{transition:transform .4s ease}
.bm--SLIDE:hover .bm-img img{transform:translateY(-12px) scale(1.05)}
.bm-slice{width:100%;height:33.3333%;background-size:100% 300%;background-repeat:no-repeat;transition:transform .3s ease}
.bm--SPLIT:hover .bm-slice-first{transform:translateX(-5px)}
.bm--SPLIT:hover .bm-slice-last{transform:translateX(5px)}
.bm--TILT:hover{transform:perspective(500px) rotateX(8deg) rotateY(-10deg)}
@keyframes bm-wave{0%,100%{transform:skewX(2deg)}50%{transform:skewX(-2deg)}}
.bm--WAVE:hover{animation:bm-wave .8s ease-in-out infinite}
@media (prefers-reduced-motion:reduce){.bm-marker,.bm-marker *{animation:none !important;transition:none !important}}
.bm-marker{touch-action:none}
.bm--side-right{border-top-right-radius:8px;border-bottom-right-radius:8px;border-top-left-radius:0;border-bottom-left-radius:0}
.bm--side-left{border-top-left-radius:8px;border-bottom-left-radius:8px;border-top-right-radius:0;border-bottom-right-radius:0}
.bm--side-right .bm-img,.bm--side-right .bm-flip-inner{border-top-right-radius:8px}
.bm--side-right .bm-name,.bm--side-right .bm-name-input{border-bottom-right-radius:8px}
.bm--side-left .bm-img,.bm--side-left .bm-flip-inner{border-top-left-radius:8px}
.bm--side-left .bm-name,.bm--side-left .bm-name-input{border-bottom-left-radius:8px}
.bm-spine{position:absolute;top:0;bottom:0;width:4px;z-index:2;pointer-events:none;background:linear-gradient(180deg,#f6d365,#c9a227 55%,#8a6d1b)}
.bm--side-right .bm-spine{left:0;box-shadow:inset 4px 0 6px -2px rgba(0,0,0,.35)}
.bm--side-left .bm-spine{right:0;box-shadow:inset -4px 0 6px -2px rgba(0,0,0,.35)}
/* مرحله ۱۹ — پلِ اتصال: نوارِ افقیِ ظریفِ ۱۰ پیکسلی که فاصلهٔ میانِ لبهٔ
   کاغذ و بدنهٔ بوک‌مارک را می‌بندد تا بوک‌مارک، با وجودِ بیرون بودن از
   صفحه، با یک آبجکتِ گرافیکی به برگه وصل باشد. داخلِ ریشهٔ مارکر است
   تا هنگامِ درگ، همراهِ مارکر حرکت کند؛ رویدادِ اشاره‌اش به ریشه
   می‌رسد (درگ از رویِ پل هم شروع می‌شود) و چون زیرِ .bm-marker است،
   پیمایشِ چهارجهته را مسدود نمی‌کند. */
.bm-bridge{position:absolute;top:18px;width:10px;height:3px;border-radius:2px;z-index:3;background:linear-gradient(90deg,#c9a227,#f6d365);box-shadow:0 1px 3px rgba(0,0,0,.45)}
.bm--side-right .bm-bridge{left:-10px}
.bm--side-left .bm-bridge{right:-10px;background:linear-gradient(270deg,#c9a227,#f6d365)}
`;

function ensureBookmarkStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('bm-marker-styles')) return;
  const style = document.createElement('style');
  style.id = 'bm-marker-styles';
  style.textContent = MARKER_CSS;
  document.head.appendChild(style);
}

function focalToObjectPosition(focalPoint) {
  if (focalPoint === 'top') return 'center top';
  if (focalPoint === 'bottom') return 'center bottom';
  return 'center';
}

export default function BookmarkMarker({ bookmark, imageUrl, onOpen, onDelete, onRename, onMove }) {
  useEffect(() => {
    ensureBookmarkStyles();
  }, []);
  // مرحله ۱۶: ویرایشِ درجایِ نام — همهٔ هوک‌ها پیش از returnِ
  // زودهنگام‌اند (قانونِ همیشگی: هوک، هرگز پس از return).
  const [isEditing, setIsEditing] = useState(false);
  const [draftName, setDraftName] = useState('');
  const skipBlurCommitRef = useRef(false);
  const inputRef = useRef(null);
  // مرحله ۱۸ — درگِ جابه‌جاییِ بوک‌مارک: همهٔ هوک‌ها، پیش از returnِ
  // زودهنگام‌اند (قانونِ همیشگی). dragVisual، جابه‌جاییِ دیداریِ
  // حینِ درگ است (فقط transform رویِ همین مارکر)؛ ذخیره، فقط در
  // pointerup انجام می‌شود.
  const dragRef = useRef(null);
  const suppressClickRef = useRef(false);
  const [dragVisual, setDragVisual] = useState(null);
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  if (!bookmark) return null;
  const template = bookmark.template || 'MARGIN';
  const label = bookmark.name || (BOOKMARK_TEMPLATE_MAP[template]?.faLabel || template);
  const focal = focalToObjectPosition(bookmark.focalPoint);

  const imgEl = imageUrl ? (
    <img src={imageUrl} alt="" draggable={false} style={{ objectPosition: focal }} />
  ) : (
    <div className="bm-ph" />
  );

  let imageArea = null;
  if (template === 'MIRROR') {
    imageArea = (
      <>
        <div className="bm-img">{imgEl}</div>
        <div className="bm-reflect">
          {imageUrl ? (
            <img src={imageUrl} alt="" draggable={false} style={{ objectPosition: focal }} />
          ) : (
            <div className="bm-ph" />
          )}
        </div>
      </>
    );
  } else if (template === 'SPLIT') {
    const slices = imageUrl ? (
      <>
        <div className="bm-slice bm-slice-first" style={{ backgroundImage: `url("${imageUrl}")`, backgroundPosition: `center 0%` }} />
        <div className="bm-slice" style={{ backgroundImage: `url("${imageUrl}")`, backgroundPosition: `center 50%` }} />
        <div className="bm-slice bm-slice-last" style={{ backgroundImage: `url("${imageUrl}")`, backgroundPosition: `center 100%` }} />
      </>
    ) : (
      <div className="bm-ph" />
    );
    imageArea = <div className="bm-img">{slices}</div>;
  } else if (template === 'FLIP') {
    imageArea = (
      <div className="bm-flip-inner">
        <div className="bm-face">{imgEl}</div>
        <div className="bm-face bm-face-back">
          {imageUrl ? (
            <img src={imageUrl} alt="" draggable={false} style={{ objectPosition: focal }} />
          ) : (
            <div className="bm-ph" />
          )}
        </div>
      </div>
    );
  } else if (template === 'OFFSET') {
    imageArea = (
      <>
        {imageUrl ? (
          <div className="bm-back" style={{ backgroundImage: `url("${imageUrl}")`, backgroundPosition: focal }} />
        ) : null}
        <div className="bm-img">{imgEl}</div>
      </>
    );
  } else {
    imageArea = <div className="bm-img">{imgEl}</div>;
  }

  // باگ ۳: در حینِ تایپ، استور لمس نمی‌شود؛ فقط در ثبتِ نهایی.
  const commitEditing = () => {
    if (!bookmark) return;
    const stored = bookmark.name || '';
    const finalName = draftName.trim().slice(0, 30);
    setIsEditing(false);
    if (finalName !== stored && onRename) onRename(bookmark, finalName);
  };
  const cancelEditing = () => {
    // باگ ۴: پرچم، پیش از آنمانت شدنِ اینپوت ست می‌شود تا onBlurِ
    // پس از آن، لغو را دوباره ذخیره نکند.
    skipBlurCommitRef.current = true;
    setIsEditing(false);
  };
  const stopKey = (e) => {
    // باگ ۱: کلیدها به شورت‌کات‌هایِ سراسری نمی‌رسند (useKeyboard
    // خودش هم INPUT را نادیده می‌گیرد؛ این، کمربندِ دوم است).
    e.stopPropagation();
    if (e.nativeEvent && typeof e.nativeEvent.stopImmediatePropagation === 'function') {
      e.nativeEvent.stopImmediatePropagation();
    }
  };
  const handleInputKeyDown = (e) => {
    stopKey(e);
    if (e.key === 'Enter') {
      e.preventDefault();
      skipBlurCommitRef.current = true;
      commitEditing();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEditing();
    }
  };
  const handleInputBlur = () => {
    if (skipBlurCommitRef.current) {
      skipBlurCommitRef.current = false;
      return;
    }
    commitEditing();
  };
  const startEditing = (e) => {
    if (e) e.stopPropagation();
    if (!onRename) return;
    skipBlurCommitRef.current = false;
    setDraftName(label);
    setIsEditing(true);
  };

  // مرحله ۱۸ — درگِ بوک‌مارک رویِ لبهٔ کاغذ با ۶ محافظِ ضدِ پرش:
  // ۱) grabOffsetY: نقطهٔ گرفتن تا بالایِ مارکر، تا در فریمِ اول نپرد؛
  // ۲) کلمپِ بالا/پایین با ارتفاعِ واقعیِ مارکر + سقفِ yRatio رویِ
  // 0.92؛ ۳) هیسترزیسِ ۴۰ پیکسلی دورِ مرکزِ صفحه برایِ تغییرِ سمت؛
  // ۴) setPointerCapture + شنونده‌هایِ window تا درگ با حرکتِ سریع
  // بیرون از مارکر قطع نشود؛ ۵) حینِ حرکت فقط stateِ محلی (بدونِ
  // IPC) و stopPropagation در برابرِ useDragPan؛ ۶) آستانهٔ ۵ پیکسل
  // برایِ تشخیصِ کلیک از درگ (پس از درگ، استودیو باز نمی‌شود).
  // توجه: دکمهٔ حذفِ .bm-x در بالایِ مارکر، ۹ پیکسل بیرون می‌زند؛
  // پس رویِ ریشه overflow:hidden گذاشته نشده (دکمه را می‌بُرید) و
  // گردیِ گوشه‌ها، رویِ فرزندها (.bm-img و .bm-name) اعمال شده است.
  const handleMarkerPointerDown = (e) => {
    if (!onMove || isEditing) return;
    if (e.button !== 0) return;
    const tgt = e.target;
    if (tgt && typeof tgt.closest === 'function' && tgt.closest('.bm-name, .bm-name-input, .bm-x')) return;
    const markerEl = e.currentTarget;
    const pageEl = markerEl.closest('.comic-page-item');
    if (!pageEl) return;
    e.stopPropagation();
    e.preventDefault();
    suppressClickRef.current = false;
    const markerRect = markerEl.getBoundingClientRect();
    const pageRect = pageEl.getBoundingClientRect();
    if (!pageRect.width || !pageRect.height || !markerRect.height) return;
    const startSide = bookmark.side === 'left' ? 'left' : 'right';
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      grabOffsetY: e.clientY - markerRect.top,
      pageRect,
      markerWidth: markerRect.width,
      markerHeight: markerRect.height,
      startTopPx: markerRect.top - pageRect.top,
      startLeftEdge: markerRect.left,
      side: startSide,
      hasMoved: false,
      lastYRatio: bookmark.yRatio,
      lastSide: startSide,
    };
    try { markerEl.setPointerCapture(e.pointerId); } catch (_) {}
    setDragVisual({ x: 0, y: 0, side: startSide });
    const handleMove = (ev) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = ev.clientX - d.startX;
      const dy = ev.clientY - d.startY;
      if (!d.hasMoved && Math.max(Math.abs(dx), Math.abs(dy)) > 5) d.hasMoved = true;
      const newTopPx = (ev.clientY - d.grabOffsetY) - d.pageRect.top;
      const maxTopPx = Math.max(0, d.pageRect.height - d.markerHeight);
      const clampedTopPx = Math.min(Math.max(0, newTopPx), maxTopPx);
      let yRatio = clampedTopPx / d.pageRect.height;
      yRatio = Math.min(Math.max(0, yRatio), 0.92);
      d.lastYRatio = yRatio;
      const centerX = d.pageRect.left + d.pageRect.width / 2;
      let nextSide = d.side;
      if (nextSide === 'right' && ev.clientX < centerX - 40) nextSide = 'left';
      else if (nextSide === 'left' && ev.clientX > centerX + 40) nextSide = 'right';
      d.side = nextSide;
      d.lastSide = nextSide;
      const targetLeftEdge = nextSide === 'left'
        ? d.pageRect.left - d.markerWidth + 2
        : d.pageRect.right - 2;
      const tx = nextSide === startSide ? 0 : targetLeftEdge - d.startLeftEdge;
      const ty = clampedTopPx - d.startTopPx;
      setDragVisual({ x: tx, y: ty, side: nextSide });
    };
    const cleanupDragListeners = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleCancel);
    };
    const handleUp = () => {
      cleanupDragListeners();
      const d = dragRef.current;
      dragRef.current = null;
      setDragVisual(null);
      if (!d) return;
      if (d.hasMoved) {
        suppressClickRef.current = true;
        const curSide = bookmark.side === 'left' ? 'left' : 'right';
        if (onMove && (d.lastYRatio !== bookmark.yRatio || d.lastSide !== curSide)) {
          onMove(bookmark, { yRatio: d.lastYRatio, side: d.lastSide });
        }
      }
    };
    const handleCancel = () => {
      cleanupDragListeners();
      dragRef.current = null;
      setDragVisual(null);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleCancel);
  };

  return (
    <div
      className={`bm-marker bm--${template} bm--side-${bookmark.side === 'left' ? 'left' : 'right'}`}
      title={label}
      style={{
        transform: dragVisual ? `translate(${dragVisual.x}px, ${dragVisual.y}px)` : undefined,
        transition: dragVisual ? 'none' : undefined,
        cursor: dragVisual ? 'grabbing' : undefined,
      }}
      onPointerDown={handleMarkerPointerDown}
      onClick={(e) => {
        e.stopPropagation();
        if (suppressClickRef.current) {
          suppressClickRef.current = false;
          return;
        }
        if (onOpen) onOpen(bookmark);
      }}
    >
      {onDelete ? (
        <button
          type="button"
          className="bm-x"
          title="حذف بوک‌مارک"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(bookmark);
          }}
        >
          <Icons.X size={12} />
        </button>
      ) : null}
      <div className="bm-spine" />
      <div className="bm-bridge" />
      {imageArea}
      {isEditing ? (
        <input
          ref={inputRef}
          className="bm-name-input"
          type="text"
          value={draftName}
          maxLength={30}
          dir="auto"
          onChange={(e) => setDraftName(e.target.value)}
          onKeyDown={handleInputKeyDown}
          onKeyUp={stopKey}
          onKeyPress={stopKey}
          onBlur={handleInputBlur}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        />
      ) : (
        <div
          className="bm-name"
          onMouseDown={(e) => { if (onRename) e.stopPropagation(); }}
          onPointerDown={(e) => { if (onRename) e.stopPropagation(); }}
          onClick={(e) => { if (onRename) { e.stopPropagation(); startEditing(e); } }}
          onDoubleClick={(e) => { if (onRename) e.stopPropagation(); }}
        >
          {label}
        </div>
      )}
    </div>
  );
}
