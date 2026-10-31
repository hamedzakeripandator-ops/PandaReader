// ============================================================================
// src/utils/gpuImageEnhancer.js — مرحله ۲۰
// موتورِ شیدرِ گرافیکیِ WebGL2 CAS (Contrast-Adaptive Sharpening)
// بر اساسِ ایدهٔ AMD FidelityFX CAS، برایِ شفاف‌سازیِ عکس‌هایِ آناتومی
// بدونِ تخریبِ متن‌هایِ برداری.
//
// چرا CAS و نه شارپِ معمولی؟
//   یک فیلترِ شارپِ معمولی (ماتریسِ کانولوشنِ ثابت) رویِ همهٔ پیکسل‌ها
//   یکسان عمل می‌کند و دورِ حروفِ سیاه، هالهٔ سفید (Ringing) می‌سازد.
//   CAS، وزنِ شارپ را از کنتراستِ محلیِ هر پیکسل می‌گیرد:
//     amount = sqrt(min(minLuma, 1 - maxLuma) / maxLuma)
//   - لبهٔ متنِ سیاه رویِ کاغذِ سفید: minLuma ≈ ۰ و maxLuma ≈ ۱، پس
//     min(۰, ۱-۱) = ۰ و وزن دقیقاً صفر می‌شود؛ شیدر به متن دست نمی‌زند.
//   - بافتِ میانیِ عکسِ آناتومی (سایه‌روشنِ استخوان، رشتهٔ عصب، رگ):
//     min و max میانی‌اند و وزن به حداکثر می‌رسد؛ جزئیاتِ تار زنده می‌شود.
//   - خروجی، اضافه بر وزن، به بازهٔ [minRGB, maxRGB] همسایه‌ها کلمپ
//     می‌شود تا هیچ پیکسلی از همسایه‌هایش فراتر نرود (ضدِ هاله).
//
// قراردادِ خروجی:
//   enhanceRenderedPageCanvas(sourceCanvas, { sharpness }) →
//     Promise<ImageBitmap | null>
//   - موفقیت: یک ImageBitmap از بومِ خروجیِ CAS (همان ابعادِ ورودی).
//   - هر شکست یا نبودِ WebGL2: null برمی‌گردد تا فراخواننده، بی‌صدا از
//     خودِ بومِ ورودی استفاده کند. هیچ‌وقت استثنا پرتاب نمی‌شود.
//   - sharpness پیش‌فرض ۰٫۶۵ است (عددِ پرامپت) و به بازهٔ [۰، ۱] کلمپ
//     می‌شود؛ sharpness = ۰ یعنی «بدونِ بهبود» و null برمی‌گردد.
//
// نکتهٔ جهتِ بافت: هنگامِ آپلودِ بوم به WebGL، UNPACK_FLIP_Y_WEBGL فعال
// است تا سطرِ اولِ بوم (بالایِ صفحه) با v=1 هم‌تراز شود و تصویرِ
// خروجی، وارونه نشود. این، همان دستورِ استانداردِ پردازشِ تصویر با
// WebGL است.
// ============================================================================

const CAS_VERTEX_SHADER = `#version 300 es
in vec2 a_position;
in vec2 a_uv;
out vec2 v_uv;
void main() {
  v_uv = a_uv;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const CAS_FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
uniform vec2 u_texel;
uniform float u_sharpness;
in vec2 v_uv;
out vec4 outColor;
void main() {
  // پنج نمونهٔ همسایه: مرکز e، بالا b، پایین h، چپ d، راست f.
  vec3 e = texture(u_tex, v_uv).rgb;
  vec3 b = texture(u_tex, v_uv + vec2(0.0, -u_texel.y)).rgb;
  vec3 h = texture(u_tex, v_uv + vec2(0.0, u_texel.y)).rgb;
  vec3 d = texture(u_tex, v_uv + vec2(-u_texel.x, 0.0)).rgb;
  vec3 f = texture(u_tex, v_uv + vec2(u_texel.x, 0.0)).rgb;

  // کمترین و بیشترینِ همسایه‌ها (برایِ کلمپِ ضدِ هاله).
  vec3 mn = min(min(b, d), min(f, h));
  vec3 mx = max(max(b, d), max(f, h));

  // روشناییِ همسایه‌ها (وزنِ CAS از روشنایی می‌آید، نه از رنگ).
  float lumaB = dot(b, vec3(0.299, 0.587, 0.114));
  float lumaH = dot(h, vec3(0.299, 0.587, 0.114));
  float lumaD = dot(d, vec3(0.299, 0.587, 0.114));
  float lumaF = dot(f, vec3(0.299, 0.587, 0.114));
  float minLuma = min(min(lumaB, lumaD), min(lumaF, lumaH));
  float maxLuma = max(max(lumaB, lumaD), max(lumaF, lumaH));

  // جادویِ CAS: در لبهٔ پُرکنتراست (متن)، minLuma ≈ ۰ یا
  // maxLuma ≈ ۱ است و وزن صفر می‌شود؛ در بافتِ میانی، وزن بالاست.
  float amount = sqrt(min(minLuma, 1.0 - maxLuma) / max(maxLuma, 0.0001));
  float w = -amount * u_sharpness;

  // ترکیبِ لوبِ منفیِ همسایه‌ها با مرکز، و نرمال‌سازی.
  vec3 outRgb = ((b + d + f + h) * w + e) / (4.0 * w + 1.0);
  // کلمپ به بازهٔ همسایه‌ها: هیچ هاله‌ای دورِ لبه ساخته نمی‌شود.
  outRgb = clamp(outRgb, mn, mx);
  outColor = vec4(outRgb, 1.0);
}
`;

