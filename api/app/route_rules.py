"""階段一的路線時間及步行設定。"""
from datetime import datetime, timedelta, timezone
from typing import Literal

from app.engine import PedestrianCosting

TPE = timezone(timedelta(hours=8))
NIGHT_START_HOUR = 18
NIGHT_END_HOUR = 6
CANDIDATE_IDS = ("fastest", "fewer_steps_hills", "fewer_steps_hills_bright", "fewer_unsignalized", "fewer_unsignalized_bright", "bright")
WALKING_SPEED_KMH = {"elder": 3.5, "child": 5.1, "visitor": 5.1}


def period_of(now: datetime, simulate: str | None) -> Literal["day", "night"]:
    hour = now.astimezone(TPE).hour
    return "night" if simulate == "night" or hour >= NIGHT_START_HOUR or hour < NIGHT_END_HOUR else "day"


def costing_for(candidate_id: str, audience: str) -> PedestrianCosting:
    """階段二會依候選權重表擴充。"""
    return PedestrianCosting(walking_speed_kmh=WALKING_SPEED_KMH[audience])
