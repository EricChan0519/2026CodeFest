"""搜尋結果在使用者語言的寫法：名稱、類別、地址（規則＋開放資料，不用 AI 模型）。

2026-11-07 回報：搜尋結果只有中文，外籍使用者看不懂，「這個搜尋根本沒有用」→ 每一筆都要有使用者語言的內容。

名稱（localize_name）：
1. 整個名稱能拆成「前綴＋一個專有名稱（3 字內）＋種類詞」→ 完整翻譯（exact=True），
   例如 國立臺灣博物館 → 국립대만박물관 / National Taiwan Museum。
2. 拆不完整 → 認得的詞翻譯、其他部分用該語言的讀音寫（exact=False），一段一段分開，
   例如 台北車站雄獅站前門市 → 타이베이역 슝스 역 앞 매장。不會整串音譯成一長條。
   英文、印尼文時，公車站有 TDX 官方英文站名就直接用。
類別（localize_category）：後端地點快照的中文類別是固定的一組，全部人工對照（api/data/place_categories.json）。
地址（localize_address）：拆成 市、區、路／街＋段、巷、弄、號、樓，依各語言慣用的順序和寫法組回去
（韓文、日文由大到小，其他由小到大），路名用讀音。拆不出來的部分保留原文。
"""
from __future__ import annotations

import json
import os
import re
from functools import lru_cache
from pathlib import Path

from app import translate as tr

LANGS = tr.LANGS

# ---------------------------------------------------------------- 類別


@lru_cache(maxsize=1)
def _categories() -> dict[str, dict[str, str]]:
    path = Path(os.environ.get("PLACE_CATEGORIES_PATH") or tr.DATA_DIR / "place_categories.json")
    try:
        return json.loads(path.read_text(encoding="utf-8"))["categories"]
    except (OSError, ValueError, KeyError, TypeError):
        return {}


def localize_category(zh: str, lang: str) -> str | None:
    if lang not in LANGS or not zh:
        return None
    item = _categories().get(zh)
    if item and item.get(lang):
        return item[lang]
    text = localize_name(zh, lang)
    return text["text"] if text["exact"] else None


# ---------------------------------------------------------------- 名稱

_HAN_RUN = re.compile(r"[㐀-鿿豈-﫿]+|[^㐀-鿿豈-﫿]+")


def _roman(text: str, lang: str) -> str:
    """讀音；越南文有字沒有漢越音時整段改用拼音（總比留中文好）"""
    return tr.romanize(text, lang) or tr.romanize(text, "en") or text


_STOP_WRAPPER = re.compile(r"\(.*?\)|（.*?）|捷運|臺鐵|台鐵|高鐵|輕軌|公車|站|[一二三四五六七八九十0-9]+$")


@lru_cache(maxsize=1)
def _known_places() -> frozenset[str]:
    """已知的地名（公車站名拿掉 捷運、站、括號：中山、士林、芝山、西門…），用來把一長串店名切開"""
    names = set()
    for zh in tr.english_names()[0]:
        core = _STOP_WRAPPER.sub("", zh)
        if 2 <= len(core) <= 4 and all(tr.is_han(c) for c in core):
            names.add(core)
    return frozenset(names)


def _split_known(run: str) -> list[tuple[str, str]]:
    """漢字串切成 已知地名（place）／緊接在地名後的單字種類詞（head：中山站 的 站）／其他（other）"""
    known = _known_places()
    heads = {t.zh: t for t in tr.load_glossary() if t.kind == "head" and len(t.zh) == 1}
    out: list[tuple[str, str]] = []
    other = ""
    i = 0
    while i < len(run):
        hit = next((run[i:i + n] for n in (4, 3, 2) if run[i:i + n] in known), None)
        if hit:
            if other:
                out.append((other, "other"))
                other = ""
            out.append((hit, "place"))
            i += len(hit)
            if i < len(run) and run[i] in heads:
                out.append((run[i], "head"))
                i += 1
            continue
        other += run[i]
        i += 1
    if other:
        out.append((other, "other"))
    return out


