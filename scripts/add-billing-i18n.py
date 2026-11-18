#!/usr/bin/env python3
"""Add the billing.* i18n keys to the API seed files (en + fa), top-level."""
import json, sys
from pathlib import Path

SEED_DIR = Path("apps/api/src/modules/i18n/seed")

BILLING_FA = {
  "plan": {
    "free": {"name": "رایگان", "tagline": "برای کسب‌وکارهای کوچک"},
    "starter": {"name": "استارتر", "tagline": "برای رشد"},
    "pro": {"name": "حرفه‌ای", "tagline": "امکانات کامل"},
    "enterprise": {"name": "سازمانی", "tagline": "برای شبکه‌ها"},
    "interval": {"monthly": "ماهانه", "yearly": "سالانه"},
    "cta": {"subscribe": "انتخاب پلن", "current": "پلن فعلی شما", "upgrade": "ارتقا"},
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
    "title": "اشتراک",
    "status": {"active": "فعال", "past_due": "سررسید گذشته", "cancelled": "لغو شده", "expired": "منقضی", "pending_payment": "در انتظار پرداخت"},
    "period": "بازه: {start} تا {end}",
    "autoRenew": "تمدید خودکار",
    "cancel": "لغو اشتراک",
    "cancelled": "اشتراک لغو شد.",
    "none": "بدون اشتراک فعال (پلن رایگان)",
    "upgradePrompt": "برای دسترسی به امکانات بیشتر، پلن خود را ارتقا دهید."
  },
  "invoice": {
    "title": "فاکتور",
    "number": "شمارهٔ فاکتور",
    "amount": "مبلغ",
    "period": "دوره",
    "status": {"pending": "در انتظار پرداخت", "verified": "پرداخت شده", "failed": "ناموفق", "cancelled": "لغو شده"},
    "list": "تاریخچه فاکتورها",
    "empty": "هنوز فاکتوری ثبت نشده."
  }
}

BILLING_EN = {
  "plan": {
    "free": {"name": "Free", "tagline": "For small businesses"},
    "starter": {"name": "Starter", "tagline": "For growth"},
    "pro": {"name": "Pro", "tagline": "Full features"},
    "enterprise": {"name": "Enterprise", "tagline": "For networks"},
    "interval": {"monthly": "Monthly", "yearly": "Yearly"},
    "cta": {"subscribe": "Choose plan", "current": "Your current plan", "upgrade": "Upgrade"},
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
    "title": "Subscription",
    "status": {"active": "Active", "past_due": "Past due", "cancelled": "Cancelled", "expired": "Expired", "pending_payment": "Pending payment"},
    "period": "Period: {start} to {end}",
    "autoRenew": "Auto-renew",
    "cancel": "Cancel subscription",
    "cancelled": "Subscription cancelled.",
    "none": "No active subscription (Free plan)",
    "upgradePrompt": "Upgrade your plan for more features."
  },
  "invoice": {
    "title": "Invoice",
    "number": "Invoice number",
    "amount": "Amount",
    "period": "Period",
    "status": {"pending": "Pending", "verified": "Paid", "failed": "Failed", "cancelled": "Cancelled"},
    "list": "Invoice history",
    "empty": "No invoices yet."
  }
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
    new_obj = insert_alpha({k: v for k, v in data.items() if k != "billing"}, "billing", tree)
    out = json.dumps(new_obj, ensure_ascii=False, indent=2) + "\n"
    if out == raw:
        print(f"  {path.name}: unchanged")
        return False
    path.write_text(out, encoding="utf-8")
    print(f"  {path.name}: updated")
    return True

def main():
    print("Adding billing.* i18n keys…")
    update_seed(SEED_DIR / "en.json", BILLING_EN)
    update_seed(SEED_DIR / "fa.json", BILLING_FA)
    return 0

if __name__ == "__main__":
    sys.exit(main())
