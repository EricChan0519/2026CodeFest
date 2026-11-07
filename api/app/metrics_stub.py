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


def measure(route: EngineRoute) -> Metrics:
    return Metrics(None, None, None, None, None, None)
