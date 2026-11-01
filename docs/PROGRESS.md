# PROGRESS

هر پرامپت بعد از تأیید «Done when» توسط شما و commit، تیک می‌خورد. فرمت تیک: `- [x] ID عنوان (تاریخ)`.

وضعیت فاز جاری: فاز 0

## فاز ۰ — اسکلت و زیرساخت

- [x] P0.1 🟢 ساخت مونورپو (pnpm، Turborepo، TS مشترک، ESLint، Prettier، hooks) (2026-10-31)
- [x] P0.2 🟢 قرار دادن فایل‌های پایه + فایل واحد نام/برند (2026-10-31)
- [x] P0.3 🟡 پکیج contracts (Zod، envelope پاسخ، خطاها، pagination) (2026-10-31)
- [x] I0.1 🟢 Docker Compose توسعه (Postgres+PostGIS، Redis، Mailpit) و اسکریپت‌های Node (2026-10-31)
- [x] B0.1 🟡 اسکلت NestJS (config، health، لاگ، فیلتر خطا، OpenAPI) (2026-10-31)
- [x] B0.2 🟡 Drizzle، migration، اکستنشن‌ها (postgis، pg_trgm، unaccent)، دیتابیس تست (2026-10-31)
- [x] B0.3 🟡 ماژول Redis، کش، rate limiter (2026-10-31)
- [x] B0.4 🟡 BullMQ و پروسهٔ worker (2026-10-31)
- [x] F0.1 🟡 اسکلت Next.js (Tailwind، logical properties، فونت self-host، RTL) (2026-10-31)
- [x] F0.2 🟡 کلاینت API تایپ‌دار + TanStack Query (2026-10-31)
- [x] Q0.1 🟡 زیرساخت تست (Vitest، Supertest، Playwright) (2026-10-31)
- [x] I0.2 🟢 CI گیت‌هاب (lint، typecheck، test، build) (2026-10-31)
- [x] Q0.2 🟢 جمع‌بندی فاز ۰ (2026-10-31)

## فاز ۱ — پایه: تنظیمات، احراز هویت، چندزبانه، تم، UI Kit

- [x] B1.1 🟡 ذخیرهٔ تنظیمات (secretها رمزنگاری‌شده، کش، فقط ادمین) (2026-10-31)
- [x] B1.2 🟡 کاربران و نقش‌ها (user, owner, moderator, admin, super_admin) + RBAC (2026-10-31)
- [x] B1.3 🔴 هستهٔ احراز هویت: ثبت‌نام/ورود با یوزر و پسورد (argon2)، JWT، refresh چرخشی، نشست‌ها (2026-11-01)
- [x] B1.4 🟡 موتور OTP (هش، انقضا، تلاش، rate limit) (2026-11-01)
- [x] B1.5 🟡 درایور پیامک: interface + فیک + ملی‌پیامک + کاوه‌نگار (تنظیم از پنل) (2026-11-01)
- [x] B1.6 🟡 درایور ایمیل: interface + SMTP + قالب‌ها + صف (2026-11-01)
- [x] B1.7 🟡 ورود با OTP موبایل/ایمیل، تأیید ایمیل/موبایل، بازیابی رمز (2026-11-01)
- [x] B1.8 🟡 ورود با گوگل OAuth (2026-11-01)
- [x] B1.9 🟡 ماژول ذخیره‌سازی (interface + درایور دیسک، اعتبارسنجی فایل، thumbnail با sharp) (2026-11-01)
- [x] B1.10 🟡 API پروفایل (me، ویرایش، آواتار، تغییر username، حذف حساب) (2026-11-01)
- [x] B1.11 🟡 audit log (2026-11-01)
- [x] B1.12 🟡 بک‌اند i18n: زبان‌ها، کلیدها/ترجمه‌ها، CRUD ادمین، کش، import/export (2026-11-01)
- [ ] B1.13 🟡 بستهٔ تم در بک‌اند (۳ تم seed: مدرن، گرم، لوکس) + انتخاب فعال
- [ ] B1.14 🟡 API مدیریت کاربران (لیست، مسدود، تغییر نقش)
- [ ] F1.1 🟡 i18n فرانت (next-intl با پیام‌ها از API، جهت هر زبان، ارقام فارسی، تقویم شمسی)
- [ ] F1.2 🔴 موتور توکن طراحی: تم‌های ۳‌گانه + روشن/تیره، بدون پرش در SSR
- [ ] F1.3 🟡 UI Kit پایه (Button، Card، Badge، Avatar، Rating، Skeleton، EmptyState…)
- [ ] F1.4 🟡 UI Kit فرم‌ها (Input، Select، Checkbox، Switch، Textarea، اعتبارسنجی)
- [ ] F1.5 🟡 UI Kit همپوشان و داده (Modal، Drawer، Toast، Tabs، Dropdown، Tooltip، Table، Pagination)
- [ ] F1.6 🟡 کامپوننت‌های تقویم شمسی و ورودی عدد فارسی
- [ ] F1.7 🟡 قالب اپ (هدر، فوتر، ناوبری موبایل، تغییر زبان/تم/حالت، layout هر route group)
- [ ] F1.8 🟡 صفحات احراز هویت (ورود رمز/OTP، ثبت‌نام، فراموشی رمز، گوگل) + guard
- [ ] F1.9 🟡 صفحات حساب (پروفایل، تنظیمات، نشست‌ها)
- [ ] I1.1 🟢 مدیریت env و secret + مستند
- [ ] Q1.1 🟢 جمع‌بندی فاز ۱

