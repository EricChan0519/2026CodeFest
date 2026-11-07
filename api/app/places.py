"""地標、餐廳、學校等地點搜尋（Overture Maps Places 快照，scripts/build_place_index.py 產生）。

為什麼放後端：大臺北約 16 萬筆、JSON 約 12 MB，手機每次下載太重；後端在記憶體比對，只回傳結果。
使用者座標只用來算距離、排序，放在 POST body，不寫進 log（ADR-0005）。

比對規則（字串先正規化：臺／台統一、全形轉半形、去空白標點、「2段」＝「二段」；常見簡稱「北市大」「臺大」也會展開）：
1. 名稱包含搜尋字串；搜尋字串像地址（有路、街、段、巷、號…）時，地址包含也算（地址先拿掉「臺北市○○區」）
2. 沒有 1 的結果：搜尋字串包含整個名稱，例如「台北市立大學天母體育館」找到「天母體育館」
3. 還是沒有：搜尋字串的字和兩字組大部分出現在名稱裡（打錯字、簡稱、字序不同），只留最像的那一群
只取最好的那一層，再依離使用者的距離由近到遠排。搜尋字串夠具體（至少 EXACT_FIRST_MIN_LEN 個字，例如「中正紀念堂」）時，
名稱完全一樣的排最前面；「體育館」「公園」這種通稱不這樣做，一律依距離。
沒給位置就依資料信心排。
"""
from __future__ import annotations

import gzip
import json
import re
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path

from app.errors import ApiError
from app.geo import haversine_m

SOURCE_NAME = "Overture Maps Places"

_PUNCT = re.compile(r"[\s'’‘`\-_.・·,，、()（）\[\]【】「」『』/／&＆:：;；!！?？#＃\"“”]+")
_DIGIT_SECTION = re.compile(r"([1-9])段")
_ZH_DIGITS = "一二三四五六七八九"
# 地址開頭的縣市、行政區：快照的地址多半從路名開始
_ADDR_PREFIX = re.compile(r"^(?:臺灣)?(?:臺北市|新北市|基隆市|桃園市)?(?:[一-鿿]{1,3}區)?")
_ADDR_FLOOR = re.compile(r"(?:\d+樓|\d+f|b\d+).*$")
_ADDRESS_LIKE = re.compile(r"[路街段巷弄號]|大道")
# 常見簡稱 → 全名（正規化後的字串）。只加沒有歧義的
ALIASES = {
    "北市大": "臺北市立大學",
    "臺大": "臺灣大學",
    "師大": "臺灣師範大學",
    "北科大": "臺北科技大學",
    "北科": "臺北科技大學",
    "北醫": "臺北醫學大學",
    "北藝大": "臺北藝術大學",
    "政大": "政治大學",
    "榮總": "榮民總醫院",
    "北車": "臺北車站",
    "北美館": "臺北市立美術館",
    "故宮": "故宮博物院",
}

MIN_SUBSTRING_LEN = 2
MIN_ADDRESS_LEN = 3
MIN_CONTAINED_NAME_LEN = 3
MIN_CONTAINED_RATIO = 0.4
MIN_FUZZY_SCORE = 0.6
# 字的覆蓋率比兩字組寬鬆，打個折
FUZZY_CHAR_WEIGHT = 0.9
FUZZY_BAND = 0.3
MAX_LIMIT = 50
# 搜尋字串至少這麼長，名稱完全一樣的才排最前面（太短的多半是「體育館」這種通稱）
EXACT_FIRST_MIN_LEN = 4


def normalize(s: str) -> str:
    s = unicodedata.normalize("NFKC", s or "").lower().replace("台", "臺")
    s = _PUNCT.sub("", s)
    return _DIGIT_SECTION.sub(lambda m: _ZH_DIGITS[int(m.group(1)) - 1] + "段", s)


def address_query(qn: str) -> str:
    return _ADDR_FLOOR.sub("", _ADDR_PREFIX.sub("", qn))


def bigrams(s: str) -> set[str]:
    return {s[i : i + 2] for i in range(len(s) - 1)}


