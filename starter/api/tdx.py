"""TDX（運輸資料流通服務）用戶端：client_credentials 取 token 並快取重用。

需要環境變數 TDX_CLIENT_ID / TDX_CLIENT_SECRET（只放後端）。
用法：data = await tdx_get("/v2/Bike/Availability/City/Taipei", {"$format": "JSON"})
"""
from __future__ import annotations

import os
import time

import httpx

TOKEN_URL = "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token"
BASE = "https://tdx.transportdata.tw/api/basic"

_token: str | None = None
_exp: float = 0.0


async def _get_token(client: httpx.AsyncClient) -> str:
    global _token, _exp
    if _token and time.time() < _exp - 60:
        return _token
    r = await client.post(
        TOKEN_URL,
        data={
            "grant_type": "client_credentials",
            "client_id": os.environ["TDX_CLIENT_ID"],
            "client_secret": os.environ["TDX_CLIENT_SECRET"],
        },
    )
    r.raise_for_status()
    body = r.json()
    _token, _exp = body["access_token"], time.time() + body.get("expires_in", 3600)
    return _token


async def tdx_get(path: str, params: dict | None = None):
    async with httpx.AsyncClient(timeout=15) as client:
        token = await _get_token(client)
        r = await client.get(BASE + path, params=params, headers={"Authorization": f"Bearer {token}"})
        r.raise_for_status()
        return r.json()
