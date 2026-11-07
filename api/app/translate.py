"""外語地點搜尋：外語搜尋字串 → 中文（再拿去搜尋），以及中文地名 → 使用者的語言（顯示結果用）。

不用 AI 模型、不呼叫外部服務，全部是規則和開放資料（ADR：執行階段不得呼叫雲端或遠端模型）：
- api/data/place_glossary.json：人工整理的「種類詞」（博物館、公園、車站…）、前綴（國立、市立、捷運）和
  約定俗成的專有名稱（臺灣、臺北、淡水…），每個語言一份。
- api/data/han_readings.json（scripts/build_han_readings.py 從 Unicode Unihan 產生）：每個漢字的
  拼音、韓文漢字音、越南漢越音；日文新字體、簡體 → 繁體。

外語 → 中文（translate_query）：
1. 依文字判斷語言（韓文、泰文、高棉文、假名、越南文的聲調符號、其他拉丁字母、漢字）。
2. 由左到右找最長的詞彙表詞（「대만박물관」→ 대만＝臺灣、박물관＝博物館），剩下的字是專有名稱。
3. 專有名稱用讀音對已知地名（後端的地點快照、公車站名）：韓文比漢字音（지산）和中文音譯（즈산），
   越南文比漢越音（Chi Sơn），英文、印尼文比拼音（Zhishan）；對到的那幾個字就是中文（芝山）。
   泰文、高棉文、日文假名沒有可靠的讀音規則，只翻詞彙表裡有的詞。
4. 中文的順序組回去：前綴 + 專有名稱 + 種類詞（「Museum Nasional Taiwan」→ 國立臺灣博物館）。

中文 → 外語（localize_name）：
只有整個名稱能拆成「前綴 + 一個專有名稱（3 個字以內）+ 種類詞」時才翻譯；專有名稱用該語言慣用的讀音寫法
（英文、印尼文、泰文、高棉文用拼音，韓文用中文音譯，越南文用漢越音，日文直接用漢字）。
拆不出來就不翻，只給讀音（reading），畫面上顯示中文原名＋讀音，不會出現半翻半不翻或亂組的詞。
"""
from __future__ import annotations

import gzip
import json
import os
import re
import unicodedata
from collections import Counter
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parents[1] / "data"
LANGS = ("en", "id", "vi", "th", "ko", "ja")
# 專有名稱最多幾個字才翻譯（臺北的地名多半 2、3 個字：芝山、天母、西門町；再長多半混了沒收錄的普通詞，
# 例如「臺大綜合體育館」的「綜合」、「臺北榮民總醫院」的「榮民總」，硬拼成拼音會變成看不懂的字）
MAX_PROPER_CHARS = 3
# 翻不出來時，名稱在這個字數以內才給讀音
MAX_READING_CHARS = 6
# 讀音比對：至少對到幾個字，避免一個音節配到一大堆地名
MIN_MATCH_CHARS = 2
MAX_CANDIDATES = 3
# 讀音對到的候選先多留幾個，最後依「整串組起來的中文」在實際地名裡出現幾次挑
# （정치 → 精緻 在店名裡很常見，但「政治大學」才是真的地名）
MAX_READING_CANDIDATES = 8
# 種類詞放在專有名稱前面的語言（Bảo tàng Đài Loan、Museum Taiwan、พิพิธภัณฑ์…）
HEAD_FIRST = {"vi", "id", "th"}

# ---------------------------------------------------------------- 文字、語言判斷

_HANGUL = re.compile(r"[가-힣]")
_THAI = re.compile(r"[฀-๿]")
_KANA = re.compile(r"[぀-ヿ]")
_HAN = re.compile(r"[㐀-鿿豈-﫿]")
_LATIN = re.compile(r"[a-zA-ZÀ-ɏḀ-ỿ]")
# 越南文才有的字母或聲調（ă â đ ê ô ơ ư 和 ạ ả ã 等）
_VIET = re.compile(r"[ăâđêôơưĂÂĐÊÔƠỰ̀́̃̉]|[Ạ-ỹ]")


def detect_lang(q: str) -> str:
    """回傳 ko、th、ja、vi、latin（英文或印尼文，translate_query 再細分）或 zh"""
    if _HANGUL.search(q):
        return "ko"
    if _THAI.search(q):
        return "th"
    if _KANA.search(q):
        return "ja"
    if _HAN.search(q):
        return "zh"
    if _VIET.search(unicodedata.normalize("NFD", q)) or _VIET.search(q):
        return "vi"
    if _LATIN.search(q):
        return "latin"
    return "zh"


def fold(s: str) -> str:
    """拉丁字母去掉聲調、大小寫（Đài Loan → dai loan）"""
    s = unicodedata.normalize("NFD", s.lower()).replace("đ", "d").replace("đ", "d")
    return unicodedata.normalize("NFC", "".join(c for c in s if not unicodedata.combining(c)))


def is_han(ch: str) -> bool:
    return bool(_HAN.match(ch))


# ---------------------------------------------------------------- 資料

@dataclass(frozen=True)
class Term:
    zh: str
    kind: str  # prefix / proper / head
    forms: dict  # lang -> [寫法…]，第一個用來顯示


@lru_cache(maxsize=1)
def load_base_glossary() -> list[Term]:
    """人工整理的詞彙表（api/data/place_glossary.json）"""
    path = Path(os.environ.get("PLACE_GLOSSARY_PATH") or DATA_DIR / "place_glossary.json")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return [Term(t["zh"], t["kind"], {lang: list(t.get(lang) or []) for lang in LANGS}) for t in data["terms"]]
    except (OSError, ValueError, KeyError, TypeError):
        return []


@lru_cache(maxsize=1)
def load_glossary() -> list[Term]:
    """詞彙表＋臺北捷運站的官方站名（2026-11-08 回報：雙連等站名要用官方翻譯）"""
    base = load_base_glossary()
    return base + station_terms(frozenset(t.zh for t in base))