def _spell_parts(chunk: str, lang: str) -> list[tuple[str, str]]:
    """和 _spell 一樣，但回傳 (種類, 文字)：已知地名是 proper、緊接的單字種類詞是 head、其他是 spell"""
    heads = {t.zh: t for t in tr.load_glossary() if t.kind == "head" and len(t.zh) == 1}
    out: list[tuple[str, str]] = []
    for run in _HAN_RUN.findall(chunk):
        if not tr.is_han(run[0]):
            run = run.strip(" ・·-_/,，、｜|")
            if run:
                out.append(("spell", run))
            continue
        if lang == "ja":
            out.append(("spell", run))
            continue
        for text, kind in _split_known(run):
            if kind == "head":
                out.append(("head", (heads[text].forms.get(lang) or [text])[0]))
            else:
                out.append(("proper" if kind == "place" else "spell", _roman(text, lang)))
    return out


def _spell(chunk: str, lang: str) -> str:
    """不認得的部分：漢字用該語言的讀音（先切出已知地名，不整串唸成一長條），其他（英文字母、數字、假名）原樣保留"""
    out = []
    for run in _HAN_RUN.findall(chunk):
        if tr.is_han(run[0]):
            if lang == "ja":
                out.append(run)
                continue
            heads = {t.zh: t for t in tr.load_glossary() if t.kind == "head" and len(t.zh) == 1}
            for text, kind in _split_known(run):
                if kind == "head":
                    form = (heads[text].forms.get(lang) or [text])[0]
                    if lang == "ko" and out:
                        out[-1] += form
                    elif lang in tr.HEAD_FIRST and out:
                        out[-1] = f"{form} {out[-1]}"
                    else:
                        out.append(form)
                else:
                    out.append(_roman(text, lang))
        else:
            run = run.strip(" ・·-_/,，、")
            if run:
                out.append(run)
    return " ".join(out)


def _join_words(parts: list[str], lang: str) -> str:
    if lang == "ja":
        return "".join(parts)
    if lang == "th":
        return tr._join(parts, lang)
    return " ".join(p for p in parts if p)


def localize_name(name: str, lang: str, official_en: str | None = None) -> dict:
    out = _localize_name(name, lang, official_en)
    if lang == "ja" and out.get("text"):
        out["text"] = tr.to_japanese(out["text"])
    if lang == "th" and out.get("text"):
        # 「捷運」＋「站」碰上名稱本身的「สถานี」（สถานีหลักไทเป）時不要重複
        t = out["text"].replace("สถานีรถไฟฟ้าสถานี", "สถานีรถไฟฟ้า").replace("รถไฟฟ้าสถานี", "สถานีรถไฟฟ้า").replace("สถานีสถานี", "สถานี")
        out["text"] = t
    return out