## فاز ۲ — جغرافیا و کاتالوگ کسب‌وکار + هستهٔ پنل ادمین

- [ ] B2.1 🟡 شهر و محله (ترجمه‌پذیر، فعال/غیرفعال، CRUD ادمین)
- [ ] B2.2 🟡 دسته‌بندی سلسله‌مراتبی (آیکون، ترجمه، فعال/غیرفعال، CRUD ادمین)
- [ ] B2.3 🟡 ویژگی‌ها/امکانات (wifi، پارکینگ…) و ارتباط با دسته
- [ ] B2.4 🔴 اسکیمای کسب‌وکار (PostGIS، slug، وضعیت، قیمت، تماس، شبکه‌ها، ایندکس‌ها)
- [ ] B2.5 🟡 ساعات کاری و روزهای ویژه + محاسبهٔ «الان باز»
- [ ] B2.6 🟡 CRUD کسب‌وکار (ثبت توسط owner با وضعیت pending، مجوزها، slug فارسی)
- [ ] B2.7 🟡 عکس‌های کسب‌وکار (آپلود، ترتیب، کاور)
- [ ] B2.8 🟡 منو/خدمات (بخش‌ها، آیتم‌ها، قیمت، عکس)
- [ ] B2.9 🟡 ادعای مالکیت (مدرک، بررسی ادمین، انتساب مالک)
- [ ] B2.10 🟡 seed: تهران، محله‌ها، دسته‌ها، امکانات، کسب‌وکارهای نمونه
- [ ] F2.1 🟡 قالب پنل ادمین + جدول داده + guard
- [ ] F2.2 🟡 ادمین: شهرها، دسته‌ها، امکانات
- [ ] F2.3 🟡 ادمین: زبان‌ها و ویرایشگر ترجمه
- [ ] F2.4 🔴 ادمین: تغییر تم + اسکلت صفحات تنظیمات
- [ ] F2.5 🟡 ادمین: مدیریت کاربران
- [ ] Q2.1 🟢 جمع‌بندی فاز ۲

## فاز ۳ — جست‌وجو و نقشه