@lru_cache(maxsize=1)
def metro_station_names() -> tuple[tuple[str, str, str], ...]:
    """捷運站的官方中英文站名（scripts/build_metro_index.py 從 TDX 產生的 api/data/metro_index.json）"""
    path = Path(os.environ.get("METRO_INDEX_PATH") or DATA_DIR / "metro_index.json")
    try:
        out = {}
        for st in json.loads(path.read_text(encoding="utf-8"))["stations"]:
            zh, en = st["name"]["zh"], st["name"].get("en")
            if zh and en:
                out.setdefault(zh.replace("台", "臺"), (en.strip(), zh))
        return tuple((k, en, orig) for k, (en, orig) in sorted(out.items()))
    except (OSError, ValueError, KeyError, TypeError):
        return ()


_PINYIN_SYLLABLES: frozenset[str] | None = None


def _split_official_pinyin(en: str, n: int) -> list[str] | None:
    """官方英文站名（Dingpu、Shuanglian）切成 n 個拼音音節；不是拼音（Taipei Main Station）回 None"""
    global _PINYIN_SYLLABLES
    if _PINYIN_SYLLABLES is None:
        _PINYIN_SYLLABLES = frozenset(load_readings().pinyin.values()) | {"lv", "nv"}
    letters = re.sub(r"[^a-z]", "", fold(en))
    if not letters:
        return None

    @lru_cache(maxsize=None)
    def go(i: int, k: int) -> tuple[str, ...] | None:
        if i == len(letters):
            return () if k == 0 else None
        if k == 0:
            return None
        for j in range(min(len(letters), i + 6), i, -1):
            syl = letters[i:j]
            if syl in _PINYIN_SYLLABLES:
                rest = go(j, k - 1)
                if rest is not None:
                    return (syl,) + rest
        return None

    found = go(0, n)
    return list(found) if found else None


def station_terms(skip: frozenset[str]) -> list[Term]:
    """每個捷運站一個專有名稱：英、印尼、越、泰、高棉文用官方英文站名；韓文照官方英文的拼音轉成韓文
    （頂埔 Dingpu → 딩푸，不會因為「埔」有兩個讀音變成 딩부）；日文用漢字。
    官方英文是意譯的（台北車站 Taipei Main Station），韓文照原本的詞彙表組（타이베이역）。"""
    out = []
    for zh, en, original in metro_station_names():
        if zh in skip or "/" in zh:
            continue
        han = [c for c in zh if is_han(c)]
        syl = _split_official_pinyin(en, len(han)) if len(han) == len(zh) else None
        # 切出來的音節要有一半以上和那個字的讀音一樣，才算是拼音（Taipei Arena 也切得成 tai pei a ren a，但不是）
        if syl and sum(a == load_readings().pinyin.get(c) for a, c in zip(syl, zh)) * 2 < len(zh):
            syl = None
        th = en
        if syl:
            parts = [pinyin_to_hangul(x) for x in syl]
            ko = "".join(parts) if None not in parts else None
            thai = [pinyin_to_thai(x) for x in syl]
            if None not in thai:
                th = "".join(thai)  # 泰文照官方拼音轉成泰文（Zhishan → จือซาน）
        else:
            ko = localize_name(zh, "ko", base_only=True)["text"] or romanize(zh, "ko")
            # 泰文：官方英文是意譯的（NTU Hospital）也照泰文組，不留英文
            th = localize_name(zh, "th", base_only=True)["text"] or romanize(zh, "th") or en
        if not ko:
            continue
        forms = {lang: [en] for lang in ("en", "id")}
        # 越南文：不在車站的名稱（士林夜市、士林區）用漢越音 Sĩ Lâm；是車站時 localize_name 換成官方站名
        forms["vi"] = [(romanize(zh, "vi") if syl else None) or en]
        forms["th"] = [th]
        forms["ko"] = [ko]
        # 日文：台北車站 → 台北駅（日本人的說法），其他站名用漢字
        forms["ja"] = [re.sub(r"車站$", "駅", original)]
        out.append(Term(zh, "proper", forms))
    return out


@dataclass
class Readings:
    pinyin: dict[str, str]
    hangul: dict[str, list[str]]
    viet: dict[str, list[str]]
    jp: dict[str, str]
    s2t: dict[str, str]
    available: bool = True


_VIET_FIX = {"好": ["hảo"], "樂": ["lạc"], "行": ["hành"], "長": ["trường"], "重": ["trùng"]}


@lru_cache(maxsize=1)
def load_readings() -> Readings:
    path = Path(os.environ.get("HAN_READINGS_PATH") or DATA_DIR / "han_readings.json")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        chars = data["chars"]
        return Readings(
            pinyin={c: v[0] for c, v in chars.items() if v[0]},
            hangul={c: v[1] for c, v in chars.items() if v[1]},
            # 漢越音有好幾個時 Unihan 不一定把常用的放第一個：好 = hảo（不是 háo）
            viet={**{c: v[2] for c, v in chars.items() if v[2]}, **_VIET_FIX},
            jp=data.get("jp") or {},
            s2t=data.get("s2t") or {},
        )
    except (OSError, ValueError, KeyError, TypeError, IndexError):
        return Readings({}, {}, {}, {}, {}, available=False)


