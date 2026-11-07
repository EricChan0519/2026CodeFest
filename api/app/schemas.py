"""請求格式，欄位名稱依 docs/arrow-nav/03-contracts.md。"""
from pydantic import BaseModel


class NearbyRequest(BaseModel):
    lat: float
    lon: float
    radiusM: int = 500
