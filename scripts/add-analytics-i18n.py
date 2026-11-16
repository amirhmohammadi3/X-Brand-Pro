#!/usr/bin/env python3
"""
Add the analytics.consent.* i18n keys to the API seed files (en + fa), in the
correct alphabetical top-level position (between `admin` and `auth`), then
sync to the web fallback copies via the project's sync script.

Idempotent: if the `analytics` key already exists, it overwrites the consent
sub-tree only (leaving any other analytics.* keys intact) and re-writes.
"""
import json
import sys
from pathlib import Path

SEED_DIR = Path("apps/api/src/modules/i18n/seed")

# The F7.7 consent banner copy. fa and en must have the SAME key set.
CONSENT_FA = {
    "title": "به ما کمک کنید خدمات را بهتر کنیم",
    "body": "با اجازهٔ شما، بازدید صفحات را به‌صورت ناشناس می‌شماریم تا تجربهٔ بهتری ارائه دهیم. هیچ اطلاعات شخصی ذخیره نمی‌شود.",
    "privacyLink": "حریم خصوصی",
    "grant": "اجازه می‌دهم",
    "deny": "فعلاً نه",
}

CONSENT_EN = {
    "title": "Help us improve",
    "body": "With your permission, we count page views anonymously to improve the experience. No personal data is stored.",
    "privacyLink": "Privacy",
    "grant": "Allow",
    "deny": "Not now",
}

# Top-level analytics tree: consent is the only sub-tree F7.7 adds. F7.8 will
# add `analytics.dashboard.*` here too.
ANALYTICS_FA = {"consent": CONSENT_FA}
ANALYTICS_EN = {"consent": CONSENT_EN}


def insert_alpha(obj: dict, key: str, value) -> dict:
    """Return a new dict with `key` inserted in alphabetical key order."""
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


def update_seed(path: Path, analytics_tree: dict) -> bool:
    raw = path.read_text(encoding="utf-8")
    data = json.loads(raw)
    existing = data.get("analytics")
    if isinstance(existing, dict):
        # Merge: overwrite consent sub-tree, keep anything else.
        merged = {**existing, **analytics_tree}
    else:
        merged = analytics_tree
    new_obj = insert_alpha({k: v for k, v in data.items() if k != "analytics"}, "analytics", merged)
    # Preserve the 2-space indent + ensure_ascii=False (Persian chars inline).
    out = json.dumps(new_obj, ensure_ascii=False, indent=2) + "\n"
    if out == raw:
        print(f"  {path.name}: unchanged")
        return False
    path.write_text(out, encoding="utf-8")
    print(f"  {path.name}: updated")
    return True


def main() -> int:
    print("Updating API i18n seeds…")
    update_seed(SEED_DIR / "en.json", ANALYTICS_EN)
    update_seed(SEED_DIR / "fa.json", ANALYTICS_FA)
    return 0


if __name__ == "__main__":
    sys.exit(main())