@lru_cache(maxsize=1)
def load_gazetteer() -> tuple[str, ...]:
    """已知的中文地名：後端地點快照＋公車站名（去重）"""
    names: set[str] = set()
    place = Path(os.environ.get("PLACE_INDEX_PATH") or DATA_DIR / "place_index.json.gz")
    try:
        raw = place.read_bytes()
        if raw[:2] == b"\x1f\x8b":
            raw = gzip.decompress(raw)
        names.update(p[0] for p in json.loads(raw.decode("utf-8"))["places"] if isinstance(p[0], str))
    except (OSError, ValueError, KeyError, TypeError, EOFError):
        pass
    stops = Path(os.environ.get("STOP_INDEX_PATH") or DATA_DIR / "stop_index.json")
    try:
        names.update(s["name"]["zh"] for s in json.loads(stops.read_text(encoding="utf-8"))["stations"])
    except (OSError, ValueError, KeyError, TypeError):
        pass
    return tuple(sorted(n.replace("台", "臺") for n in names))


# 日文和中文意思不同、不能逐字換的字（駅 是車站，不是「驛」）
_JA_WORDS = {"駅": "站"}


def sources() -> list[dict]:
    """給畫面標示出處"""
    return [
        {"name": "Unicode Unihan Database", "license": "Unicode License v3"},
        {"name": "OpenCC", "license": "Apache-2.0"},
        {"name": "地點詞彙表（人工整理）", "license": "AGPL-3.0"},
    ]


@lru_cache(maxsize=1)
def _taiwan_chars() -> frozenset[str]:
    """公車站官方名稱用到的字（全是臺灣的正體字）：這些字不用換"""
    return frozenset("".join(english_names()[0].keys()))


@lru_cache(maxsize=1)
def _to_shinjitai() -> dict[str, str]:
    """繁體 → 日文新字體（JPShinjitaiCharacters 反過來：學 → 学、藝 → 芸）"""
    return {trad: jp for jp, trad in load_readings().jp.items() if len(trad) == 1}


def to_japanese(s: str) -> str:
    """日文顯示：繁體字換成日文的寫法（中山駅裝置藝術街 → 中山駅装置芸術街）"""
    table = _to_shinjitai()
    return "".join(table.get(c, c) for c in s).replace("臺", "台")


def to_traditional(s: str) -> str:
    r = load_readings()
    keep = _taiwan_chars()
    return "".join(_JA_WORDS.get(c) or (c if c in keep else r.jp.get(c) or r.s2t.get(c)) or c for c in s).replace("台", "臺")


# ---------------------------------------------------------------- 韓文

_JUNG_Y = {2, 3, 6, 7, 12, 17, 20}  # ㅑ ㅒ ㅕ ㅖ ㅛ ㅠ ㅣ：頭音法則會改變的母音


def _syllable(cho: int, jung: int, jong: int = 0) -> str:
    return chr(0xAC00 + (cho * 21 + jung) * 28 + jong)


def hangul_loose(s: str) -> str:
    """把頭音法則的差別抹平（리/이、룡/용、녀/여 視為一樣），只用來比對"""
    out = []
    for ch in s:
        code = ord(ch) - 0xAC00
        if not 0 <= code < 11172:
            out.append(ch)
            continue
        cho, jung, jong = code // 588, (code % 588) // 28, code % 28
        if cho == 5:  # ㄹ
            cho = 11 if jung in _JUNG_Y else 2
        if cho == 2 and jung in _JUNG_Y:  # ㄴ
            cho = 11
        out.append(_syllable(cho, jung, jong))
    return "".join(out)


# 漢語拼音 → 韓文（國立國語院「外來語表記法」中文部分）
_INITIALS = ("zh", "ch", "sh", "b", "p", "m", "f", "d", "t", "n", "l", "g", "k", "h", "j", "q", "x", "r", "z", "c", "s")
_CHO = {"b": 7, "p": 17, "m": 6, "f": 17, "d": 3, "t": 16, "n": 2, "l": 5, "g": 0, "k": 15, "h": 18,
        "j": 12, "q": 14, "x": 9, "zh": 12, "ch": 14, "sh": 9, "r": 5, "z": 13, "c": 14, "s": 10, "": 11}
_FINALS = {
    "a": [(0, 0)], "o": [(8, 0)], "e": [(4, 0)], "ai": [(0, 0), (20, 0)], "ei": [(5, 0), (20, 0)],
    "ao": [(0, 0), (8, 0)], "ou": [(4, 0), (13, 0)], "an": [(0, 4)], "en": [(4, 4)], "ang": [(0, 21)],
    "eng": [(4, 21)], "ong": [(13, 21)], "er": [(4, 8)],
    "i": [(20, 0)], "ia": [(2, 0)], "ie": [(7, 0)], "iao": [(2, 0), (8, 0)], "iu": [(17, 0)], "ian": [(7, 4)],
    "in": [(20, 4)], "iang": [(2, 21)], "ing": [(20, 21)], "iong": [(17, 21)],
    "u": [(13, 0)], "ua": [(9, 0)], "uo": [(14, 0)], "uai": [(9, 0), (20, 0)], "ui": [(13, 0), (20, 0)],
    "uan": [(9, 4)], "un": [(13, 4)], "uang": [(9, 21)], "ueng": [(14, 21)],
    "v": [(16, 0)], "ve": [(15, 0)], "van": [(16, 0), (0, 4)], "vn": [(16, 4)],
}
_PALATAL = {2: 0, 3: 1, 6: 4, 7: 5, 12: 8, 17: 13}  # ㅈ ㅊ ㅉ 後面 ㅑ→ㅏ、ㅕ→ㅓ、ㅖ→ㅔ…


def _split_pinyin(py: str) -> tuple[str, str, bool]:
    """回傳 (聲母, 韻母, 是否零聲母)；y、w 開頭的寫法還原成 i、u、ü"""
    if py.startswith("y"):
        rest = py[1:]
        if py in ("yu", "yue", "yuan", "yun"):
            return "", "v" + py[2:], True
        if rest.startswith("i"):
            return "", rest, True
        if rest == "ou":
            return "", "iu", True
        return "", "i" + rest, True
    if py.startswith("w"):
        rest = py[1:]
        if rest == "u":
            return "", "u", True
        mapped = {"ei": "ui", "en": "un", "eng": "ueng"}.get(rest)
        return "", mapped or "u" + rest, True
    for ini in _INITIALS:
        if py.startswith(ini):
            fin = py[len(ini):]
            if ini in ("j", "q", "x") and fin.startswith("u"):
                fin = "v" + fin[1:]
            return ini, fin, False
    return "", py, True