- [ ] B3.1 🔴 نرمال‌سازی متن فارسی + ستون‌ها و ایندکس‌های full-text/trigram
- [ ] B3.2 🔴 API جست‌وجو (متن، دسته، شهر، فیلترها، شعاع، مرتب‌سازی، رتبه‌بندی)
- [ ] B3.3 🟡 پیشنهاد خودکار (کسب‌وکار، دسته، محله) با کش
- [ ] B3.4 🟡 endpoint نقشه با bbox و خوشه‌بندی
- [ ] B3.5 🟡 تاریخچه و جست‌وجوهای پرطرفدار
- [ ] I3.1 🟡 تایل نقشهٔ self-host (PMTiles ایران)، style، glyph و sprite، سرو با range
- [ ] F3.1 🔴 کامپوننت نقشه (MapLibre): نشانگر، خوشه، popup، موقعیت کاربر، هماهنگ با تم
- [ ] F3.2 🟡 انتخاب موقعیت روی نقشه (برای ثبت کسب‌وکار)
- [ ] F3.3 🔴 صفحهٔ خانه
- [ ] F3.4 🔴 صفحهٔ جست‌وجوی نقشه‌محور (فیلترها، هماهنگی لیست و نقشه، bottom sheet موبایل)
- [ ] F3.5 🟡 صفحات دسته و شهر (SEO)
- [ ] F3.6 🟡 UI پیشنهاد، جست‌وجوهای اخیر
- [ ] Q3.1 🟢 جمع‌بندی فاز ۳

## فاز ۴ — صفحهٔ کسب‌وکار، نظرات و اعتماد

- [ ] B4.1 🔴 نظرات: ثبت/ویرایش/حذف، عکس، تجمیع امتیاز با job
- [ ] B4.2 🟡 رأی مفید/نامفید
- [ ] B4.3 🟡 پاسخ صاحب کسب‌وکار
- [ ] B4.4 🟡 گزارش تخلف و صف مدیریت محتوا (نقش moderator)
- [ ] B4.5 🔴 فیلتر خودکار اسپم/تقلب (کلمات قابل مدیریت، تکراری، سرعت، موج نظر)
- [ ] B4.6 🟡 نظر تأییدشده: چک‌این مکانی/زمانی، فیش، نشان
- [ ] B4.7 🟡 امتیاز اعتبار کاربر، سطح‌ها، بج «اولین نظر»
- [ ] B4.8 🟡 پرسش و پاسخ کسب‌وکار
- [ ] B4.9 🟡 endpoint تجمیعی صفحهٔ کسب‌وکار + داده JSON-LD
- [ ] B4.10 🟡 پروفایل عمومی کاربر
- [ ] F4.1 🔴 صفحهٔ کسب‌وکار (هیرو، اطلاعات، ساعات، نقشه، تماس/واتس‌اپ/مسیر‌یابی)
- [ ] F4.2 🟡 گالری تصاویر
- [ ] F4.3 🟡 منو/خدمات
- [ ] F4.4 🔴 لیست و خلاصهٔ نظرات و فیلترها
- [ ] F4.5 🔴 فرم ثبت نظر (امتیاز، متن، عکس، چک‌این)
- [ ] F4.6 🟡 رأی، گزارش، نمایش پاسخ مالک
- [ ] F4.7 🟡 UI پرسش و پاسخ
- [ ] F4.8 🟡 صفحهٔ عمومی کاربر و «نظرات من»
- [ ] F4.9 🟡 اشتراک‌گذاری (واتس‌اپ، تلگرام، اینستاگرام، کپی، native) + تصویر OG
- [ ] F4.10 🔴 ویزارد ثبت کسب‌وکار و ادعای مالکیت
- [ ] Q4.1 🟢 جمع‌بندی فاز ۴

## فاز ۵ — تعامل: علاقه‌مندی، دنبال‌کردن، اعلان، پیام‌رسانی، PWA

- [ ] B5.1 🟡 علاقه‌مندی و لیست‌های نام‌دار
- [ ] B5.2 🟡 دنبال‌کردن کاربر/کسب‌وکار و فید فعالیت
- [ ] B5.3 🔴 هستهٔ اعلان (رویداد، درون‌برنامه، ترجیحات، کانال ایمیل/پیامک، قالب ترجمه‌پذیر)
- [ ] B5.4 🟡 Web Push (VAPID)
- [ ] B5.5 🔴 دروازهٔ realtime (WebSocket، احراز هویت، room، آداپتور Redis)
- [ ] B5.6 🔴 بک‌اند پیام‌رسانی (گفتگو، خوانده‌شدن، پیوست، بلاک/گزارش)
- [ ] B5.7 🟡 اتصال رویدادها به اعلان (نظر جدید، پاسخ، رأی، نتیجهٔ ادعا…)
- [ ] F5.1 🟡 UI علاقه‌مندی و لیست‌ها
- [ ] F5.2 🟡 UI دنبال‌کردن و فید
- [ ] F5.3 🟡 مرکز اعلان و ترجیحات
- [ ] F5.4 🟡 PWA (manifest، service worker، نصب، صفحهٔ آفلاین، push)
- [ ] F5.5 🟡 کلاینت realtime (hook، reconnect)
- [ ] F5.6 🔴 UI پیام‌رسانی (صندوق، گفتگو، لحظه‌ای، پیوست)
- [ ] Q5.1 🟢 جمع‌بندی فاز ۵

