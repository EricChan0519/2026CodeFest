"""外語地點搜尋：外語 → 中文、中文 → 外語（用真的詞彙表和讀音表，地名清單用小的測試資料）"""
import gzip
import json

import pytest

from app import translate as t

GAZETTEER = [
    "捷運芝山站", "芝山公園", "芝山國小", "芝山岩", "捷運士林站", "士林夜市", "士林官邸",
    "龍山寺", "中正紀念堂", "西門町", "天母運動公園", "天母", "北投溫泉博物館", "饒河街觀光夜市",
    "東門", "至善路", "國立臺灣博物館", "臺北車站", "臺北車站(忠孝)", "臺北車站(承德)",
    "國立政治大學", "政治大學", "精緻料理", "精緻餐廳", "精緻小館", "精緻美食",
]


@pytest.fixture(autouse=True)
def small_gazetteer(monkeypatch, tmp_path):
    place = tmp_path / "place_index.json.gz"
    places = [[n, 25.1, 121.5, "", 0, 90] for n in GAZETTEER]
    place.write_bytes(gzip.compress(json.dumps({"categories": ["x"], "places": places}, ensure_ascii=False).encode()))
    monkeypatch.setenv("PLACE_INDEX_PATH", str(place))
    monkeypatch.setenv("STOP_INDEX_PATH", str(tmp_path / "none.json"))
    for f in (t.load_gazetteer, t._reading_table, t._name_count):
        f.cache_clear()
    yield
    for f in (t.load_gazetteer, t._reading_table, t._name_count):
        f.cache_clear()


def q(text):
    return t.translate_query(text)["queries"]


def test_detects_languages():
    assert t.detect_lang("대만박물관") == "ko"
    assert t.detect_lang("พิพิธภัณฑ์") == "th"
    assert t.detect_lang("សារមន្ទីរ") == "km"
    assert t.detect_lang("バス停") == "ja"
    assert t.detect_lang("Bảo tàng Đài Loan") == "vi"
    assert t.detect_lang("Taipei Zoo") == "latin"
    assert t.detect_lang("臺北車站") == "zh"


def test_korean_place_not_in_any_list_is_translated_word_by_word():
    # 2026-11-07 回報：대만박물관 應該找到臺灣博物館
    assert q("대만박물관") == ["臺灣博物館"]
    assert q("국립대만박물관") == ["國立臺灣博物館"]
    assert q("국립 대만 박물관") == ["國立臺灣博物館"]


def test_korean_names_by_mandarin_transcription_or_sino_korean_reading():
    assert q("즈산역")[0] == "芝山站"  # 中文音譯
    assert q("지산역")[0] == "芝山站"  # 韓文漢字音
    assert q("스린야시장") == ["士林夜市"]
    assert q("용산사") == ["龍山寺"]  # 頭音法則：룡 → 용
    assert q("시먼딩") == ["西門町"]


def test_english_and_indonesian():
    assert q("National Taiwan Museum") == ["國立臺灣博物館"]
    assert q("Museum Nasional Taiwan") == ["國立臺灣博物館"]
    assert q("Zhishan MRT station")[0] == "捷運芝山站"
    assert q("Stasiun MRT Zhishan")[0] == "捷運芝山站"
    assert q("Shilin Night Market") == ["士林夜市"]
    assert q("Pasar Malam Shilin") == ["士林夜市"]
    assert q("Taipei Mosque") == ["臺北清真寺"]
    assert q("Masjid Taipei") == ["臺北清真寺"]


def test_latin_queries_are_told_apart_as_english_or_indonesian():
    assert t.translate_query("Masjid Taipei")["lang"] == "id"
    assert t.translate_query("Pasar Malam Shilin")["lang"] == "id"
    assert t.translate_query("Taipei Mosque")["lang"] == "en"
    assert t.translate_query("Zhishan")["lang"] == "en"


def test_vietnamese_with_and_without_tone_marks():
    assert q("Bảo tàng Đài Loan") == ["臺灣博物館"]
    assert q("Chợ đêm Sĩ Lâm") == ["士林夜市"]
    assert q("Chua Long Son") == ["龍山寺"]  # 沒打聲調：當成拉丁字母，也查得到


def test_thai_and_khmer_use_the_glossary():
    assert q("พิพิธภัณฑ์ไต้หวัน") == ["臺灣博物館"]
    assert q("สวนสัตว์ไทเป") == ["臺北動物園"]
    assert q("សារមន្ទីរតៃវ៉ាន់") == ["臺灣博物館"]


def test_japanese_and_simplified_become_traditional():
    assert q("台湾博物館") == ["臺灣博物館"]
    assert q("士林駅") == ["士林站"]  # 駅 是車站，不是「驛」
    assert q("国立台湾大学") == ["國立臺灣大學"]


def test_unknown_parts_are_flagged_not_guessed():
    r = t.translate_query("Rumah Sakit Tri-Service")
    assert r["partial"] is True
    assert r["queries"] == ["醫院"]
    r = t.translate_query("ตลาดกลางคืนซื่อหลิน")  # 泰文的「士林」沒有讀音規則
    assert r["partial"] is True


def test_one_syllable_category_word_does_not_split_a_name():
    # 「즈산」不會被切成「즈」＋「산(山)」
    assert all("山站" in x for x in q("즈산역")[:1])


