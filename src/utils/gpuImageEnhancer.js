// ============================================================================
// src/utils/gpuImageEnhancer.js — مرحله ۲۴
// بازنویسیِ کاملِ دوم: فیلترِ SVGِ مرحلهٔ ۲۳ حذف شد (دلیلش در
// گزارشِ مرحلهٔ ۲۴، بخشِ ۲٫۱ آمده است: کامپوزیتورِ کرومیوم،
// تصویرِ سوپرسمپل‌شده را پیش از کانولوشن، در بافری با رزولوشنِ
// پایین‌تر رستر می‌کرد و لبه‌هایِ آنتی‌الیاس‌شده را ضخیم و
// دندانه‌دار نشان می‌داد). این فایل، حالا فقط یک کار می‌کند:
// انکودِ PNGِ خالص در Worker، بدونِ اینکه تردِ اصلی را قفل کند.
//
// تفاوتِ حیاتی با ورکرِ مرحلهٔ ۲۲: کدِ ورکر، یک رشتهٔ ثابت است،
// نه خروجیِ fn.toString(). هیچ تابعی به رشته تبدیل نمی‌شود، هیچ
// حلقهٔ دستکاریِ پیکسلی در کار نیست، و هیچ getImageData یا
// putImageDataای وجود ندارد. ورکر فقط بیت‌مپ را می‌گیرد، رویِ
// OffscreenCanvas می‌کشد و PNG برمی‌گرداند — همین.
//
// قراردادِ encodeCanvasToPng(canvas):
//   - اول، با createImageBitmap یک کپیِ سخت‌افزاری از بوم گرفته
//     می‌شود؛ بومِ اصلی تا زمانِ دریافتِ جوابِ ورکر، دست‌نخورده
//     نگه داشته می‌شود (صفر نمی‌شود) تا اگر ورکر در محیطی نبود،
//     بلافاصله رویِ همان بومِ اصلی، toBlobِ PNG اجرا شود.
//   - اگر ورکر جواب داد → همان blob برمی‌گردد.
//   - اگر ورکر نبود، خطا داد یا در ۶۰ ثانیه جواب نداد → Fallbackِ
//     تردِ اصلی (canvas.toBlob با image/png) اجرا می‌شود.
//   - هیچ‌وقت استثنا پرتاب نمی‌شود؛ در بدترین حالت، null برمی‌گردد
//     و فراخواننده، خودش تصمیم می‌گیرد.
// ============================================================================

// کدِ ورکرِ انکودرِ خالصِ PNG — رشتهٔ ثابت، بدونِ toString.
export const PNG_WORKER_CODE = `
self.onmessage = async (e) => {
  const { id, bitmap } = e.data;
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    self.postMessage({ id, ok: true, blob });
  } catch (err) {
    try { bitmap.close(); } catch (_) {}
    self.postMessage({ id, ok: false });
  }
};
`;

// --- مدیریتِ تک‌نمونهٔ ورکر در تردِ اصلی -------------------------------
let workerInstance = null;
let workerFailed = false;
let nextReqId = 1;
const pendingRequests = new Map();

function getWorker() {
  if (workerInstance) return workerInstance;
  if (workerFailed) return null;
  try {
    const blob = new Blob([PNG_WORKER_CODE], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    const w = new Worker(url);
    // اسکریپت، همان‌جا خوانده شده؛ نشانیِ Blob لازم نیست بماند.
    try { URL.revokeObjectURL(url); } catch (_) {}
    w.onmessage = (e) => {
      const msg = e.data || {};
      const entry = pendingRequests.get(msg.id);
      if (!entry) return;
      pendingRequests.delete(msg.id);
      clearTimeout(entry.timer);
      entry.resolve(msg);
    };
    w.onerror = () => {
      workerFailed = true;
      for (const [, entry] of pendingRequests) {
        clearTimeout(entry.timer);
        entry.resolve({ ok: false });
      }
      pendingRequests.clear();
    };
    workerInstance = w;
    return w;
  } catch (_) {
    workerFailed = true;
    return null;
  }
}

function canvasToPngBlobFallback(canvas) {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob || null), 'image/png');
    } catch (_) {
      resolve(null);
    }
  });
}

