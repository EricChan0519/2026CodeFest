from pathlib import Path

import pytest

from app.main import app, get_place_index
from app.places import PlaceIndex, address_query, normalize

REAL_INDEX = Path(__file__).resolve().parents[1] / "data" / "place_index.json.gz"

DOC = {
    "release": "test",
    "updatedAt": "2026-11-07T21:00:00+08:00",
    "license": "CDLA-Permissive-2.0 / Apache-2.0 / CC0-1.0",
    "categories": ["運動場館", "大學", "餐廳", "職業學校"],
    "places": [
        ["天母體育館", 25.115164, 121.534019, "", 0, 92],
        ["臺北市立大學詩欣館", 25.114431, 121.536835, "忠誠路二段122號", 1, 89],
        ["台北市職能發展學院", 25.114746, 121.537834, "士東路301號", 3, 87],
        ["信義體育館", 25.0330, 121.5650, "松勤街100號", 0, 90],
        ["天母豆漿", 25.1121, 121.5375, "中山北路七段1號", 2, 70],
        ["天母豆漿", 25.0500, 121.5200, "忠孝西路一段2號", 2, 95],
        ["中正紀念堂", 25.0350, 121.5210, "中山南路21號", 0, 95],
        ["中正紀念堂 春水堂", 25.1140, 121.5370, "", 2, 80],
        ["咖啡店", 25.1141, 121.5371, "鼎泰豐大樓1樓", 2, 80],
    ],
}

TIANMU = (25.1150, 121.5360)
TAIPEI_STATION = (25.0478, 121.517)


@pytest.fixture
def index():
    return PlaceIndex.from_doc(DOC)


@pytest.fixture
def places_client(client, index):
    app.dependency_overrides[get_place_index] = lambda: index
    return client


def names(rows):
    return [r["name"] for r in rows]


def test_normalize_unifies_tai_width_spaces_and_section_digits():
    assert normalize("台北 市立大學") == "臺北市立大學"
    assert normalize("忠誠路２段１２２號") == "忠誠路二段122號"
    assert normalize("McDonald's") == "mcdonalds"


def test_address_query_drops_city_district_and_floor():
    assert address_query(normalize("臺北市士林區士東路301號3樓")) == "士東路301號"


def test_name_substring(index):
    assert names(index.search("天母體育")) == ["天母體育館"]


def test_query_containing_the_whole_name(index):
    # 使用者打完整的「台北市立大學天母體育館」，資料裡叫「天母體育館」
    assert names(index.search("台北市立大學天母體育館", TIANMU)) == ["天母體育館"]


def test_address_match_with_city_and_district(index):
    assert names(index.search("台北市士林區士東路301號")) == ["台北市職能發展學院"]
    assert names(index.search("忠誠路2段122號")) == ["臺北市立大學詩欣館"]


def test_sorted_by_distance_from_user(index):
    near_tianmu = index.search("天母豆漿", TIANMU)
    assert [r["address"] for r in near_tianmu] == ["中山北路七段1號", "忠孝西路一段2號"]
    assert near_tianmu[0]["distanceM"] < near_tianmu[1]["distanceM"]
    near_station = index.search("天母豆漿", TAIPEI_STATION)
    assert [r["address"] for r in near_station] == ["忠孝西路一段2號", "中山北路七段1號"]


def test_same_location_changes_order(index):
    # 同一個搜尋，換一個位置就重新依距離排（不會沿用第一次的位置）
    a = index.search("體育館", TIANMU)
    b = index.search("體育館", (25.0330, 121.5650))
    assert names(a) == ["天母體育館", "信義體育館"]
    assert names(b) == ["信義體育館", "天母體育館"]


def test_without_location_orders_by_confidence(index):
    rows = index.search("天母豆漿")
    assert [r["address"] for r in rows] == ["忠孝西路一段2號", "中山北路七段1號"]
    assert all(r["distanceM"] is None for r in rows)


def test_typo_falls_back_to_bigrams(index):
    assert names(index.search("台北市職能發展學校")) == ["台北市職能發展學院"]


def test_exact_name_first_then_by_distance(index):
    # 「中正紀念堂」本身比較遠，還是排在名稱只是包含它的地點前面
    assert names(index.search("中正紀念堂", TIANMU)) == ["中正紀念堂", "中正紀念堂 春水堂"]


def test_generic_short_name_is_not_pulled_to_the_top(index, monkeypatch):
    # 「體育館」是通稱：名稱剛好叫「體育館」的遠處地點不可以排在近的「天母體育館」前面
    far_generic = PlaceIndex.from_doc({**DOC, "places": DOC["places"] + [["體育館", 25.0330, 121.6100, "", 0, 90]]})
    assert names(far_generic.search("體育館", TIANMU))[0] == "天母體育館"


