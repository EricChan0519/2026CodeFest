from pydantic import BaseModel, Field


class NearbyRequest(BaseModel):
    lat: float
    lon: float
    radiusM: int = Field(500, ge=1, le=2000)
