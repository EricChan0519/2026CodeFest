"""所有臺北捷運站，用各語言使用者會打的說法都要翻回正確的站（真的資料；2026-11-08 掃描發現 北投、臺北橋、奇岩 等查不到）"""
import json
import re
from pathlib import Path

import pytest

from app import translate as t

DATA = Path(__file__).resolve().parents[1] / "data"
pytestmark = pytest.mark.skipif(not (DATA / "stop_index.json").exists(), reason="沒有站位快照")


@pytest.fixture(scope="module", autouse=True)
def real_data():
    for f in (t.load_gazetteer, t._reading_table, t._name_count, t.english_names, t._taiwan_chars):
        f.cache_clear()
    yield


def mrt_stations() -> list[str]:
    out = set()
    for st in json.loads((DATA / "stop_index.json").read_text(encoding="utf-8"))["stations"]:
        m = re.fullmatch(r"捷運(.{2,4}?)站", re.sub(r"\(.*?\)|[一二三四五六七八九]$", "", st["name"]["zh"]))
        if m:
            out.add(m.group(1).replace("台", "臺"))
    return sorted(out)


def spell(name: str, how: str) -> str | None:
    r = t.load_readings()
    if how == "ko":
        parts = [t.pinyin_to_hangul(r.pinyin.get(c, "")) for c in name]
        return None if None in parts else "".join(parts) + "역"
    if how == "en":
        py = "".join(r.pinyin.get(c, "?") for c in name).replace("v", "u")
        return None if "?" in py else f"{py.capitalize()} Station"
    if how == "vi":
        vs = [r.viet.get(c, [None])[0] for c in name]
        return None if None in vs else "Ga " + " ".join(v.capitalize() for v in vs)
    if how == "ja":
        return name + "駅"
    raise ValueError(how)


@pytest.mark.slow
@pytest.mark.parametrize("how", ["ko", "en", "vi", "ja"])
def test_every_mrt_station(how):
    misses = []
    for name in mrt_stations():
        q = spell(name, how)
        if q is None:
            continue
        got = t.translate_query(q)["queries"]
        if not got or name not in got[0].replace("台", "臺"):
            misses.append((name, q, got[:2]))
    assert misses == []


def test_reported_cases():
    assert t.translate_query("즈산역")["queries"][0] == "芝山站"
    assert t.translate_query("지산역")["queries"][0] == "芝山站"
    assert t.translate_query("북투역")["queries"][0] == "北投站"  # 北 = 배／북
    assert t.translate_query("타이베이차오역")["queries"][0] == "臺北橋站"
    assert t.translate_query("Ga Công viên Đại Hồ")["queries"][0] == "大湖公園站"
    assert t.translate_query("奇岩駅")["queries"][0] == "奇岩站"  # 不要換成「巖」


def test_warm_up_makes_the_first_query_fast():
    import time

    t.warm_up()
    t0 = time.time()
    t.translate_query("스린역")
    assert time.time() - t0 < 1.5
