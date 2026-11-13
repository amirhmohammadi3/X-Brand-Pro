#!/usr/bin/env python3
"""F6.1/F6.2 — insert the `bookings` namespace into the i18n seed files
(fa + en). Surgical: loads the JSON, adds the namespace if absent, dumps
with the same 2-space indent + trailing newline, preserving key order."""
import json
import sys
from collections import OrderedDict

FA = {
    "widget": {
        "title": "رزرو آنلاین",
        "service": "سرویس",
        "date": "تاریخ",
        "slots": "بازه‌های آزاد",
        "closed": "در این تاریخ رزروی ثبت نمی‌شود.",
        "allTaken": "همهٔ بازه‌های این روز پر شده‌اند.",
        "party": "تعداد نفرات",
        "partyMinus": "کاهش نفرات",
        "partyPlus": "افزایش نفرات",
        "contactName": "نام تماس‌گیرنده",
        "contactPhone": "شماره تماس",
        "note": "یادداشت (اختیاری)",
        "submit": "ثبت رزرو",
        "loginHint": "برای ثبت رزرو وارد حساب خود شوید.",
        "login": "ورود",
        "successTitle": "رزرو شما ثبت شد",
        "successBody": "پس از تأیید صاحب کسب‌وکار، اعلان دریافت می‌کنید.",
        "created": "رزرو با کد {code} ثبت شد.",
        "code": "کد رزرو: {code}",
    },
    "mine": {
        "title": "رزروهای من",
        "scopeLabel": "بازهٔ رزروها",
        "scope": {"upcoming": "پیش‌رو", "past": "گذشته"},
        "allStatuses": "همهٔ وضعیت‌ها",
        "empty": "هنوز رزروی ثبت نکرده‌اید.",
        "cancel": "لغو رزرو",
        "cancelAria": "لغو این رزرو",
        "cancelTitle": "لغو رزرو",
        "cancelBody": "رزرو با کد {code} لغو شود؟ ظرفیت آزاد می‌شود و بازگشت‌پذیر نیست.",
        "cancelConfirm": "بله، لغو کن",
        "cancelDismiss": "انصراف",
        "cancelled": "رزرو لغو شد.",
        "cancelReason": "دلیل: {reason}",
        "feedTitle": "فید تقویم",
        "feedHint": "این نشانی را در گوگل‌کلندر یا اپل‌کلندر ثبت کنید تا رزروها خودکار ظاهر شوند.",
        "feedCopy": "کپی نشانی فید",
        "pagination": "صفحه‌بندی رزروها",
    },
    "status": {
        "pending": "در انتظار تأیید",
        "confirmed": "تأییدشده",
        "rejected": "ردشده",
        "cancelled": "لغوشده",
        "completed": "انجام‌شده",
        "no_show": "عدم حضور",
    },
    "errors": {
        "generic": "خطا در انجام عملیات. دوباره تلاش کنید.",
        "cancelWindow": "مهلت لغو رایگان این رزرو گذشته است.",
        "slot_full": "این بازه همین حالا پر شد. بازهٔ دیگری انتخاب کنید.",
        "party_size": "تعداد نفرات در بازهٔ مجاز این سرویس نیست.",
        "past": "این تاریخ گذشته است.",
        "horizon": "این تاریخ خارج از بازهٔ رزرو است.",
        "closed_day": "در این تاریخ رزرو پذیرفته نمی‌شود.",
        "grid": "این بازه روی شبکهٔ اسلات نیست.",
        "outside_hours": "این بازه خارج از ساعات کاری است.",
        "lead_time": "این بازه داخل حداقل زمان اطلاع‌رسانی است.",
        "too_many_active": "سقف رزروهای فعال شما در این کسب‌وکار پر است.",
        "stale_status": "وضعیت رزرو تغییر کرده است. صفحه را به‌روز کنید.",
        "conflict": "درخواست با وضعیت فعلی در تضاد است.",
        "unprocessable": "اطلاعات ارسالی معتبر نیست.",
        "not_found": "رزرو یا سرویس موردنظر یافت نشد.",
    },
}

EN = {
    "widget": {
        "title": "Online booking",
        "service": "Service",
        "date": "Date",
        "slots": "Available slots",
        "closed": "No bookings are taken on this date.",
        "allTaken": "Every slot for this day is taken.",
        "party": "Party size",
        "partyMinus": "Fewer people",
        "partyPlus": "More people",
        "contactName": "Contact name",
        "contactPhone": "Contact phone",
        "note": "Note (optional)",
        "submit": "Book",
        "loginHint": "Sign in to complete the booking.",
        "login": "Sign in",
        "successTitle": "Booking received",
        "successBody": "You will be notified once the business confirms.",
        "created": "Booking created with code {code}.",
        "code": "Booking code: {code}",
    },
    "mine": {
        "title": "My bookings",
        "scopeLabel": "Booking range",
        "scope": {"upcoming": "Upcoming", "past": "Past"},
        "allStatuses": "All statuses",
        "empty": "No bookings yet.",
        "cancel": "Cancel booking",
        "cancelAria": "Cancel this booking",
        "cancelTitle": "Cancel booking",
        "cancelBody": "Cancel booking {code}? The slot is released and this cannot be undone.",
        "cancelConfirm": "Yes, cancel it",
        "cancelDismiss": "Keep it",
        "cancelled": "Booking cancelled.",
        "cancelReason": "Reason: {reason}",
        "feedTitle": "Calendar feed",
        "feedHint": "Add this URL to Google or Apple Calendar and your bookings appear automatically.",
        "feedCopy": "Copy feed URL",
        "pagination": "Bookings pagination",
    },
    "status": {
        "pending": "Pending",
        "confirmed": "Confirmed",
        "rejected": "Rejected",
        "cancelled": "Cancelled",
        "completed": "Completed",
        "no_show": "No-show",
    },
    "errors": {
        "generic": "Something went wrong. Please try again.",
        "cancelWindow": "The free cancellation window has passed.",
        "slot_full": "That slot just filled up. Pick another one.",
        "party_size": "Party size is outside this service's bounds.",
        "past": "That date is in the past.",
        "horizon": "That date is beyond the booking horizon.",
        "closed_day": "Bookings are closed on that date.",
        "grid": "That time is off the slot grid.",
        "outside_hours": "That slot falls outside the opening hours.",
        "lead_time": "That slot is inside the minimum notice window.",
        "too_many_active": "You reached the cap of active bookings at this business.",
        "stale_status": "The booking status changed. Refresh the page.",
        "conflict": "The request conflicts with the current state.",
        "unprocessable": "The submitted data is invalid.",
        "not_found": "Booking or service not found.",
    },
}


def insert(path: str, ns: OrderedDict) -> None:
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh, object_pairs_hook=OrderedDict)
    data["bookings"] = ns
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    print(f"[f6-i18n] bookings namespace written to {path}")


if __name__ == "__main__":
    base = "apps/api/src/modules/i18n/seed"
    insert(f"{base}/fa.json", FA)
    insert(f"{base}/en.json", EN)