export async function encodeCanvasToPng(canvas) {
  try {
    if (!canvas || !canvas.width || !canvas.height) return null;
    const w = getWorker();
    if (w && typeof createImageBitmap === 'function') {
      // کپیِ سخت‌افزاری؛ بومِ اصلی تا جوابِ ورکر، زنده می‌ماند.
      const bitmap = await createImageBitmap(canvas);
      const id = nextReqId++;
      const result = await new Promise((resolve) => {
        const timer = setTimeout(() => {
          pendingRequests.delete(id);
          resolve({ ok: false, timeout: true });
        }, 60000);
        pendingRequests.set(id, { resolve, timer });
        try {
          w.postMessage({ id, bitmap }, [bitmap]);
        } catch (_) {
          clearTimeout(timer);
          pendingRequests.delete(id);
          resolve({ ok: false });
        }
      });
      if (result.ok && result.blob) return result.blob;
      // ورکر جوابِ خوب نداد → Fallback رویِ همان بومِ اصلی.
    }
    return await canvasToPngBlobFallback(canvas);
  } catch (_) {
    try {
      return await canvasToPngBlobFallback(canvas);
    } catch (_) {
      return null;
    }
  }
}

export function isPngEncoderWorkerAvailable() {
  return !workerFailed;
}

// ============================================================================
// موتورِ ۲ — آپ‌اسکیل و فوکوسِ نرمِ تصاویرِ آناتومی (مرحلهٔ ۲۵)
// جایگزینِ کاملِ pica (که از مرحلهٔ ۲۲ در هیچ فایلی نیست و در این
// فایل هم هرگز نبوده است). این موتور، برایِ عکس‌ها ساخته شده، نه
// برایِ متن: رویِ متنِ برداری، موتورِ ۱ (بومِ وکتورِ نمایشگر)
// می‌نشیند و این فیلتر، هرگز رویِ متن اعمال نمی‌شود.
//
// معماری:
//   گامِ الف — درون‌یابیِ نرمِ دو-مکعبی: اگر ابعادِ هدف، بزرگ‌تر
//     از مبدأ باشد، اول با imageSmoothingQuality='high' به ابعادِ
//     هدف کشیده می‌شود تا هیچ شکستگیِ پیکسلی در رگ‌ها و اعصاب
//     نیاید.
//   گامِ ب — فیلترِ دوطرفهٔ فوکوسِ نرم (Bilateral Soft-Focus):
//     برایِ هر پیکسل، همسایگیِ ۳×۳ با دو وزن بررسی می‌شود:
//     وزنِ مکانیِ گاوسی (۱،۲،۱؛ ۲،۴،۲؛ ۱،۲،۱) و وزنِ تشابهٔ رنگی
//     exp(-Δ²/2σr²) با σr=۲۸. در نواحیِ هموار (گرادیانِ کم، مثلِ
//     سایه‌روشنِ عضله و غضروف)، خروجی همان میانگینِ دوطرفه است:
//     نویزِ JPEG/WebP یکدست و مخملی می‌شود.
//   گامِ ج — هدایتِ گرادیان (Gradient-Directed Edge Refinement):
//     در مرزها (گرادیانِ بالا، مثلِ رگ و عصب)، خروجی به‌سمتِ یک
//     آنشارپِ ملایم (center + edgePush×(center - bilateral))
//     کشیده می‌شود؛ اما نتیجه، در بازهٔ [min, max] هر ۹ پیکسلِ
//     همسایگی — با احتسابِ خودِ مرکز — clamp می‌شود. این همان
//     نکته‌ای است که مرحلهٔ ۲۰ را خراب کرد (clampِ بدونِ مرکز،
//     قله‌ها را صاف می‌کرد): اینجا مرکز هم در بازه هست، پس نه
//     قله صاف می‌شود و نه هالهٔ سفید ساخته می‌شود (Zero-Halo).
//     وزنِ لبه، smoothstep رویِ گرادیانِ سوبل است (۰٫۰۸ تا ۰٫۳۵).
//   اجرا: اول WebGL2 (شیدرِ GLSL ES 3.00، بدونِ هیچ readback؛
//     خروجی همان بومِ GL است که مستقیم toBlob می‌شود). اگر WebGL2
//     نبود، Fallbackِ CPU رویِ همان بوم (فقط تا ۸ مگاپیکسل؛
//     بزرگ‌تر از آن، بدونِ تغییر برمی‌گردد تا ترد قفل نشود).
//   هیچ‌وقت استثنا پرتاب نمی‌شود؛ در بدترین حالت، بومِ ورودی
//   (یا نسخهٔ آپ‌اسکیل‌شده‌اش) بدونِ فیلتر برمی‌گردد.
//   توجه به جهتِ بافت در WebGL: با flipY=false و v معکوس‌شده،
//   ردیفِ اولِ بافت همان ردیفِ بالایِ بوم است و تصویر وارونه
//   نمی‌شود.
// ============================================================================