## فاز ۶ — رزرو

- [ ] B6.1 🔴 اسکیمای رزرو (ظرفیت، میز/سرویس، قواعد اسلات، مدت، روزهای تعطیل)
- [ ] B6.2 🔴 موتور موجودی و ثبت رزرو بدون تداخل (تراکنش و قفل)
- [ ] B6.3 🟡 چرخهٔ رزرو (تأیید/رد/لغو/عدم‌حضور، یادآوری، سیاست لغو)
- [ ] B6.4 🟡 خروجی ICS و فید تقویم
- [ ] F6.1 🔴 جریان رزرو کاربر (تقویم شمسی، انتخاب اسلات)
- [ ] F6.2 🟡 «رزروهای من»
- [ ] Q6.1 🟢 جمع‌بندی فاز ۶

## فاز ۷ — پنل صاحب کسب‌وکار و آنالیتیکس

- [ ] B7.1 🔴 دریافت رویدادهای آنالیتیکس (بازدید، کلیک تماس/مسیر/اشتراک، impression) با batch و Redis
- [ ] B7.2 🟡 job تجمیع و API آمار (سری زمانی، قیف، آمار کلی بدون هویت)
- [ ] F7.1 🟡 قالب داشبورد + انتخاب کسب‌وکار
- [ ] F7.2 🟡 ویرایش پروفایل، ساعات و موقعیت
- [ ] F7.3 🟡 مدیریت گالری و منو
- [ ] F7.4 🟡 نظرات، پاسخ و پرسش‌وپاسخ
- [ ] F7.5 🔴 تنظیمات رزرو و تقویم مدیریت رزروها
- [ ] F7.6 🟡 پیام‌های داشبورد
- [ ] F7.7 🟡 کلاینت ردیابی (رضایت‌محور، حریم‌خصوصی)
- [ ] F7.8 🔴 داشبورد آنالیتیکس (نمودارهای self-host)
- [ ] Q7.1 🟢 جمع‌بندی فاز ۷

## فاز ۸ — درآمدزایی: پرداخت، اشتراک، تبلیغات

- [ ] B8.1 🔴 ماژول پرداخت: interface + فیک + زرین‌پال (sandbox)، idempotency، verify
- [ ] B8.2 🟡 پلن‌ها، اشتراک، سقف‌های امکانات، فاکتور
- [ ] B8.3 🔴 دامنهٔ تبلیغات (boost/banner، بودجه، زمان‌بندی، وضعیت، پرداخت)
- [ ] B8.4 🔴 نمایش تبلیغ در نتایج و اسلات‌ها، شمارش impression/click، pacing، برچسب «تبلیغ»
- [ ] B8.5 🟡 برجسته‌سازی دستی (Featured) توسط ادمین
- [ ] B8.6 🟡 گزارش درآمد و تراکنش
- [ ] F8.1 🟡 صورتحساب: پلن‌ها، پرداخت، نتیجه، فاکتورها
- [ ] F8.2 🔴 ساخت و آمار کمپین تبلیغاتی
- [ ] F8.3 🟡 اسلات‌های تبلیغ در خانه و جست‌وجو
- [ ] F8.4 🟡 ادمین: پلن‌ها، تبلیغات، تراکنش‌ها، Featured
- [ ] Q8.1 🟢 جمع‌بندی فاز ۸

## فاز ۹ — هوش مصنوعی