def pinyin_to_hangul(py: str) -> str | None:
    ini, fin, zero = _split_pinyin(py)
    if ini in ("zh", "ch", "sh", "r", "z", "c", "s") and fin == "i":
        parts = [(18, 0)]  # 즈 츠 스 르 쯔 츠 쓰
    elif zero and fin == "ui":
        parts = [(15, 0), (20, 0)]  # wei → 웨이
    elif zero and fin == "un":
        parts = [(14, 4)]  # wen → 원
    else:
        parts = _FINALS.get(fin)
    if not parts:
        return None
    cho = _CHO[ini]
    out = []
    for i, (jung, jong) in enumerate(parts):
        if i == 0 and cho in (12, 13, 14):
            jung = _PALATAL.get(jung, jung)
        out.append(_syllable(cho if i == 0 else 11, jung, jong))
    return "".join(out)


# 漢語拼音 → 泰文（2026-11-08 回報：泰文結果英文太多；照泰國常見的中文地名寫法，不標聲調）
_TH_INI = {"b": "บ", "p": "พ", "m": "ม", "f": "ฟ", "d": "ต", "t": "ท", "n": "น", "l": "ล", "g": "ก", "k": "ค", "h": "ฮ",
           "j": "จ", "q": "ช", "x": "ซ", "zh": "จ", "ch": "ช", "sh": "ซ", "r": "ร", "z": "จ", "c": "ช", "s": "ซ", "": "อ"}
# {C} 是聲母
_TH_FIN = {
    "a": "{C}า", "o": "{C}อ", "e": "เ{C}อ", "ai": "ไ{C}", "ei": "เ{C}ย", "ao": "เ{C}า", "ou": "โ{C}ว", "an": "{C}าน",
    "en": "เ{C}ิน", "ang": "{C}าง", "eng": "เ{C}ิง", "ong": "{C}ง", "er": "เออร์",
    "i": "{C}ี", "ia": "เ{C}ีย", "ie": "เ{C}ีย", "iao": "เ{C}ียว", "iu": "{C}ิว", "ian": "เ{C}ียน", "in": "{C}ิน",
    "iang": "เ{C}ียง", "ing": "{C}ิง", "iong": "{C}ยง",
    "u": "{C}ู", "ua": "{C}วา", "uo": "{C}วอ", "uai": "{C}วาย", "ui": "{C}ุย", "uan": "{C}วน", "un": "{C}ุน",
    "uang": "{C}วง", "ueng": "เวิง",
    "v": "{C}วี", "ve": "เ{C}วีย", "van": "เ{C}วียน", "vn": "{C}วิน",
}


def pinyin_to_thai(py: str) -> str | None:
    ini, fin, zero = _split_pinyin(py)
    if ini in ("zh", "ch", "sh", "r", "z", "c", "s") and fin == "i":
        pattern = "{C}ือ"  # zhi จือ、shi ซือ
    elif zero and fin == "ui":
        pattern = "เว่ย"
    elif zero and fin == "un":
        pattern = "เวิน"
    else:
        pattern = _TH_FIN.get(fin)
    if not pattern:
        return None
    return pattern.replace("{C}", _TH_INI[ini])


# ---------------------------------------------------------------- 讀音

@lru_cache(maxsize=None)
def char_readings(ch: str, system: str) -> list[str]:
    """某個字在某種讀音系統的寫法（比對用，小寫、無聲調）"""
    r = load_readings()
    if system == "pinyin":
        p = r.pinyin.get(ch)
        return [p] if p else []
    if system == "ko_sino":
        return [hangul_loose(h) for h in r.hangul.get(ch, [])][:1]
    if system == "ko_sino2":
        # 第二個讀音（北 = 배／북，Unihan 把 배 放前面）；只有一個讀音的字照用那個
        hs = [hangul_loose(h) for h in r.hangul.get(ch, [])]
        return hs[-1:] if hs else []
    if system == "ko_mandarin":
        p = r.pinyin.get(ch)
        h = pinyin_to_hangul(p) if p else None
        return [h] if h else []
    if system == "viet":
        return [fold(v) for v in r.viet.get(ch, [])][:1]
    return []


@lru_cache(maxsize=8)
def _reading_table(system: str) -> tuple[tuple[str, tuple[int, ...]], ...]:
    """每個已知地名的讀音字串，以及每個字的讀音在字串裡從哪裡開始（拿來把對到的讀音換回漢字）"""
    sep = " " if system == "viet" else ""
    out = []
    for name in load_gazetteer():
        text = ""
        starts = []
        for ch in name:
            starts.append(len(text))
            rs = char_readings(ch, system) if is_han(ch) else []
            text += (rs[0] if rs else "\x00") + sep
        starts.append(len(text))
        out.append((text, tuple(starts)))
    return tuple(out)


def match_by_reading(reading: str, system: str) -> list[tuple[str, int]]:
    """在已知地名裡找讀音等於 reading 的連續漢字；回傳 [(漢字, 出現次數)]，常見的排前面"""
    if system == "viet":
        reading = " ".join(reading.split()) + " "
    if not reading.strip():
        return []
    names = load_gazetteer()
    counts: Counter[str] = Counter()
    for (text, starts), name in zip(_reading_table(system), names):
        pos = text.find(reading)
        while pos != -1:
            if pos in starts:
                a = starts.index(pos)
                end = pos + len(reading)
                if end in starts:
                    b = starts.index(end)
                    if b - a >= MIN_MATCH_CHARS:
                        counts[name[a:b]] += 1
            pos = text.find(reading, pos + 1)
    return counts.most_common(MAX_READING_CANDIDATES)


