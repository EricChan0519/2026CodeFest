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
  /** 問句：zh-TW 給旁人看，其他語言是給手機主人看的翻譯 */
  ask: string
  askNoDirection: string
  showOthers: string
  done: string
  hearAgain: string
  askHint: string
  back: string
  readAloud: string
}

export const ARRIVAL_STRINGS: Record<Lang, ArrivalStrings> = {
  'zh-TW': {
    arrived: '到了',
    arrivedChild: '你做到了！',
    direction: '往{to}',
    waitFor: '等 {bus}，往{to}方向',
    waitForNoDirection: '等 {bus}',
    ask: '我要搭 {bus}，往{to}。請問是這班車嗎？',
    askNoDirection: '我要搭 {bus}。請問是這班車嗎？',
    showOthers: '給別人看',
    done: '完成',
    hearAgain: '再聽一次',
    askHint: '把手機拿給司機或旁邊的人看',
    back: '返回',
    readAloud: '念出來',
  },
  en: {
    arrived: "You're here.",
    arrivedChild: 'You did it!',
    direction: 'To {to}',
    waitFor: 'Wait for bus {bus}, to {to}',
    waitForNoDirection: 'Wait for bus {bus}',
    ask: 'I want bus {bus}, to {to}. Is this the right bus?',
    askNoDirection: 'I want bus {bus}. Is this the right bus?',
    showOthers: 'Show someone',
    done: 'Done',
    hearAgain: 'Hear again',
    askHint: 'Show this to the driver or someone nearby',
    back: 'Back',
    readAloud: 'Read aloud',
  },
  th: {
    arrived: 'ถึงแล้ว',
    arrivedChild: 'เก่งมาก!',
    direction: 'ไป {to}',
    waitFor: 'รอรถเมล์สาย {bus} ไป {to}',
    waitForNoDirection: 'รอรถเมล์สาย {bus}',
    ask: 'ฉันจะขึ้นรถเมล์สาย {bus} ไป {to} ใช่คันนี้ไหม',
    askNoDirection: 'ฉันจะขึ้นรถเมล์สาย {bus} ใช่คันนี้ไหม',
    showOthers: 'ให้คนอื่นดู',
    done: 'เสร็จสิ้น',
    hearAgain: 'ฟังอีกครั้ง',
    askHint: 'ยื่นให้คนขับหรือคนใกล้ ๆ ดู',
    back: 'กลับ',
    readAloud: 'อ่านออกเสียง',
  },
  vi: {
    arrived: 'Đã đến nơi.',
    arrivedChild: 'Bạn làm được rồi!',
    direction: 'Đi {to}',
    waitFor: 'Đợi xe buýt {bus}, đi {to}',
    waitForNoDirection: 'Đợi xe buýt {bus}',
    ask: 'Tôi muốn đi xe buýt {bus}, đến {to}. Có phải xe này không?',
    askNoDirection: 'Tôi muốn đi xe buýt {bus}. Có phải xe này không?',
    showOthers: 'Cho người khác xem',
    done: 'Xong',
    hearAgain: 'Nghe lại',
    askHint: 'Đưa cho tài xế hoặc người bên cạnh xem',
    back: 'Quay lại',
    readAloud: 'Đọc to',
  },
  id: {
    arrived: 'Sudah sampai.',
    arrivedChild: 'Kamu berhasil!',
    direction: 'Ke {to}',
    waitFor: 'Tunggu bus {bus}, ke {to}',
    waitForNoDirection: 'Tunggu bus {bus}',
    ask: 'Saya mau naik bus {bus}, ke {to}. Apakah ini busnya?',
    askNoDirection: 'Saya mau naik bus {bus}. Apakah ini busnya?',
    showOthers: 'Tunjukkan ke orang lain',
    done: 'Selesai',
    hearAgain: 'Dengar lagi',
    askHint: 'Tunjukkan ke sopir atau orang di dekat Anda',
    back: 'Kembali',
    readAloud: 'Bacakan',
  },
  km: {
    arrived: 'មកដល់ហើយ',
    arrivedChild: 'អ្នកធ្វើបានហើយ!',
    direction: 'ទៅ {to}',
    waitFor: 'រង់ចាំឡានក្រុង {bus} ទៅ {to}',
    waitForNoDirection: 'រង់ចាំឡានក្រុង {bus}',
    ask: 'ខ្ញុំចង់ជិះឡានក្រុង {bus} ទៅ {to}។ តើឡាននេះត្រូវទេ?',
    askNoDirection: 'ខ្ញុំចង់ជិះឡានក្រុង {bus}។ តើឡាននេះត្រូវទេ?',
    showOthers: 'បង្ហាញអ្នកដទៃ',
    done: 'រួចរាល់',
    hearAgain: 'ស្តាប់ម្តងទៀត',
    askHint: 'បង្ហាញដល់អ្នកបើកបរ ឬអ្នកនៅក្បែរ',
    back: 'ត្រឡប់',
    readAloud: 'អានឮៗ',
  },
  ja: {
    arrived: '着きました。',
    arrivedChild: 'よくできました！',
    direction: '{to} 行き',
    waitFor: '{bus} 番バス、{to} 行きを待ちましょう',
    waitForNoDirection: '{bus} 番バスを待ちましょう',
    ask: '{bus} 番バスで {to} へ行きたいです。このバスで合っていますか？',
    askNoDirection: '{bus} 番バスに乗りたいです。このバスで合っていますか？',
    showOthers: '人に見せる',
    done: '完了',
    hearAgain: 'もう一度聞く',
    askHint: '運転手や近くの人に見せてください',
    back: '戻る',
    readAloud: '読み上げる',
  },
  ko: {
    arrived: '도착했어요.',
    arrivedChild: '해냈어요!',
    direction: '{to} 방면',
    waitFor: '{bus}번 버스, {to} 방면을 기다리세요',
    waitForNoDirection: '{bus}번 버스를 기다리세요',
    ask: '{bus}번 버스로 {to}에 가려고 해요. 이 버스가 맞나요?',
    askNoDirection: '{bus}번 버스를 타려고 해요. 이 버스가 맞나요?',
    showOthers: '다른 사람에게 보여주기',
    done: '완료',
    hearAgain: '다시 듣기',
    askHint: '기사님이나 주변 사람에게 보여주세요',
    back: '뒤로',
    readAloud: '소리 내어 읽기',
  },
}
