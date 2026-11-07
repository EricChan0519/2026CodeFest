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
