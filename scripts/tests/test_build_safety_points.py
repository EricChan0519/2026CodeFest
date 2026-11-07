from scripts.build_safety_points import (
    AddressIndex,
    PlaceIndex,
    build,
    build_police,
    parse_address,
    parse_intersection,
    resolve,
)


def test_parse_house_address():
    assert parse_address("民生西路231號") == {"street": "民生西路", "number": "231", "lane": False}
    assert parse_address("寧夏路55號燈桿")["number"] == "55"
    assert parse_address("北市中正區臨沂街25巷19號旁路口監控") == {"street": "臨沂街25巷", "number": "19", "lane": False}
    assert parse_address("福港街259巷3弄1號") == {"street": "福港街259巷3弄", "number": "1", "lane": False}


def test_section_becomes_chinese_numeral_like_overture():
    assert parse_address("木柵路1段191巷29號")["street"] == "木柵路一段191巷"
    assert parse_address("南港路3段30號")["street"] == "南港路三段"
    assert parse_address("中山北路7段38巷11號前")["street"] == "中山北路七段38巷"
    assert parse_address("中山北路10段1號")["street"] == "中山北路十段"
    assert parse_address("重慶北路一段58號前")["street"] == "重慶北路一段"
    assert parse_address("南京東路二段21巷32號前")["street"] == "南京東路二段21巷"


def test_dash_and_zhi_numbers_match():
    assert parse_address("虎林街68-3號前燈桿")["number"] == "68-3"
    assert parse_address("虎林街68之3號")["number"] == "68-3"


def test_lane_without_number_and_road_only():
    assert parse_address("文林北路94巷底對面號誌桿") == {"street": "文林北路94巷", "number": None, "lane": True}
    assert parse_address("中山北路") is None


def test_intersections_are_not_house_addresses():
    assert parse_address("承德路5段與士商路口") is None
    assert parse_address("貴陽街1段、中山南路口") is None
    assert parse_intersection("承德路5段與士商路口") == ("承德路五段", "士商路")
    assert parse_intersection("貴陽街1段、中山南路口") == ("貴陽街一段", "中山南路")
    assert parse_intersection("北市南港區經園街＆南港連絡道口路口監控") == ("經園街", "南港連絡道")
    assert parse_intersection("民生西路231號") is None


ROWS = [
    ("民生西路", "２３１號", "大同區", 121.5100, 25.0560),
    ("民生西路", "２３３號", "大同區", 121.5102, 25.0560),
    ("木柵路一段１９１巷", "２９", "文山區", 121.5400, 24.9900),
    ("承德路五段", "１號", "士林區", 121.5200, 25.0900),
    ("士商路", "２號", "士林區", 121.5201, 25.0900),
    ("中山北路", "１號", "中山區", 121.5300, 25.0600),
    ("中山北路", "１號", "士林區", 121.5900, 25.1200),
]


def test_resolve_tiers():
    index = AddressIndex(ROWS)
    assert resolve("民生西路231號", index)[0] == "exact"
    tier, (lat, lon) = resolve("民生西路235號", index)  # 235 missing, 233 is 2 away, same parity
    assert tier == "nearby_number" and abs(lon - 121.5102) < 1e-6
    assert resolve("民生西路230號", index) is None  # wrong parity
    assert resolve("木柵路1段191巷29號", index)[0] == "exact"
    assert resolve("木柵路1段191巷旁", index)[0] == "lane"
    assert resolve("承德路5段與士商路口", index)[0] == "intersection"
    assert resolve("承德路5段與不存在路口", index) is None


def test_ambiguous_address_in_distant_districts_is_dropped():
    assert resolve("中山北路1號", AddressIndex(ROWS)) is None


def test_build_dedupes_and_reports_coverage():
    index = AddressIndex(ROWS)
    cameras = [{"安裝地址": a} for a in ["民生西路231號", "民生西路231號", "民生西路233號", "沒有這條路99號"]]
    out = build(cameras, index, "t")
    assert out["updatedAt"] == "t" and out["police"] == []
    assert len(out["cameras"]) == 2
    c = out["cameraCoverage"]
    assert (c["cameraRows"], c["uniqueAddresses"], c["resolvedAddresses"]) == (4, 3, 2)
    assert c["tiers"] == {"exact": 2, "unresolved": 1}


POLICE = [
    {"name": "民生派出所", "display_addr": "臺北市大同區民生西路231號"},  # exact address
    {"name": "木柵派出所", "display_addr": "臺北市文山區木柵路一段191巷31號"},  # only a nearby number
    {"name": "康定路派出所", "display_addr": "臺北市萬華區和平西路三段112號"},  # address missing, found by name
    {"name": "不存在派出所", "display_addr": "臺北市萬華區沒有路1號"},
]
PLACES = PlaceIndex([
    ("康定路派出所", 121.5005, 25.0351),
    ("木柵派出所", 121.5500, 25.0000),  # far from the address: must not replace the address guess
    ("木柵派出所", 121.5401, 24.9901),
])


def test_police_resolution_order():
    police, coverage = build_police(POLICE, AddressIndex(ROWS), PLACES)
    by_name = {p[2]: p for p in police}
    assert by_name["民生派出所"][:2] == [25.056, 121.5100]
    assert by_name["康定路派出所"][:2] == [25.0351, 121.5005]
    assert abs(by_name["木柵派出所"][1] - 121.5401) < 1e-6
    assert "不存在派出所" not in by_name
    assert coverage["rows"] == 4 and coverage["resolved"] == 3
    assert coverage["tiers"] == {"exact": 1, "place": 2, "unresolved": 1}


def test_place_name_alone_is_not_enough_when_ambiguous():
    places = PlaceIndex([("中山派出所", 121.4, 25.0), ("中山派出所", 121.6, 25.2)])
    assert places.find("中山派出所") is None
    assert places.find("中山派出所", (25.0001, 121.4001)) == (25.0, 121.4)
    assert places.find("中山派出所", (25.1, 121.5)) is None  # neither within 1 km


def test_build_includes_police_and_sources():
    out = build([{"安裝地址": "民生西路231號"}], AddressIndex(ROWS), "t", POLICE, PLACES)
    assert len(out["police"]) == 3
    assert out["policeCoverage"]["resolved"] == 3
    assert "臺北市政府警察局名稱及地址" in out["sources"]
