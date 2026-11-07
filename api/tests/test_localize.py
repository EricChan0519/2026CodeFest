"""搜尋結果在使用者語言的寫法：每一筆都要有（2026-11-07 回報：只有中文，外籍使用者看不懂）"""
import pytest

from app import localize as L

LANGS = ["en", "id", "vi", "th", "km", "ko", "ja"]


@pytest.mark.parametrize("lang", LANGS)
def test_every_result_name_gets_text_in_the_users_language(lang):
    for name in ["台北車站雄獅站前門市", "一風堂微風台北車站店", "愛不囉嗦台北車站店", "台北車站南一門", "鼎泰豐", "臺北榮民總醫院"]:
        assert L.localize_name(name, lang)["text"], (name, lang)


def test_known_words_are_translated_and_the_rest_spelled_in_pieces():
    assert L.localize_name("台北車站雄獅站前門市", "ko")["text"] == "타이베이역 슝스 역 앞 매장"
    assert L.localize_name("台北車站雄獅站前門市", "en")["text"] == "Taipei Station Xiongshi Station Front Store"
    assert L.localize_name("一風堂微風台北車站店", "ko")["text"] == "이펑탕웨이펑 타이베이역점"
    # 種類詞在前的語言：臺北車站 → Ga Đài Bắc，最後的「店」放最前面
    assert L.localize_name("一風堂微風台北車站店", "vi")["text"] == "Cửa hàng Nhất Phong Đường Vi Phong Ga Đài Bắc"
    assert L.localize_name("一風堂微風台北車站店", "id")["text"] == "Toko Yifengtangweifeng Stasiun Taipei"
    assert L.localize_name("台北車站雄獅站前門市", "th")["text"].startswith("ร้านสถานีไทเป")


def test_exact_translation_is_flagged():
    r = L.localize_name("國立臺灣博物館", "ko")
    assert r == {"zh": "國立臺灣博物館", "text": "국립대만박물관", "exact": True}
    assert L.localize_name("一風堂微風台北車站店", "ko")["exact"] is False


def test_names_that_already_have_english():
    assert L.localize_name("臺鐵台北車站 TRA Taipei Station", "en")["text"] == "TRA Taipei Station"
    assert L.localize_name("臺鐵台北車站 TRA Taipei Station", "ko")["text"] == "대만철도타이베이역 (TRA Taipei Station)"


def test_official_tdx_english_names_for_english_and_indonesian():
    assert L.localize_name("政大", "en")["text"].startswith("National Chengchi")


@pytest.mark.parametrize(
    "lang,expected",
    [
        ("ko", "중샤오시루 1단 3호"),
        ("en", "No. 3, Sec. 1, Zhongxiao West Road"),
        ("id", "No. 3, Seksi 1, Jalan Zhongxiao Barat"),
        ("vi", "Số 3, Đoạn 1, Đường Trung Hiếu Tây"),
        ("th", "เลขที่ 3, ช่วง 1, ถนน Zhongxiao ตะวันตก"),
        ("km", "លេខ 3, ផ្នែក 1, ផ្លូវ Zhongxiao ខាងលិច"),
    ],
)
def test_addresses(lang, expected):
    assert L.localize_address("忠孝西路一段3號", lang) == expected


def test_address_details():
    assert L.localize_address("北平西路3號2樓", "ko") == "베이핑시루 3호 2층"
    assert L.localize_address("中正區北平西路三號", "en") == "No. 3, Beiping West Road, Zhongzheng District"
    assert L.localize_address("大同路二段312巷12號", "en") == "No. 12, Ln. 312, Sec. 2, Datong Road"
    # OSM 的格式：郵遞區號、里、臺灣拿掉
    osm = "49，忠孝西路一段，黎明里，中正區，台北站前商圈，臺北市，10041，臺灣"
    assert L.localize_address(osm, "en").startswith("No. 49, Sec. 1, Zhongxiao West Road, Zhongzheng District")
    assert "10041" not in L.localize_address(osm, "ko")
    # 已經是英文、只夾了「號」
    assert L.localize_address("No. 15-1號, Alley 16, Lane 52, Section 4, Roosevelt Rd", "ko") == "No. 15-1, Alley 16, Lane 52, Section 4, Roosevelt Rd"
    # 日文看得懂漢字，不轉
    assert L.localize_address("忠孝西路一段3號", "ja") is None


@pytest.mark.parametrize("lang", LANGS)
def test_every_category_is_translated(lang):
    for cat in L._categories():
        assert L.localize_category(cat, lang), (cat, lang)


def test_long_names_are_split_around_known_places():
    # 2026-11-07：「中山站裝置藝術街」整串唸成「중산잔좡즈이수제」；先切出已知地名「中山」，「站」只修飾中山
    assert L.localize_name("中山站裝置藝術街", "ko")["text"] == "중산역 좡즈이수제"
    assert L.localize_name("文成補習班-中山站", "vi")["text"] == "Văn Thành Bổ Tập Ban Ga Trung Sơn"


def test_mixed_english_address_keeps_both_numbers():
    assert L.localize_address("Lane 133, Taiyuan Rd, 13號1樓", "ko") == "Lane 133, Taiyuan Rd, 13 1F"
