/**
 * 抵達畫面與「給別人看」卡片的文字。預先翻譯，執行時不呼叫翻譯服務。
 * zh-TW、en 由隊員撰寫與確認；其他語言尚未由母語者確認，要在關於頁標示。
 */
import type { Lang } from '@/lib/contract'

export interface ArrivalStrings {
  arrived: string
  arrivedChild: string
  /** 大號碼下方的方向，{to} 是不含「往／To」的目的地 */
  direction: string
  /** {bus}、{to} */
  waitFor: string
  waitForNoDirection: string
  /** 下車站，{stop} 是站名 */
  getOffAt: string
  /** 問句：zh-TW 給旁人看，其他語言是給手機主人看的翻譯 */
  ask: string
  askNoDirection: string
  showOthers: string
  done: string
  hearAgain: string
  askHint: string
  back: string
  readAloud: string
  /** 坐車畫面 */
  boarded: string
  gotOff: string
  /** {n} 是站數 */
  stopsLeft: string
  /** {stop} 是下車站名 */
  nextStop: string
  getOffNow: string
  /** 問問卡：{stop} 是下車站名 */
  askRemind: string
  /** 問問卡：{place} 是目的地名稱 */
  askLost: string
  /** 問問卡分頁的名稱（使用者的語言） */
  tabBus: string
  tabRemind: string
  tabLost: string
  /** 捷運站內換線時到站卡的大標 */
  changeLine: string
  /** 捷運出站口，{exit} 是出口名稱（M3、2） */
  exitVia: string
}