- [ ] A9.1 🔴 ماژول AI: درایور OpenAI-compatible (آدرس، توکن، مدل از پنل)، timeout، retry، سقف مصرف، لاگ، تست اتصال
- [ ] A9.2 🟡 درایور پایه بدون مدل (خلاصه‌سازی آماری/قاعده‌محور فارسی)
- [ ] A9.3 🔴 خلاصهٔ نظرات (job، پرامپت‌های قابل ویرایش، مزایا/معایب/موضوع‌ها، کش، بازتولید)
- [ ] A9.4 🟡 پاسخ خودکار به پرسش‌های پرتکرار (برچسب AI، با منبع)
- [ ] A9.5 🔴 پیشنهاد شخصی‌سازی‌شده (رفتار کاربر + شباهت، توضیح اختیاری با LLM)
- [ ] A9.6 🟡 امتیاز تقلب/سمّی بودن برای صف مدیریت
- [ ] A9.7 🟡 ادمین: تنظیمات AI (توکن، مدل، فعال/غیرفعال هر قابلیت، تست)
- [ ] F9.1 🟡 بلوک خلاصهٔ AI در صفحهٔ کسب‌وکار
- [ ] F9.2 🟡 بخش «برای شما» در خانه
- [ ] F9.3 🟡 نشانگر پاسخ AI در پرسش و پاسخ
- [ ] Q9.1 🟢 جمع‌بندی فاز ۹

## فاز ۱۰ — تکمیل پنل ادمین و محتوا

- [ ] B10.1 🟡 API آمار پلتفرم (رشد، محتوا، مالی)
- [ ] B10.2 🟡 تنظیمات عمومی سایت، feature flag، حالت تعمیر
- [ ] B10.3 🟡 صفحات محتوایی (دربارهٔ ما، قوانین، حریم خصوصی، FAQ) ترجمه‌پذیر
- [ ] B10.4 🟡 مدیریت کسب‌وکار توسط ادمین + ادغام تکراری‌ها
- [ ] B10.5 🟡 خروجی داده و حذف حساب کاربر
- [ ] F10.1 🟡 ادمین: داشبورد آمار
- [ ] F10.2 🟡 ادمین: کسب‌وکارها و ادعاها
- [ ] F10.3 🟡 ادمین/moderator: صف گزارش‌ها، کلمات ممنوعه، تحریم‌ها
- [ ] F10.4 🟡 ادمین: تنظیمات پیامک، ایمیل، ذخیره‌سازی، پرداخت، عمومی، feature flag
- [ ] F10.5 🟡 ادمین: audit log
- [ ] F10.6 🟡 صفحات محتوایی، 404/500، حالت تعمیر
- [ ] F10.7 🟡 UI حریم خصوصی (خروجی داده، حذف حساب)
- [ ] Q10.1 🟢 جمع‌بندی فاز ۱۰

## فاز ۱۱ — ویدیو و رسانه

- [ ] B11.1 🔴 پایپ‌لاین ویدیوی کوتاه (آپلود، ffmpeg، poster، محدودیت، صف)
- [ ] B11.2 🟡 بهینه‌سازی تصویر (اندازه‌های مختلف، webp، blurhash)
- [ ] F11.1 🟡 آپلود و نمایش ویدیو در گالری و داشبورد
- [ ] F11.2 🟡 فید ویدیوی کوتاه (Reels)
- [ ] Q11.1 🟢 جمع‌بندی فاز ۱۱

## فاز ۱۲ — کیفیت، امنیت، کارایی، استقرار

