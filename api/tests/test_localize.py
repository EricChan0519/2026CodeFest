"""搜尋結果在使用者語言的寫法：每一筆都要有（2026-11-07 回報：只有中文，外籍使用者看不懂）"""
import pytest

from app import localize as L

LANGS = ["en", "id", "vi", "th", "ko", "ja"]


@pytest.mark.parametrize("lang", LANGS)
def test_every_result_name_gets_text_in_the_users_language(lang):
    for name in ["台北車站雄獅站前門市", "一風堂微風台北車站店", "愛不囉嗦台北車站店", "台北車站南一門", "鼎泰豐", "臺北榮民總醫院"]:
        assert L.localize_name(name, lang)["text"], (name, lang)


def test_known_words_are_translated_and_the_rest_spelled_in_pieces():
    assert L.localize_name("台北車站雄獅站前門市", "ko")["text"] == "타이베이역 라이언 트래블 역 앞 매장"
    assert L.localize_name("台北車站雄獅站前門市", "en")["text"] == "Taipei Main Station Lion Travel Station Front Store"
    assert L.localize_name("一風堂微風台北車站店", "ko")["text"] == "잇푸도 브리즈 타이베이역점"
    # 種類詞在前的語言：臺北車站 → Ga Đài Bắc，最後的「店」放最前面
    assert L.localize_name("一風堂微風台北車站店", "vi")["text"] == "Cửa hàng Ippudo Breeze Ga Đài Bắc"
    assert L.localize_name("一風堂微風台北車站店", "id")["text"] == "Toko Ippudo Breeze Stasiun Utama Taipei"
    assert L.localize_name("台北車站雄獅站前門市", "th")["text"].startswith("ร้าน")


def test_exact_translation_is_flagged():
    r = L.localize_name("國立臺灣博物館", "ko")
    assert r == {"zh": "國立臺灣博物館", "text": "국립대만박물관", "exact": True}
    assert L.localize_name("芝山岩展示館", "ko")["exact"] is False


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
        ("id", "No. 3, Sec. 1, Jalan Zhongxiao Barat"),
        ("vi", "Số 3, Đoạn 1, Đường Trung Hiếu Tây"),  # 越南文用漢越音
        ("th", "เลขที่ 3 ถนนจงเซียวตะวันตก ตอน 1"),  # 泰文地址不用逗號，段 = ตอน
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
    assert L.localize_name("中山站裝置藝術街", "ko")["text"] == "중산역 좡즈 예술 제"
    assert L.localize_name("文成補習班-中山站", "vi")["text"] == "Trung tâm luyện thi Văn Thành Ga Trung Sơn"


def test_mixed_english_address_keeps_both_numbers():
    assert L.localize_address("Lane 133, Taiyuan Rd, 13號1樓", "ko") == "Lane 133, Taiyuan Rd, 13 1F"


def test_station_only_means_a_transit_station():
    # 2026-11-08 回報：「芝山抽水站」→「즈산 처우수이역」；站 只有在交通的地方才是車站
    assert L.localize_name("芝山抽水站", "ko")["text"] == "즈산양수장"
    assert L.localize_name("芝山抽水站", "en")["text"] == "Zhishan Pumping Station"
    assert L.localize_name("中油加油站", "en")["text"] == "CPC Corporation Gas Station"  # 官方品牌名
    assert "역" not in L.localize_name("某某工作站", "ko")["text"]
    # 真的車站照樣是車站
    assert L.localize_name("士林站", "ko")["text"] == "스린역"
    assert L.localize_name("大安森林公園站", "en")["text"] == "Daan Park Station"  # 官方英文站名
    assert L.localize_name("公車士林站", "vi")["text"] == "Trạm xe buýt Shilin"  # 官方英文站名
    assert L.localize_name("捷運大安森林公園站", "vi")["text"] == "Ga MRT Daan Park"  # 官方英文站名