def _localize_name(name: str, lang: str, official_en: str | None = None) -> dict:
    """中文地名 → {"zh", "text", "exact"}；text 一定有（名稱是空的除外）"""
    if lang not in LANGS or not name.strip():
        return {"zh": name, "text": None, "exact": False}
    if official_en and lang in ("en", "id"):
        return {"zh": name, "text": official_en, "exact": True}
    # 名稱本身已經有英文（「臺鐵台北車站 TRA Taipei Station」）：英文、印尼文直接用，其他語言放在括號裡
    # 知名地標、品牌整個名稱就是詞彙表裡的專有名稱：直接用官方名稱（中正紀念堂 → Chiang Kai-shek Memorial Hall，
    # 不用 TDX 公車站的縮寫 C.K.S. Memorial Hall）
    whole = next((t for t in tr.load_base_glossary() if t.kind == "proper" and t.zh == name.strip().replace("台", "臺")), None)
    if whole and whole.forms.get(lang):
        return {"zh": name, "text": whole.forms[lang][0], "exact": True}
    latin = re.search(r"[A-Za-z][A-Za-z0-9&'.\-]*(?:\s+[A-Za-z0-9&'.\-]+)+", name)
    if latin and re.search(r"[一-鿿]", name):
        han = (name[: latin.start()] + name[latin.end():]).strip()
        if lang in ("en", "id"):
            return {"zh": name, "text": latin.group(0).strip(), "exact": True}
        inner = localize_name(han, lang)
        return {"zh": name, "text": f"{inner['text']} ({latin.group(0).strip()})", "exact": inner["exact"]}
    # 「IKEA宜家家居」：中文部分翻出來和英文一樣時只留一次
    single = re.fullmatch(r"\s*([A-Za-z][A-Za-z0-9&'.\-]*)\s*([一-鿿].*)", name)
    if single:
        rest = localize_name(single.group(2), lang)["text"] or ""
        if rest.lower() == single.group(1).lower():
            return {"zh": name, "text": single.group(1), "exact": True}
    # 英文：TDX 官方英文站名優先（政大 → National Chengchi University）。
    # 印尼文不直接用（TDX 是英文縮寫「MRT Zhishan Sta.」），照印尼文的詞組（Stasiun MRT Zhishan）
    if lang == "en":
        en = tr.english_names()[0].get(tr._PAREN.sub("", name).replace("台", "臺"))
        if en:
            return {"zh": name, "text": en, "exact": True}
    strict = tr.localize_name(name, lang)
    if strict["text"]:
        return {"zh": name, "text": strict["text"], "exact": True}

    # 括號：括號外、括號裡分開處理
    m = re.fullmatch(r"\s*(.+?)\s*[(（](.+?)[)）]\s*(.*)", name)
    if m:
        outer = localize_name(m.group(1), lang)
        inner = localize_name(m.group(2), lang)
        rest = localize_name(m.group(3), lang)["text"] if m.group(3).strip() else ""
        text = f"{outer['text']} ({inner['text']})" + (f" {rest}" if rest else "")
        return {"zh": name, "text": text, "exact": outer["exact"] and inner["exact"]}

    zh = name.replace("台", "臺")
    segs = tr._segment_zh(re.sub(r"\s+", " ", zh).strip())
    parts: list[tuple[str, str]] = []  # (kind, 文字)
    for seg, term in segs:
        if term is None:
            # 地名（中山）後面緊接的「站」「店」：只修飾那個地名（中山站裝置藝術街 → 중산역 …）
            heads1 = {t.zh: t for t in tr.load_glossary() if t.kind == "head" and len(t.zh) == 1}
            if parts and parts[-1][0] == "proper" and seg[:1] in heads1:
                parts.append(("head", (heads1[seg[0]].forms.get(lang) or [seg[0]])[0]))
                seg = seg[1:]
            # 不認得的部分：先切出已知地名（中山、士林），地名後面的單字種類詞（站、店）只修飾那個地名
            for piece in seg.split(" "):
                parts.extend(_spell_parts(piece, lang))
        else:
            form = (term.forms.get(lang) or [None])[0]
            parts.append((term.kind, form or _spell(seg, lang)))
    if not parts:
        return {"zh": name, "text": None, "exact": False}
    if lang in tr.HEAD_FIRST:
        # 種類詞在前的語言：種類詞緊接在名稱後面時只修飾前一個詞（臺北車站 → Ga Đài Bắc），
        # 連續的第二個種類詞修飾前面全部（一風堂…臺北車站店 → Cửa hàng … Ga Đài Bắc）
        # 名稱最後是「前綴＋種類詞」（台北車站捷運站、台北車站-捷運入口）：這一組是整個地點的種類，
        # 合成一個（สถานีรถไฟฟ้า、ทางเข้ารถไฟฟ้า）放最前面
        wrapper = None
        k = len(parts)
        while k > 0 and parts[k - 1][0] in ("prefix", "head"):
            k -= 1
        tail = parts[k:]
        if 0 < k and any(kd == "prefix" for kd, _ in tail) and any(kd == "head" for kd, _ in tail):
            heads = [w for kd, w in tail if kd == "head"]
            prefixes = [w for kd, w in tail if kd == "prefix"]
            wrapper = _join_words(heads[::-1] + prefixes, lang)
            parts = parts[:k]
        units: list[str] = []
        prev = None
        # 「站」只修飾前面那個地名（Ga Zhongshan）；名稱最後的其他種類詞（店、門市）是整個地點的種類，放最前面
        station_words = {(t.forms.get(lang) or [""])[0] for t in tr.load_base_glossary() if t.zh in ("站", "車站")}
        for idx, (kind, w) in enumerate(parts):
            last = idx == len(parts) - 1
            if kind == "head" and units and last and len(units) > 1 and w not in station_words:
                units = [_join_words([w] + units, lang)]
            elif kind == "head" and units:
                if prev != "head":
                    units[-1] = _join_words([w, units[-1]], lang)
                else:
                    units = [_join_words([w] + units, lang)]
            else:
                units.append(w)
            prev = kind
        if wrapper:
            units = [wrapper] + units
        return {"zh": name, "text": _join_words(units, lang) or None, "exact": False}
    words = [w for _, w in parts]
    if lang == "ko":
        # 韓文：一個音節的種類詞（역、점、산）直接接在前一個詞後面（타이베이역）
        merged: list[str] = []
        for kind, w in parts:
            if merged and kind == "head" and len(w) == 1:
                merged[-1] += w
            else:
                merged.append(w)
        words = merged
    return {"zh": name, "text": _join_words(words, lang) or None, "exact": False}


