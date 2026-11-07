"""錯誤格式：一律回 {"error": {"code": ...}}，不回傳使用者輸入（座標不外洩）。代碼見 docs/arrow-nav/03-contracts.md。"""
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


class ApiError(Exception):
    def __init__(self, code: str, status: int):
        super().__init__(code)
        self.code = code
        self.status = status


def _body(code: str) -> dict:
    return {"error": {"code": code}}


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(_: Request, exc: ApiError):
        return JSONResponse(_body(exc.code), status_code=exc.status)

    # FastAPI 預設的 422 會把輸入（含座標）放進回應，這裡改成只回代碼
    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, __: RequestValidationError):
        return JSONResponse(_body("VALIDATION_ERROR"), status_code=422)
