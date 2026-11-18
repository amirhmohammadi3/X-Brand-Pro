#!/usr/bin/env python3
"""Add the ads.* i18n keys to the API seed files (en + fa), top-level."""
import json, sys
from pathlib import Path

SEED_DIR = Path("apps/api/src/modules/i18n/seed")

ADS_FA = {
  "title": "تبلیغات",
  "campaign": {
    "title": "کمپین تبلیغاتی",
    "name": "نام کمپین",
    "placements": "محل نمایش",
    "budget": "بودجه",
    "budgetTotal": "بودجهٔ کل",
    "budgetRemaining": "بودجهٔ باقی‌مانده",
    "dailyCap": "سقف روزانه",
    "cpc": "هزینهٔ هر کلیک",
    "schedule": "زمان‌بندی",
    "startsOn": "شروع",
    "endsOn": "پایان",
    "headline": "تیتر تبلیغ",
    "status": {
      "draft": "پیش‌نویس",
      "pending_payment": "در انتظار پرداخت",
      "active": "فعال",
      "paused": "متوقف شده",
      "ended": "پایان یافته",
      "archived": "بایگانی"
    },
    "create": "ایجاد کمپین",
    "checkout": "پرداخت کمپین",
    "prepared": "کمپین برای پرداخت آماده شد. حالا یک پرداخت با purpose=ads بسازید.",
    "stats": {
      "impressions": "نمایش",
      "clicks": "کلیک",
      "ctr": "نرخ کلیک",
      "spent": "هزینه شده",
      "daysRun": "روز فعالیت",
      "daysRemaining": "روز باقی‌مانده"
    }
  },
  "placement": {
    "search_top": "بالای نتایج جستجو",
    "home_slot": "اسلات صفحهٔ اصلی",
    "category_top": "بالای صفحهٔ دسته"
  },
  "label": "تبلیغ",
  "empty": "هنوز کمپینی نساخته‌اید."
}

ADS_EN = {
  "title": "Advertising",
  "campaign": {
    "title": "Ad campaign",
    "name": "Campaign name",
    "placements": "Placements",
    "budget": "Budget",
    "budgetTotal": "Total budget",
    "budgetRemaining": "Budget remaining",
    "dailyCap": "Daily cap",
    "cpc": "Cost per click",
    "schedule": "Schedule",
    "startsOn": "Starts on",
    "endsOn": "Ends on",
    "headline": "Ad headline",
    "status": {
      "draft": "Draft",
      "pending_payment": "Pending payment",
      "active": "Active",
      "paused": "Paused",
      "ended": "Ended",
      "archived": "Archived"
    },
    "create": "Create campaign",
    "checkout": "Pay for campaign",
    "prepared": "Campaign prepared for payment. Now create a payment with purpose=ads.",
    "stats": {
      "impressions": "Impressions",
      "clicks": "Clicks",
      "ctr": "Click-through rate",
      "spent": "Spent",
      "daysRun": "Days run",
      "daysRemaining": "Days remaining"
    }
  },
  "placement": {
    "search_top": "Top of search results",
    "home_slot": "Home slot",
    "category_top": "Top of category page"
  },
  "label": "Sponsored",
  "empty": "You have not created any campaigns yet."
}

def insert_alpha(obj, key, value):
    new = {}
    placed = False
    for k in sorted(obj.keys()):
        if not placed and key < k:
            new[key] = value
            placed = True
        new[k] = obj[k]
    if not placed:
        new[key] = value
    return new

def update_seed(path, tree):
    raw = path.read_text(encoding="utf-8")
    data = json.loads(raw)
    new_obj = insert_alpha({k: v for k, v in data.items() if k != "ads"}, "ads", tree)
    out = json.dumps(new_obj, ensure_ascii=False, indent=2) + "\n"
    if out == raw:
        print(f"  {path.name}: unchanged")
        return False
    path.write_text(out, encoding="utf-8")
    print(f"  {path.name}: updated")
    return True

def main():
    print("Adding ads.* i18n keys…")
    update_seed(SEED_DIR / "en.json", ADS_EN)
    update_seed(SEED_DIR / "fa.json", ADS_FA)
    return 0

if __name__ == "__main__":
    sys.exit(main())
