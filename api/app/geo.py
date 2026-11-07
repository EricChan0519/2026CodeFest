"""WGS84 兩點間的球面距離。"""
from math import asin, cos, radians, sin, sqrt

from app.engine import LatLon


def haversine_m(a: LatLon, b: LatLon) -> float:
    lat1, lat2 = radians(a[0]), radians(b[0])
    dlat, dlon = lat2 - lat1, radians(b[1] - a[1])
    h = sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlon / 2) ** 2
    return 2 * 6371008.8 * asin(sqrt(min(1.0, max(0.0, h))))