const ANATOMY_CPU_MAX_PIXELS = 8000000;

const BILATERAL_VERTEX_SHADER = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
  v_uv = vec2((a_pos.x + 1.0) * 0.5, 1.0 - (a_pos.y + 1.0) * 0.5);
}`;

const BILATERAL_FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform sampler2D u_image;
uniform vec2 u_texel;
uniform float u_sigmaRange;
uniform float u_edgePush;
uniform float u_strength;
in vec2 v_uv;
out vec4 outColor;
void main() {
  vec4 centerSample = texture(u_image, v_uv);
  vec3 center = centerSample.rgb;
  float lumCenter = dot(center, vec3(0.299, 0.587, 0.114));
  vec3 bilateral = vec3(0.0);
  float wsum = 0.0;
  vec3 mn = center;
  vec3 mx = center;
  float gx = 0.0;
  float gy = 0.0;
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      vec2 uv = v_uv + vec2(float(dx), float(dy)) * u_texel;
      vec3 s = texture(u_image, uv).rgb;
      float l = dot(s, vec3(0.299, 0.587, 0.114));
      mn = min(mn, s);
      mx = max(mx, s);
      float spatial = (dx == 0 && dy == 0) ? 4.0 : ((dx == 0 || dy == 0) ? 2.0 : 1.0);
      float d = l - lumCenter;
      float range = exp(-(d * d) / (2.0 * u_sigmaRange * u_sigmaRange));
      float w = spatial * range;
      bilateral += s * w;
      wsum += w;
      float gxW = dx == -1 ? (dy == 0 ? -2.0 : -1.0) : (dx == 1 ? (dy == 0 ? 2.0 : 1.0) : 0.0);
      float gyW = dy == -1 ? (dx == 0 ? -2.0 : -1.0) : (dy == 1 ? (dx == 0 ? 2.0 : 1.0) : 0.0);
      gx += l * gxW;
      gy += l * gyW;
    }
  }
  bilateral /= max(wsum, 1e-6);
  float grad = sqrt(gx * gx + gy * gy) / (4.0 * 255.0);
  float edgeW = smoothstep(0.08, 0.35, grad);
  vec3 sharpened = center + u_edgePush * (center - bilateral);
  sharpened = clamp(sharpened, mn, mx);
  vec3 outRgb = mix(bilateral, sharpened, edgeW * u_strength);
  outColor = vec4(outRgb, centerSample.a);
}`;

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function runBilateralWebGL2(sourceCanvas, { sigmaRange = 28, edgePush = 0.55, strength = 0.6 } = {}) {
  try {
    const w = sourceCanvas.width;
    const h = sourceCanvas.height;
    if (!w || !h) return null;
    const glCanvas = document.createElement('canvas');
    glCanvas.width = w;
    glCanvas.height = h;
    // preserveDrawingBuffer لازم است تا پس از draw، بوم برایِ
    // createImageBitmap/toBlob خالی نماند.
    const gl = glCanvas.getContext('webgl2', { antialias: false, alpha: true, preserveDrawingBuffer: true });
    if (!gl) return null;
    const vs = compileShader(gl, gl.VERTEX_SHADER, BILATERAL_VERTEX_SHADER);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, BILATERAL_FRAGMENT_SHADER);
    if (!vs || !fs) return null;
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(program, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // نمونه‌برداری در مرکزِ دقیقِ تکسل‌ها، بدونِ ترکیبِ خطی.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sourceCanvas);
    gl.uniform2f(gl.getUniformLocation(program, 'u_texel'), 1 / w, 1 / h);
    gl.uniform1f(gl.getUniformLocation(program, 'u_sigmaRange'), sigmaRange);
    gl.uniform1f(gl.getUniformLocation(program, 'u_edgePush'), edgePush);
    gl.uniform1f(gl.getUniformLocation(program, 'u_strength'), strength);
    gl.viewport(0, 0, w, h);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return glCanvas;
  } catch (_) {
    return null;
  }
}

