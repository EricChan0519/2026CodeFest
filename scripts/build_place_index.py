#!/usr/bin/env python3
"""
建立「地標、餐廳、學校…」的地點索引 api/data/place_index.json.gz，給後端 POST /api/landmarks/search 用。

為什麼需要：OpenStreetMap 的 Nominatim 在臺北缺很多地點（例如「天母體育館」「北市大天母詩欣館」都查不到），
而 Overture Maps Places 有。整個大臺北約 17 萬筆、JSON 約 10 MB，放前端太大，所以放後端查。

資料來源：Overture Maps Foundation 的 Places 主題
  - 免費、免帳號、免金鑰，直接從公開 S3 讀（不經任何商用 API）
  - 授權 CDLA-Permissive-2.0 / Apache-2.0 / CC0-1.0（不含 OpenStreetMap）
  - 需標示出處（見 docs/arrow-nav/08-poi-data.md）
工具：DuckDB（MIT，開源）

連鎖店（7-11、全家、麥當勞…）不放這裡：前端已有 web/public/lab/poi_index.json（scripts/build_poi_index.py），
這裡用同一套品牌規則排除，避免同一家店在兩個清單重複出現。

用法：
  python3 -m venv /tmp/ovenv && /tmp/ovenv/bin/pip install duckdb
  /tmp/ovenv/bin/python scripts/build_place_index.py [--release 2026-10-21.0]

輸出格式（為了小，用陣列的陣列，gzip 壓縮）：
  { "release", "updatedAt", "source", "license", "categories": ["餐廳", ...],
    "places": [[name, lat, lon, address, categoryIdx, confidence100], ...] }
"""

from __future__ import annotations

import argparse
import gzip
import json
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_poi_index import CJK, MAX_NAME_LEN, classify, haversine_m  # noqa: E402

# 大臺北：臺北市全部，加上相鄰的新北市區域（三重、板橋、永和、新店、汐止…）
BBOX = dict(xmin=121.40, xmax=121.70, ymin=24.95, ymax=25.22)
MIN_CONFIDENCE = 0.6
DEDUPE_METERS = 60  # 同名 60 m 內視為同一個地點（不同來源的座標會差幾十公尺）

# Overture taxonomy.primary → 畫面上的中文類別。沒列到的用第一層 hierarchy（TOP_LABELS）。
PRIMARY_LABELS = {
    "coffee_shop": "咖啡廳", "cafe": "咖啡廳", "tea_room": "茶館", "bubble_tea_shop": "飲料店",
    "bakery": "麵包店", "dessert_shop": "甜點店", "ice_cream_shop": "冰店", "bar": "酒吧",
    "food_truck_stand": "小吃攤", "breakfast_and_brunch_restaurant": "早午餐",
    "school": "學校", "elementary_school": "國小", "middle_school": "國中", "high_school": "高中",
    "college_university": "大學", "preschool": "幼兒園", "day_care_preschool": "幼兒園",
    "vocational_and_technical_school": "職業學校", "education": "學校",
    "park": "公園", "playground": "遊樂場", "stadium_arena": "運動場館", "gym": "健身房",
    "sport_or_fitness_facility": "運動場館", "swimming_pool": "游泳池",
    "hospital": "醫院", "dental_clinic": "牙醫", "pharmacy": "藥局",
    "library": "圖書館", "museum": "博物館", "art_gallery": "藝廊", "historic_site": "古蹟",
    "hotel": "旅館", "lodging": "住宿",
    "police_station": "警察局", "fire_station": "消防隊", "post_office": "郵局",
    "government_office": "政府機關", "bank": "銀行", "bank_or_credit_union": "銀行", "atm": "提款機",
    "buddhist_place_of_worship": "寺廟", "taoist_place_of_worship": "廟宇", "temple": "廟宇",
    "christian_place_of_worship": "教會", "religious_organization": "宗教團體",
    "parking": "停車場", "train_station": "車站", "metro_station": "捷運站", "bus_station": "公車站",
    "convenience_store": "便利商店", "grocery_store": "超市", "supermarket": "超市",
    "shopping_mall": "購物中心", "department_store": "百貨公司", "bookstore": "書店",
    "mountain": "山", "community_center": "活動中心", "social_or_community_service": "社福機構",
}
TOP_LABELS = {
    "food_and_drink": "餐飲", "shopping": "商店", "services_and_business": "商家",
    "lifestyle_services": "生活服務", "cultural_and_historic": "文化", "travel_and_transportation": "交通",
    "education": "學校", "health_care": "醫療", "sports_and_recreation": "運動休閒",
    "community_and_government": "公共機關", "arts_and_entertainment": "藝文娛樂", "lodging": "住宿",
    "geographic_entities": "地理",
}
OTHER_LABEL = "地點"

# 名稱以外縣市開頭的學校、公園、景點、機關，多半是座標錯放到臺北的（實測「台南七股樹林國小」在臺北車站旁）。
# 只看開頭、只限這些類別：餐廳「台南擔仔麵」、新店「小金門友誼運動公園」、七堵的「基隆市…國小」（在範圍內）都要留下。
ELSEWHERE_PREFIX = re.compile(r"^(?:苗栗|臺南|台南|高雄|臺中|台中|彰化|雲林|嘉義|屏東|宜蘭|花蓮|臺東|台東|南投|新竹|澎湖|桃園)")
ELSEWHERE_LABELS = {"國小", "國中", "高中", "大學", "學校", "職業學校", "幼兒園", "公園", "地理", "古蹟", "山", "政府機關", "文化"}


