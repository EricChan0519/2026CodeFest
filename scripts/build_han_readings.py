#!/usr/bin/env python3
"""
建立漢字讀音表 api/data/han_readings.json，給外語地點搜尋（api/app/translate.py）用。

為什麼需要：外籍使用者用母語打地名（「대만박물관」「Đài Loan」「Zhishan」），要先換回中文再搜尋；
搜尋結果再用同一張表轉成使用者看得懂的寫法。只收地點、站牌、連鎖店名稱用到的字（約 5 千字），檔案很小。

資料來源（都是開源、免費）：
  - Unicode Unihan Database（Unicode License v3）：
      kMandarin（漢語拼音；有兩個讀音時第二個是臺灣讀音）、kHangul（韓文漢字音，含頭音法則的另一個讀音）、
      kVietnamese（越南漢越音）
      下載：https://www.unicode.org/Public/UCD/latest/ucd/Unihan.zip
  - OpenCC 字典（Apache-2.0，取自 npm opencc-js 的 dist/esm-lib/dict）：
      JPShinjitaiCharacters（日文新字體 → 繁體）、STCharacters（簡體 → 繁體）

用法：
  python scripts/build_han_readings.py --unihan Unihan.zip --opencc-dict node_modules/opencc-js/dist/esm-lib/dict

輸出：
  { "updatedAt", "sources": [...],
    "chars": { "國": ["guo", ["국"], ["quốc"]], ... },   # 拼音（無聲調，ü 寫成 v）、韓文音、漢越音
    "jp": { "湾": "灣", ... }, "s2t": { "国": "國", ... } }
"""

from __future__ import annotations

import argparse
import gzip
import json
import re
import unicodedata
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PLACE_INDEX = ROOT / "api" / "data" / "place_index.json.gz"
STOP_INDEX = ROOT / "api" / "data" / "stop_index.json"
POI_INDEX = ROOT / "web" / "public" / "lab" / "poi_index.json"
GLOSSARY = ROOT / "api" / "data" / "place_glossary.json"
OUT = ROOT / "api" / "data" / "han_readings.json"

# Unihan 缺的或不是地名慣用的漢越音（臺灣 → Đài Loan）
VIETNAMESE_OVERRIDES = {"臺": ["đài"], "台": ["đài"], "灣": ["loan"], "湾": ["loan"]}

TONE_MARKS = str.maketrans({"ü": "v", "ǖ": "v", "ǘ": "v", "ǚ": "v", "ǜ": "v"})


def is_han(ch: str) -> bool:
    return "㐀" <= ch <= "鿿" or "豈" <= ch <= "﫿"


def plain_pinyin(p: str) -> str:
    """zhī → zhi；lǚ → lv"""
    p = p.lower().translate(TONE_MARKS)
    return "".join(c for c in unicodedata.normalize("NFD", p) if not unicodedata.combining(c))


def used_chars() -> set[str]:
    chars: set[str] = set()
    data = json.loads(gzip.decompress(PLACE_INDEX.read_bytes()))
    for p in data["places"]:
        chars.update(p[0])
    for s in json.loads(STOP_INDEX.read_text(encoding="utf-8"))["stations"]:
        chars.update(s["name"]["zh"])
    if POI_INDEX.exists():
        for p in json.loads(POI_INDEX.read_text(encoding="utf-8"))["places"]:
            chars.update(p[1])
    if GLOSSARY.exists():
        for term in json.loads(GLOSSARY.read_text(encoding="utf-8"))["terms"]:
            chars.update(term["zh"])
    return {c for c in chars if is_han(c)}


def read_opencc(dict_dir: Path, name: str) -> dict[str, str]:
    """opencc-js 的字典檔是 `export default "万 萬|与 與|..."`；一對多時取第一個"""
    text = (dict_dir / f"{name}.js").read_text(encoding="utf-8")
    body = re.search(r'"(.*)"', text, re.S).group(1)
    out = {}
    for pair in body.split("|"):
        parts = pair.split(" ")
        if len(parts) >= 2 and len(parts[0]) == 1:
            out[parts[0]] = parts[1]
    return out


def read_unihan(path: Path) -> dict[str, dict[str, str]]:
    fields = {"kMandarin", "kHangul", "kVietnamese"}
    out: dict[str, dict[str, str]] = {}
    with zipfile.ZipFile(path) as z:
        for line in z.read("Unihan_Readings.txt").decode("utf-8").splitlines():
            if line.startswith("#") or not line.strip():
                continue
            cp, field, value = line.split("\t", 2)
            if field in fields:
                out.setdefault(chr(int(cp[2:], 16)), {})[field] = value
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--unihan", type=Path, required=True)
    ap.add_argument("--opencc-dict", type=Path, required=True)
    args = ap.parse_args()

    unihan = read_unihan(args.unihan)
    jp = read_opencc(args.opencc_dict, "JPShinjitaiCharacters")
    s2t = read_opencc(args.opencc_dict, "STCharacters")

    chars = used_chars()
    # 日文、簡體換過來的繁體字也要有讀音
    chars |= {t for t in list(jp.values()) + list(s2t.values()) if t in chars}

    table: dict[str, list] = {}
    for ch in sorted(chars):
        u = unihan.get(ch, {})
        mandarin = u.get("kMandarin", "").split()
        pinyin = plain_pinyin(mandarin[-1]) if mandarin else ""  # 第二個是臺灣讀音
        hangul = [h.split(":")[0] for h in u.get("kHangul", "").split()]
        viet = VIETNAMESE_OVERRIDES.get(ch) or [v.lower() for v in u.get("kVietnamese", "").split()]
        if pinyin or hangul or viet:
            table[ch] = [pinyin, hangul, viet]

    keep = set(table)
    doc = {
        "updatedAt": datetime.now(timezone(timedelta(hours=8))).isoformat(timespec="seconds"),
        "sources": [
            {"name": "Unicode Unihan Database", "license": "Unicode License v3", "url": "https://www.unicode.org/charts/unihan.html"},
            {"name": "OpenCC", "license": "Apache-2.0", "url": "https://github.com/BYVoid/OpenCC"},
        ],
        "chars": table,
        "jp": {k: v for k, v in jp.items() if v in keep},
        "s2t": {k: v for k, v in s2t.items() if v in keep and k != v},
    }
    OUT.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{OUT}: {len(table)} chars, jp {len(doc['jp'])}, s2t {len(doc['s2t'])}, {OUT.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