function runBilateralCpu(sourceCanvas, { sigmaRange = 28, edgePush = 0.55, strength = 0.6 } = {}) {
  try {
    const w = sourceCanvas.width;
    const h = sourceCanvas.height;
    if (!w || !h || w * h > ANATOMY_CPU_MAX_PIXELS) return null;
    const ctx = sourceCanvas.getContext('2d');
    if (!ctx) return null;
    let img;
    try {
      img = ctx.getImageData(0, 0, w, h);
    } catch (_) {
      return null;
    }
    const data = img.data;
    const out = new Uint8ClampedArray(data);
    const spatial = [[1, 2, 1], [2, 4, 2], [1, 2, 1]];
    const clampByte = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        const cr = data[o];
        const cg = data[o + 1];
        const cb = data[o + 2];
        const lumC = 0.299 * cr + 0.587 * cg + 0.114 * cb;
        let sr = 0;
        let sg = 0;
        let sb = 0;
        let wsum = 0;
        let mnR = cr;
        let mnG = cg;
        let mnB = cb;
        let mxR = cr;
        let mxG = cg;
        let mxB = cb;
        let gx = 0;
        let gy = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx < 0 ? 0 : x + dx >= w ? w - 1 : x + dx;
            const yy = y + dy < 0 ? 0 : y + dy >= h ? h - 1 : y + dy;
            const oo = (yy * w + xx) * 4;
            const r = data[oo];
            const g = data[oo + 1];
            const b = data[oo + 2];
            const l = 0.299 * r + 0.587 * g + 0.114 * b;
            const d = l - lumC;
            const range = Math.exp(-(d * d) / (2 * sigmaRange * sigmaRange));
            const wt = spatial[dy + 1][dx + 1] * range;
            sr += r * wt;
            sg += g * wt;
            sb += b * wt;
            wsum += wt;
            if (r < mnR) mnR = r;
            if (g < mnG) mnG = g;
            if (b < mnB) mnB = b;
            if (r > mxR) mxR = r;
            if (g > mxG) mxG = g;
            if (b > mxB) mxB = b;
            const gxW = dx === -1 ? (dy === 0 ? -2 : -1) : dx === 1 ? (dy === 0 ? 2 : 1) : 0;
            const gyW = dy === -1 ? (dx === 0 ? -2 : -1) : dy === 1 ? (dx === 0 ? 2 : 1) : 0;
            gx += l * gxW;
            gy += l * gyW;
          }
        }
        const br = sr / wsum;
        const bg = sg / wsum;
        const bb = sb / wsum;
        const grad = Math.sqrt(gx * gx + gy * gy) / (4 * 255);
        let t = grad < 0.08 ? 0 : grad > 0.35 ? 1 : (grad - 0.08) / (0.35 - 0.08);
        const edgeT = t * t * (3 - 2 * t) * strength;
        const shR = clampByte(cr + edgePush * (cr - br), mnR, mxR);
        const shG = clampByte(cg + edgePush * (cg - bg), mnG, mxG);
        const shB = clampByte(cb + edgePush * (cb - bb), mnB, mxB);
        out[o] = br + (shR - br) * edgeT;
        out[o + 1] = bg + (shG - bg) * edgeT;
        out[o + 2] = bb + (shB - bb) * edgeT;
      }
    }
    ctx.putImageData(new ImageData(out, w, h), 0, 0);
    return sourceCanvas;
  } catch (_) {
    return null;
  }
}