- [ ] Q12.1 🔴 بازبینی امنیتی (OWASP، تست مجوز برای هر endpoint، رفع مشکلات)
- [ ] Q12.2 🟡 سخت‌سازی (CSP، هدرها، کوکی، CSRF، rate limit)
- [ ] Q12.3 🟡 تکمیل تست واحد/یکپارچگی بک‌اند
- [ ] Q12.4 🔴 تست E2E مسیرهای اصلی (مهمان، ثبت‌نام، نظر، رزرو، ادعای مالکیت، ادمین)
- [ ] Q12.5 🟡 ممیزی دسترسی‌پذیری (۳ تم × روشن/تیره × RTL/LTR)
- [ ] Q12.6 🟡 کارایی دیتابیس (EXPLAIN، ایندکس، کش)
- [ ] Q12.7 🟡 کارایی فرانت (Lighthouse، bundle، تصویر)
- [ ] Q12.8 🟡 SEO (sitemap، JSON-LD، robots، hreflang)
- [ ] Q12.9 🟡 تست بار (k6) با داده‌های زیاد
- [ ] Q12.10 🟡 مشاهده‌پذیری (لاگ ساخت‌یافته، متریک، health، هشدار)
- [ ] Q12.11 🟡 پشتیبان‌گیری و بازیابی (اسکریپت، تست restore)
- [ ] I12.1 🟡 Docker imageهای production (multi-stage)
- [ ] I12.2 🔴 استقرار: اول مستندات پلتفرم هدف را بررسی و پلتفرم را از شما می‌پرسد؛ سپس compose/Nginx/TLS/مهاجرت
- [ ] I12.3 🟡 CD (استقرار خودکار و rollback)
- [ ] Q12.12 🟡 مستندات نهایی (README، API، runbook، راهنمای ادمین و مالک)
- [ ] Q12.13 🟡 چک‌لیست نهایی انتشار و تأیید کل پروژه

## Follow-ups

فرمت هر مورد: `- [ ] (ID پرامپت منشأ) شرح کار پیشنهادی و دلیل`

