from typing import Literal

from pydantic import BaseModel, Field

CandidateId = Literal["fastest", "fewer_steps_hills", "fewer_steps_hills_bright", "fewer_unsignalized", "fewer_unsignalized_bright", "bright"]


class NearbyRequest(BaseModel):
    lat: float
    lon: float
    radiusM: int = Field(500, ge=1, le=2000)


class AroundRequest(BaseModel):
    lat: float
    lon: float
    radiusM: int = Field(50, ge=5, le=300)
    policeRadiusM: int = Field(150, ge=10, le=1000)


class PlaceSearchRequest(BaseModel):
    q: str = Field(min_length=1, max_length=60)
    # 使用者位置：只用來依距離排序；不給就依資料信心排
    lat: float | None = Field(None, ge=-90, le=90)
    lon: float | None = Field(None, ge=-180, le=180)
    limit: int = Field(20, ge=1, le=50)


class TranslateQueryRequest(BaseModel):
    q: str = Field(min_length=1, max_length=60)


class TranslateNamesRequest(BaseModel):
    lang: Literal["en", "id", "vi", "th", "km", "ko", "ja"]
    names: list[str] = Field(default_factory=list, max_length=100)
    addresses: list[str] = Field(default_factory=list, max_length=100)
    categories: list[str] = Field(default_factory=list, max_length=100)


class LatLonIn(BaseModel):
    lat: float
    lon: float


class RouteTarget(LatLonIn):
    stationUid: str | None = None


class RoutesRequest(BaseModel):
    from_: LatLonIn = Field(alias="from")
    to: RouteTarget
    audience: Literal["elder", "child", "visitor"]
    candidate: CandidateId | None = None
    simulate: Literal["night"] | None = None