# ---------------------------------------------------------------- 外語 → 中文

@dataclass
class Segment:
    text: str
    kind: str  # prefix / proper / head / unknown
    zh: list[str]  # 候選中文，第一個最好；unknown 沒有
    via: str  # glossary / reading / hanzi / none


def _lang_pool(lang: str) -> list[str]:
    if lang == "latin":
        return ["en", "id", "vi"]
    if lang == "vi":
        return ["vi", "en"]
    return [lang]


def _glossary_forms(lang: str, word_level: bool) -> list[tuple[str, Term]]:
    out = []
    tones = lang == "vi"
    for term in load_glossary():
        for code in _lang_pool(lang):
            for form in term.forms.get(code, []):
                key = _match_key(form, word_level, tones)
                if key:
                    out.append((key, term))
    # 長的寫法先比；同一個寫法對到好幾個詞時取中文最短的（역 → 站 而不是 車站，야시장 → 夜市）
    out.sort(key=lambda x: (-len(x[0]), len(x[1].zh)))
    return out


def _tone_words(s: str) -> list[str]:
    """越南文：保留聲調，只轉小寫、拿掉標點"""
    return re.findall(r"[0-9a-zà-ỹđ]+", unicodedata.normalize("NFC", s.lower()))


def _match_key(s: str, word_level: bool, tones: bool = False) -> str:
    if word_level:
        if tones:
            return " ".join(_tone_words(s))
        return " ".join(re.findall(r"[0-9a-z]+", fold(s)))
    return re.sub(r"\s+", "", s.lower())


def _scan(q: str, lang: str) -> list[tuple[str, Term | None]]:
    """由左到右找最長的詞彙表詞；回傳 [(原文片段, 詞或 None)]"""
    word_level = lang in ("latin", "vi")
    forms = _glossary_forms(lang, word_level)
    if word_level:
        units = _tone_words(q) if lang == "vi" else re.findall(r"[0-9a-z]+", fold(q))
        joiner = " "
    else:
        units = list(re.sub(r"\s+", "", q.lower()))
        joiner = ""
    out: list[tuple[str, Term | None]] = []
    residual: list[str] = []
    i = 0
    while i < len(units):
        hit = None
        for key, term in forms:
            n = len(key.split(" ")) if word_level else len(key)
            if joiner.join(units[i:i + n]) == key:
                # 一個字的種類詞（산＝山、사＝寺、역＝站）只接在認得的詞（타이베이역）或兩個字以上的
                # 專有名稱後面，否則「즈산」會被切成「즈」＋「山」
                after_term = not residual and bool(out) and out[-1][1] is not None
                at_end = i + n == len(units)
                if not word_level and n == 1 and term.kind == "head" and (not at_end or (len(residual) < 2 and not after_term)):
                    continue
                hit = (key, term, n)
                break
        if hit:
            if residual:
                out.append((joiner.join(residual), None))
                residual = []
            out.append((hit[0], hit[1]))
            i += hit[2]
        else:
            residual.append(units[i])
            i += 1
    if residual:
        out.append((joiner.join(residual), None))
    return out


# 第二、第三個候選至少要有第一個的這個比例才留下（「즈산」→ 芝山 很常見，至善、指山 很少）
MIN_ALT_SHARE = 0.25


def _resolve(text: str, lang: str) -> Segment:
    if _HAN.search(text) and lang in ("zh", "ja"):
        return Segment(text, "proper", [to_traditional(text)], "hanzi")
    systems: list[str] = []
    if lang == "ko":
        systems = ["ko_mandarin", "ko_sino", "ko_sino2"]  # 즈산（中文音譯）和 지산（韓文漢字音）都要能找到 芝山
    elif lang == "vi":
        systems = ["viet", "pinyin"]
    elif lang == "latin":
        systems = ["pinyin", "viet"]
    counts: Counter[str] = Counter()
    for system in systems:
        if system in ("ko_sino", "ko_sino2"):
            key = hangul_loose(text)
        elif system == "pinyin":
            key = re.sub(r"[^a-z]", "", fold(text)).replace("ü", "v")
            if len(key) < 3:
                continue
        elif system == "viet":
            key = " ".join(re.findall(r"[a-z]+", fold(text)))
        else:
            key = text
        for zh, n in match_by_reading(key, system):
            counts[zh] = max(counts[zh], n)
    if not counts:
        return Segment(text, "unknown", [], "none")
    zh = [z for z, _ in counts.most_common(MAX_READING_CANDIDATES)]
    return Segment(text, "proper", zh, "reading")


MAX_COMBINATIONS = 24


_NAME_WRAP = re.compile(r"^(?:臺北捷運|捷運|臺鐵|公車)|[(（].*$")
STRONG_WEIGHT = 20


@lru_cache(maxsize=2048)
def _name_count(text: str) -> int:
    """這串中文像不像真的地名：名稱本身（拿掉 捷運、括號後）就是它，一個算 20；只是包含它，一個算 1。
    「橋和站」是站名本身，「…橋火車站」只是某個名稱的一部分（2026-11-08 掃描所有捷運站時發現）"""
    total = 0
    for name in load_gazetteer():
        if text in name:
            total += STRONG_WEIGHT if _NAME_WRAP.sub("", name) == text else 1
    return total