export const ARRIVAL_STRINGS: Record<Lang, ArrivalStrings> = {
  'zh-TW': {
    arrived: '到了',
    arrivedChild: '你做到了！',
    direction: '往{to}',
    waitFor: '等 {bus}，往{to}方向',
    waitForNoDirection: '等 {bus}',
    getOffAt: '在 {stop} 下車',
    ask: '我要搭 {bus}，往{to}。請問是這班車嗎？',
    askNoDirection: '我要搭 {bus}。請問是這班車嗎？',
    showOthers: '給別人看',
    done: '完成',
    hearAgain: '再聽一次',
    askHint: '把手機拿給司機或旁邊的人看',
    back: '返回',
    readAloud: '念出來',
    boarded: '上車了',
    gotOff: '下車了',
    stopsLeft: '還有 {n} 站',
    nextStop: '下一站 {stop}，準備下車',
    getOffNow: '到了，請在 {stop} 下車',
    askRemind: '到「{stop}」請提醒我下車，謝謝',
    askLost: '我迷路了，請幫幫我。我要去「{place}」',
    tabBus: '是這班車嗎',
    tabRemind: '提醒我下車',
    tabLost: '我迷路了',
    changeLine: '在這裡換線',
    exitVia: '從 {exit} 出口出站',
  },
  en: {
    arrived: "You're here.",
    arrivedChild: 'You did it!',
    direction: 'To {to}',
    waitFor: 'Wait for bus {bus}, to {to}',
    waitForNoDirection: 'Wait for bus {bus}',
    getOffAt: 'Get off at {stop}',
    ask: 'I want bus {bus}, to {to}. Is this the right bus?',
    askNoDirection: 'I want bus {bus}. Is this the right bus?',
    showOthers: 'Show someone',
    done: 'Done',
    hearAgain: 'Hear again',
    askHint: 'Show this to the driver or someone nearby',
    back: 'Back',
    readAloud: 'Read aloud',
    boarded: "I'm on the bus",
    gotOff: 'I got off',
    stopsLeft: '{n} stops to go',
    nextStop: 'Next stop {stop}, get ready to get off',
    getOffNow: 'This is {stop}. Get off here',
    askRemind: 'Please tell me when we reach "{stop}" so I can get off. Thank you',
    askLost: 'I am lost, please help me. I want to go to "{place}"',
    tabBus: 'Is this my bus?',
    tabRemind: 'Remind me to get off',
    tabLost: 'I am lost',
    changeLine: 'Change lines here',
    exitVia: 'Exit via {exit}',
  },
  th: {
    arrived: 'ถึงแล้ว',
    arrivedChild: 'เก่งมาก!',
    direction: 'ไป {to}',
    waitFor: 'รอรถเมล์สาย {bus} ไป {to}',
    waitForNoDirection: 'รอรถเมล์สาย {bus}',
    getOffAt: 'ลงที่ {stop}',
    ask: 'ฉันจะขึ้นรถเมล์สาย {bus} ไป {to} ใช่คันนี้ไหม',
    askNoDirection: 'ฉันจะขึ้นรถเมล์สาย {bus} ใช่คันนี้ไหม',
    showOthers: 'ให้คนอื่นดู',
    done: 'เสร็จสิ้น',
    hearAgain: 'ฟังอีกครั้ง',
    askHint: 'ยื่นให้คนขับหรือคนใกล้ ๆ ดู',
    back: 'กลับ',
    readAloud: 'อ่านออกเสียง',
    boarded: 'ขึ้นรถแล้ว',
    gotOff: 'ลงรถแล้ว',
    stopsLeft: 'อีก {n} ป้าย',
    nextStop: 'ป้ายหน้า {stop} เตรียมลง',
    getOffNow: 'ถึง {stop} แล้ว ลงที่นี่',
    askRemind: 'ถึง "{stop}" ช่วยบอกให้ฉันลงด้วย ขอบคุณ',
    askLost: 'ฉันหลงทาง ช่วยฉันด้วย ฉันจะไป "{place}"',
    tabBus: 'ใช่คันนี้ไหม',
    tabRemind: 'บอกให้ลงรถ',
    tabLost: 'ฉันหลงทาง',
    changeLine: 'เปลี่ยนสายที่นี่',
    exitVia: 'ออกทางออก {exit}',
  },
  vi: {
    arrived: 'Đã đến nơi.',
    arrivedChild: 'Bạn làm được rồi!',
    direction: 'Đi {to}',
    waitFor: 'Đợi xe buýt {bus}, đi {to}',
    waitForNoDirection: 'Đợi xe buýt {bus}',
    getOffAt: 'Xuống ở {stop}',
    ask: 'Tôi muốn đi xe buýt {bus}, đến {to}. Có phải xe này không?',
    askNoDirection: 'Tôi muốn đi xe buýt {bus}. Có phải xe này không?',
    showOthers: 'Cho người khác xem',
    done: 'Xong',
    hearAgain: 'Nghe lại',
    askHint: 'Đưa cho tài xế hoặc người bên cạnh xem',
    back: 'Quay lại',
    readAloud: 'Đọc to',
    boarded: 'Đã lên xe',
    gotOff: 'Đã xuống xe',
    stopsLeft: 'Còn {n} trạm',
    nextStop: 'Trạm tới {stop}, chuẩn bị xuống',
    getOffNow: 'Đến {stop} rồi, xuống ở đây',
    askRemind: 'Đến "{stop}" xin nhắc tôi xuống xe, cảm ơn',
    askLost: 'Tôi bị lạc, xin hãy giúp tôi. Tôi muốn đến "{place}"',
    tabBus: 'Có phải xe này?',
    tabRemind: 'Nhắc tôi xuống xe',
    tabLost: 'Tôi bị lạc',
    changeLine: 'Đổi tuyến tại đây',
    exitVia: 'Ra cửa {exit}',
  },
  id: {
    arrived: 'Sudah sampai.',
    arrivedChild: 'Kamu berhasil!',
    direction: 'Ke {to}',
    waitFor: 'Tunggu bus {bus}, ke {to}',
    waitForNoDirection: 'Tunggu bus {bus}',
    getOffAt: 'Turun di {stop}',
    ask: 'Saya mau naik bus {bus}, ke {to}. Apakah ini busnya?',
    askNoDirection: 'Saya mau naik bus {bus}. Apakah ini busnya?',
    showOthers: 'Tunjukkan ke orang lain',
    done: 'Selesai',
    hearAgain: 'Dengar lagi',
    askHint: 'Tunjukkan ke sopir atau orang di dekat Anda',
    back: 'Kembali',
    readAloud: 'Bacakan',
    boarded: 'Sudah naik',
    gotOff: 'Sudah turun',
    stopsLeft: '{n} halte lagi',
    nextStop: 'Halte berikutnya {stop}, siap turun',
    getOffNow: 'Sudah sampai {stop}, turun di sini',
    askRemind: 'Tolong beri tahu saya saat sampai di "{stop}" supaya saya turun. Terima kasih',
    askLost: 'Saya tersesat, tolong bantu saya. Saya mau ke "{place}"',
    tabBus: 'Apakah ini busnya?',
    tabRemind: 'Ingatkan saya turun',
    tabLost: 'Saya tersesat',
    changeLine: 'Ganti jalur di sini',
    exitVia: 'Keluar lewat pintu {exit}',
  },
  ja: {
    arrived: '着きました。',
    arrivedChild: 'よくできました！',
    direction: '{to} 行き',
    waitFor: '{bus} 番バス、{to} 行きを待ちましょう',
    waitForNoDirection: '{bus} 番バスを待ちましょう',
    getOffAt: '{stop} で降ります',
    ask: '{bus} 番バスで {to} へ行きたいです。このバスで合っていますか？',
    askNoDirection: '{bus} 番バスに乗りたいです。このバスで合っていますか？',
    showOthers: '人に見せる',
    done: '完了',
    hearAgain: 'もう一度聞く',
    askHint: '運転手や近くの人に見せてください',
    back: '戻る',
    readAloud: '読み上げる',
    boarded: '乗りました',
    gotOff: '降りました',
    stopsLeft: 'あと {n} 停留所',
    nextStop: '次は {stop}、降りる準備をしましょう',
    getOffNow: '{stop} に着きました。ここで降ります',
    askRemind: '「{stop}」に着いたら降りるので教えてください。ありがとうございます',
    askLost: '道に迷いました。助けてください。「{place}」へ行きたいです',
    tabBus: 'このバスですか',
    tabRemind: '降りる所を教えて',
    tabLost: '道に迷いました',
    changeLine: 'ここで乗り換え',
    exitVia: '{exit} 出口から出る',
  },
  ko: {
    arrived: '도착했어요.',
    arrivedChild: '해냈어요!',
    direction: '{to} 방면',
    waitFor: '{bus}번 버스, {to} 방면을 기다리세요',
    waitForNoDirection: '{bus}번 버스를 기다리세요',
    getOffAt: '{stop}에서 내리세요',
    ask: '{bus}번 버스로 {to}에 가려고 해요. 이 버스가 맞나요?',
    askNoDirection: '{bus}번 버스를 타려고 해요. 이 버스가 맞나요?',
    showOthers: '다른 사람에게 보여주기',
    done: '완료',
    hearAgain: '다시 듣기',
    askHint: '기사님이나 주변 사람에게 보여주세요',
    back: '뒤로',
    readAloud: '소리 내어 읽기',
    boarded: '탔어요',
    gotOff: '내렸어요',
    stopsLeft: '{n}정거장 남았어요',
    nextStop: '다음 정류장 {stop}, 내릴 준비하세요',
    getOffNow: '{stop}에 도착했어요. 여기서 내리세요',
    askRemind: '"{stop}"에 도착하면 내릴 수 있게 알려 주세요. 감사합니다',
    askLost: '길을 잃었어요. 도와주세요. "{place}"에 가고 싶어요',
    tabBus: '이 버스가 맞나요',
    tabRemind: '내릴 때 알려 주세요',
    tabLost: '길을 잃었어요',
    changeLine: '여기서 환승',
    exitVia: '{exit} 출구로 나가기',
  },
}
