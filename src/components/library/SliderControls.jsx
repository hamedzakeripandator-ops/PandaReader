// ============================================================================
// src/components/library/SliderControls.jsx — مرحلهٔ ۳۵ §۶
//
// کنترلِ «موجِ صوتی»ِ اسلایدرِ هیرویِ کتابخانه: ردیفِ [قبلی] [نوارِ
// canvas] [بعدی] با ۵ تمپلیتِ قابلِ انتخاب (led / mirror / matrix /
// pendulum / firefly) و یک موتورِ فیزیکیِ مشترک.
//
// هندسهٔ مشترک (مو‌به‌مو از مشخصاتِ تسک): barsPerSlide = 5، PITCH = 8،
// GAP = 9، PAD = 8، عرضِ بوم W = PAD*2 + B*PITCH + (N-1)*GAP (برایِ
// N = 7 دقیقاً 350px)، HC = 64، MID = 32، MIN = 6، MAX = 44.
// موتور: PRNGی mulberry32 که فقط با تغییرِ اسلاید عوض می‌شود (نه در
// هاور)، منحنیِ زنگوله‌ای، نفس کشیدن، موجِ ورودِ ماوس، پاپِ تغییرِ
// اسلاید و نرم‌سازی در useRef (بدونِ useState در هر فریم).
// «میلهٔ پیک» در همهٔ تمپلیت‌ها، میلهٔ مرکزیِ گروهِ فعال است.
// ============================================================================

import React, { useState, useEffect, useRef } from 'react';
import './SliderControls.css';

export const SLIDER_GEOMETRY = {
  barsPerSlide: 5,
  pitch: 8,
  gap: 9,
  pad: 8,
  canvasHeight: 64,
  mid: 32,
  min: 6,
  max: 44,
};

const G = 5;
const PITCH = 8;
const GAP = 9;
const PAD = 8;
const HC = 64;
const MID = 32;
const MIN = 6;
const MAX = 44;

const COLOR_ACTIVE = '#22d3ee';
const COLOR_PEAK = '#ec4899';
const COLOR_INACTIVE = 'rgba(255,255,255,0.28)';
const COLOR_HOVER_GROUP = 'rgba(255,255,255,0.55)';
const COLOR_HOVER_BAR = 'rgba(255,255,255,0.95)';

export function sliderStripWidth(totalSlides) {
  const n = Math.max(1, Number(totalSlides) || 1);
  return PAD * 2 + (n * G) * PITCH + (n - 1) * GAP;
}

export function ledDotCount(v) {
  return Math.max(1, Math.min(11, Math.round(((v - MIN) / (MAX - MIN)) * 9 + 1)));
}

