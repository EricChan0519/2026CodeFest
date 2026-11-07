#!/usr/bin/env python3
"""
建立「連鎖店（便利商店、速食、連鎖餐廳）」離線索引 web/public/lab/poi_index.json。

資料來源：Overture Maps Foundation 的 Places 主題
  - 免費、免帳號、免金鑰，直接從公開 S3 讀（不經任何商用 API）
  - 授權 CDLA-Permissive-2.0 / Apache-2.0 / CC0-1.0（不含 OpenStreetMap，沒有 ODbL 的相同方式分享義務）
  - 與本專案 AGPL-3.0 相容，需標示出處（見 docs/arrow-nav/08-poi-data.md）
工具：DuckDB（MIT，開源）

用法：
  python3 -m venv /tmp/ovenv && /tmp/ovenv/bin/pip install duckdb
  /tmp/ovenv/bin/python scripts/build_poi_index.py [--release 2026-10-21.0]

輸出格式（為了小，用陣列的陣列）：
  { "release": "...", "updatedAt": "...", "brands": [{ "key", "zh", "en", "kind", "aliases": [...] }],
    "places": [[brandIdx, name, lat, lon, address, confidence100], ...] }
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

# kind: store = 便利商店/超市, food = 速食與連鎖餐廳, cafe = 咖啡飲料
# match: 比對 names.primary 與 brand.names.primary 的正規式（不分大小寫）
# exclude: 命中就丟掉（避免「全家福海鮮」之類）
BRANDS = [
    # 便利商店
    dict(key="7-11", zh="7-ELEVEN", en="7-ELEVEN", kind="store", aliases=["7-11", "7-eleven", "seven", "統一超商", "小七", "7eleven", "7 11"],
         match=r"7[\s-]?eleven|(?<![0-9])7[\s-]?11(?![0-9])|統一超商", exclude=r"ibon|cold stone|cstore|city\s?cafe$"),
    dict(key="familymart", zh="全家", en="FamilyMart", kind="store", aliases=["全家", "family", "familymart", "全家便利商店"],
         match=r"^全家(?!福)|family\s?mart|全家便利商店", exclude=r"全家福|全家樂|全家人"),
    dict(key="hilife", zh="萊爾富", en="Hi-Life", kind="store", aliases=["萊爾富", "hilife", "hi-life", "hi life"],
         match=r"萊爾富|hi[\s-]?life", exclude=r""),
    dict(key="okmart", zh="OK超商", en="OK mart", kind="store", aliases=["ok", "ok超商", "okmart", "ok mart"],
         match=r"^ok\s?(超商|mart|便利)|ok\s?mart", exclude=r"ok\s?camera|ok\s?貸|okinawa|ok\s?kids"),
    dict(key="pxmart", zh="全聯福利中心", en="PX Mart", kind="store", aliases=["全聯", "pxmart", "px mart", "全聯福利中心"],
         match=r"全聯|px\s?mart", exclude=r"全聯會|全聯車"),
    dict(key="simplemart", zh="美廉社", en="Simple Mart", kind="store", aliases=["美廉社", "simple mart", "simplemart"],
         match=r"美廉社|simple\s?mart", exclude=r""),
    # 速食
    dict(key="mcdonalds", zh="麥當勞", en="McDonald's", kind="food", aliases=["麥當勞", "mcdonald", "mcdonalds", "mcd", "麥當當"],
         match=r"麥當勞|mcdonald", exclude=r"叔叔|兒童|慈善"),
    dict(key="kfc", zh="肯德基", en="KFC", kind="food", aliases=["肯德基", "kfc", "kentucky"],
         match=r"肯德基|\bkfc\b|kentucky", exclude=r""),
    dict(key="burgerking", zh="漢堡王", en="Burger King", kind="food", aliases=["漢堡王", "burger king", "burgerking", "bk"],
         match=r"漢堡王|burger\s?king", exclude=r""),
    dict(key="mos", zh="摩斯漢堡", en="MOS Burger", kind="food", aliases=["摩斯", "摩斯漢堡", "mos", "mos burger"],
         match=r"摩斯漢堡|mos\s?burger|^摩斯", exclude=r""),
    dict(key="subway", zh="Subway 潛艇堡", en="Subway", kind="food", aliases=["subway", "潛艇堡", "賽百味"],
         match=r"\bsubway\b|賽百味", exclude=r"station|捷運|地鐵|subway\s?surfers"),
    dict(key="dominos", zh="達美樂披薩", en="Domino's", kind="food", aliases=["達美樂", "domino", "dominos", "披薩"],
         match=r"達美樂|domino'?s", exclude=r""),
    dict(key="pizzahut", zh="必勝客", en="Pizza Hut", kind="food", aliases=["必勝客", "pizza hut", "pizzahut"],
         match=r"必勝客|pizza\s?hut", exclude=r""),
    dict(key="yoshinoya", zh="吉野家", en="Yoshinoya", kind="food", aliases=["吉野家", "yoshinoya"],
         match=r"吉野家|yoshinoya", exclude=r""),
    dict(key="sukiya", zh="食其家", en="Sukiya", kind="food", aliases=["食其家", "sukiya"],
         match=r"食其家|sukiya", exclude=r""),
    dict(key="sushiro", zh="壽司郎", en="Sushiro", kind="food", aliases=["壽司郎", "sushiro"],
         match=r"壽司郎|sushiro", exclude=r""),
    dict(key="genki", zh="爭鮮", en="Sushi Express", kind="food", aliases=["爭鮮", "sushi express", "迴轉壽司"],
         match=r"爭鮮|sushi\s?express", exclude=r""),
    dict(key="haidilao", zh="海底撈", en="Haidilao", kind="food", aliases=["海底撈", "haidilao", "火鍋"],
         match=r"海底撈|haidilao", exclude=r"旗魚|桌遊|棋牌|自助|月棋"),
    dict(key="din-tai-fung", zh="鼎泰豐", en="Din Tai Fung", kind="food", aliases=["鼎泰豐", "din tai fung", "dintaifung", "小籠包"],
         match=r"鼎泰豐|din\s?tai\s?fung", exclude=r""),
    dict(key="bafang", zh="八方雲集", en="Bafang Dumpling", kind="food", aliases=["八方雲集", "八方", "bafang", "鍋貼"],
         match=r"八方雲集|bafang", exclude=r""),
    dict(key="maiweideng", zh="麥味登", en="Mai Wei Deng", kind="food", aliases=["麥味登", "早餐"],
         match=r"麥味登", exclude=r""),
    dict(key="dandan", zh="丹丹漢堡", en="Dan Dan Burger", kind="food", aliases=["丹丹", "丹丹漢堡"],
         match=r"丹丹漢堡", exclude=r""),
    dict(key="tkk", zh="頂呱呱", en="TKK Fried Chicken", kind="food", aliases=["頂呱呱", "tkk"],
         match=r"頂呱呱|tkk", exclude=r""),
    dict(key="napoli", zh="拿坡里", en="Napoli Pizza", kind="food", aliases=["拿坡里", "napoli"],
         match=r"拿坡里", exclude=r""),
    dict(key="hushiang", zh="鬍鬚張", en="Hu Hsu Chang", kind="food", aliases=["鬍鬚張", "魯肉飯"],
         match=r"鬍鬚張", exclude=r""),
    # 咖啡飲料
    dict(key="starbucks", zh="星巴克", en="Starbucks", kind="cafe", aliases=["星巴克", "starbucks", "starbuck"],
         match=r"星巴克|starbucks", exclude=r""),
    dict(key="louisa", zh="路易莎咖啡", en="Louisa Coffee", kind="cafe", aliases=["路易莎", "louisa"],
         match=r"路易莎|louisa", exclude=r""),
    dict(key="cama", zh="cama café", en="cama café", kind="cafe", aliases=["cama", "cama cafe"],
         match=r"\bcama\b", exclude=r""),
    dict(key="85c", zh="85度C", en="85°C", kind="cafe", aliases=["85度c", "85c", "85°c", "85度"],
         match=r"85\s?度\s?c|85\s?°\s?c|85c\b", exclude=r""),
    dict(key="comebuy", zh="Comebuy", en="Comebuy", kind="cafe", aliases=["comebuy", "手搖"],
         match=r"comebuy", exclude=r""),
    dict(key="50lan", zh="50嵐", en="50嵐", kind="cafe", aliases=["50嵐", "五十嵐", "手搖"],
         match=r"50\s?嵐|五十嵐", exclude=r""),
    dict(key="kebuke", zh="可不可熟成紅茶", en="KEBUKE", kind="cafe", aliases=["可不可", "kebuke", "手搖"],
         match=r"可不可|kebuke", exclude=r""),
    dict(key="cosmed", zh="康是美", en="Cosmed", kind="store", aliases=["康是美", "cosmed", "藥妝"],
         match=r"康是美|cosmed", exclude=r""),
    dict(key="watsons", zh="屈臣氏", en="Watsons", kind="store", aliases=["屈臣氏", "watsons", "藥妝"],
         match=r"屈臣氏|watsons", exclude=r""),
]

# 台灣本島＋離島（含金門、馬祖、澎湖）。再用地址 country = TW 排除對岸。
BBOX = dict(xmin=118.0, xmax=122.2, ymin=21.8, ymax=26.5)
MIN_CONFIDENCE = 0.5
DEDUPE_METERS_STORE = 40  # 便利商店：同品牌 40 m 內視為同一家（不同來源的座標會差幾十公尺）
DEDUPE_METERS_FOOD = 100  # 餐廳、咖啡：店少、同點重複多，放寬到 100 m
MAX_NAME_LEN = 40  # 超過的多半是 SEO 垃圾店名
CJK = re.compile(r"[\u4e00-\u9fff]")


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def classify(name: str, brand_name: str) -> int | None:
    """回傳 BRANDS 索引；沒命中回傳 None。只看店名：brand 欄位常被錯掛（例如「阿官火鍋專家」掛成海底撈）。"""
    texts = [name]
    for idx, b in enumerate(BRANDS):
        pat = re.compile(b["match"], re.I)
        exc = re.compile(b["exclude"], re.I) if b["exclude"] else None
        for t in texts:
            if pat.search(t) and not (exc and exc.search(t)):
                return idx
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--release", default="2026-10-21.0")
    ap.add_argument("--out", default=str(Path(__file__).resolve().parent.parent / "web/public/lab/poi_index.json"))
    args = ap.parse_args()

    try:
        import duckdb
    except ImportError:
        print("需要 duckdb：pip install duckdb", file=sys.stderr)
        return 2

    con = duckdb.connect()
    con.sql("INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2';")
    src = f"s3://overturemaps-us-west-2/release/{args.release}/theme=places/type=place/*"

    # 先在伺服端用寬鬆的關鍵字縮小範圍，再用上面的精確規則分類
    # DuckDB 用 RE2，不支援 lookaround；粗篩時把它們拿掉，精確判斷交給 Python
    strip_look = re.compile(r"\(\?<?[!=][^)]*\)")
    loose = "|".join(f"(?:{strip_look.sub('', b['match'])})" for b in BRANDS)
    sql = f"""
    SELECT id, names.primary AS name, coalesce(brand.names.primary, '') AS brand,
           bbox.ymin AS lat, bbox.xmin AS lon,
           coalesce(addresses[1].freeform, '') AS addr, coalesce(addresses[1].country, '') AS country,
           confidence, coalesce(operating_status, 'open') AS status
    FROM read_parquet('{src}', hive_partitioning=1)
    WHERE bbox.xmin BETWEEN {BBOX['xmin']} AND {BBOX['xmax']}
      AND bbox.ymin BETWEEN {BBOX['ymin']} AND {BBOX['ymax']}
      AND confidence >= {MIN_CONFIDENCE}
      AND coalesce(operating_status, 'open') <> 'permanently_closed'
      AND (regexp_matches(names.primary, ?, 'i') OR regexp_matches(coalesce(brand.names.primary, ''), ?, 'i'))
    """
    rows = con.execute(sql, [loose, loose]).fetchall()
    print(f"粗篩 {len(rows)} 筆", file=sys.stderr)

    kept: list[tuple[int, str, float, float, str, float]] = []
    for _id, name, brand, lat, lon, addr, country, conf, status in rows:
        if country and country != "TW":
            continue
        if not name or len(name) > MAX_NAME_LEN:
            continue
        idx = classify(name, brand)
        if idx is None:
            continue
        kept.append((idx, name.strip(), lat, lon, addr.strip(), conf))

    # 同品牌近距離去重：留 confidence 高的座標；若留下的那筆沒有中文名/地址，改用重複那筆的
    kept.sort(key=lambda r: -r[5])
    grid: dict[tuple[int, int, int], list[list]] = {}
    out: list[list] = []
    cell = 0.001  # ~110 m
    for r in kept:
        idx, name, lat, lon, addr, _conf = r
        radius = DEDUPE_METERS_STORE if BRANDS[idx]["kind"] == "store" else DEDUPE_METERS_FOOD
        cx, cy = int(lon / cell), int(lat / cell)
        hit = None
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for m in grid.get((idx, cx + dx, cy + dy), []):
                    if haversine_m(lat, lon, m[2], m[3]) <= radius:
                        hit = m
                        break
                if hit:
                    break
            if hit:
                break
        if hit:
            if not CJK.search(hit[1]) and CJK.search(name):
                hit[1] = name
            if not CJK.search(hit[4]) and CJK.search(addr):
                hit[4] = addr
            continue
        m = list(r)
        grid.setdefault((idx, cx, cy), []).append(m)
        out.append(m)

    out.sort(key=lambda r: (r[0], r[2], r[3]))
    tz = timezone(timedelta(hours=8))
    doc = {
        "release": args.release,
        "updatedAt": datetime.now(tz).isoformat(timespec="seconds"),
        "source": "Overture Maps Places",
        "license": "CDLA-Permissive-2.0 / Apache-2.0 / CC0-1.0",
        "brands": [
            {k: b[k] for k in ("key", "zh", "en", "kind", "aliases")} for b in BRANDS
        ],
        "places": [
            [idx, name, round(lat, 6), round(lon, 6), addr, int(round(conf * 100))]
            for idx, name, lat, lon, addr, conf in out
        ],
    }
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    counts: dict[str, int] = {}
    for r in out:
        counts[BRANDS[r[0]]["zh"]] = counts.get(BRANDS[r[0]]["zh"], 0) + 1
    for k, v in sorted(counts.items(), key=lambda kv: -kv[1]):
        print(f"{k:<12}{v}", file=sys.stderr)
    print(f"總計 {len(out)} 筆 → {args.out} ({Path(args.out).stat().st_size/1024:.0f} KB)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
