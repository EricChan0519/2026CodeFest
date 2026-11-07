from datetime import datetime, timezone

import pytest
from app.engine import PedestrianCosting
from app.route_rules import TPE, costing_for, period_of


@pytest.mark.parametrize("hour,minute,expected", [(17,59,"day"),(18,0,"night"),(5,59,"night"),(6,0,"day")])
def test_period(hour, minute, expected):
    assert period_of(datetime(2026,11,7,hour,minute,tzinfo=TPE), None) == expected


def test_utc_and_simulation():
    assert period_of(datetime(2026,11,7,10,tzinfo=timezone.utc), None) == "night"
    assert period_of(datetime(2026,11,7,10,tzinfo=TPE), "night") == "night"


@pytest.mark.parametrize("audience,speed", [("elder",3.5),("child",5.1),("visitor",5.1)])
def test_costing(audience, speed):
    assert costing_for("bright", audience) == PedestrianCosting(walking_speed_kmh=speed)