@dataclass
class PlaceIndex:
    names: list[str] = field(default_factory=list)
    lats: list[float] = field(default_factory=list)
    lons: list[float] = field(default_factory=list)
    addresses: list[str] = field(default_factory=list)
    categories: list[str] = field(default_factory=list)
    category_of: list[int] = field(default_factory=list)
    confidence: list[int] = field(default_factory=list)
    name_keys: list[str] = field(default_factory=list)
    addr_keys: list[str] = field(default_factory=list)
    release: str | None = None
    updated_at: str | None = None
    license: str | None = None
    available: bool = False

    @classmethod
    def from_doc(cls, data: dict) -> "PlaceIndex":
        categories = data["categories"]
        places = data["places"]
        if not isinstance(categories, list) or not isinstance(places, list):
            raise ValueError("快照格式錯誤")
        idx = cls(categories=[str(c) for c in categories], release=data.get("release"),
                  updated_at=data.get("updatedAt"), license=data.get("license"), available=True)
        for name, lat, lon, addr, cat, conf in places:
            if not isinstance(name, str) or not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)):
                raise ValueError("快照格式錯誤")
            if not 0 <= int(cat) < len(categories):
                raise ValueError("快照格式錯誤")
            idx.names.append(name)
            idx.lats.append(float(lat))
            idx.lons.append(float(lon))
            idx.addresses.append(addr or "")
            idx.category_of.append(int(cat))
            idx.confidence.append(int(conf))
            idx.name_keys.append(normalize(name))
            idx.addr_keys.append(normalize(addr or ""))
        return idx

    @classmethod
    def load(cls, path: Path) -> "PlaceIndex":
        try:
            raw = Path(path).read_bytes()
            if raw[:2] == b"\x1f\x8b":
                raw = gzip.decompress(raw)
            return cls.from_doc(json.loads(raw.decode("utf-8")))
        except (OSError, ValueError, TypeError, KeyError, EOFError):
            return cls()

    @property
    def source(self) -> dict:
        return {"name": SOURCE_NAME, "release": self.release, "license": self.license, "updatedAt": self.updated_at}

    def _variants(self, qn: str) -> list[str]:
        out = [qn]
        for short, full in ALIASES.items():
            if short in qn and full not in qn:
                out.append(qn.replace(short, full))
        return out

    def _matches(self, qn: str) -> list[int]:
        """回傳最好那一層的索引（沒排序）"""
        variants = self._variants(qn)
        hits: list[int] = []
        seen: set[int] = set()

        def add(ids):
            for i in ids:
                if i not in seen:
                    seen.add(i)
                    hits.append(i)

        for v in variants:
            if len(v) >= MIN_SUBSTRING_LEN:
                add(i for i, k in enumerate(self.name_keys) if v in k)
            qa = address_query(v)
            if _ADDRESS_LIKE.search(v) and len(qa) >= MIN_ADDRESS_LEN:
                add(i for i, k in enumerate(self.addr_keys) if qa in k)
        if hits:
            return hits

        for v in variants:
            min_len = max(MIN_CONTAINED_NAME_LEN, int(len(v) * MIN_CONTAINED_RATIO + 0.999))
            add(i for i, k in enumerate(self.name_keys) if len(k) >= min_len and k in v)
        if hits:
            return hits

        # 模糊：字的覆蓋率和兩字組比例取大的；只留最像的那一群，避免不相干的地點因為比較近排到前面
        best: dict[int, float] = {}
        for v in variants:
            grams = bigrams(v)
            chars = set(v)
            if len(grams) < 2:
                continue
            for i, k in enumerate(self.name_keys):
                g = sum(x in k for x in grams)
                if g < 2:
                    continue
                score = max(g / len(grams), sum(c in k for c in chars) / len(chars) * FUZZY_CHAR_WEIGHT)
                if score >= MIN_FUZZY_SCORE and score > best.get(i, 0):
                    best[i] = score
        if not best:
            return []
        top = max(best.values())
        return [i for i, sc in best.items() if sc >= top - FUZZY_BAND]

    def search(self, q: str, near: tuple[float, float] | None = None, limit: int = 20) -> list[dict]:
        if not self.available:
            raise ApiError("DATA_UNAVAILABLE", 503)
        qn = normalize(q)
        if not qn:
            raise ApiError("VALIDATION_ERROR", 422)
        hits = self._matches(qn)
        limit = max(1, min(MAX_LIMIT, limit))
        variants = {v for v in self._variants(qn) if len(v) >= EXACT_FIRST_MIN_LEN}

        def key(i: int):
            exact = 0 if self.name_keys[i] in variants else 1
            if near is not None:
                return (exact, haversine_m(near, (self.lats[i], self.lons[i])))
            return (exact, -self.confidence[i], self.names[i])

        ranked = sorted(hits, key=key)[:limit]
        scored = [(haversine_m(near, (self.lats[i], self.lons[i])) if near is not None else None, i) for i in ranked]
        return [self._public(i, d) for d, i in scored]

    def _public(self, i: int, distance: float | None) -> dict:
        return {
            "name": self.names[i],
            "lat": self.lats[i],
            "lon": self.lons[i],
            "address": self.addresses[i] or None,
            "category": self.categories[self.category_of[i]],
            "distanceM": None if distance is None else round(distance),
        }
