#!/usr/bin/env python3
"""Add the dashboard.billing.* + dashboard.common.* keys the billing-dashboard
component references (F8.1). The plan/subscription/invoice labels mirror the
root billing.* keys (the contract's i18n seeds already have billing.* from
phase 8 backend); the dashboard-scoped variants live under dashboard.billing.*
because the component uses useTranslations('dashboard')."""
import json, sys
from pathlib import Path

SEED_DIR = Path("apps/api/src/modules/i18n/seed")

def deep_merge(base, override):
    out = dict(base)
    for k, v in override.items():
        if k in out and isinstance(out[k], dict) and isinstance(v, dict):
            out[k] = deep_merge(out[k], v)
        else:
            out[k] = v
    return out

# dashboard.billing.* (mirror of the root billing.* keys, dashboard-scoped)
DASHBOARD_BILLING_FA = {
    "plan": {
        "interval": {"monthly": "ماهانه", "yearly": "سالانه"},
        "cta": {"subscribe": "انتخاب پلن", "current": "پلن فعلی شما"},
        "limits": {
            "galleryPhotos": "حداکثر {count} عکس گالری",
            "menuItems": "حداکثر {count} آیتم منو",
            "videos": "پشتیبانی از ویدیو",
            "ai": "امکانات هوش مصنوعی",
            "ads": "اجازهٔ تبلیغات",
            "adCampaigns": "تا {count} کمپین هم‌زمان"
        }
    },
    "subscription": {
        "cancel": "لغو اشتراک",
        "none": "بدون اشتراک فعال (پلن رایگان)",
        "period": "بازه: {start} تا {end}",
        "status": {
            "pending_payment": "در انتظار پرداخت",
            "active": "فعال",
            "past_due": "سررسید گذشته",
            "cancelled": "لغو شده",
            "expired": "منقضی"
        }
    },
    "invoice": {
        "number": "شمارهٔ فاکتور",
        "amount": "مبلغ",
        "period": "دوره",
        "status": {"title": "وضعیت", "pending": "در انتظار پرداخت", "verified": "پرداخت شده", "failed": "ناموفق", "cancelled": "لغو شده"}
    }
}

DASHBOARD_BILLING_EN = {
    "plan": {
        "interval": {"monthly": "Monthly", "yearly": "Yearly"},
        "cta": {"subscribe": "Choose plan", "current": "Your current plan"},
        "limits": {
            "galleryPhotos": "Up to {count} gallery photos",
            "menuItems": "Up to {count} menu items",
            "videos": "Video support",
            "ai": "AI features",
            "ads": "Ad campaigns allowed",
            "adCampaigns": "Up to {count} concurrent campaigns"
        }
    },
    "subscription": {
        "cancel": "Cancel subscription",
        "none": "No active subscription (Free plan)",
        "period": "Period: {start} to {end}",
        "status": {
            "pending_payment": "Pending payment",
            "active": "Active",
            "past_due": "Past due",
            "cancelled": "Cancelled",
            "expired": "Expired"
        }
    },
    "invoice": {
        "number": "Invoice number",
        "amount": "Amount",
        "period": "Period",
        "status": {"title": "Status", "pending": "Pending", "verified": "Paid", "failed": "Failed", "cancelled": "Cancelled"}
    }
}

# dashboard.common.* (the billing dashboard uses t('common.*') under the
# dashboard namespace; mirror the root common.* keys)
DASHBOARD_COMMON_FA = {
    "cancel": "لغو", "confirm": "تأیید", "error": "خطایی رخ داد.",
    "prev": "قبلی", "next": "بعدی", "free": "رایگان",
    "currency": {"toman": "تومان"}
}
DASHBOARD_COMMON_EN = {
    "cancel": "Cancel", "confirm": "Confirm", "error": "An error occurred.",
    "prev": "Previous", "next": "Next", "free": "Free",
    "currency": {"toman": "Toman"}
}

def update_seed(path, billing_tree, common_tree):
    raw = path.read_text(encoding="utf-8")
    data = json.loads(raw)
    dash = data.get("dashboard", {})
    dash["billing"] = deep_merge(dash.get("billing", {}), billing_tree)
    dash["common"] = deep_merge(dash.get("common", {}), common_tree)
    data["dashboard"] = dash
    out = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    if out == raw:
        print(f"  {path.name}: unchanged")
        return False
    path.write_text(out, encoding="utf-8")
    print(f"  {path.name}: updated")
    return True

def main():
    print("Adding dashboard.billing.* + dashboard.common.* keys (F8.1)…")
    update_seed(SEED_DIR / "en.json", DASHBOARD_BILLING_EN, DASHBOARD_COMMON_EN)
    update_seed(SEED_DIR / "fa.json", DASHBOARD_BILLING_FA, DASHBOARD_COMMON_FA)
    return 0

if __name__ == "__main__":
    sys.exit(main())
