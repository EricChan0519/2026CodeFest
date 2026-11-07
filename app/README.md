# 一箭成行 × Town Pass（2026 臺北秋季程式設計節參賽作品）

本目錄是 [taipei-doit/TownPass](https://github.com/taipei-doit/TownPass)（main @ `c8e5d4d`）的修改版，加入城市通微服務「**一箭成行**」：看不懂地圖也能走到，跟著一支依路線轉彎的箭頭走到公車站牌與任何地點。

| 位置 | 內容 | 授權 |
|---|---|---|
| repo 根目錄（`../web`、`../api`、`../routing`、`../scripts`、`../docs`） | 微服務前端（Vue 3）、後端（FastAPI）、步行路網（Valhalla）、資料建置腳本、文件 | AGPL-3.0，見 [../LICENSE](../LICENSE) |
| 本目錄的 App 修改 | 服務入口（`lib/page/city_service/`）、`speak`／`haptic` Handler（`lib/util/web_message_handler/arrow_nav_message_handler.dart`）、iOS 方向權限（`lib/util/tp_web_view.dart`）、Android `INTERNET` 權限 | 新增檔案 AGPL-3.0；TownPass 原始碼維持 GPL-3.0（[LICENSE](LICENSE)） |

**資料來源、第三方套件、資料安全、AI 使用聲明、建置與部署方式見 [repo 根目錄 README](../README.md)。**

快速開始：

```bash
fvm install && fvm flutter pub get
fvm dart run build_runner build --delete-conflicting-outputs
fvm flutter run          # 服務 › 我的服務 › 一箭成行
```

---

# What is Town Pass?

Town Pass is an open-source project developed by the Taipei City Government. With the growth of smart cities, the demand for digitalization in city management and citizen services continues to rise. As we enter a new digital era, our goal is to involve citizens in the process, combining third-party expertise and innovation to make digital life in Taipei more convenient.

Town Pass is not just an application; it is an open community project. Through open-source, every citizen can participate in the ideation, development, and optimization of the application. This not only enhances citizen engagement and satisfaction but also leverages collective intelligence to continuously improve the application, making it truly serve the people. Furthermore, we hope that various municipalities can widely adopt the open-source framework of Town Pass, integrate it with their existing municipal service systems, and quickly have their own applications to enhance digital governance.

Open source is a key driver of technological progress and social development. Through open-source, Town Pass will become an ever-evolving platform, attracting developers from all backgrounds to contribute. We welcome experts to submit code, report issues, provide suggestions, and even develop new features and creative ideas, working together to perfect Town Pass as we advance toward a smart city.

# Getting Started

We highly recommend to read through our [document](https://townpass.taipei/en/docs/) for more detail.

Here are some quick setup guide.

## Requirement

- [Flutter](https://docs.flutter.dev/get-started/install) or [FVM](https://fvm.app/documentation/getting-started/installation)
- [XCode](https://developer.apple.com/xcode/) (for iOS)
- [Android SDK](https://developer.android.com/studio/index.html) (for Android, with or without Android Studio)

## Build the Project

1. Get the packages project needed:

   ``` bash
   flutter pub get
   ```

2. Generate additional needed dart code for the project.

   ``` bash
   dart run build_runner build
   ```

3. You are all set now, Run the project from your IDE or the through the command line:

   ``` bash
   flutter run
   ```
