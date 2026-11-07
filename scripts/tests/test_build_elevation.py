import zipfile
import struct
from scripts import build_elevation as b


def test_grd_interpolation_and_output(tmp_path):
    zpath = tmp_path / 'sample.zip'
    with zipfile.ZipFile(zpath, 'w') as z:
        z.writestr('tile.grd', '300000 2770000 10\n300020 2770000 20\n300000 2770020 30\n300020 2770020 40\n')
    points = b.read_points(zpath)
    assert len(points) == 4
    assert b.interpolate(points, 300010, 2770010) == 25
    assert b.interpolate(points, 300030, 2770010) is None
    meta, data = b.build(points, 'today')
    assert meta['updatedAt'] == 'today'
    assert len(data) == meta['rows'] * meta['cols'] * 2
    assert meta['nodata'] == -32768 and meta['scale'] == 0.1
    values = struct.unpack(f"<{meta['rows'] * meta['cols']}h", data)
    assert -32768 in values
    assert any(v != -32768 for v in values)
