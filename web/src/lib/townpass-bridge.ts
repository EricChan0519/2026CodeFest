/**
 * TownPass 城市通 雙向溝通 bridge（框架無關，Vue/React/純 TS 皆可用）
 * 協定：flutterObject.postMessage(JSON.stringify({ name, data }))；回覆在 'message' 事件，event.data 為 JSON 字串 {name, data}
 * 瀏覽器（無 flutterObject）時回傳 MOCK，方便開發。
 * 見 docs/03-two-way-communication.md
 */

type Reply<T = unknown> = { name: string; data: T };

declare global {
  interface Window {
    flutterObject?: {
      postMessage(message: string): void;
      addEventListener(type: 'message', cb: (e: { data: string }) => void): void;
      removeEventListener(type: 'message', cb: (e: { data: string }) => void): void;
    };
  }
}

export const isInTownPass = () => typeof window !== 'undefined' && !!window.flutterObject;

/** 只送不等回覆（notify、open_link 等） */
export function send(name: string, data: unknown = null): void {
  // data 直接傳物件，不要再 JSON.stringify（App 只 decode 外層一次）
  window.flutterObject?.postMessage(JSON.stringify({ name, data }));
}

/** 送出並等待同名回覆。瀏覽器下回傳 mock[name]。 */
export function request<T = unknown>(name: string, data: unknown = null, timeoutMs = 15000): Promise<T> {
  if (!isInTownPass()) return Promise.resolve(MOCK[name] as T);
  return new Promise<T>((resolve, reject) => {
    const fo = window.flutterObject!;
    const timer = setTimeout(() => {
      fo.removeEventListener('message', onMsg);
      reject(new Error(`TownPass bridge timeout: ${name}`));
    }, timeoutMs);
    function onMsg(e: { data: string }) {
      let msg: Reply<T>;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (msg.name !== name) return;
      clearTimeout(timer);
      fo.removeEventListener('message', onMsg);
      resolve(msg.data);
    }
    fo.addEventListener('message', onMsg);
    send(name, data);
  });
}

// ---- 內建能力的型別化包裝 ----
export interface TPPosition {
  latitude: number;
  longitude: number;
  accuracy?: number;
  timestamp?: number;
  [k: string]: unknown;
}

export const tp = {
  /** 失敗時 App 回 []，這裡轉成 null */
  userinfo: async () => {
    const d = await request<any>('userinfo');
    return Array.isArray(d) ? null : d;
  },
  location: async (): Promise<TPPosition | null> => {
    const d = await request<any>('location');
    return Array.isArray(d) || !d ? null : d;
  },
  deviceinfo: () => request<Record<string, unknown>>('deviceinfo'),
  scanQRCode: () => request<string | null>('qr_code_scan', null, 120000),
  notify: (title: string, content: string) => send('notify', { title, content }),
  openLink: (url: string) => send('open_link', url),
  /** 必須傳非空字串（App 端 null 會拋例外） */
  launchMap: (url: string) => request<boolean>('launch_map', url),
  phoneCall: (phone: string) => request<boolean>('phone_call', phone),
};

// ---- 瀏覽器開發用 mock（對應 assets/mock_data/account.json） ----
const MOCK: Record<string, unknown> = {
  userinfo: {
    id: '7f3562f4-bb3f-4ec7-89b9-da3b4b5ff250',
    account: 'wz7786',
    username: 'Wesley',
    realName: '金大森',
    birthday: '1988/12/12',
    memberType: 'personal',
    verifyLevel: '3',
    addresses: [{ zip3: 104, city: '臺北市', town: '中山區', village: '正得里', street: '吉林路', priority: true }],
    residentAddress: '臺北市中山區吉林路 69 號 4 樓',
    citizen: true,
    nativePeople: false,
  },
  location: { latitude: 25.0375, longitude: 121.5637, accuracy: 10 }, // 臺北市政府
  deviceinfo: { model: 'browser-mock' },
  qr_code_scan: 'MOCK-QR-CONTENT',
  launch_map: true,
  phone_call: true,
};
