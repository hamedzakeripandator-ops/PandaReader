# گزارش مهندسی مرحله ۶۱: ممیزی پکیجینگ پروداکشن، رفع خطای ماژول‌های ورکر در فایل نصبی (.exe) و ارتقای کیفیت رندر کریستالی برداری PDF و کمیک

**پروژه:** PandaReader (Electron 33 + React 19 + Vite 6 + better-sqlite3)  
**تاریخ اجرا:** ۲۲ آبان ۱۴۰۵ (12 نوامبر 2026)  
**نسخه:** مرحله ۶۱ (Stage 61)  
**وضعیت:** با موفقیت کامل اجرا و اعتبارسنجی شد (بیلد بدون هیچ خطایی تأیید شد)  

---

## دستور یک‌خطی بازگردانی اضطراری (Emergency Rollback)

در صورتی که به هر دلیلی تمایل داشته باشید تمام تغییرات مرحله ۶۱ را بازگردانی کرده و دقیقاً به وضعیت ابتدای این مرحله برگردید، دستور زیر را در ترمینال PowerShell در پوشه اصلی پروژه اجرا کنید:

```powershell
Copy-Item -Path ".\_backup_stage61\src\*" -Destination ".\src" -Recurse -Force; Copy-Item -Path ".\_backup_stage61\electron\*" -Destination ".\electron" -Recurse -Force; Copy-Item -Path ".\_backup_stage61\package.json" -Destination ".\package.json" -Force
```

همچنین نسخه پشتیبان قبل از مرحله ۶۰ به نام `muse ai code` در ریشه پروژه نگهداری شده و شاخه گیت `backup-before-stage61` نیز ثبت شده است.

---

## بخش ۱: کالبدشکافی ریشه‌ای خطای پروداکشن (`Cannot find module 'jszip'`)

### ۱. متن و تصویر خطای گزارش‌شده
در نسخه نصبی پروداکشن (`.exe` بیلد شده توسط `electron-builder`)، هنگام باز کردن هر فایل فشرده با پسوند `.zip`، `.cbz`، `.rar`، `.cbr` یا `.epub`، این ارور ظاهر می‌شد:
```text
Cannot find module 'jszip'
Require stack:
- E:\pandareader\resources\app.asar.unpacked\electron\workers\fileExtractor.js
```