def _assemble(ordered: list[Segment]) -> list[str]:
    """依中文順序組出搜尋字串；每段有好幾個候選時全部組合，實際地名裡最常出現的排前面"""
    combos = [""]
    for seg in ordered:
        combos = [c + z for c in combos for z in seg.zh][:MAX_COMBINATIONS]
    combos = [c for i, c in enumerate(combos) if c and c not in combos[:i]]
    if len(combos) <= 1 and not any(seg.via == "reading" for seg in ordered):
        return combos
    counts = {c: _name_count(c) for c in combos}
    ranked = sorted(combos, key=lambda c: -counts[c])  # sorted 是穩定的：一樣多時維持原本（常見的讀音在前）的順序
    top = counts[ranked[0]]
    if top == 0:
        # 用讀音湊出來、卻沒有任何地名用到的組合（Chengchi → 城池大學）是亂猜的，不要
        if any(seg.via == "reading" for seg in ordered):
            return []
        return ranked[:MAX_CANDIDATES]
    return [c for c in ranked if counts[c] >= top * MIN_ALT_SHARE][:MAX_CANDIDATES]


_EN_ABBREV = {"u": "university", "univ": "university", "sta": "station", "rd": "road", "st": "street",
              "nat'l": "national", "natl": "national", "jr": "junior", "sr": "senior", "elem": "elementary",
              "hosp": "hospital", "dist": "district", "sec": "section", "ln": "lane", "aly": "alley", "admin": "administration"}
_PAREN = re.compile(r"\s*[(（].*?[)）]\s*")


def _en_key(s: str) -> str:
    words = re.findall(r"[0-9a-z']+", fold(s))
    return " ".join(_EN_ABBREV.get(w, w).replace("'", "") for w in words)


@lru_cache(maxsize=1)
def english_names() -> tuple[dict[str, str], tuple[tuple[str, str], ...]]:
    """TDX 公車站的官方英文站名（政大 = National Chengchi University、淡水 = Tamsui）：
    回傳 (中文 → 英文, [(英文比對字串, 中文)])。括號裡的方位（忠孝、承德）拿掉。"""
    path = Path(os.environ.get("STOP_INDEX_PATH") or DATA_DIR / "stop_index.json")
    zh2en: dict[str, str] = {}
    pairs: dict[str, Counter] = {}
    try:
        for st in json.loads(path.read_text(encoding="utf-8"))["stations"]:
            zh, en = st["name"]["zh"], st["name"].get("en")
            if not zh or not en:
                continue
            zh, en = _PAREN.sub("", zh).replace("台", "臺"), _PAREN.sub("", en).strip()
            if not zh or not en:
                continue
            zh2en.setdefault(zh, en)
            pairs.setdefault(_en_key(en), Counter())[zh] += 1
    except (OSError, ValueError, KeyError, TypeError):
        pass
    flat = tuple((k, c.most_common(1)[0][0]) for k, c in pairs.items() if k)
    return zh2en, flat


def match_english_name(q: str) -> list[str]:
    """英文搜尋字串對官方英文站名（字要整個對上，順序一樣）：「Chengchi University」→ 政大"""
    qk = _en_key(q)
    if len(qk) < 4:
        return []
    exact, partial = [], []
    for key, zh in english_names()[1]:
        if key == qk:
            exact.append(zh)
        elif f" {qk} " in f" {key} ":
            partial.append((len(key), zh))
    partial.sort()
    out: list[str] = []
    for zh in exact + [z for _, z in partial]:
        if zh not in out:
            out.append(zh)
    return out[:MAX_CANDIDATES]


def _merge_short_unknown(segments: list[Segment], lang: str) -> list[Segment]:
    """看不懂的一小段接在認得的專有名稱後面時，連在一起用讀音再找一次：
    타이베이＋차오 → 臺北橋（차오 只有一個字，單獨找不到）"""
    out: list[Segment] = []
    for seg in segments:
        prev = out[-1] if out else None
        # 用讀音湊出來的一小段（차오 → 車五）也一樣：先試著和前面連起來
        loose = seg.kind == "unknown" or (seg.kind == "proper" and seg.via == "reading")
        if loose and prev is not None and prev.kind == "proper":
            merged = _resolve(prev.text + seg.text, lang)
            if merged.kind == "proper":
                out[-1] = merged
                continue
        out.append(seg)
    return out


def _heads_in_chinese_order(segments: list[Segment]) -> list[Segment]:
    """種類詞換成中文的順序：在名稱後面的照原順序（Daan Park Station → 大安公園站）；
    在名稱前面的（越南、印尼、泰、高棉文）倒過來（Ga Công viên Đại Hồ → 大湖公園站）"""
    first_name = next((i for i, s in enumerate(segments) if s.kind in ("proper", "unknown")), len(segments))
    before = [s for s in segments[:first_name] if s.kind == "head"]
    after = [s for s in segments[first_name:] if s.kind == "head"]
    return after + before[::-1]


def _guess_latin(segments: list[Segment]) -> str:
    """拉丁字母的搜尋字串是英文還是印尼文：看對到的詞彙表寫法只出現在哪一種語言（Masjid、Pasar Malam → id）"""
    votes = Counter()
    by_zh = {t.zh: t for t in load_glossary()}
    for s in segments:
        if s.via != "glossary":
            continue
        term = by_zh.get(s.zh[0])
        if not term:
            continue
        key = _match_key(s.text, True)
        in_en = any(_match_key(f, True) == key for f in term.forms.get("en", []))
        in_id = any(_match_key(f, True) == key for f in term.forms.get("id", []))
        if in_id and not in_en:
            votes["id"] += 1
        elif in_en and not in_id:
            votes["en"] += 1
    return "id" if votes["id"] > votes["en"] else "en"


