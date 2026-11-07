import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from build_place_index import category_label, dedupe, misplaced  # noqa: E402


def test_category_labels():
    assert category_label("stadium_arena", "sports_and_recreation") == "運動場館"
    assert category_label("taiwanese_restaurant", "food_and_drink") == "餐廳"
    assert category_label("dental_clinic", "health_care") == "牙醫"
    assert category_label("pediatric_clinic", "health_care") == "診所"
    assert category_label("something_new", "education") == "學校"
    assert category_label(None, None) == "地點"


def test_misplaced_schools_from_other_counties_are_dropped():
    # 實測：這兩間學校的座標被放在臺北車站旁
    assert misplaced("台南七股樹林國小", "國小")
    assert misplaced("苗栗南庄東河國小", "國小")


def test_local_or_food_places_with_county_names_are_kept():
    assert not misplaced("台南擔仔麵", "餐廳")  # 臺北的餐廳
    assert not misplaced("新店小金門友誼運動公園", "公園")  # 不是開頭
    assert not misplaced("基隆市七堵區堵南國民小學", "國小")  # 七堵在範圍內
    assert not misplaced("天母體育館", "運動場館")


def test_dedupe_same_name_nearby_keeps_highest_confidence_and_fills_address():
    rows = [
        ("天母體育館", 25.11516, 121.53402, "", "運動場館", 0.92),
        ("天母體育館", 25.11530, 121.53410, "忠誠路二段77號", "運動場館", 0.70),
        ("天母體育館", 25.03000, 121.56000, "", "運動場館", 0.80),
    ]
    out = dedupe(rows)
    assert len(out) == 2
    assert out[0][5] == 0.92 and out[0][3] == "忠誠路二段77號"
