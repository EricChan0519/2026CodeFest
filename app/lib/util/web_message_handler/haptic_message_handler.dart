import 'package:flutter/services.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:town_pass/util/web_message_handler/allowed_origins.dart';
import 'package:town_pass/util/web_message_handler/tp_web_message_handler.dart';

class HapticMessageHandler extends TPWebMessageHandler {
  static const Duration _gap = Duration(milliseconds: 200);

  @override
  String get name => 'haptic';

  @override
  Future<void> handle({
    required Object? message,
    required WebUri? sourceOrigin,
    required bool isMainFrame,
    required onReply,
  }) async {
    if (!isAllowedOrigin(sourceOrigin) || message is! Map) return;
    switch (message['pattern']) {
      case 'turn':
        await HapticFeedback.mediumImpact();
      case 'warn':
        await _heavy(2);
      case 'arrive':
        await _heavy(3);
    }
  }

  Future<void> _heavy(int times) async {
    for (var i = 0; i < times; i++) {
      if (i > 0) await Future<void>.delayed(_gap);
      await HapticFeedback.heavyImpact();
    }
  }
}