@pytest.mark.parametrize(
    "name,ko,en",
    [
        ("長春牙醫診所", "장춘치과", "Zhangchun Dental Clinic"),
        ("好學補習班", "하오쉐학원", "Haoxue Cram School"),
        ("老王牛肉麵", "라오왕우육면", "Laowang Beef Noodles"),
        ("天母動物醫院", "톈무동물병원", "Tianmu Veterinary Hospital"),
        ("王律師事務所", "왕법률사무소", "Wang Law Firm"),
    ],
)
def test_common_place_types(name, ko, en):
    assert L.localize_name(name, "ko")["text"] == ko
    assert L.localize_name(name, "en")["text"] == en


def test_official_mrt_line_names():
    # 2026-11-08 回報：淡水信義線等路線名要用官方翻譯（舊名 淡水線 也對到現在的線）
    assert L.localize_name("捷運淡水線-芝山站", "ko")["text"] == "MRT 단수이신이선 즈산역"
    assert L.localize_name("捷運淡水線-芝山站", "en")["text"] == "MRT Tamsui-Xinyi Line Zhishan Station"
    assert L.localize_name("板南線", "vi")["text"] == "Bannan Line"
    assert L.localize_name("環狀線", "ja")["text"] == "環状線"


@pytest.mark.parametrize(
    "name,en,vi,ko",
    [
        # 2026-11-08 回報：雙連等站名要用官方翻譯；韓文照官方拼音（頂埔 Dingpu → 딩푸，不是 딩부）
        ("捷運雙連站", "MRT Shuanglian Sta.", "Ga MRT Shuanglian", "MRT 솽롄역"),
        ("捷運頂埔站", "MRT Dingpu Station", "Ga MRT Dingpu", "MRT 딩푸역"),
        ("捷運台北車站", "MRT Taipei Main Station", "MRT Taipei Main Station", "MRT 타이베이역"),
        ("捷運台大醫院站", "MRT NTU Hospital Station", "Ga MRT NTU Hospital", None),
        ("捷運台北小巨蛋站", "MRT Taipei Arena Station", "Ga MRT Taipei Arena", None),
    ],
)
def test_official_mrt_station_names(name, en, vi, ko):
    assert L.localize_name(name, "en")["text"] == en
    assert L.localize_name(name, "vi")["text"] == vi
    if ko:
        assert L.localize_name(name, "ko")["text"] == ko


@pytest.mark.parametrize(
    "name,en,ko",
    [
        # 2026-11-08 回報：台北大巨蛋是 Taipei Dome、秀泰影城是 Showtime Cinemas；知名地標、品牌用官方名稱
        ("台北大巨蛋", "Taipei Dome", "타이베이 돔"),
        ("秀泰影城台北車站店", "Showtime Cinemas Taipei Main Station Store", "쇼타임 시네마 타이베이역점"),
        ("中正紀念堂", "Chiang Kai-shek Memorial Hall", "중정기념당"),
        ("國立故宮博物院", "National Palace Museum", "국립고궁박물원"),
        ("鼎泰豐", "Din Tai Fung", "딘타이펑"),
        ("全聯福利中心天母店", "PX Mart Tianmu Store", "취안롄 톈무점"),
    ],
)
def test_official_landmark_and_brand_names(name, en, ko):
    assert L.localize_name(name, "en")["text"] == en
    assert L.localize_name(name, "ko")["text"] == ko


def test_brand_written_twice_shows_once():
    assert L.localize_name("IKEA宜家家居", "en")["text"] == "IKEA"


def test_language_details_2026_11_08():
    # 印尼文不用 TDX 的英文縮寫（MRT Zhishan Sta.），照印尼文組
    assert L.localize_name("捷運芝山站", "id")["text"] == "Stasiun MRT Zhishan"
    # 越南文的名稱用官方拼音，不用漢越音（好 會挑成 Háo）
    assert L.localize_name("好學補習班", "vi")["text"] == "Trung tâm luyện thi Hảo Học"  # 漢越音，好 = hảo
    # 日文：台北駅、日文字形
    assert L.localize_name("臺北車站", "ja")["text"] == "台北駅"
    assert L.localize_name("中山站裝置藝術街", "ja")["text"] == "中山駅装置芸術街"
    # 連鎖品牌
    assert L.localize_name("全家便利商店 芝山店", "th")["text"] == "ร้าน FamilyMart จือซาน"
    assert L.localize_name("全家便利商店 芝山店", "ja")["text"] == "ファミリーマート芝山店"