// وضعیتِ تک‌نمونه: یک‌بار ساخته می‌شود و برایِ همهٔ صفحه‌ها مشترک است.
let glState = null; // null = هنوز تلاش نشده؛ false = ناموفق؛ object = آماده
let glCanvas = null;

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    try { gl.deleteShader(shader); } catch (_) {}
    return null;
  }
  return shader;
}

function initGl() {
  if (glState !== null) return glState || null;
  try {
    let canvas = null;
    // اول OffscreenCanvas (بدونِ اتصال به DOM)، بعد بومِ مخفیِ معمولی.
    if (typeof OffscreenCanvas !== 'undefined') {
      try { canvas = new OffscreenCanvas(1, 1); } catch (_) { canvas = null; }
    }
    if (!canvas && typeof document !== 'undefined') {
      canvas = document.createElement('canvas');
    }
    if (!canvas) { glState = false; return null; }
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true,
    });
    if (!gl) { glState = false; return null; }
    const vs = compileShader(gl, gl.VERTEX_SHADER, CAS_VERTEX_SHADER);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, CAS_FRAGMENT_SHADER);
    if (!vs || !fs) { glState = false; return null; }
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { glState = false; return null; }
    gl.useProgram(program);

    // چهارگوشِ تمام‌صفحه (دو مثلث) با مختصاتِ بافت.
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1, 0, 0,
       1, -1, 1, 0,
      -1,  1, 0, 1,
       1,  1, 1, 1,
    ]), gl.STATIC_DRAW);
    const posLoc = gl.getAttribLocation(program, 'a_position');
    const uvLoc = gl.getAttribLocation(program, 'a_uv');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(uvLoc);
    gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 16, 8);

    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // سطرِ اولِ بوم، بالایِ تصویر است؛ با این پرچم، v=1 بالایِ
    // تصویر می‌شود و خروجی وارونه نمی‌شود.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

    glCanvas = canvas;
    glState = {
      gl,
      program,
      texLoc: gl.getUniformLocation(program, 'u_tex'),
      texelLoc: gl.getUniformLocation(program, 'u_texel'),
      sharpLoc: gl.getUniformLocation(program, 'u_sharpness'),
    };
    return glState;
  } catch (_) {
    glState = false;
    return null;
  }
}

export function isGpuEnhancerAvailable() {
  try {
    const state = initGl();
    return !!state && !(state.gl.isContextLost && state.gl.isContextLost());
  } catch (_) {
    return false;
  }
}

export async function enhanceRenderedPageCanvas(sourceCanvas, options = {}) {
  try {
    if (!sourceCanvas || !sourceCanvas.width || !sourceCanvas.height) return null;
    const sharpnessRaw = (options && typeof options.sharpness === 'number')
      ? options.sharpness
      : 0.65;
    const sharpness = Math.min(1, Math.max(0, sharpnessRaw));
    if (sharpness <= 0) return null;
    const state = initGl();
    if (!state) return null;
    const { gl } = state;
    if (gl.isContextLost && gl.isContextLost()) return null;

    if (glCanvas.width !== sourceCanvas.width || glCanvas.height !== sourceCanvas.height) {
      glCanvas.width = sourceCanvas.width;
      glCanvas.height = sourceCanvas.height;
    }
    gl.viewport(0, 0, sourceCanvas.width, sourceCanvas.height);
    gl.useProgram(state.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sourceCanvas);
    gl.uniform1i(state.texLoc, 0);
    gl.uniform2f(state.texelLoc, 1 / sourceCanvas.width, 1 / sourceCanvas.height);
    gl.uniform1f(state.sharpLoc, sharpness);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    if (typeof createImageBitmap !== 'function') return null;
    return await createImageBitmap(glCanvas);
  } catch (_) {
    // هر شکست (کانتکست، بافت، بیت‌مپ) یعنی «بدونِ بهبود»؛ فراخواننده
    // از خودِ بومِ ورودی استفاده می‌کند و هیچ خطایی بالا نمی‌آید.
    return null;
  }
}

export default { enhanceRenderedPageCanvas, isGpuEnhancerAvailable };
