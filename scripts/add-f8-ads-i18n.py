#!/usr/bin/env python3
"""Add the dashboard.ads.* keys the campaigns-dashboard component references
(F8.2). The keys mirror the root ads.* keys (already in seed from phase 8
backend) but are dashboard-scoped because the component uses
useTranslations('dashboard')."""
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

ADS_FA = {
    "campaign": {
        "name": "نام کمپین",
        "placements": "محل نمایش",
        "budgetTotal": "بودجهٔ کل",
        "budgetRemaining": "بودجهٔ باقی‌مانده",
        "dailyCap": "سقف روزانه",
        "cpc": "هزینهٔ هر کلیک",
        "schedule": "زمان‌بندی",
        "startsOn": "شروع",
        "endsOn": "پایان",
        "headline": "تیتر تبلیغ",
        "checkout": "پرداخت",
        "status": {
            "draft": "پیش‌نویس",
            "pending_payment": "در انتظار پرداخت",
            "active": "فعال",
            "paused": "متوقف شده",
            "ended": "پایان یافته",
            "archived": "بایگانی"
        },
        "stats": {
            "impressions": "نمایش",
            "clicks": "کلیک",
            "ctr": "نرخ کلیک",
            "spent": "هزینه شده"
        }
    },
    "placement": {
        "search_top": "بالای نتایج جستجو",
        "home_slot": "اسلات صفحهٔ اصلی",
        "category_top": "بالای صفحهٔ دسته"
    }
}

ADS_EN = {
    "campaign": {
        "name": "Campaign name",
        "placements": "Placements",
        "budgetTotal": "Total budget",
        "budgetRemaining": "Budget remaining",
        "dailyCap": "Daily cap",
        "cpc": "Cost per click",
        "schedule": "Schedule",
        "startsOn": "Starts on",
        "endsOn": "Ends on",
        "headline": "Ad headline",
        "checkout": "Pay",
        "status": {
            "draft": "Draft",
            "pending_payment": "Pending payment",
            "active": "Active",
            "paused": "Paused",
            "ended": "Ended",
            "archived": "Archived"
        },
        "stats": {
            "impressions": "Impressions",
            "clicks": "Clicks",
            "ctr": "Click-through rate",
            "spent": "Spent"
        }
    },
    "placement": {
        "search_top": "Top of search results",
        "home_slot": "Home slot",
        "category_top": "Top of category page"
    }
}

def update_seed(path, ads_tree):
    raw = path.read_text(encoding="utf-8")
    data = json.loads(raw)
    dash = data.get("dashboard", {})
    dash["ads"] = deep_merge(dash.get("ads", {}), ads_tree)
    data["dashboard"] = dash
    out = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    if out == raw:
        print(f"  {path.name}: unchanged")
        return False
    path.write_text(out, encoding="utf-8")
    print(f"  {path.name}: updated")
    return True

def main():
    print("Adding dashboard.ads.* keys (F8.2)…")
    update_seed(SEED_DIR / "en.json", ADS_EN)
    update_seed(SEED_DIR / "fa.json", ADS_FA)
    return 0

if __name__ == "__main__":
    sys.exit(main())
