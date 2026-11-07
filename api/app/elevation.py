"""Read the optional WGS84 elevation grid."""
import json
import math
import os
import sys
from array import array
from functools import lru_cache
from pathlib import Path


@lru_cache(maxsize=1)
def _load():
    path = Path(os.environ.get('ELEVATION_GRID_PATH') or Path(__file__).resolve().parents[1] / 'data' / 'elevation_grid.json')
    try:
        meta = json.loads(path.read_text(encoding='utf-8'))
        rows, cols = meta['rows'], meta['cols']
        if type(rows) is not int or type(cols) is not int or rows < 2 or cols < 2:
            return None
        for key in ('lat0', 'lon0', 'step', 'scale'):
            if not isinstance(meta[key], (int, float)) or not math.isfinite(meta[key]):
                return None
        if meta['step'] <= 0 or meta['scale'] <= 0 or type(meta['nodata']) is not int or not -32768 <= meta['nodata'] <= 32767:
            return None
        if not isinstance(meta['updatedAt'], str) or not isinstance(meta['source'], dict):
            return None
        raw = path.with_suffix('.bin').read_bytes()
        if len(raw) != rows * cols * 2:
            return None
        data = array('h')
        if data.itemsize != 2:
            return None
        data.frombytes(raw)
        if sys.byteorder != 'little':
            data.byteswap()
        return meta, data
    except (OSError, ValueError, TypeError, KeyError, OverflowError):
        return None


def available():
    return _load() is not None


def updated_at():
    grid = _load()
    return grid[0]['updatedAt'] if grid else None


def source():
    grid = _load()
    return grid[0]['source'].copy() if grid else None


def height(lat, lon):
    grid = _load()
    if grid is None:
        return None
    meta, data = grid
    try:
        y, x = (lat - meta['lat0']) / meta['step'], (lon - meta['lon0']) / meta['step']
        if not math.isfinite(x) or not math.isfinite(y) or x < 0 or y < 0 or x >= meta['cols'] - 1 or y >= meta['rows'] - 1:
            return None
        row, col = math.floor(y), math.floor(x)
        i = row * meta['cols'] + col
        vals = (data[i], data[i+1], data[i+meta['cols']], data[i+meta['cols']+1])
        if meta['nodata'] in vals:
            return None
        u, v = x - col, y - row
        return (vals[0]*(1-u)*(1-v) + vals[1]*u*(1-v) + vals[2]*(1-u)*v + vals[3]*u*v) * meta['scale']
    except (TypeError, ValueError, OverflowError):
        return None