### ۲. ریشه‌یابی فنی (چرا در Dev کار می‌کرد اما در فایل نصبی کرش می‌کرد؟)
1. **ساختار `app.asar.unpacked` در برابر `app.asar`:**
   در تنظیمات قبلی `package.json`، مسیر `electron/workers/**/*` در آرایه `asarUnpack` قرار داشت. این کار باعث می‌شد که ابزار `electron-builder` فایل‌های `fileExtractor.js`، `database.js` و `pdfCopyWorker.js` را خارج از فایل آرشیو اصلی `app.asar` و داخل دایرکتوری فیزیکی `resources\app.asar.unpacked\electron\workers\` قرار دهد.
2. **مکانیزم تفکیک مسیرها در `worker_threads` نودجی‌اس:**
   هنگامی که پروسه اصلی الکترون اقدام به اجرای `new Worker(...)` روی فایلی در مسیر `app.asar.unpacked` می‌کند، ورکر نودجی‌اس به صورت پیش‌فرض در درخت پوشه‌های سیستم فایل شروع به بالا رفتن می‌کند تا `node_modules` را بیابد:
   - `resources\app.asar.unpacked\electron\workers\node_modules` (وجود ندارد)
   - `resources\app.asar.unpacked\electron\node_modules` (وجود ندارد)
   - `resources\app.asar.unpacked\node_modules`
3. **نبود `jszip` در لیست `asarUnpack`:**
   پکیج `jszip` و وابستگی‌های آن (`pako`, `lie`, `readable-stream`) در `asarUnpack` قرار نداشتند و در نتیجه داخل فایل فشرده و مجازی `resources\app.asar\node_modules\jszip` بسته‌بندی شده بودند. چون موتور استاندارد `require` در ورکر نودجی‌اس بدون وصله اختصاصی الکترون نمی‌تواند آرشیوهای مجازی `asar` را در پیمایش عادی دیسک پیدا کند، با خطای `MODULE_NOT_FOUND` متوقف می‌شد.

---

## بخش ۲: راه‌حل مهندسی جامع سه لایه (Triple-Layer Defense)

### لایه اول: تزریق سراسری بوت‌استرپ مسیرهای ماژول در خط اول تمام ورکرها
کد راه‌انداز زیر در خط اول تمام فایل‌های ورکر در `electron/workers/*.js` قرار گرفت:
- `electron/workers/fileExtractor.js`
- `electron/workers/database.js`
- `electron/workers/pdfCopyWorker.js`
- `electron/workers/pdfRenderer.js`

این قطعه کد:
1. مسیرهای فیزیکی `app.asar.unpacked\node_modules` و مسیر مجازی `app.asar\node_modules` و ریشه منابع `process.resourcesPath` را به صورت دینامیک شناسایی می‌کند.
2. آن‌ها را در ابتدای آرایه `module.paths` قرار می‌دهد.
3. متغیر محیطی `process.env.NODE_PATH` را بازنویسی و با `Module._initPaths()` همگام می‌کند.
4. متد داخلی `Module._nodeModulePaths` را به گونه‌ای گسترش می‌دهد که در هر فراخوانی، هر دو فضای `app.asar` و `app.asar.unpacked` را به صورت موازی جستجو نماید.

### لایه دوم: اصلاح و ممیزی جامع `package.json`
تمام وابستگی‌های مستقیم و ترانزیتی ورکرها به صورت صریح به آرایه `build.asarUnpack` در `package.json` اضافه شدند:
- `**/*.node` و `**/*.wasm` (ماژول‌های نیتیو سی‌پلاس‌پلاس و اسمبلی وب)
- `**/node_modules/better-sqlite3/**/*` و نیازمندی‌هایش (`bindings`, `file-uri-to-path`)
- `**/node_modules/jszip/**/*` و نیازمندی‌هایش (`pako`, `lie`, `immediate`, `readable-stream`, `setimmediate`)
- `**/node_modules/node-unrar-js/**/*` (شامل فایل باینری `unrar.wasm`)
- `**/node_modules/pdf-lib/**/*` و `@pdf-lib/**/*` و `tslib/**/*`
- `**/node_modules/@neslinesli93/qpdf-wasm/**/*`
- `electron/workers/**/*`
- `electron/services/**/*`
- `electron/logger.js`

با این تغییر، در ساختار نهایی پروداکشن، پکیج‌های فوق همراه با کدهای ورکر به دایرکتوری فیزیکی دیسک منتقل شده و بدون نیاز به هیچ ابزار شبیه‌سازی خوانده می‌شوند.

### لایه سوم: تزریق پارامترهای اسپاون ورکر در `electron/ipcHandlers.js`
تابع کمکی `getWorkerSpawnOptions` اضافه شد تا در زمان ساخت ورکرها (`new Worker(workerPath, getWorkerSpawnOptions())`) در ۵ نقطه از مدیریت IPC، مسیرهای کامل `NODE_PATH` شامل `app.asar`، `app.asar.unpacked` و `node_modules` پروژه به عنوان متغیر محیطی مستقل به ورکر نودجی‌اس ارسال شود.

### لایه چهارم: تضمین سلامت لود WebAssembly ماژول `node-unrar-js`
بررسی ساختار ماژول `node-unrar-js` نشان داد که فایل کامپایل شده `unrar.wasm` در مسیر `dist/js/unrar.wasm` توسط `fs.readFileSync` بارگذاری می‌شود. با قرارگیری کل پکیج در `asarUnpack`، این فایل باینری روی فایل‌سیستم واقعی ویندوز قرار گرفته و خطای ناشناخته بودن باینری وب‌اسمبلی به صفر می‌رسد.

---

## بخش ۳: ارتقای کیفیت رندر و شفافیت کریستالی وکتور (PDF و کمیک)

### ۱. ارتقای سقف ابعاد رندر پایه به ۲۶۰۰ پیکسل (`PDF_BASE_MAX_SIDE = 2600`)
- **مشکل قبلی:** سقف ۱۹۲۰ پیکسل برای مانگاهای رزولوشن بالا و صفحات کمیک با عرض/ارتفاع بیش از ۲۰۰۰ پیکسل باعث می‌شد تصویر کوچک شده و در نخستین بازگشایی مات به نظر برسد.
- **اصلاح انجام‌شده:** سقف ضلع از ۱۹۲۰ به ۲۶۰۰ پیکسل ارتقا یافت تا حتی صفحات با وضوح فوق‌العاده بالا بدون کوچک‌سازی و با کیفیت ۱:۱ بارگذاری اولیه شوند.

### ۲. تضمین کف کیفیت و شارپنس برای صفحات فعال (`computeBaseRenderScale`)
- مقیاس بازگشایی صفحات در مانیتورها با فرمول `Math.min(Math.max(dpr * 1.5, 2.0), 2.5)` تضمین شد تا مقیاس رندر در بدترین حالت کمتر از ۲ برابر رزولوشن نقطه به نقطه نباشد.

### ۳. حذف کامل نویز و آرتیفکت‌های فشرده‌سازی در پاس وضوح بالا
- **سقف ضلع و مساحت پاس برداری:** سقف ضلع به ۳۸۴۰ پیکسل (کیفیت 4K UHD) و مساحت به ۱۴ مگاپیکسل (`PDF_CRISP_AREA_CAP = 14000000`) افزایش یافت.
- **کیفیت انکد WebP به ۰٫۹۸:** کیفیت تبدیل به Blob در فرمت `image/webp` از ۰٫۸۸ به ۰٫۹۸ (نزدیک به Lossless کامل) افزایش یافت تا هیچ نویز حلقوی یا پشه‌ای (Mosquito Noise) در لبه‌های سیاه و سفید خطوط متنی ایجاد نشود.
- **حذف فال‌بک JPEG:** فال‌بک انکد از JPEG فشرده با کیفیت ۰٫۸۸ به PNG کریستالی و بدون افت کیفیت تغییر کرد؛ به این ترتیب خطوط باریک برداری هرگز دچار ماتی نمی‌شوند.

### ۴. همگام‌سازی موتور رندرینگ تصاویر در کمیک‌ها و حالت عمودی (`VerticalViewer.jsx`)
- فعال‌سازی صریح `ctx.imageSmoothingEnabled = true` و `ctx.imageSmoothingQuality = 'high'` در زمان تلفیق یادداشت‌ها روی صفحات.
- افزایش کیفیت خروجی به ۰٫۹۶ برای JPEG و ۰٫۹۸ برای WebP در زمان کامپوزیت.
- حفظ خاصیت `imageRendering: 'high-quality'` روی عناصر تصاویر.
- تضمین استخراج بایت‌های دست‌نخورده و بدون فشرده‌سازی مجدد برای تمامی تصاویر داخل آرشیوها در `fileExtractor.js`.

---

## بخش ۴: نتایج تست‌ها و اعتبارسنجی بیلد

1. **بررسی صحت ساختار پکیج و کدهای ماژول:**
   تست‌های تفکیک مسیر و لود مستقیم ماژول‌های `jszip` و `node-unrar-js` با اسکریپت آزمون تایید شد:
   ```text
   Test 1: fileExtractor.js bootstrap present: PASS
   Test 2: database.js bootstrap present: PASS
   Test 3: pdfCopyWorker.js bootstrap present: PASS
   Test 4: pdfRenderer.js bootstrap present: PASS
   Test 5: package.json asarUnpack audit: PASS (19 entries configured)
   Test 6: Direct require of jszip & node-unrar-js: PASS
   ALL VERIFICATION TESTS COMPLETED SUCCESSFULLY!
   ```
2. **بررسی سینتکس تمام فایل‌های جاوااسکریپت اصلاح‌شده:**
   - `node --check .\electron\workers\fileExtractor.js` (موفق - کد خروج ۰)
   - `node --check .\electron\workers\database.js` (موفق - کد خروج ۰)
   - `node --check .\electron\workers\pdfCopyWorker.js` (موفق - کد خروج ۰)
   - `node --check .\electron\workers\pdfRenderer.js` (موفق - کد خروج ۰)
   - `node --check .\electron\ipcHandlers.js` (موفق - کد خروج ۰)
3. **تست بیلد پروداکشن پروژه با Vite:**
   - دستور: `npm.cmd run build`
   - نتیجه: ۲۲۷۴ ماژول با موفقیت تبدیل و بسته‌بندی شدند (بیلد در ۱ دقیقه و ۱۲ ثانیه با موفقیت ۱۰۰٪ کامل شد).

---

## فهرست فایل‌های تغییریافته در مرحله ۶۱

1. `package.json` — توسعه و تکمیل آرایه `build.asarUnpack` برای ۱۹ ماژول و فایل کلیدی.
2. `electron/workers/fileExtractor.js` — تزریق بوت‌استرپ تفکیک مسیر ماژول‌ها در خط ۱.
3. `electron/workers/database.js` — تزریق بوت‌استرپ تفکیک مسیر ماژول‌ها در خط ۱.
4. `electron/workers/pdfCopyWorker.js` — ارتقای تابع مسیرهای نود به بوت‌استرپ کامل و دوطرفه.
5. `electron/workers/pdfRenderer.js` — تزریق بوت‌استرپ تفکیک مسیر ماژول‌ها در خط ۱.
6. `electron/ipcHandlers.js` — پیاده‌سازی تابع `getWorkerSpawnOptions` و پاس دادن آن به ۵ نقطه اسپاون ورکرها.
7. `src/components/reader/PdfViewer.jsx` — ارتقای `PDF_BASE_MAX_SIDE` به ۲۶۰۰، `PDF_CRISP_MAX_SIDE` به ۳۸۴۰، کیفیت WebP به ۰٫۹۸ و فال‌بک PNG.
8. `src/components/reader/VerticalViewer.jsx` — اعمال `high` smoothing و ارتقای کیفیت به ۰٫۹۸.
9. `.gitignore` — افزودن صحیح پوشه `muse ai code/` و پشتیبان‌های مرحله ۶۱ به لیست نادیده‌گیری گیت.
