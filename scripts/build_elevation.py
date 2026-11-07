"""Build the Taipei elevation snapshot from the 20 m DTM ZIP."""
import json
import math
import sys
import zipfile
from array import array
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import TemporaryDirectory

import httpx
from pyproj import Transformer

URL = 'https://www.tgos.tw/MDE/VirtualDir_TC/Product/d18c7b0d-1f49-4a9d-9eb3-3a0f94b33255/分幅_臺北市DEM.zip'
OUTPUT = Path(__file__).resolve().parents[1] / 'api' / 'data' / 'elevation_grid.json'
STEP = 0.0002
NODATA = -32768
SOURCE = {'name': '內政部20公尺網格數值地形模型資料', 'url': 'https://data.gov.tw/dataset/35430', 'license': '政府資料開放授權第1版'}
TO_WGS = Transformer.from_crs(3826, 4326, always_xy=True)
TO_TWD = Transformer.from_crs(4326, 3826, always_xy=True)


def read_points(path):
    points = {}
    with zipfile.ZipFile(path) as archive:
        for name in archive.namelist():
            if name.lower().endswith('.grd'):
                with archive.open(name) as source:
                    for line in source:
                        x, y, h = line.split()
                        points[(int(x), int(y))] = float(h)
    return points


def interpolate(points, x, y):
    x0, y0 = math.floor(x / 20) * 20, math.floor(y / 20) * 20
    values = [points.get((x0, y0)), points.get((x0 + 20, y0)), points.get((x0, y0 + 20)), points.get((x0 + 20, y0 + 20))]
    if any(v is None for v in values):
        return None
    u, v = (x - x0) / 20, (y - y0) / 20
    return values[0] * (1-u) * (1-v) + values[1] * u * (1-v) + values[2] * (1-u) * v + values[3] * u * v


def build(points, updated_at):
    # Transform all source points: projected bounding-box corners are not necessarily extrema.
    lons, lats = TO_WGS.transform(*zip(*points))
    lat_start, lon_start = math.floor(min(lats) / STEP), math.floor(min(lons) / STEP)
    lat_end, lon_end = math.ceil(max(lats) / STEP), math.ceil(max(lons) / STEP)
    rows, cols = lat_end - lat_start + 1, lon_end - lon_start + 1
    data = array('h')
    for row in range(rows):
        lat = (lat_start + row) * STEP
        xs, ys = TO_TWD.transform([(lon_start + col) * STEP for col in range(cols)], [lat] * cols)
        for x, y in zip(xs, ys):
            h = interpolate(points, x, y)
            value = round(h * 10) if h is not None else NODATA
            data.append(value if -32767 <= value <= 32767 else NODATA)
    if sys.byteorder != 'little':
        data.byteswap()
    meta = {'updatedAt': updated_at, 'source': SOURCE, 'lat0': round(lat_start * STEP, 7), 'lon0': round(lon_start * STEP, 7), 'step': STEP, 'rows': rows, 'cols': cols, 'scale': 0.1, 'nodata': NODATA}
    return meta, data.tobytes()


def main():
    with TemporaryDirectory() as temp:
        if len(sys.argv) > 1:
            path = Path(sys.argv[1])
        else:
            path = Path(temp) / 'source.zip'
            response = httpx.get(URL, timeout=300, follow_redirects=True)
            response.raise_for_status()
            path.write_bytes(response.content)
        points = read_points(path)
        meta, data = build(points, datetime.now(timezone(timedelta(hours=8))).isoformat(timespec='seconds'))
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(meta, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    OUTPUT.with_suffix('.bin').write_bytes(data)
    print(f"source points={len(points)} rows={meta['rows']} cols={meta['cols']} bytes={len(data)}")


if __name__ == '__main__':
    main()