def translate_query(q: str) -> dict:
    """外語搜尋字串 → 中文搜尋字串（最多 3 個，最可能的在前）"""
    q = (q or "").strip()
    lang = detect_lang(q)
    if lang == "zh":
        zh = to_traditional(q)
        return {"lang": "zh", "queries": [zh] if zh != q else [], "partial": False, "segments": []}
    segments: list[Segment] = []
    word_level = lang in ("latin", "vi")
    forms = _glossary_forms(lang, word_level)
    for text, term in _scan(q, lang):
        if term is None:
            segments.append(_resolve(text, lang))
        else:
            # 同一個寫法對到的所有中文（역 → 站、車站；야시장 → 夜市、觀光夜市），短的在前，之後依實際地名挑
            options = []
            for key, other in forms:
                if key == text and other.kind == term.kind and other.zh not in options:
                    options.append(other.zh)
            segments.append(Segment(text, term.kind, options or [term.zh], "glossary"))

    segments = _merge_short_unknown(segments, lang)
    prefixes = [s for s in segments if s.kind == "prefix"]
    propers = [s for s in segments if s.kind == "proper"]
    heads = _heads_in_chinese_order(segments)
    unknown = [s for s in segments if s.kind == "unknown"]
    display = lang
    if lang == "latin":
        display = _guess_latin(segments)

    queries = _assemble(prefixes + propers + heads)
    if not queries and propers and heads:
        # 「士林公車站」這種組法沒有任何地名用到：只用地名找（Shilin bus stop → 士林）
        queries = _assemble(prefixes + propers) or _assemble(propers)
    if not queries and propers:
        unknown = unknown + [p for p in propers if p.via == "reading"]
    if lang in ("latin", "vi"):
        # 官方英文站名（非拼音的舊拼法也對得上：Chengchi、Tamsui）；完全一樣的排最前面
        official = match_english_name(q)
        if official and (not queries or unknown or _en_key(q) in {k for k, _ in english_names()[1]}):
            queries = official + [x for x in queries if x not in official]
            unknown = []
        elif official:
            queries = queries + [x for x in official if x not in queries]
    return {
        "lang": display,
        "queries": queries[:MAX_CANDIDATES],
        "partial": bool(unknown),
        "segments": [{"text": s.text, "kind": s.kind, "zh": s.zh, "via": s.via} for s in segments],
    }


# ---------------------------------------------------------------- 中文 → 外語

def _zh_terms(base_only: bool = False) -> list[Term]:
    return sorted(load_base_glossary() if base_only else load_glossary(), key=lambda t: -len(t.zh))


_TRANSIT_WORDS = ("捷運", "臺鐵", "台鐵", "高鐵", "輕軌", "公車", "客運", "機捷")
_STOP_CORE = re.compile(r"\(.*?\)|（.*?）|捷運|臺鐵|台鐵|高鐵|輕軌|公車|客運|車站|站|[一二三四五六七八九十0-9]+$")


@lru_cache(maxsize=1)
def _known_stop_places() -> frozenset[str]:
    """公車站、捷運站名拿掉 捷運、站、括號之後的地名（芝山、士林、臺北）"""
    return frozenset(c for c in (_STOP_CORE.sub("", zh) for zh in english_names()[0]) if len(c) >= 2)


def _station_context(name: str, residual: str, out: list) -> bool:
    if any(w in name for w in _TRANSIT_WORDS):
        return True
    if out and out[-1][1] is not None and out[-1][1].kind == "proper":
        return True  # 臺北站、新北站
    before = "".join(text for text, _ in out) + residual
    known = _known_stop_places()
    # 前面那一段、或整個名稱到「站」之前（大安森林公園站）是認得的站名
    return residual.replace("台", "臺") in known or before.replace("台", "臺") in known


def _merge_prefix_head(segs: list[tuple[str, Term | None]]) -> list[tuple[str, Term | None]]:
    """前綴＋最後的種類詞合起來是一個詞時用那個詞：公車＋…＋站 → 公車站（Trạm xe buýt，不是 Ga Xe buýt）"""
    if len(segs) < 2 or segs[0][1] is None or segs[-1][1] is None:
        return segs
    first, last = segs[0][1], segs[-1][1]
    if first.kind != "prefix" or last.kind != "head":
        return segs
    merged = next((t for t in load_base_glossary() if t.zh == first.zh + last.zh and t.kind == "head"), None)
    if merged is None:
        return segs
    return segs[1:-1] + [(merged.zh, merged)]


def _segment_zh(name: str, base_only: bool = False) -> list[tuple[str, Term | None]]:
    terms = _zh_terms(base_only)
    out: list[tuple[str, Term | None]] = []
    residual = ""
    i = 0
    while i < len(name):
        hit = None
        for t in terms:
            if name.startswith(t.zh, i):
                # 一個字的種類詞（山、寺、店、站）只算在名稱最後，而且前面要有東西；
                # 「龍山寺」的「山」、「芝山岩」的「山」是名稱的一部分
                after_term = not residual and bool(out) and out[-1][1] is not None
                at_end = i + 1 == len(name)
                if len(t.zh) == 1 and t.kind == "head" and (not at_end or (len(residual) < 2 and not after_term)):
                    continue
                # 「站」只在交通的地方才是車站：前面是認得的地名（芝山、臺北），或名稱有 捷運、臺鐵、公車…；
                # 「芝山抽水站」「某某工作站」不是車站（2026-11-08 回報：芝山抽水站 → 즈산 처우수이역）
                if t.zh == "站" and not _station_context(name, residual, out):
                    continue
                hit = t
                break
        if hit:
            if residual:
                out.append((residual, None))
                residual = ""
            out.append((hit.zh, hit))
            i += len(hit.zh)
        else:
            residual += name[i]
            i += 1
    if residual:
        out.append((residual, None))
    return out


