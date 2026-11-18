#!/usr/bin/env python3
"""Add the dashboard.billing.* + dashboard.campaigns.* + dashboard.payment.*
+ dashboard.group.growth + common keys to the API seed files (en + fa).
The web fallback is synced via sync-i18n-fallback.mjs afterwards."""
import json, sys
from pathlib import Path

SEED_DIR = Path("apps/api/src/modules/i18n/seed")

# We need to add keys under dashboard.* and common.* in BOTH en.json and fa.json.
# Rather than a full subtree, we'll load, walk to dashboard, merge the new keys,
# and write back. Use a recursive deep-merge that preserves existing keys.

def deep_merge(base, override):
    """Merge override into base; nested dicts merge recursively."""
    out = dict(base)
    for k, v in override.items():
        if k in out and isinstance(out[k], dict) and isinstance(v, dict):
            out[k] = deep_merge(out[k], v)
        else:
            out[k] = v
    return out

DASHBOARD_FA = {
    "group": {"growth": "رشد"},
    "billing": {
        "title": "صورتحساب و اشتراک",
        "plans": {"title": "پلن‌ها", "empty": "هیچ پلنی فعال نیست."},
        "invoice": {
            "list": "تاریخچه فاکتورها",
            "empty": "هنوز فاکتوری ثبت نشده."
        }
    },
    "campaigns": {
        "title": "کمپین‌های تبلیغاتی",
        "list": "کمپین‌ها",
        "empty": "هنوز کمپینی نساخته‌اید.",
        "create": "ایجاد کمپین",
        "stats": "آمار"
    },
    "payment": {
        "title": "پرداخت",
        "verifying": "در حال تأیید پرداخت…",
        "verifyingDescription": "لطفاً چند لحظه صبر کنید.",
        "verified": "پرداخت موفق بود",
        "verifiedDescription": "اشتراک شما فعال شد.",
        "failed": "پرداخت ناموفق بود",
        "failedDescription": "در صورت کسر مبلغ، طی ۲۴ ساعت بازمی‌گردد.",
        "missing": "شناسه پرداخت یافت نشد",
        "backToDashboard": "بازگشت به داشبورد"
    }
}

DASHBOARD_EN = {
    "group": {"growth": "Growth"},
    "billing": {
        "title": "Billing & subscription",
        "plans": {"title": "Plans", "empty": "No active plans."},
        "invoice": {
            "list": "Invoice history",
            "empty": "No invoices yet."
        }
    },
    "campaigns": {
        "title": "Ad campaigns",
        "list": "Campaigns",
        "empty": "You have not created any campaigns yet.",
        "create": "Create campaign",
        "stats": "Stats"
    },
    "payment": {
        "title": "Payment",
        "verifying": "Verifying payment…",
        "verifyingDescription": "Please wait a moment.",
        "verified": "Payment successful",
        "verifiedDescription": "Your subscription is now active.",
        "failed": "Payment failed",
        "failedDescription": "If charged, the amount is refunded within 24 hours.",
        "missing": "Payment id not found",
        "backToDashboard": "Back to dashboard"
    }
}

# Common keys (currency label + free + prev/next/confirm/cancel — check which exist first)
COMMON_FA = {"currency": {"toman": "تومان"}, "free": "رایگان", "prev": "قبلی", "next": "بعدی", "confirm": "تأیید", "cancel": "لغو", "error": "خطایی رخ داد."}
COMMON_EN = {"currency": {"toman": "Toman"}, "free": "Free", "prev": "Previous", "next": "Next", "confirm": "Confirm", "cancel": "Cancel", "error": "An error occurred."}

def update_seed(path, dashboard_tree, common_tree):
    raw = path.read_text(encoding="utf-8")
    data = json.loads(raw)
    # Merge dashboard.* (only the new sub-keys; existing keys preserved)
    data["dashboard"] = deep_merge(data.get("dashboard", {}), dashboard_tree)
    # Merge common.* (only add missing keys)
    data["common"] = deep_merge(data.get("common", {}), common_tree)
    out = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    if out == raw:
        print(f"  {path.name}: unchanged")
        return False
    path.write_text(out, encoding="utf-8")
    print(f"  {path.name}: updated")
    return True

def main():
    print("Adding dashboard.billing/campaigns/payment + group.growth + common keys…")
    update_seed(SEED_DIR / "en.json", DASHBOARD_EN, COMMON_EN)
    update_seed(SEED_DIR / "fa.json", DASHBOARD_FA, COMMON_FA)
    return 0

if __name__ == "__main__":
    sys.exit(main())