def misplaced(name: str, label: str) -> bool:
    return label in ELSEWHERE_LABELS and bool(ELSEWHERE_PREFIX.match(name))


def category_label(primary: str | None, top: str | None) -> str:
    p = primary or ""
    if p in PRIMARY_LABELS:
        return PRIMARY_LABELS[p]
    if p.endswith("_restaurant") or p == "restaurant" or p == "diner":
        return "餐廳"
    if p.endswith("_clinic") or p == "doctor":
        return "診所"
    return TOP_LABELS.get(top or "", OTHER_LABEL)


def clean(s: str | None) -> str:
    return re.sub(r"\s+", " ", (s or "").strip())


def dedupe(rows: list[tuple]) -> list[list]:
    """rows: (name, lat, lon, addr, label, conf)，依 confidence 高到低；同名 DEDUPE_METERS 內只留一筆，缺的地址用重複那筆補"""
    grid: dict[tuple[str, int, int], list[list]] = {}
    out: list[list] = []
    cell = 0.001  # ~110 m
    for r in sorted(rows, key=lambda r: -r[5]):
        name, lat, lon, addr = r[0], r[1], r[2], r[3]
        key = name.replace("台", "臺").replace(" ", "").lower()
        cx, cy = int(lon / cell), int(lat / cell)
        hit = None
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for m in grid.get((key, cx + dx, cy + dy), []):
                    if haversine_m(lat, lon, m[1], m[2]) <= DEDUPE_METERS:
                        hit = m
                        break
                if hit:
                    break
            if hit:
                break
        if hit:
            if not CJK.search(hit[3]) and CJK.search(addr):
                hit[3] = addr
            continue
        m = list(r)
        grid.setdefault((key, cx, cy), []).append(m)
        out.append(m)
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--release", default="2026-10-21.0")
    ap.add_argument("--out", default=str(Path(__file__).resolve().parent.parent / "api/data/place_index.json.gz"))
    args = ap.parse_args()

    try:
        import duckdb
    except ImportError:
        print("需要 duckdb：pip install duckdb", file=sys.stderr)
        return 2

    con = duckdb.connect()
    con.sql("INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2';")
    src = f"s3://overturemaps-us-west-2/release/{args.release}/theme=places/type=place/*"
    sql = f"""
    SELECT names.primary AS name, taxonomy.primary AS cat, taxonomy.hierarchy[1] AS top,
           bbox.ymin AS lat, bbox.xmin AS lon,
           coalesce(addresses[1].freeform, '') AS addr, coalesce(addresses[1].country, '') AS country,
           coalesce(brand.names.primary, '') AS brand, confidence
    FROM read_parquet('{src}', hive_partitioning=1)
    WHERE bbox.xmin BETWEEN {BBOX['xmin']} AND {BBOX['xmax']}
      AND bbox.ymin BETWEEN {BBOX['ymin']} AND {BBOX['ymax']}
      AND confidence >= {MIN_CONFIDENCE}
      AND coalesce(operating_status, 'open') = 'open'
    """
    rows = con.execute(sql).fetchall()
    print(f"讀到 {len(rows)} 筆", file=sys.stderr)

    kept: list[tuple] = []
    chains = 0
    elsewhere = 0
    for name, cat, top, lat, lon, addr, country, brand, conf in rows:
        name = clean(name)
        if country and country != "TW":
            continue
        if not name or len(name) > MAX_NAME_LEN:
            continue
        if classify(name, brand) is not None:
            chains += 1
            continue
        label = category_label(cat, top)
        if misplaced(name, label):
            elsewhere += 1
            continue
        kept.append((name, lat, lon, clean(addr), label, conf))

    out = dedupe(kept)
    labels = sorted({r[4] for r in out})
    label_idx = {l: i for i, l in enumerate(labels)}
    out.sort(key=lambda r: (r[1], r[2]))
    tz = timezone(timedelta(hours=8))
    doc = {
        "release": args.release,
        "updatedAt": datetime.now(tz).isoformat(timespec="seconds"),
        "source": "Overture Maps Places",
        "license": "CDLA-Permissive-2.0 / Apache-2.0 / CC0-1.0",
        "categories": labels,
        "places": [
            [name, round(lat, 6), round(lon, 6), addr, label_idx[label], int(round(conf * 100))]
            for name, lat, lon, addr, label, conf in out
        ],
    }
    path = Path(args.out)
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = json.dumps(doc, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    # mtime=0：同樣的資料產生同樣的檔案，git diff 才不會每次都變
    with open(path, "wb") as f, gzip.GzipFile(fileobj=f, mode="wb", compresslevel=9, mtime=0) as gz:
        gz.write(raw)
    print(f"排除連鎖店 {chains} 筆、外縣市錯放 {elsewhere} 筆、去重後 {len(out)} 筆 → {path} ({path.stat().st_size/1024/1024:.1f} MB gzip，原始 {len(raw)/1024/1024:.1f} MB)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
