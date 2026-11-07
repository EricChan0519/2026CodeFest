# routing：臺北步行路徑服務

Valhalla 3.9.1（MIT）＋ OpenStreetMap（© OpenStreetMap contributors，ODbL），範圍 `121.45,24.96,121.67,25.21`。路網在建置映像時從 Geofabrik 下載並裁切，執行時不需要網路，也不存使用者資料。

```bash
docker build -t routing routing/
docker run --rm -p 8080:8080 routing
curl -s localhost:8080/route -d '{"locations":[{"lat":25.0478,"lon":121.5170},{"lat":25.0405,"lon":121.5190}],"costing":"pedestrian","units":"kilometers"}'
```

部署：

```bash
gcloud run deploy routing --source routing --region asia-east1 --memory 2Gi --max-instances 2 --no-allow-unauthenticated --port 8080
```

服務是私有的，匿名存取回 403。`api` 的服務帳號要有這個服務的 `roles/run.invoker`，並設定 `ROUTING_ENGINE=valhalla`、`ROUTING_URL=<服務網址>`、`ROUTING_AUTH=iam`；adapter 會向 metadata server 取得 ID token。

本機測試不用設 `ROUTING_AUTH`，直接呼叫本機容器。

**更新路網：** 重新建置並部署（要用 `--no-cache`，否則會沿用舊的 PBF）。
