# Valhalla walking-route service for Taipei. Tiles are baked into the image,
# so the running service needs no network and holds no user data.
FROM debian:bookworm-slim AS extract
RUN apt-get update && apt-get install -y --no-install-recommends osmium-tool curl ca-certificates
RUN curl -fsSL -o /taiwan.osm.pbf https://download.geofabrik.de/asia/taiwan-latest.osm.pbf \
 && osmium extract -b 121.45,24.96,121.67,25.21 /taiwan.osm.pbf -o /taipei.osm.pbf \
 && rm /taiwan.osm.pbf

FROM ghcr.io/valhalla/valhalla:3.9.1 AS tiles
COPY --from=extract /taipei.osm.pbf /data/taipei.osm.pbf
RUN valhalla_build_config \
      --mjolnir-tile-dir /data/tiles \
      --mjolnir-tile-extract /data/tiles.tar \
      --httpd-service-listen 'tcp://*:8080' \
      > /data/valhalla.json \
 && valhalla_build_tiles -c /data/valhalla.json /data/taipei.osm.pbf \
 && valhalla_build_extract -c /data/valhalla.json -v \
 && rm -rf /data/tiles /data/taipei.osm.pbf

FROM ghcr.io/valhalla/valhalla:3.9.1
COPY --from=tiles /data /data
EXPOSE 8080
ENTRYPOINT ["valhalla_service", "/data/valhalla.json", "1"]
