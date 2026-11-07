from scripts.build_store_points import build, cell_of, dedupe

POI = {
    "release": "r1",
    "brands": [{"key": "7-11"}, {"key": "mcdonalds"}, {"key": "familymart"}],
    "places": [
        [0, "7-ELEVEN 天母門市", 25.1175, 121.5310, "addr", 99],
        [0, "7-ELEVEN 天母門市", 25.11751, 121.53101, "addr", 90],  # same store twice
        [1, "麥當勞", 25.1180, 121.5320, "addr", 99],
        [2, "全家 墾丁", 21.95, 120.80, "addr", 99],  # outside Taipei
    ],
}
PLACES = {
    "release": "r1",
    "categories": ["餐廳", "學校", "便利商店"],
    "places": [
        ["小館", 25.1000, 121.5000, None, 0, 90],
        ["國小", 25.1010, 121.5010, None, 1, 90],
        ["萊爾富", 25.1020, 121.5020, None, 2, 90],
    ],
}


def test_build_keeps_taipei_convenience_and_shop_cells():
    out = build(POI, PLACES, "t")
    assert out["updatedAt"] == "t" and out["release"] == "r1"
    assert sorted(map(tuple, out["convenience"])) == [(25.102, 121.502), (25.1175, 121.531)]
    assert cell_of(25.1180, 121.5320) in out["shopCells"]  # McDonald's is a storefront, not a convenience store
    assert cell_of(25.1000, 121.5000) in out["shopCells"]
    assert cell_of(25.1010, 121.5010) not in out["shopCells"]  # schools are not storefronts
    assert out["shopCells"] == sorted(out["shopCells"])


def test_dedupe_only_merges_close_points():
    assert len(dedupe([(25.1, 121.5), (25.10001, 121.50001), (25.101, 121.5)])) == 2