@pytest.mark.parametrize(
    "lang,expected",
    [
        ("en", "National Taiwan Museum"),
        ("id", "Museum Nasional Taiwan"),
        ("vi", "Bảo tàng Quốc gia Đài Loan"),
        ("th", "พิพิธภัณฑ์แห่งชาติไต้หวัน"),
        ("km", "សារមន្ទីរជាតិតៃវ៉ាន់"),
        ("ko", "국립대만박물관"),
        ("ja", "国立台湾博物館"),
    ],
)
def test_localize_national_taiwan_museum(lang, expected):
    assert t.localize_name("國立臺灣博物館", lang)["text"] == expected


def test_localize_uses_each_languages_reading_for_names():
    assert t.localize_name("捷運芝山站", "en")["text"] == "MRT Zhishan Station"
    assert t.localize_name("捷運芝山站", "ko")["text"] == "MRT 즈산역"
    assert t.localize_name("捷運芝山站", "vi")["text"] == "Ga MRT Chi Sơn"
    assert t.localize_name("捷運芝山站", "th")["text"] == "สถานีรถไฟฟ้า Zhishan"
    assert t.localize_name("士林夜市", "ko")["text"] == "스린야시장"
    assert t.localize_name("天母", "en")["text"] == "Tianmu"


def test_localize_puts_the_real_category_first_in_head_first_languages():
    assert t.localize_name("北投溫泉博物館", "en")["text"] == "Beitou Hot Spring Museum"
    assert t.localize_name("北投溫泉博物館", "id")["text"] == "Museum Pemandian Air Panas Beitou"


def test_localize_refuses_names_it_cannot_fully_understand():
    # 「榮民總」「綜合」不是地名，硬拼會變成看不懂的字：不翻，只給讀音
    for name in ("臺北榮民總醫院", "臺大綜合體育館", "艋舺龍山寺", "捷運芝山站一"):
        r = t.localize_name(name, "en")
        assert r["text"] is None, name
        # 7 個字以上的不給讀音（太長的音譯看不懂）
        assert bool(r["reading"]) == (len(name) <= t.MAX_READING_CHARS), name
    assert t.localize_name("艋舺龍山寺", "en")["reading"] == "Meng Xia Long Shan Si"


def test_mandarin_to_hangul_follows_the_korean_standard():
    expect = {"zhi": "즈", "shan": "산", "tai": "타이", "bei": "베이", "shi": "스", "lin": "린", "xi": "시",
              "men": "먼", "long": "룽", "tian": "톈", "mu": "무", "jian": "젠", "jia": "자", "jiu": "주",
              "xiong": "슝", "yuan": "위안", "wei": "웨이", "wen": "원", "hui": "후이", "zhou": "저우",
              "ju": "쥐", "xue": "쉐", "lv": "뤼", "yun": "윈", "zi": "쯔", "si": "쓰", "ri": "르"}
    for py, ko in expect.items():
        assert t.pinyin_to_hangul(py) == ko, py


def test_api(client):
    r = client.post("/api/translate/query", json={"q": "대만박물관"})
    assert r.status_code == 200
    assert r.json()["queries"] == ["臺灣博物館"]
    r = client.post("/api/translate/names", json={"lang": "id", "names": ["國立臺灣博物館", "臺北榮民總醫院"], "addresses": ["忠孝西路一段3號"], "categories": ["餐廳"]})
    body = r.json()
    assert body["names"][0] == {"zh": "國立臺灣博物館", "text": "Museum Nasional Taiwan", "exact": True}
    # 每一筆都有使用者語言的內容；拆不完整的一部分用讀音
    assert body["names"][1]["text"] and body["names"][1]["exact"] is False
    assert body["addresses"][0]["text"] == "No. 3, Seksi 1, Jalan Zhongxiao Barat"
    assert body["categories"][0]["text"] == "Restoran"
    assert client.post("/api/translate/names", json={"lang": "xx", "names": ["a"]}).status_code == 422


def test_localize_names_with_parentheses():
    assert t.localize_name("博物館(館前)", "en")["text"] == "Museum (Guanqian)"  # 館前＝館前路
    assert t.localize_name("捷運士林站(中正)", "en")["text"] == "MRT Shilin Station (Zhongzheng)"
    assert t.localize_name("捷運士林站(中正)", "ko")["text"] == "MRT 스린역 (중정)"


def test_grand_mosque():
    assert t.localize_name("臺北清真大寺", "id")["text"] == "Masjid Raya Taipei"
    assert t.localize_name("臺北清真大寺", "en")["text"] == "Taipei Grand Mosque"


def test_one_syllable_category_word_after_a_known_place_name():
    # 2026-11-07 回報：타이베이역 只翻出「臺北」；역 可以是 站 或 車站，挑實際地名裡有的
    assert q("타이베이역")[0] == "臺北車站"
    assert q("Taipei Station")[0] == "臺北車站"
    assert q("Ga Đài Bắc")[0] == "臺北車站"
    assert q("สถานีไทเป")[0] == "臺北車站"
    # MRT 站還是「站」
    assert q("Zhishan MRT station")[0] == "捷運芝山站"


def test_long_names_get_no_reading():
    # 2026-11-07 回報：「一風堂微風台北車站店」的韓文讀音「이펑탕웨이펑타이베이처잔뎬」看不懂；長的店名只顯示中文
    r = t.localize_name("一風堂微風台北車站店", "ko")
    assert r["text"] is None and r["reading"] is None
    assert t.localize_name("臺北車站", "ko")["text"] == "타이베이역"


def test_reading_candidates_are_chosen_by_the_whole_name():
    # 2026-11-07 回報：정치대학교 → 精緻大學（精緻在店名很常見）；整串「政治大學」才是真的地名
    t._name_count.cache_clear()
    assert q("정치대학교") == ["政治大學"]