export function matrixCellCount(v) {
  return Math.max(1, Math.min(7, Math.round(v / 8)));
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

function buildParams(total, activeIndex) {
  const bars = total * G;
  const params = [];
  for (let j = 0; j < bars; j++) {
    const rnd = mulberry32((activeIndex + 1) * 1000003 + j * 9176 + 13);
    params.push({
      base: rnd(),
      spd: 0.02 + rnd() * 0.06,
      ph: rnd() * Math.PI * 2,
      fr: 0.5 + rnd() * 1.5,
      jit: rnd(),
    });
  }
  return params;
}

function barX(j) {
  const g = Math.floor(j / G);
  return PAD + j * PITCH + g * GAP;
}

// نگاشتِ مختصاتِ x روی بوم به {group, bar} (یا null در فاصله‌ها).
function barAtX(x, total) {
  const rel = x - PAD;
  if (rel < 0) return null;
  const groupSpan = G * PITCH + GAP;
  const g = Math.floor(rel / groupSpan);
  if (g < 0 || g >= total) return null;
  const within = rel - g * groupSpan;
  if (within >= G * PITCH) return null;
  const b = Math.floor(within / PITCH);
  if (b < 0 || b >= G) return null;
  return { group: g, bar: g * G + b };
}

function groupColor(j, active, hoverGroup, hoverBar) {
  if (hoverBar === j) return COLOR_HOVER_BAR;
  const g = Math.floor(j / G);
  if (g === active) return COLOR_ACTIVE;
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

function drawVariant(ctx, variant, v, params, active, hoverGroup, hoverBar, t) {
  const peakBar = active * G + 2;
  const bars = v.length;
  if (variant === 'led') {
    for (let j = 0; j < bars; j++) {
      const x = barX(j);
      const n = ledDotCount(v[j]);
      for (let r = 0; r < n; r++) {
        const isPeakTop = j === peakBar && r === n - 1;
        ctx.beginPath();
        ctx.arc(x, HC - 5 - r * 5, 1.7, 0, Math.PI * 2);
        ctx.fillStyle = isPeakTop ? COLOR_PEAK : groupColor(j, active, hoverGroup, hoverBar);
        ctx.fill();
      }
    }
    return;
  }
  if (variant === 'matrix') {
    for (let j = 0; j < bars; j++) {
      const x = barX(j);
      const n = matrixCellCount(v[j]);
      const g = Math.floor(j / G);
      const p = params[j] || {};
      for (let r = 0; r < n; r++) {
        let fill;
        if (j === peakBar && r === n - 1) {
          fill = COLOR_PEAK;
        } else if (hoverBar === j) {
          fill = COLOR_HOVER_BAR;
        } else if (g === active) {
          const flicker = r === n - 1 ? 1 : 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(t * 0.002 * (p.fr || 1) + (p.ph || 0) + r));
          fill = `rgba(34, 211, 238, ${flicker.toFixed(3)})`;
        } else if (hoverGroup === g) {
          fill = COLOR_HOVER_GROUP;
        } else {
          fill = COLOR_INACTIVE;
        }
        rr(ctx, x - 2, HC - 6 - r * 8, 4, 4, 1.2);
        ctx.fillStyle = fill;
        ctx.fill();
      }
    }
    return;
  }
  if (variant === 'pendulum') {
    ctx.beginPath();
    ctx.moveTo(PAD, 4);
    ctx.lineTo(PAD + bars * PITCH + (Math.floor((bars - 1) / G)) * GAP, 4);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.stroke();
    for (let j = 0; j < bars; j++) {
      const x = barX(j);
      const p = params[j] || {};
      const sway = Math.sin(t * 0.0022 + (p.ph || 0)) * (1.5 + (p.jit || 0) * 3);
      const bx = x + sway;
      const by = 4 + v[j];
      ctx.beginPath();
      ctx.moveTo(x, 4);
      ctx.lineTo(bx, by);
      ctx.strokeStyle = groupColor(j, active, hoverGroup, hoverBar);
      ctx.lineWidth = 1.3;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(bx, by, j === peakBar ? 3.6 : 2.6, 0, Math.PI * 2);
      ctx.fillStyle = j === peakBar ? COLOR_PEAK : groupColor(j, active, hoverGroup, hoverBar);
      ctx.fill();
    }
    return;
  }
  if (variant === 'firefly') {
    for (let j = 0; j < bars; j++) {
      const x = barX(j);
      const p = params[j] || {};
      for (let k = 1; k <= 3; k++) {
        const px = x + Math.sin(t * 0.0011 * (p.fr || 1) + (p.ph || 0) + k * 1.7) * (1.5 + k);
        const py = HC - 6 - (v[j] * (k / 3)) + Math.cos(t * 0.0013 * ((p.spd || 0.05) * 8 + 1) + k * 2.1) * 2;
        const isPeakTop = j === peakBar && k === 3;
        ctx.beginPath();
        ctx.arc(px, py, isPeakTop ? 3 : 1.1 + 0.4 * k, 0, Math.PI * 2);
        ctx.fillStyle = isPeakTop ? COLOR_PEAK : groupColor(j, active, hoverGroup, hoverBar);
        ctx.globalAlpha = k < 3 && !isPeakTop ? 0.75 : 1;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
    return;
  }
  // پیش‌فرض: mirror — میلهٔ گردِ وسط‌چین روی MID با دایرهٔ صورتیِ پیک.
  for (let j = 0; j < bars; j++) {
    const x = barX(j);
    rr(ctx, x - 1.5, MID - v[j] / 2, 3, v[j], 1.5);
    ctx.fillStyle = groupColor(j, active, hoverGroup, hoverBar);
    ctx.fill();
  }
  const peakX = barX(peakBar);
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

  const safeTotal = Math.max(1, Number(total ?? count) || 1);
  const safeIndex = clamp01(Math.floor(Number(currentIndex) || 0), 0, safeTotal - 1);
  const W = sliderStripWidth(safeTotal);

  // اندازهٔ بوم با dpr (حداکثر ۲).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(HC * dpr);
  }, [W]);

  // پارامترهایِ موتور فقط با تغییرِ اسلاید عوض می‌شوند (نه در هاور)؛
  // ارتفاع‌ها پیوستگی‌شان را حفظ می‌کنند (فقط ورودی‌هایِ تازه با MIN).
  useEffect(() => {
    paramsRef.current = buildParams(safeTotal, safeIndex);
    const prev = vRef.current || [];
    const next = new Array(safeTotal * G);
    for (let j = 0; j < next.length; j++) next[j] = j < prev.length ? prev[j] : MIN;
    vRef.current = next;
    popRef.current = performance.now();
  }, [safeTotal, safeIndex]);

  // حلقهٔ رندر (با احترام به prefers-reduced-motion و document.hidden).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    const reduced = Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
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
      const ref = active * G + 2;
      const popAge = Math.max(0, t - popRef.current);
      const pop = 1 + 0.35 * Math.exp(-popAge / 250);
      const hover = hoverRef.current;
      for (let j = 0; j < params.length; j++) {
        const p = params[j];
        const env = Math.exp(-Math.pow((j - ref) / 9, 2));
        const breath = 0.78 + 0.22 * Math.sin(t * 0.0016 + p.ph);
        const g = Math.floor(j / G);
        let boost = 0;
        if (hover.group === g) boost = 8 * (0.5 + 0.5 * Math.sin(t * 0.004 + p.ph));
        let h = MIN + (MAX - MIN) * env * breath + boost;
        if (g === active) h *= pop;
        h = clamp01(h, MIN, MAX);
        if (reduced) v[j] = h;
        else v[j] += (h - v[j]) * (0.09 + p.spd);
      }
      drawVariant(ctx, variantRef.current, v, params, active, hover.group, hover.bar, t);
      if (!reduced) raf = requestAnimationFrame(draw);
    };
    if (reduced) draw(performance.now());
    else raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [safeTotal, safeIndex, W]);

  const canvasX = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return -1;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return -1;
    return ((e.clientX - rect.left) / rect.width) * W;
  };

  const handleCanvasClick = (e) => {
    const hit = barAtX(canvasX(e), safeTotal);
    if (hit && typeof onSelect === 'function') onSelect(hit.group);
  };

  const handleCanvasMouseMove = (e) => {
    const hit = barAtX(canvasX(e), safeTotal);
    hoverRef.current = hit ? hit : { group: null, bar: null };
  };

  const handleCanvasMouseLeave = () => {
    hoverRef.current = { group: null, bar: null };
  };

  return (
    <div className="eq-controls" dir="ltr" style={{ direction: 'ltr', display: 'inline-flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: '14px' }}>
      <button type="button" className="eq-nav" onClick={onPrev} title="اسلاید قبلی" aria-label="اسلاید قبلی" dir="ltr" style={{ direction: 'ltr', width: 36, height: 36, borderRadius: '50%', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', color: '#ffffff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, outline: 'none', flexShrink: 0 }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: 'none', display: 'block' }}>
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>
      <div className="eq-canvas-wrap" style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
        <canvas
          ref={canvasRef}
          style={{ width: W, height: HC, display: 'block', cursor: 'pointer' }}
          onClick={handleCanvasClick}
          onMouseMove={handleCanvasMouseMove}
          onMouseLeave={handleCanvasMouseLeave}
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
      <button type="button" className="eq-nav" onClick={onNext} title="اسلاید بعدی" aria-label="اسلاید بعدی" dir="ltr" style={{ direction: 'ltr', width: 36, height: 36, borderRadius: '50%', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', color: '#ffffff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, outline: 'none', flexShrink: 0 }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: 'none', display: 'block' }}>
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>
    </div>
  );
}