# ---------------------------------------------------------------- 地址

_ZH_NUM = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9, "十": 10}


def _num(s: str) -> str:
    if s.isdigit():
        return str(int(s))
    if s in _ZH_NUM:
        return str(_ZH_NUM[s])
    if len(s) == 2 and s[0] == "十" and s[1] in _ZH_NUM:
        return str(10 + _ZH_NUM[s[1]])
    if len(s) == 2 and s[1] == "十" and s[0] in _ZH_NUM:
        return str(_ZH_NUM[s[0]] * 10)
    return s


_ADDR = re.compile(
    r"(?P<country>臺灣|台灣)"
    r"|(?P<zip>\d{3,6}(?=\D|$))(?!號|巷|弄|樓|之|-)"
    r"|(?P<city>[一-鿿]{2}市)"
    r"|(?P<dist>[一-鿿]{1,3}區)"
    r"|(?P<road>[一-鿿]{1,6}?(?:大道|路|街))(?:(?P<sec>[一二三四五六七八九十\d]{1,2})段)?"
    r"|(?P<lane>[\d一二三四五六七八九十]+)巷"
    r"|(?P<alley>[\d一二三四五六七八九十]+)弄"
    r"|(?P<no>(?:\d+|[一二三四五六七八九十]+)(?:[-之]\d+)?)號"
    r"|(?P<floor>[Bb]?\d+)(?:樓|[Ff])"
    r"|(?P<village>[一-鿿]{1,3}里)"
)

_DIRS = {"東": ("East", "Timur", "Đông", "ตะวันออก"), "西": ("West", "Barat", "Tây", "ตะวันตก"),
         "南": ("South", "Selatan", "Nam", "ใต้"), "北": ("North", "Utara", "Bắc", "เหนือ")}
_DIR_IDX = {"en": 0, "id": 1, "vi": 2, "th": 3}

# 各語言的地址詞：(區, 路, 街, 大道, 段, 巷, 弄, 號, 樓)
_WORDS = {
    "en": ("District", "Road", "Street", "Boulevard", "Sec. {n}", "Ln. {n}", "Aly. {n}", "No. {n}", "{n}F"),
    "id": ("Distrik", "Jalan", "Jalan", "Jalan", "Sec. {n}", "Gang {n}", "Lorong {n}", "No. {n}", "Lantai {n}"),
    "vi": ("Quận", "Đường", "Phố", "Đại lộ", "Đoạn {n}", "Ngõ {n}", "Ngách {n}", "Số {n}", "Tầng {n}"),
    "th": ("เขต", "ถนน", "ถนน", "ถนน", "ตอน {n}", "ซอย {n}", "ตรอก {n}", "เลขที่ {n}", "ชั้น {n}"),
    "ko": ("구", "", "", "", "{n}단", "{n}항", "{n}롱", "{n}호", "{n}층"),
}


def _road(name: str, kind: str, lang: str) -> str:
    """路名：韓文整個音譯（중샤오시루）；越南文漢越音（đường Trung Hiếu Tây）；其他用拼音＋方向＋路"""
    if lang == "ko":
        return tr.romanize(name + kind, "ko") or name + kind
    words = _WORDS[lang]
    road_word = {"路": words[1], "街": words[2], "大道": words[3]}[kind]
    base, direction = name, ""
    if len(name) > 1 and name[-1] in _DIRS:
        base, direction = name[:-1], _DIRS[name[-1]][_DIR_IDX[lang]]
    spelled = _roman(base, lang)
    if lang == "en":
        return " ".join(x for x in (spelled, direction, road_word) if x)
    if lang == "th":
        return "".join(x for x in (road_word, spelled, direction) if x)  # 泰文不空格：ถนนจงเซียวตะวันตก
    return " ".join(x for x in (road_word, spelled, direction) if x)