- [ ] (B1.5) Verify the Melipayamak and Kavenegar drivers with REAL provider accounts before production (send one SMS each, confirm URLs/params/response parsing and the admin test endpoint's ok/errorCode paths). This sandbox has no provider credentials; both drivers were implemented from the providers' official REST docs/samples (see DECISIONS 2026-11-01).
- [ ] (B1.5) With a Docker machine: run the worker (`pnpm --filter @app/api dev:worker`), set `sms.provider=fake`, call POST /admin/sms/test as super admin and watch the message appear at GET /dev/sms-outbox; observe one real BullMQ retry of a retryable provider error.
- [ ] (B1.7) With a Docker machine: hand-walk the Done-when (DEV_TOOLS=true): request an SMS OTP, read it from GET /api/v1/dev/sms-outbox, verify and receive cookies; request an email OTP and read it in Mailpit. The HTTP tests simulate the worker inline (InlineQueuesService — see DECISIONS 2026-11-01); a live BullMQ worker tick is still unverified.
- [ ] (B1.10) Test-suite isolation: several specs pass alone (or in small groups) but fail in the full run (CSRF 403s / env carry-over between files in one worker) — this predates B1.10 (15 baseline failures on the pristine phase-1 tree). Harden per-file env on a Docker machine.
- [ ] (B1.10) RateLimitGuard runs before JwtAuth, so `scope: 'user'` silently falls back to ip for all routes; resolve the user (JWT parse) inside the guard or reorder the chain, then tighten `users.change_username` / `users.change_password` keys.
- [ ] (B1.6) With a Docker machine: run `pnpm services:up`, call POST /admin/email/test as the seeded super admin and see the message in the Mailpit UI (http://localhost:8025) with the correct RTL layout for a fa recipient; observe one real BullMQ retry for a retryable SMTP error. The sandbox has no Docker — the Mailpit integration test skips automatically, everything else is green.
- [ ] (B1.6) Verify the SMTP driver against a REAL provider (not Mailpit) before production — TLS, auth and connection pooling are confirmed by mocks/typecheck only.
- [ ] (B1.9) With a Docker machine: run `pnpm services:up` + `pnpm db:migrate` to apply migration 0005 (media_kind enum, media_files, users.avatar_media_id) against a real Postgres — the migration SQL is generated and typechecked but was never executed here (no Docker); then hand-walk the Done-when: upload a phone photo with EXIF GPS, open the returned /media URL through the API port and confirm a WebP WITHOUT EXIF, and upload a .txt renamed .jpg to see 415/422. All HTTP-level behaviours are already covered by test/media.api.spec.ts with fakes.
- [ ] (B1.9) F0.1 did not create the promised apps/web `/media/*` → API proxy rewrites (next.config.ts has no `rewrites()` yet). Add them when the web app first renders user media (F1.x) so `/media/<key>` resolves same-origin in dev; until then media urls only resolve through the API port directly.
- [ ] (B0.2) Run `pnpm db:migrate` and `pnpm db:migrate:test` against a live Postgres (Docker) to verify the migration runner end to end. In this sandbox Docker is unavailable; verified instead: `db:generate` (no-DB diff), clean ECONNREFUSED failure path of the CLI, and 12 unit tests.
- [ ] (B1.4) Apply migration `0003_woozy_revanche` (otp_codes) and observe one real `otp:cleanup` worker tick against live Redis/Postgres on a Docker machine; the repeatable scheduler registration is verified by unit/type checks only here.
- [ ] (B1.3) Apply migration `0002_plain_jack_flag` and run `pnpm db:seed` (super-admin seeder) against a live Postgres on a machine with Docker; the seeder CLI was verified up to the DB boundary (env validation passes, first query fails with ECONNREFUSED here).
- [ ] (B1.3) Run the live-DB variant of the auth integration suite (`test/auth.api.spec.ts` uses in-memory repositories + FakeRedis today) and re-do the curl "Done when" walk-through (register → login → me → refresh → replay → me fails) against a running API on a Docker machine.
- [ ] (B1.1→B1.8) Prompt B1.8 assumed settings keys `oauth.google.enabled/clientId/clientSecret` were registered by B1.1 — they were not; B1.8 registered them itself. When the admin panel settings pages land (F10.4), surface the oauth group in the UI as well.
- [ ] (B1.8) Real end-to-end Google login cannot be verified without REAL Google credentials (and Google is commonly unreachable from Iranian servers — the feature ships disabled and 404s until an admin enables it). Verify once with real credentials from a machine with access; also apply migration `0004_ordinary_quicksilver` (oauth_accounts) against live Postgres on a Docker machine — the HTTP suite runs on in-memory fakes (see DECISIONS B1.8).
- [ ] (B1.3) Add partial unique indexes on users(username) / users(email) / users(phone) when all writers exist (B1.7/B1.8) — uniqueness is service-enforced for now, as decided in B1.2.
- [ ] (B1.3) Force-revoke a user's sessions synchronously on admin role change (B1.14) — today the role claim refreshes within ≤ ACCESS_TTL_SEC via refresh.
- [ ] (B0.3) Cache stampede protection: single-flight lock for `CacheService.wrap` (only one producer per key) — deferred, acceptable at current scale.
- [ ] (B0.3) Add a Redis probe to the health endpoint (ping + latency) once a liveness/readiness split exists; the limiter and cache fail open until then.
- [ ] (B0.4) Verify the worker end to end against live Redis (enqueue → consume → retry on failure) on a machine with Docker; unit tests use a BullMQ mock, and the SIGTERM drain path was verified only with an empty registry.
- [ ] (I0.2) Observe the first real CI run on GitHub (push-triggered) and fix any Actions-environment quirks; the workflow was validated locally (YAML parse + every step reproduced: pnpm verify green, prod-mode e2e 5/5) but the sandbox cannot execute GitHub Actions.

## Known issues

فرمت هر مورد: `- (ID پرامپت منشأ) شرح مشکل، اثر، راه‌حل موقت`

## Phase orchestration

This repo is built phase-by-phase by an hourly cron. The state machine lives in
`scripts/orchestrator.mjs` and keeps its state in `.phase-state.json` (gitignored).

- `node scripts/orchestrator.mjs status` — current phase, lock, overlap guard
- `node scripts/orchestrator.mjs acquire` — take the lock, mark phase running, print the brief
- `node scripts/orchestrator.mjs log "P0.1 done"` — record a prompt as done
- `node scripts/orchestrator.mjs release --ok` — release the lock, mark phase completed, advance
- `node scripts/orchestrator.mjs release --fail` — release the lock, mark phase failed (will retry next cron)

Overlap guard: `acquire` refuses to take the lock if a fresh lock exists
(< 2h old). A stale lock (> 2h, or pid no longer alive) is overridden. This
prevents two cron-fired agents from working on the same phase simultaneously.
