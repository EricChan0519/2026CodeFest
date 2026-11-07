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
LANGS = ("en", "id", "vi", "th", "km", "ko", "ja")
# 專有名稱最多幾個字才翻譯（臺北的地名多半 2、3 個字：芝山、天母、西門町；再長多半混了沒收錄的普通詞，
# 例如「臺大綜合體育館」的「綜合」、「臺北榮民總醫院」的「榮民總」，硬拼成拼音會變成看不懂的字）
MAX_PROPER_CHARS = 3
# 讀音比對：至少對到幾個字，避免一個音節配到一大堆地名
MIN_MATCH_CHARS = 2
MAX_CANDIDATES = 3
# 種類詞放在專有名稱前面的語言（Bảo tàng Đài Loan、Museum Taiwan、พิพิธภัณฑ์…）
HEAD_FIRST = {"vi", "id", "th", "km"}

# ---------------------------------------------------------------- 文字、語言判斷

_HANGUL = re.compile(r"[가-힣]")
_THAI = re.compile(r"[฀-๿]")
_KHMER = re.compile(r"[ក-៿]")
_KANA = re.compile(r"[぀-ヿ]")
_HAN = re.compile(r"[㐀-鿿豈-﫿]")
_LATIN = re.compile(r"[a-zA-ZÀ-ɏḀ-ỿ]")
# 越南文才有的字母或聲調（ă â đ ê ô ơ ư 和 ạ ả ã 等）
_VIET = re.compile(r"[ăâđêôơưĂÂĐÊÔƠỰ̀́̃̉]|[Ạ-ỹ]")


def detect_lang(q: str) -> str:
    """回傳 ko、th、km、ja、vi、latin（英文或印尼文，translate_query 再細分）或 zh"""
    if _HANGUL.search(q):
        return "ko"
    if _THAI.search(q):
        return "th"
    if _KHMER.search(q):
        return "km"
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
def load_glossary() -> list[Term]:
    path = Path(os.environ.get("PLACE_GLOSSARY_PATH") or DATA_DIR / "place_glossary.json")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return [Term(t["zh"], t["kind"], {lang: list(t.get(lang) or []) for lang in LANGS}) for t in data["terms"]]
    except (OSError, ValueError, KeyError, TypeError):
        return []


@dataclass
class Readings:
    pinyin: dict[str, str]
    hangul: dict[str, list[str]]
    viet: dict[str, list[str]]
    jp: dict[str, str]
    s2t: dict[str, str]
    available: bool = True