export async function upscaleAndEnhanceAnatomyCanvas(sourceCanvas, options = {}) {
  try {
    if (!sourceCanvas || !sourceCanvas.width || !sourceCanvas.height) return null;
    const { targetWidth = 0, targetHeight = 0, strength = 0.6, sigmaRange = 28, edgePush = 0.55 } = options;
    let work = sourceCanvas;
    // گامِ الف — آپ‌اسکیلِ نرمِ دو-مکعبی (فقط وقتی هدف بزرگ‌تر است).
    if (targetWidth > 0 && targetHeight > 0 && (targetWidth !== sourceCanvas.width || targetHeight !== sourceCanvas.height)) {
      const tmp = document.createElement('canvas');
      tmp.width = Math.max(1, Math.round(targetWidth));
      tmp.height = Math.max(1, Math.round(targetHeight));
      const tctx = tmp.getContext('2d');
      if (!tctx) return sourceCanvas;
      tctx.fillStyle = '#ffffff';
      tctx.fillRect(0, 0, tmp.width, tmp.height);
      tctx.imageSmoothingEnabled = true;
      tctx.imageSmoothingQuality = 'high';
      tctx.drawImage(sourceCanvas, 0, 0, tmp.width, tmp.height);
      work = tmp;
    }
    // گامِ ب/ج — اول WebGL2، بعد Fallbackِ CPU.
    if (typeof document !== 'undefined') {
      const glCanvas = runBilateralWebGL2(work, { sigmaRange, edgePush, strength });
      if (glCanvas) return glCanvas;
    }
    const cpu = runBilateralCpu(work, { sigmaRange, edgePush, strength });
    if (cpu) return cpu;
    return work;
  } catch (_) {
    return sourceCanvas;
  }
}

// ============================================================================
// مرحلهٔ ۲۶ — چسبِ موتورِ sharp (پروسهٔ اصلیِ Electron).
// از مرحلهٔ ۲۶، مسیرِ HiDPIِ سرویس دیگر از انکودرِ PNGِ ورکر و
// موتورِ Bilateralِ مرحلهٔ ۲۵ استفاده نمی‌کند؛ آن دو اکسپورت،
// برایِ سازگاری و استفادهٔ احتمالیِ بعدی، در فایل مانده‌اند ولی
// هیچ فراخواننده‌ای در مسیرِ رندر ندارند (پس هیچ هزینهٔ زمانی
// هم ندارند). مسیرِ تازه، این است:
//   بوم -> WebP با کیفیتِ ۱٫۰ -> موتورِ sharpِ پروسهٔ اصلی
//   (lanczos3 + شارپنینگِ دو موتوره + WebP 100) -> نشانیِ blob:
// اگر sharp در دسترس نبود یا خطا داد، همان WebPِ مستقیمِ ۱٫۰
// برگردانده می‌شود تا تصویر همیشه در بالاترین کیفیتِ WebP باشد.
// sharpFn، تابعی است که فراخواننده می‌دهد (معمولاً پوششی رویِ
// coreApi.enhanceRenderedPageSharp) تا این فایل، وابستگیِ مستقیم
// به coreApi نگیرد. تابع هرگز استثنا نمی‌دهد؛ فقط در صورتِ
// شکستِ کاملِ هر دو مسیر، null برمی‌گردد.
// ============================================================================

function canvasToWebPBlob(canvas) {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob || null), 'image/webp', 1.0);
    } catch (_) {
      resolve(null);
    }
  });
}

export async function renderCanvasToSharpWebP(canvas, sharpFn = null) {
  try {
    if (!canvas || !canvas.width || !canvas.height) return null;
    const webpBlob = await canvasToWebPBlob(canvas);
    if (!webpBlob) return null;
    if (typeof sharpFn === 'function') {
      try {
        const buffer = new Uint8Array(await webpBlob.arrayBuffer());
        const res = await sharpFn(buffer);
        if (res && res.success && res.buffer) {
          const outBlob = new Blob([res.buffer], { type: 'image/webp' });
          return { url: URL.createObjectURL(outBlob), viaSharp: true };
        }
      } catch (_) {
        // سقوط به WebPِ مستقیمِ زیر.
      }
    }
    return { url: URL.createObjectURL(webpBlob), viaSharp: false };
  } catch (_) {
    return null;
  }
}

export default { PNG_WORKER_CODE, encodeCanvasToPng, isPngEncoderWorkerAvailable, upscaleAndEnhanceAnatomyCanvas, renderCanvasToSharpWebP };
