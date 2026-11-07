/**
 * 2026-11-07 實際回應：士東路 286 巷（25.1129, 121.53739）往北過士東路，到 299 巷（25.115, 121.53760）。
 * 回報的問題：由下往上走，還沒過士東路就說右轉。
 *
 * 路線 geometry：
 *   0–2 士東路 286 巷往北，到士東路南側
 *   2–6 斑馬線（OSM way 827108893）：先沿路邊往東 14 m（2→3），再往北過士東路（3→6）
 *   6–7 北側人行道往東
 *   7–8 巷口短斑馬線（約 7 m，不算過馬路）
 *   8–9 左轉進 299 巷往北
 * Valhalla 的提示：2 右轉（上斑馬線）、6 右轉（上人行道）、8 左轉。
 * trace_attributes 的 edge 只留 use、road_class、index。
 */
export const SHIDONG_ROUTE = {
  trip: {
    summary: { length: 0.262, time: 248.243 },
    legs: [
      {
        shape: 'isw{n@kv`yfF_U`AwEn@y@kG{Ct@yCl@cDv@gAuF?gCqrAE',
        maneuvers: [
          { type: 1, length: 0.051, time: 42.751, begin_shape_index: 0, street_names: ['士東路286巷'] },
          { type: 10, length: 0.042, time: 39.423, begin_shape_index: 2 },
          { type: 10, length: 0.019, time: 19.17, begin_shape_index: 6 },
          { type: 15, length: 0.148, time: 146.898, begin_shape_index: 8 },
          { type: 4, length: 0.0, time: 0.0, begin_shape_index: 9 },
        ],
      },
    ],
  },
}

export const SHIDONG_EDGES = [
  { use: 'road', road_class: 'residential', begin_shape_index: 0, end_shape_index: 2 },
  { use: 'pedestrian_crossing', road_class: 'service_other', begin_shape_index: 2, end_shape_index: 4 },
  { use: 'pedestrian_crossing', road_class: 'service_other', begin_shape_index: 4, end_shape_index: 5 },
  { use: 'pedestrian_crossing', road_class: 'service_other', begin_shape_index: 5, end_shape_index: 6 },
  { use: 'footway', road_class: 'service_other', begin_shape_index: 6, end_shape_index: 7 },
  { use: 'pedestrian_crossing', road_class: 'service_other', begin_shape_index: 7, end_shape_index: 8 },
  { use: 'road', road_class: 'residential', begin_shape_index: 8, end_shape_index: 9 },
]

/** 士東路南側路邊、斑馬線往北過馬路的起點（geometry index 4） */
export const SHIDONG_SOUTH_CURB: [number, number] = [25.113468, 121.537448]
/** 士東路北側，過完馬路的地方（geometry index 6） */
export const SHIDONG_NORTH_SIDE: [number, number] = [25.113627, 121.537397]