@lru_cache(maxsize=1)
def load_readings() -> Readings:
    path = Path(os.environ.get("HAN_READINGS_PATH") or DATA_DIR / "han_readings.json")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        chars = data["chars"]
        return Readings(
            pinyin={c: v[0] for c, v in chars.items() if v[0]},
            hangul={c: v[1] for c, v in chars.items() if v[1]},
            viet={c: v[2] for c, v in chars.items() if v[2]},
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


def to_traditional(s: str) -> str:
    r = load_readings()
    return "".join(_JA_WORDS.get(c) or r.jp.get(c) or r.s2t.get(c) or c for c in s).replace("台", "臺")


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
    return counts.most_common(MAX_CANDIDATES)


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
    for term in load_glossary():
        for code in _lang_pool(lang):
            for form in term.forms.get(code, []):
                key = _match_key(form, word_level)
                if key:
                    out.append((key, term))
    # 長的寫法先比；同一個寫法對到好幾個詞時取中文最短的（역 → 站 而不是 車站，야시장 → 夜市）
    out.sort(key=lambda x: (-len(x[0]), len(x[1].zh)))
    return out


def _match_key(s: str, word_level: bool) -> str:
    if word_level:
        return " ".join(re.findall(r"[0-9a-z]+", fold(s)))
    return re.sub(r"\s+", "", s.lower())


def _scan(q: str, lang: str) -> list[tuple[str, Term | None]]:
    """由左到右找最長的詞彙表詞；回傳 [(原文片段, 詞或 None)]"""
    word_level = lang in ("latin", "vi")
    forms = _glossary_forms(lang, word_level)
    if word_level:
        units = re.findall(r"[0-9a-z]+", fold(q))
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
                # 一個字的種類詞（산＝山、사＝寺、역＝站）只接在兩個字以上的專有名稱後面，
                # 否則「즈산」會被切成「즈」＋「山」
                if not word_level and n == 1 and term.kind == "head" and len(residual) < 2:
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
        systems = ["ko_mandarin", "ko_sino"]  # 즈산（中文音譯）和 지산（韓文漢字音）都要能找到 芝山
    elif lang == "vi":
        systems = ["viet", "pinyin"]
    elif lang == "latin":
        systems = ["pinyin", "viet"]
    counts: Counter[str] = Counter()
    for system in systems:
        if system == "ko_sino":
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
    ranked = counts.most_common()
    top = ranked[0][1]
    zh = [z for z, n in ranked if n >= top * MIN_ALT_SHARE][:MAX_CANDIDATES]
    return Segment(text, "proper", zh, "reading")


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
    for text, term in _scan(q, lang):
        if term is None:
            segments.append(_resolve(text, lang))
        else:
            segments.append(Segment(text, term.kind, [term.zh], "glossary"))

    prefixes = [s for s in segments if s.kind == "prefix"]
    propers = [s for s in segments if s.kind == "proper"]
    heads = [s for s in segments if s.kind == "head"]
    unknown = [s for s in segments if s.kind == "unknown"]
    display = lang
    if lang == "latin":
        display = _guess_latin(segments)

    queries: list[str] = []
    if propers or prefixes or heads:
        alternatives = propers[0].zh if propers else [""]
        rest = "".join(p.zh[0] for p in propers[1:])
        for alt in alternatives:
            text = "".join(p.zh[0] for p in prefixes) + alt + rest + "".join(h.zh[0] for h in heads)
            if text and text not in queries:
                queries.append(text)
    return {
        "lang": display,
        "queries": queries[:MAX_CANDIDATES],
        "partial": bool(unknown),
        "segments": [{"text": s.text, "kind": s.kind, "zh": s.zh, "via": s.via} for s in segments],
    }


# ---------------------------------------------------------------- 中文 → 外語

def _zh_terms() -> list[Term]:
    return sorted(load_glossary(), key=lambda t: -len(t.zh))


def _segment_zh(name: str) -> list[tuple[str, Term | None]]:
    terms = _zh_terms()
    out: list[tuple[str, Term | None]] = []
    residual = ""
    i = 0
    while i < len(name):
        hit = None
        for t in terms:
            if name.startswith(t.zh, i):
                if len(t.zh) == 1 and t.kind == "head" and len(residual) < 2:
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
        elif lang == "vi":
            v = r.viet.get(ch)
            if not v:
                return None
            syllables.append(v[0])
        else:
            p = r.pinyin.get(ch)
            if not p:
                return None
            syllables.append(p.replace("v", "ü"))
    if lang == "ko":
        return "".join(syllables)
    if lang == "vi" or spaced:
        return " ".join(s[:1].upper() + s[1:] for s in syllables)
    word = "".join(syllables)
    return word[:1].upper() + word[1:]


def _join(parts: list[str], lang: str) -> str:
    if lang == "ja":
        return "".join(parts)
    if lang in ("th", "km", "ko"):
        # 泰文、高棉文、韓文地名詞之間不空格；夾在中間的拉丁字母（拼音、MRT）前後空一格
        out = ""
        for p in parts:
            if out and (p[:1].isascii() or out[-1:].isascii()):
                out += " "
            out += p
        return out
    return " ".join(parts)


def localize_name(name: str, lang: str) -> dict:
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
    segs = _segment_zh(zh)
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
        for seg, t in segs:
            form = romanize(seg, lang) if t is None else (t.forms.get(lang) or [None])[0]
            if not form:
                parts = None
                break
            parts["proper" if t is None else t.kind].append(form)
        if parts:
            if lang in HEAD_FIRST:
                # 最後一個種類詞才是真正的種類（溫泉博物館是博物館）：放最前面
                seq = parts["head"][::-1] + parts["prefix"] + parts["proper"]
            else:
                seq = parts["prefix"] + parts["proper"] + parts["head"]
            text = _join(seq, lang) or None
    reading = None
    if text is None and lang != "ja" and len(zh) <= 12:
        reading = romanize(zh, lang, spaced=lang not in ("ko",))
    return {"zh": name, "text": text, "reading": reading}