def romanize(text: str, lang: str, spaced: bool = False) -> str | None:
    """專有名稱的讀音寫法；有讀不出來的字回 None。spaced：拼音每個音節分開（整個店名的讀音用）"""
    r = load_readings()
    if lang == "ja":
        return text
    syllables = []
    for ch in text:
        if not is_han(ch):
            if ch.isascii() and ch.isalnum():
                syllables.append(ch)
                continue
            return None
        if lang == "ko":
            p = r.pinyin.get(ch)
            h = pinyin_to_hangul(p) if p else None
            if not h:
                return None
            syllables.append(h)
        elif lang == "th":
            p = r.pinyin.get(ch)
            h = pinyin_to_thai(p) if p else None
            if not h:
                return None
            syllables.append(h)
        elif lang == "vi":
            # 越南文：一般地名用漢越音（士林 → Sĩ Lâm、天母 → Thiên Mẫu），越南人熟悉的說法；
            # 捷運站名稱另外用官方站名（station_terms、localize_name 的 is_station）
            v = r.viet.get(ch)
            if not v:
                return None
            syllables.append(v[0])
        else:
            p = r.pinyin.get(ch)
            if not p:
                return None
            syllables.append(p.replace("v", "ü"))
    if lang in ("ko", "th"):
        return "".join(syllables)
    if lang == "vi" or spaced:
        return " ".join(s[:1].upper() + s[1:] for s in syllables)
    word = "".join(syllables)
    return word[:1].upper() + word[1:]


def _join(parts: list[str], lang: str) -> str:
    if lang == "ja":
        return "".join(parts)
    if lang in ("th", "ko"):
        # 泰文、高棉文、韓文地名詞之間不空格；夾在中間的拉丁字母（拼音、MRT）前後空一格
        out = ""
        for p in parts:
            # 前一個詞本身有空格（쇼타임 시네마）時也空一格
            if out and (p[:1].isascii() or out[-1:].isascii() or (lang in ("ko", "th") and len(p) > 1 and (" " in p or " " in parts[parts.index(p) - 1]))):
                out += " "
            out += p
        return out
    return " ".join(parts)


def localize_name(name: str, lang: str, base_only: bool = False) -> dict:
    """中文地名 → {"text": 翻譯或 None, "reading": 讀音或 None}；有翻譯時不給讀音"""
    if lang not in LANGS:
        return {"zh": name, "text": None, "reading": None}
    # 站牌常見「博物館(館前)」：括號外、括號裡各自翻，兩邊都翻得出來才組回去；括號裡翻不出來就只翻括號外
    m = re.fullmatch(r"\s*(.+?)\s*[(（](.+?)[)）]\s*", name)
    if m:
        outer = localize_name(m.group(1), lang)
        inner = localize_name(m.group(2), lang)
        if outer["text"]:
            text = outer["text"] + (f" ({inner['text']})" if inner["text"] else "")
            return {"zh": name, "text": text, "reading": None}
        if outer["reading"] and inner["reading"]:
            return {"zh": name, "text": None, "reading": f"{outer['reading']} ({inner['reading']})"}
    zh = re.sub(r"\s+", "", name.replace("台", "臺"))
    segs = _segment_zh(zh, base_only)
    kinds = [("proper" if t is None else t.kind) for _, t in segs]
    order = {"prefix": 0, "proper": 1, "head": 2}
    ordered = all(order[a] <= order[b] for a, b in zip(kinds, kinds[1:]))
    residuals = [text for text, t in segs if t is None]
    proper_terms = [t for _, t in segs if t is not None and t.kind == "proper"]
    ok = (
        ordered
        and len(residuals) <= 1
        and sum(len(r) for r in residuals) <= MAX_PROPER_CHARS
        # 「臺北」＋沒收錄的「榮民總」這種，代表名稱裡有我們不認識的普通詞，不翻
        and not (residuals and proper_terms)
    )
    text = None
    if ok:
        parts: dict[str, list[str]] | None = {"prefix": [], "proper": [], "head": []}
        segs = _merge_prefix_head(segs)
        is_station = zh.startswith("捷運") or zh.endswith("站")
        official = {k: en for k, en, _ in metro_station_names()}
        for seg, t in segs:
            form = romanize(seg, lang) if t is None else (t.forms.get(lang) or [None])[0]
            # 捷運站的名稱用官方站名（捷運台大醫院站 → NTU Hospital，不是醫院本身的 National Taiwan University Hospital）
            if t is not None and t.kind == "proper" and is_station and seg in official and lang in ("en", "id", "vi"):
                form = official[seg]
            if not form:
                parts = None
                break
            parts["proper" if t is None else t.kind].append(form)
        if parts:
            if lang in HEAD_FIRST:
                # 最後一個種類詞才是真正的種類（溫泉博物館是博物館）：放最前面
                # 最外層（最後一個）種類詞最前面，再來前綴，再來裡面的種類詞：Ga MRT Công viên rừng Đại An
                seq = parts["head"][-1:] + parts["prefix"] + parts["head"][:-1][::-1] + parts["proper"]
            else:
                # 韓文：好幾個專有名稱（잇푸도、브리즈、타이베이역）之間空一格，前綴、種類詞照樣接在一起
                propers = [" ".join(parts["proper"])] if lang == "ko" and len(parts["proper"]) > 1 else parts["proper"]
                seq = parts["prefix"] + propers + parts["head"]
            text = _join(seq, lang) or None
    reading = None
    # 讀音只給短的名稱：長的店名逐字音譯（이펑탕웨이펑타이베이처잔뎬）使用者看不懂，反而像亂碼
    if text is None and lang != "ja" and len(zh) <= MAX_READING_CHARS:
        reading = romanize(zh, lang, spaced=lang not in ("ko",))
    return {"zh": name, "text": text, "reading": reading}


def warm_up() -> None:
    """先把讀音表、地名清單建好（約 3 秒）。伺服器一啟動就在背景跑，
    不然第一個外語搜尋要等這麼久，前端會逾時、改用原字串搜尋而查不到（2026-11-08：즈산역）。"""
    for system in ("ko_mandarin", "ko_sino", "ko_sino2", "viet", "pinyin"):
        _reading_table(system)
    english_names()
    _taiwan_chars()
    translate_query("즈산역")
