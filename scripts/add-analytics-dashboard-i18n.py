#!/usr/bin/env python3
"""
Add the dashboard.analytics.* i18n keys to the API seed files (en + fa),
nested under the existing `dashboard` top-level object. Idempotent: overwrites
the analytics sub-tree only.

Keys added (fa + en):
  dashboard.analytics.title
  dashboard.analytics.loadError
  dashboard.analytics.window          {from} {to}
  dashboard.analytics.range.label
  dashboard.analytics.range.7d / .30d / .90d
  dashboard.analytics.empty.title / .body
  dashboard.analytics.charts.title
  dashboard.analytics.funnel.title
  dashboard.analytics.funnel.conv      {pct}
"""
import json
import sys
from pathlib import Path

SEED_DIR = Path("apps/api/src/modules/i18n/seed")

ANALYTICS_DASHBOARD_FA = {
    "title": "آنالیتیکس",
    "loadError": "بارگذاری آمار ناموفق بود.",
    "window": "بازه: {from} تا {to}",
    "range": {
      "label": "بازهٔ زمانی",
      "7d": "۷ روز",
      "30d": "۳۰ روز",
      "90d": "۹۰ روز",
    },
    "empty": {
      "title": "هنوز داده‌ای ثبت نشده",
      "body": "با بازدید کاربران از صفحهٔ کسب‌وکار شما، آمار بازدید، تماس، مسیر و اشتراک در اینجا نمایش داده می‌شود.",
    },
    "charts": {
      "title": "روند روزانه",
    },
    "funnel": {
      "title": "قیف تبدیل",
      "conv": "تبدیل: {pct}٪",
    },
}

ANALYTICS_DASHBOARD_EN = {
    "title": "Analytics",
    "loadError": "Failed to load analytics.",
    "window": "Range: {from} to {to}",
    "range": {
      "label": "Time range",
      "7d": "7 days",
      "30d": "30 days",
      "90d": "90 days",
    },
    "empty": {
      "title": "No data yet",
      "body": "As visitors view your business page, view / call / direction / share counts will appear here.",
    },
    "charts": {
      "title": "Daily trend",
    },
    "funnel": {
      "title": "Conversion funnel",
      "conv": "Conversion: {pct}%",
    },
}


def deep_merge(base: dict, overlay: dict) -> dict:
    """Recursively merge overlay onto base (overlay wins on conflict)."""
    out = dict(base)
    for k, v in overlay.items():
        if k in out and isinstance(out[k], dict) and isinstance(v, dict):
            out[k] = deep_merge(out[k], v)
        else:
            out[k] = v
    return out


def update_seed(path: Path, analytics_tree: dict) -> bool:
    raw = path.read_text(encoding="utf-8")
    data = json.loads(raw)
    dashboard = data.get("dashboard")
    if not isinstance(dashboard, dict):
        # Should never happen — the dashboard tree has existed since F7.1.
        raise SystemExit(f"{path}: missing top-level 'dashboard' object")
    existing = dashboard.get("analytics")
    if isinstance(existing, dict):
        merged = deep_merge(existing, analytics_tree)
    else:
        merged = analytics_tree
    dashboard["analytics"] = merged
    out = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    if out == raw:
        print(f"  {path.name}: unchanged")
        return False
    path.write_text(out, encoding="utf-8")
    print(f"  {path.name}: updated")
    return True


def main() -> int:
    print("Updating dashboard.analytics i18n keys…")
    update_seed(SEED_DIR / "en.json", ANALYTICS_DASHBOARD_EN)
    update_seed(SEED_DIR / "fa.json", ANALYTICS_DASHBOARD_FA)
    return 0


if __name__ == "__main__":
    sys.exit(main())
