/**
 * 路線模式（快速／安全／平緩）的文字：選單、「怎麼去」的路線說明、原因與沿路資訊。
 * 原因代碼與數字來自 POST /api/routes（mode），句子在這裡組（docs/arrow-nav/02-route-candidates.md 的用詞規則：
 * 一定要說出依據、數字來自 API；「路燈較多」不是「比較亮」）。
 * zh-TW、en 由隊員撰寫；其他語言尚未由母語者確認，和 arrow.ts 一樣要在關於頁標示。
 */
import type { Lang, RouteMode } from '@/lib/contract'

export type ReasonKey =
  | 'fewer_steps'
  | 'flatter'
  | 'gentler_slope'
  | 'brighter'
  | 'more_cameras'
  | 'near_police'
  | 'more_stores'
  | 'more_shops'
  | 'fewer_alleys'
  | 'main_roads'
  | 'extra_time'

export type FactKey = 'cameras' | 'stores' | 'police' | 'noSteps' | 'steps' | 'stepsLeft' | 'climb' | 'flat'

export interface RouteModeStrings {
  /** 選單標題 */
  modeTitle: string
  /** 選單上的名稱（zh-TW 一律兩個字，只有文字） */
  modes: Record<RouteMode, string>
  /** 「怎麼去」：推薦的路 */
  walkMode: string
  /** 「怎麼去」：和推薦不同時的最快路線 */
  fastestRoute: string
  planning: string
  noBetter: string
  fallback: string
  /** 時間上限的說明（{pct}） */
  capNote: string
  simNight: string
  reasons: Record<ReasonKey, string>
  facts: Record<FactKey, string>
}

