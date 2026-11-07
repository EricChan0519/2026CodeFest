import 'dart:io';

import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:flutter_tts/flutter_tts.dart';
import 'package:town_pass/util/web_message_handler/allowed_origins.dart';
import 'package:town_pass/util/web_message_handler/tp_web_message_handler.dart';

/// `rate` 的實際數值。Android、iOS 的刻度不同，實測後分開調整。
double ttsRateFor(String? rate, {required bool isIOS}) {
  final slow = rate == 'slow';
  return isIOS ? (slow ? 0.35 : 0.5) : (slow ? 0.35 : 0.5);
}

class SpeakMessageHandler extends TPWebMessageHandler {
  late final FlutterTts _tts = FlutterTts();
  bool _configured = false;

  @override
  String get name => 'speak';

  @override
  Future<void> handle({
    required Object? message,
    required WebUri? sourceOrigin,
    required bool isMainFrame,
    required onReply,
  }) async {
    if (!isAllowedOrigin(sourceOrigin)) return;
    onReply?.call(replyWebMessage(data: await _speak(message)));
  }

  Future<Map<String, Object>> _speak(Object? message) async {
    const error = {'ok': false, 'code': 'tts_error'};
    if (message is! Map) return error;
    final text = message['text'];
    final lang = message['lang'];
    if (text is! String || text.isEmpty || lang is! String) return error;

    try {
      if (await _tts.isLanguageAvailable(lang) != true) {
        return {'ok': false, 'code': 'no_voice'};
      }
      if (!_configured) {
        // Android 預設會打斷前一句；沒有要求 interrupt 時要排隊。
        if (Platform.isAndroid) await _tts.setQueueMode(1);
        _configured = true;
      }
      if (message['interrupt'] == true) await _tts.stop();
      await _tts.setLanguage(lang);
      await _tts.setSpeechRate(
        ttsRateFor(message['rate'] as String?, isIOS: Platform.isIOS),
      );
      return await _tts.speak(text) == 1 ? {'ok': true} : error;
    } catch (_) {
      return error;
    }
  }
}
