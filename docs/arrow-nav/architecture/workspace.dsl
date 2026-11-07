workspace "跟著箭頭走" "城市通微服務：用箭頭帶看不懂地圖的人走到正確的公車站牌" {

    !identifiers hierarchical

    model {
        elder = person "長者" "看不懂地圖，要走到公車站牌"
        child = person "兒童" "第一次自己走到站牌"
        visitor = person "外籍人士" "看不懂中文站名"
        maintainer = person "維運者" "定期更新資料快照與路網"

        arrowNav = softwareSystem "跟著箭頭走" "選站牌，跟著箭頭走到正確站位" {
            web = container "微服務網頁" "主流程、導航引擎、對象與語言設定" "Vue 3, TypeScript, Firebase Hosting"
            api = container "API" "站位查詢、規則表、路線組合" "FastAPI, Cloud Run"
            routing = container "路徑服務" "步行路線計算" "Valhalla, Cloud Run"
            snapshots = container "資料快照" "站位、路口、路燈網格" "JSON，打包進 API 映像" {
                tags "Database"
            }
            scripts = container "資料腳本" "從開放資料產生快照與路網" "Python, 建置時執行"

            web -> api "查站位、取路線" "JSON/HTTPS, /api rewrite"
            api -> routing "計算候選路線" "JSON/HTTPS"
            api -> snapshots "讀取"
            scripts -> snapshots "產生"
        }

        townPass = softwareSystem "TownPass App" "城市通 Flutter App，以 WebView 載入微服務，提供語音、震動 Handler" {
            tags "External"
        }
        tdx = softwareSystem "TDX" "交通部公車站位資料" {
            tags "External"
        }
        osm = softwareSystem "OpenStreetMap" "路網、階梯、路口、照明標籤" {
            tags "External"
        }
        taipeiData = softwareSystem "臺北市開放資料" "路燈位置" {
            tags "External"
        }

        elder -> townPass "打開服務"
        child -> townPass "打開服務"
        visitor -> townPass "打開服務"
        maintainer -> arrowNav.scripts "執行"
        townPass -> arrowNav.web "載入、回傳 Handler 結果" "WebView, flutterObject"
        arrowNav.web -> townPass "要求語音、震動" "flutterObject"
        arrowNav.scripts -> tdx "建置時下載站位" "HTTPS, API key"
        arrowNav.scripts -> osm "建置時下載路網與路口" "HTTPS"
        arrowNav.scripts -> taipeiData "建置時下載路燈" "HTTPS"
    }

    views {
        systemContext arrowNav "Context" "系統情境" {
            include *
            autolayout lr
        }

        container arrowNav "Containers" "容器" {
            include *
            autolayout lr
        }

        styles {
            element "Person" {
                shape person
                background #356C77
                color #ffffff
            }
            element "Software System" {
                background #22474E
                color #ffffff
            }
            element "Container" {
                background #356C77
                color #ffffff
            }
            element "External" {
                background #5E6D76
                color #ffffff
            }
            element "Database" {
                shape cylinder
            }
        }
    }
}
