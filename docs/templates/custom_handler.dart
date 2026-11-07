// 自訂 Handler 樣板 —— 複製到 app/lib/util/web_message_handler/tp_web_message_handler.dart（或新檔並 import）
// 然後加入 TPWebMessageListener._cachedMessageHandlers 清單。
// 網頁端：send('my_feature', { foo: 1 }) / request('my_feature', {...})
//
// message 是網頁送來 JSON 的 data 欄位（已 decode：Map / List / String / num / null）。

import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:town_pass/util/web_message_handler/tp_web_message_handler.dart';

class MyFeatureMessageHandler extends TPWebMessageHandler {
  @override
  String get name => 'my_feature'; // 勿與內建 userinfo/location/notify/... 重名

  @override
  Future<void> handle({
    required Object? message,
    required WebUri? sourceOrigin,
    required bool isMainFrame,
    required Function(WebMessage reply)? onReply,
  }) async {
    if (message is! Map) {
      onReply?.call(replyWebMessage(data: {'ok': false, 'error': 'invalid payload'}));
      return; // 記得 return（內建 launch_map/phone_call 忘了）
    }
    try {
      // TODO: 呼叫原生能力 / 套件（MIT/BSD/Apache）
      final result = {'echo': message};
      onReply?.call(replyWebMessage(data: {'ok': true, 'result': result}));
    } catch (e) {
      onReply?.call(replyWebMessage(data: {'ok': false, 'error': e.toString()}));
    }
  }
}

// 本機排程通知（ParkFlow timer_set 的做法）需在 NotificationService 加 zonedSchedule，
// 並在 AndroidManifest 加 SCHEDULE_EXACT_ALARM / POST_NOTIFICATIONS 權限。