def localize_address(addr: str, lang: str) -> str | None:
    """中文地址 → 使用者語言；日文不轉（看得懂漢字）；沒有中文的（Overture 的英文地址）原樣回傳"""
    if lang not in LANGS or not addr or not addr.strip():
        return None
    if lang == "ja":
        return None
    if not re.search(r"[一-鿿]", addr):
        return addr.strip()
    if re.search(r"[A-Za-z]{3,}", addr):
        # Overture 有些地址已經是英文、只夾了「號」（No. 15-1號, Alley 16, …）：拿掉號，其他中文用名稱的規則
        out = re.sub(r"(\d+)樓", lambda m: " " + m.group(1) + "F", addr)
        out = re.sub(r"號\s*", " ", out)
        out = re.sub(r"[一-鿿]+", lambda m: f" {_free(m.group(0), lang)} ", out)
        return re.sub(r"\s+,", ",", re.sub(r"\s+", " ", out)).strip(" ,")
    text = addr.replace("台", "臺")
    # OSM 的格式「49，忠孝西路一段，黎明里，中正區，…」：一段一段處理
    pieces = [p.strip() for p in re.split(r"[，,]", text) if p.strip()]
    tokens: list[tuple[str, str]] = []  # (類型, 使用者語言的文字)
    order = {"floor": 0, "no": 1, "alley": 2, "lane": 3, "road": 4, "village": 5, "dist": 6, "area": 6, "city": 7, "zip": 8, "country": 9}
    w = _WORDS.get(lang)
    for piece in pieces:
        if re.fullmatch(r"\d{5,6}", piece):
            continue  # OSM 的郵遞區號
        if re.fullmatch(r"\d+(?:[-之]\d+)?", piece):  # OSM 把門牌單獨放一段
            tokens.append(("no", w[7].format(n=piece.replace("之", "-")) if w else piece))
            continue
        pos = 0
        for m in _ADDR.finditer(piece):
            if m.start() > pos:
                tokens.append(("area", _free(piece[pos:m.start()], lang)))
            pos = m.end()
            kind = m.lastgroup if m.lastgroup != "sec" else "road"
            g = m.groupdict()
            if g["country"]:
                continue  # 都在臺灣，不用寫
            if g["zip"]:
                continue  # 郵遞區號對找路沒有幫助
            elif g["city"]:
                tokens.append(("city", _free(g["city"], lang)))
            elif g["dist"]:
                name = _roman(g["dist"][:-1], lang)
                if lang == "ko":
                    tokens.append(("dist", name + "구" if not name.endswith("구") else name))
                elif lang == "en":
                    tokens.append(("dist", f"{name} District"))
                else:
                    tokens.append(("dist", f"{w[0]} {name}"))
            elif g["road"]:
                road = g["road"]
                kind_word = "大道" if road.endswith("大道") else road[-1]
                road_text = _road(road[: -len(kind_word)], kind_word, lang)
                if g["sec"]:
                    sec = w[4].format(n=_num(g["sec"]))
                    # 韓文、泰文：路名在前、段在後（중샤오시루 1단、ถนน … ตอน 1）；其他：段在前（Sec. 1, Zhongxiao…）
                    road_text = f"{road_text} {sec}" if lang in ("ko", "th") else f"{sec}, {road_text}"
                tokens.append(("road", road_text))
            elif g["lane"]:
                tokens.append(("lane", w[5].format(n=_num(g["lane"]))))
            elif g["alley"]:
                tokens.append(("alley", w[6].format(n=_num(g["alley"]))))
            elif g["no"]:
                num = g["no"].replace("之", "-")
                tokens.append(("no", w[7].format(n=num if num[0].isdigit() else _num(num))))
            elif g["floor"]:
                tokens.append(("floor", w[8].format(n=g["floor"].upper())))
            elif g["village"]:
                continue  # 里名對外國人沒有幫助
            del kind
        if pos < len(piece):
            rest = piece[pos:].strip(" ,，")
            if rest:
                tokens.append(("area", _free(rest, lang)))
    tokens = [(k, v) for k, v in tokens if v]
    if not tokens:
        return None
    # 韓文由大到小（타이베이시 중정구 중샤오시루 1단 3호 2층）；其他由小到大（No. 3, Sec. 1, …, Taipei City）
    big_first = lang == "ko"
    tokens = sorted(tokens, key=lambda t: order.get(t[0], 6), reverse=big_first)
    # 韓文、泰文地址不用逗號
    sep = " " if lang in ("ko", "th") else ", "
    return sep.join(v for _, v in tokens)


def _free(text: str, lang: str) -> str:
    """地址裡其他的字（商圈名、大樓名、市名）：用名稱的規則"""
    text = text.strip()
    if not text:
        return ""
    if not re.search(r"[一-鿿]", text):
        return text
    return localize_name(text, lang)["text"] or text