export const ROUTE_MODE_STRINGS: Record<Lang, RouteModeStrings> = {
  'zh-TW': {
    modeTitle: '想走哪一種路？',
    modes: { fast: '快速', safe: '安全', gentle: '平緩' },
    walkMode: '走路 · {mode}',
    fastestRoute: '走路 · 最快的路',
    planning: '正在比較路線…',
    noBetter: '附近沒有更合適的路，帶你走最快的路',
    fallback: '暫時只能找最快的路',
    capNote: '不會比最快的路多花 {pct}% 以上的時間',
    simNight: '模擬晚上',
    reasons: {
      fewer_steps: '少走 {n} 段階梯',
      flatter: '少爬 {n} 公尺的坡',
      gentler_slope: '最陡的地方比較緩',
      brighter: '路燈較多',
      more_cameras: '監視器多 {n} 支',
      near_police: '會經過派出所附近',
      more_stores: '便利商店多 {n} 家',
      more_shops: '沿路店家較多',
      fewer_alleys: '少走小巷',
      main_roads: '多走大馬路',
      extra_time: '多走約 {n} 分鐘',
    },
    facts: {
      cameras: '沿路 {n} 支監視器',
      stores: '{n} 家便利商店',
      police: '經過派出所附近',
      noSteps: '沒有階梯',
      steps: '有 {n} 段階梯',
      stepsLeft: '還有 {n} 段階梯',
      climb: '要爬約 {n} 公尺',
      flat: '坡度平緩',
    },
  },
  en: {
    modeTitle: 'What kind of route?',
    modes: { fast: 'Fastest', safe: 'Safer', gentle: 'Gentle' },
    walkMode: 'Walk · {mode}',
    fastestRoute: 'Walk · Fastest route',
    planning: 'Comparing routes…',
    noBetter: 'No better route nearby, taking the fastest one',
    fallback: 'Only the fastest route is available right now',
    capNote: 'Never more than {pct}% slower than the fastest route',
    simNight: 'Simulated night',
    reasons: {
      fewer_steps: '{n} fewer flights of stairs',
      flatter: '{n} m less climbing',
      gentler_slope: 'Gentler at the steepest part',
      brighter: 'More street lights',
      more_cameras: '{n} more cameras',
      near_police: 'Passes a police station',
      more_stores: '{n} more convenience stores',
      more_shops: 'More shops along the way',
      fewer_alleys: 'Fewer alleys',
      main_roads: 'More main roads',
      extra_time: 'About {n} min longer',
    },
    facts: {
      cameras: '{n} cameras along the way',
      stores: '{n} convenience stores',
      police: 'Passes a police station',
      noSteps: 'No stairs',
      steps: '{n} flights of stairs',
      stepsLeft: 'Still {n} flights of stairs',
      climb: 'About {n} m of climbing',
      flat: 'Mostly flat',
    },
  },
  th: {
    modeTitle: 'ต้องการเส้นทางแบบไหน?',
    modes: { fast: 'เร็วที่สุด', safe: 'ปลอดภัย', gentle: 'ราบเรียบ' },
    walkMode: 'เดิน · {mode}',
    fastestRoute: 'เดิน · เส้นทางที่เร็วที่สุด',
    planning: 'กำลังเปรียบเทียบเส้นทาง…',
    noBetter: 'ไม่มีเส้นทางที่เหมาะกว่านี้ จะพาไปทางที่เร็วที่สุด',
    fallback: 'ตอนนี้หาได้เฉพาะเส้นทางที่เร็วที่สุด',
    capNote: 'ใช้เวลาไม่เกิน {pct}% มากกว่าเส้นทางที่เร็วที่สุด',
    simNight: 'จำลองกลางคืน',
    reasons: {
      fewer_steps: 'บันไดน้อยลง {n} ช่วง',
      flatter: 'ขึ้นเนินน้อยลง {n} เมตร',
      gentler_slope: 'ช่วงที่ชันที่สุดชันน้อยลง',
      brighter: 'ไฟถนนมากกว่า',
      more_cameras: 'กล้องวงจรปิดมากกว่า {n} ตัว',
      near_police: 'ผ่านใกล้สถานีตำรวจ',
      more_stores: 'ร้านสะดวกซื้อมากกว่า {n} ร้าน',
      more_shops: 'มีร้านค้าตลอดทางมากกว่า',
      fewer_alleys: 'เดินในซอยน้อยลง',
      main_roads: 'เดินถนนใหญ่มากขึ้น',
      extra_time: 'นานขึ้นประมาณ {n} นาที',
    },
    facts: {
      cameras: 'กล้องวงจรปิด {n} ตัวตลอดทาง',
      stores: 'ร้านสะดวกซื้อ {n} ร้าน',
      police: 'ผ่านใกล้สถานีตำรวจ',
      noSteps: 'ไม่มีบันได',
      steps: 'มีบันได {n} ช่วง',
      stepsLeft: 'ยังมีบันได {n} ช่วง',
      climb: 'ขึ้นเนินประมาณ {n} เมตร',
      flat: 'ทางค่อนข้างราบ',
    },
  },
  vi: {
    modeTitle: 'Bạn muốn đi đường nào?',
    modes: { fast: 'Nhanh', safe: 'An toàn', gentle: 'Bằng phẳng' },
    walkMode: 'Đi bộ · {mode}',
    fastestRoute: 'Đi bộ · Đường nhanh nhất',
    planning: 'Đang so sánh các tuyến…',
    noBetter: 'Không có đường nào phù hợp hơn, sẽ đi đường nhanh nhất',
    fallback: 'Hiện chỉ tìm được đường nhanh nhất',
    capNote: 'Không chậm hơn đường nhanh nhất quá {pct}%',
    simNight: 'Mô phỏng ban đêm',
    reasons: {
      fewer_steps: 'Ít hơn {n} đoạn bậc thang',
      flatter: 'Leo dốc ít hơn {n} m',
      gentler_slope: 'Chỗ dốc nhất thoải hơn',
      brighter: 'Nhiều đèn đường hơn',
      more_cameras: 'Nhiều hơn {n} camera',
      near_police: 'Đi qua gần đồn cảnh sát',
      more_stores: 'Nhiều hơn {n} cửa hàng tiện lợi',
      more_shops: 'Nhiều cửa hàng dọc đường hơn',
      fewer_alleys: 'Ít đi hẻm hơn',
      main_roads: 'Đi đường lớn nhiều hơn',
      extra_time: 'Lâu hơn khoảng {n} phút',
    },
    facts: {
      cameras: '{n} camera dọc đường',
      stores: '{n} cửa hàng tiện lợi',
      police: 'Đi qua gần đồn cảnh sát',
      noSteps: 'Không có bậc thang',
      steps: 'Có {n} đoạn bậc thang',
      stepsLeft: 'Vẫn còn {n} đoạn bậc thang',
      climb: 'Leo dốc khoảng {n} m',
      flat: 'Khá bằng phẳng',
    },
  },
  id: {
    modeTitle: 'Mau rute yang seperti apa?',
    modes: { fast: 'Cepat', safe: 'Aman', gentle: 'Landai' },
    walkMode: 'Jalan kaki · {mode}',
    fastestRoute: 'Jalan kaki · Rute tercepat',
    planning: 'Membandingkan rute…',
    noBetter: 'Tidak ada rute yang lebih cocok, memakai rute tercepat',
    fallback: 'Saat ini hanya rute tercepat yang tersedia',
    capNote: 'Paling lama {pct}% lebih lambat dari rute tercepat',
    simNight: 'Simulasi malam',
    reasons: {
      fewer_steps: '{n} tangga lebih sedikit',
      flatter: 'Tanjakan {n} m lebih sedikit',
      gentler_slope: 'Bagian tercuram lebih landai',
      brighter: 'Lampu jalan lebih banyak',
      more_cameras: '{n} kamera lebih banyak',
      near_police: 'Melewati dekat kantor polisi',
      more_stores: '{n} minimarket lebih banyak',
      more_shops: 'Lebih banyak toko di sepanjang jalan',
      fewer_alleys: 'Lebih sedikit gang',
      main_roads: 'Lebih banyak jalan besar',
      extra_time: 'Sekitar {n} menit lebih lama',
    },
    facts: {
      cameras: '{n} kamera di sepanjang jalan',
      stores: '{n} minimarket',
      police: 'Melewati dekat kantor polisi',
      noSteps: 'Tanpa tangga',
      steps: 'Ada {n} tangga',
      stepsLeft: 'Masih ada {n} tangga',
      climb: 'Tanjakan sekitar {n} m',
      flat: 'Cukup datar',
    },
  },
  ja: {
    modeTitle: 'どんな道で行きますか？',
    modes: { fast: '最速', safe: '安全', gentle: 'なだらか' },
    walkMode: '徒歩 · {mode}',
    fastestRoute: '徒歩 · いちばん早い道',
    planning: 'ルートを比べています…',
    noBetter: 'これより合う道が見つからないので、いちばん早い道で案内します',
    fallback: '今はいちばん早い道だけ案内できます',
    capNote: 'いちばん早い道より {pct}% 以上は遅くなりません',
    simNight: '夜を想定',
    reasons: {
      fewer_steps: '階段が {n} か所少ない',
      flatter: '上り坂が {n} m 少ない',
      gentler_slope: 'いちばん急な所がゆるやか',
      brighter: '街灯が多い',
      more_cameras: '防犯カメラが {n} 台多い',
      near_police: '交番の近くを通る',
      more_stores: 'コンビニが {n} 軒多い',
      more_shops: '沿道にお店が多い',
      fewer_alleys: '路地が少ない',
      main_roads: '大通りを多く通る',
      extra_time: '約 {n} 分長い',
    },
    facts: {
      cameras: '沿道に防犯カメラ {n} 台',
      stores: 'コンビニ {n} 軒',
      police: '交番の近くを通る',
      noSteps: '階段なし',
      steps: '階段 {n} か所',
      stepsLeft: 'まだ階段が {n} か所',
      climb: '上り約 {n} m',
      flat: 'ほぼ平ら',
    },
  },
  ko: {
    modeTitle: '어떤 길로 갈까요?',
    modes: { fast: '빠른 길', safe: '안전한 길', gentle: '완만한 길' },
    walkMode: '걸어가기 · {mode}',
    fastestRoute: '걸어가기 · 가장 빠른 길',
    planning: '경로를 비교하는 중…',
    noBetter: '더 알맞은 길이 없어 가장 빠른 길로 안내해요',
    fallback: '지금은 가장 빠른 길만 찾을 수 있어요',
    capNote: '가장 빠른 길보다 {pct}% 넘게 오래 걸리지 않아요',
    simNight: '밤 시뮬레이션',
    reasons: {
      fewer_steps: '계단 {n}곳 적음',
      flatter: '오르막 {n}m 적음',
      gentler_slope: '가장 가파른 곳이 완만함',
      brighter: '가로등이 더 많음',
      more_cameras: 'CCTV {n}대 더 많음',
      near_police: '파출소 근처를 지남',
      more_stores: '편의점 {n}곳 더 많음',
      more_shops: '길가에 가게가 더 많음',
      fewer_alleys: '골목길이 적음',
      main_roads: '큰길을 더 많이 걸음',
      extra_time: '약 {n}분 더 걸림',
    },
    facts: {
      cameras: '길가 CCTV {n}대',
      stores: '편의점 {n}곳',
      police: '파출소 근처를 지남',
      noSteps: '계단 없음',
      steps: '계단 {n}곳',
      stepsLeft: '아직 계단 {n}곳',
      climb: '오르막 약 {n}m',
      flat: '거의 평지',
    },
  },
}
