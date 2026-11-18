#!/usr/bin/env python3
"""Add the admin.nav.revenue + admin.group.revenue + dashboard.admin.revenue.*
keys (F8.4)."""
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

ADMIN_FA = {"nav": {"revenue": "درآمد"}, "group": {"revenue": "درآمد"}}
ADMIN_EN = {"nav": {"revenue": "Revenue"}, "group": {"revenue": "Revenue"}}

DASH_ADMIN_FA = {
    "revenue": {
        "title": "گزارش درآمد",
        "empty": "در بازهٔ انتخاب‌شده تراکنشی ثبت نشده است.",
        "range.7d": "۷ روز",
        "range.30d": "۳۰ روز",
        "range.90d": "۹۰ روز",
        "totalRevenue": "درآمد کل",
        "totalTransactions": "تعداد تراکنش‌ها",
        "averageTransaction": "میانگین تراکنش",
        "byPurpose": "به تفکیک نوع",
        "byPlan": "به تفکیک پلن",
        "purpose": "نوع",
        "count": "تعداد",
        "amount": "مبلغ",
        "planTier": "پلن",
        "purpose.subscription": "اشتراک",
        "purpose.ads": "تبلیغات",
        "purpose.topup": "شارژ"
    }
}
DASH_ADMIN_EN = {
    "revenue": {
        "title": "Revenue report",
        "empty": "No transactions in the selected window.",
        "range.7d": "7 days",
        "range.30d": "30 days",
        "range.90d": "90 days",
        "totalRevenue": "Total revenue",
        "totalTransactions": "Total transactions",
        "averageTransaction": "Average transaction",
        "byPurpose": "By purpose",
        "byPlan": "By plan",
        "purpose": "Purpose",
        "count": "Count",
        "amount": "Amount",
        "planTier": "Plan",
        "purpose.subscription": "Subscription",
        "purpose.ads": "Ads",
        "purpose.topup": "Top-up"
    }
}

def update_seed(path, admin_tree, dash_admin_tree):
    raw = path.read_text(encoding="utf-8")
    data = json.loads(raw)
    data["admin"] = deep_merge(data.get("admin", {}), admin_tree)
    dash = data.get("dashboard", {})
    dash["admin"] = deep_merge(dash.get("admin", {}), dash_admin_tree)
    data["dashboard"] = dash
    out = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    if out == raw:
        print(f"  {path.name}: unchanged")
        return False
    path.write_text(out, encoding="utf-8")
    print(f"  {path.name}: updated")
    return True

def main():
    print("Adding admin.revenue + dashboard.admin.revenue keys (F8.4)…")
    update_seed(SEED_DIR / "en.json", ADMIN_EN, DASH_ADMIN_EN)
    update_seed(SEED_DIR / "fa.json", ADMIN_FA, DASH_ADMIN_FA)
    return 0

if __name__ == "__main__":
    sys.exit(main())