def test_abbreviation_expands(index):
    assert "臺北市立大學詩欣館" in names(index.search("北市大詩欣館", TIANMU))


def test_address_only_matches_address_like_queries(index):
    # 「鼎泰豐」不是地址，不可以因為某家店的地址寫了「鼎泰豐大樓」就配到
    assert index.search("鼎泰豐", TIANMU) == []
    assert names(index.search("鼎泰豐大樓1樓", TIANMU)) == []  # 沒有路、街、號，不當地址比對
    assert names(index.search("士東路301號", TIANMU)) == ["台北市職能發展學院"]


def test_no_match(index):
    assert index.search("完全不存在的地方") == []


def test_unavailable_index():
    from app.errors import ApiError

    with pytest.raises(ApiError) as e:
        PlaceIndex.load(Path("/nonexistent/place_index.json.gz")).search("天母")
    assert e.value.code == "DATA_UNAVAILABLE"


def test_endpoint_returns_places_with_distance_and_source(places_client):
    r = places_client.post("/api/landmarks/search", json={"q": "天母體育館", "lat": TIANMU[0], "lon": TIANMU[1]})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["places"][0] == {
        "name": "天母體育館", "lat": 25.115164, "lon": 121.534019, "address": None,
        "category": "運動場館", "distanceM": body["places"][0]["distanceM"],
    }
    assert isinstance(body["places"][0]["distanceM"], int)
    assert body["source"]["name"] == "Overture Maps Places"


def test_endpoint_validation_does_not_echo_input(places_client):
    r = places_client.post("/api/landmarks/search", json={"q": "", "lat": 25.1, "lon": 121.5})
    assert r.status_code == 422 and r.json() == {"error": {"code": "VALIDATION_ERROR"}}


@pytest.mark.skipif(not REAL_INDEX.exists(), reason="沒有 place_index.json.gz")
class TestRealSnapshot:
    @pytest.fixture(scope="class")
    def real(self):
        idx = PlaceIndex.load(REAL_INDEX)
        assert idx.available
        return idx

    def test_finds_tianmu_gym_from_the_full_name(self, real):
        # 2026-11-07 回報：「台北市立大學天母體育館」在 OSM 查不到
        rows = real.search("台北市立大學天母體育館", TIANMU)
        assert "天母體育館" in names(rows)[:5]

    def test_finds_vocational_institute_by_address(self, real):
        assert "台北市職能發展學院" in names(real.search("士東路301號", TIANMU))

    def test_results_are_sorted_by_distance(self, real):
        rows = real.search("國小", TIANMU, limit=50)
        d = [r["distanceM"] for r in rows]
        assert len(rows) == 50 and d == sorted(d)

    def test_mrt_station_phrased_the_other_way(self, real):
        # 2026-11-07 回報：「芝山捷運站」查到中山、龍山寺、圓山捷運站
        for q in ("芝山捷運站", "捷運芝山", "芝山mrt"):
            rows = names(real.search(q, (25.0478, 121.517), limit=20))
            assert rows and all("芝山" in n for n in rows), (q, rows[:5])


def test_fuzzy_requires_the_place_name_part():
    idx = PlaceIndex.from_doc({**DOC, "places": DOC["places"] + [
        ["中山捷運站", 25.05, 121.52, "", 0, 90],
        ["捷運芝山站 候車區", 25.10, 121.52, "", 0, 90],
    ]})
    out = names(idx.search("芝山捷運站", TAIPEI_STATION))
    assert "捷運芝山站 候車區" in out and "中山捷運站" not in out


def test_the_place_itself_comes_before_names_that_only_mention_it():
    # 2026-11-07 回報：「士林站」最前面是「接睫毛/…/士林站/…」（比較近），捷運士林站反而在後面
    idx = PlaceIndex.from_doc({**DOC, "categories": ["生活服務", "車站", "公車站"], "places": [
        ["璞美學-接睫毛/民權西路站/中山站/雙連站/劍潭站/士林站/大橋頭站", 25.0630, 121.5200, "", 0, 90],
        ["大都會士林站", 25.0940, 121.5260, "", 2, 90],
        ["捷運士林站", 25.0935, 121.5262, "", 1, 90],
        ["公車士林站", 25.0950, 121.5250, "", 2, 90],
    ]})
    out = names(idx.search("士林站", TAIPEI_STATION))
    assert out[:2] == ["捷運士林站", "公車士林站"]
    assert out[-1].startswith("璞美學")
