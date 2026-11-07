"""B 的 app/metrics.py 交付前使用的 stub：介面相同、數字全部是 None。

B 交付後 routes_service 會自動改用 B 的版本，不用改 A 的程式。
"""
from dataclasses import dataclass

from app.engine import EngineRoute


@dataclass(frozen=True)
class Metrics:
    steps: int | None
    climb_m: float | None
    lit_ratio: float | None
    unsignalized_crossings: int | None
    signal_crossings: int | None
    unknown_crossings: int | None
    max_grade_pct: float | None = None
    cameras: int | None = None
    police_nearby: int | None = None
    # 路線模式「安全」用（store_points.json、trace_attributes）；沒有資料是 None
    stores: int | None = None               # 路線 STORE_BUFFER_M 內的便利商店數
    shop_ratio: float | None = None         # 每 20 公尺取一點，附近有店面的比例
    quiet_ratio: float | None = None        # 走在小巷、私人車道、產業道路、山徑的長度比例
    main_road_ratio: float | None = None    # 走在主要道路（含旁邊人行道）的長度比例


def measure(route: EngineRoute) -> Metrics:
    return Metrics(None, None, None, None, None, None)
