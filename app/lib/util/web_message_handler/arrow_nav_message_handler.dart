// 一箭成行（arrow-nav）微服務用的 Handler：語音提示（speak）與震動（haptic）。
// 合約見 microservice/docs/arrow-nav/03-contracts.md。
//
// Copyright (C) 2026 王閎立、王昱荃、詹維宏、羅泓勛、許雅晴（一箭成行團隊）
// SPDX-License-Identifier: AGPL-3.0-or-later

import 'dart:io';

import 'package:flutter/services.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:flutter_tts/flutter_tts.dart';
import 'package:town_pass/util/web_message_handler/tp_web_message_handler.dart';

/// 只回應一箭成行自己的網域（正式站與 Firebase 預覽頻道）。
///
/// TownPass 的 WebMessageListener 沒有設定 allowedOriginRules，任何網頁都拿得到
/// flutterObject，所以自訂 Handler 要自己檢查來源。
bool isArrowNavOrigin(WebUri? origin) {
  if (origin == null || origin.scheme != 'https') {
    return false;
  }
  final String host = origin.host;
  return host == 'townpass-hackathon-2026.web.app' ||
      host == 'townpass-hackathon-2026.firebaseapp.com' ||
      RegExp(r'^townpass-hackathon-2026--[a-z0-9-]+\.web\.app$').hasMatch(host);
}

/// `speak`：網頁送 `{ text, lang, rate, interrupt }`，
/// 回覆 `{ ok: true }` 或 `{ ok: false, code: 'no_voice' | 'tts_error' }`。
///
/// 語音全部在手機上合成（系統 TTS），文字不會送出裝置。
class SpeakMessageHandler extends TPWebMessageHandler {
  static const Set<String> _langs = {
    'zh-TW',
    'en-US',
    'th-TH',
    'vi-VN',
    'id-ID',
    'km-KH',
    'ja-JP',
    'ko-KR',
  };

  /// 單一字串的長度上限，避免被拿來大量朗讀。
  static const int _maxTextLength = 300;

  FlutterTts? _tts;

  FlutterTts get _engine {
    final FlutterTts? existing = _tts;
    if (existing != null) {
      return existing;
    }
    final FlutterTts tts = FlutterTts();
    if (Platform.isIOS) {
      // 跟其他聲音並存，且在靜音模式下也能出聲（導航提示）
      tts.setSharedInstance(true);
      tts.setIosAudioCategory(
        IosTextToSpeechAudioCategory.playback,
        [
          IosTextToSpeechAudioCategoryOptions.mixWithOthers,
          IosTextToSpeechAudioCategoryOptions.duckOthers,
        ],
        IosTextToSpeechAudioMode.voicePrompt,
      );
    }
    tts.awaitSpeakCompletion(false);
    _tts = tts;
    return tts;
  }

  @override
  String get name => 'speak';

  /// flutter_tts 的語速：Android 1.0 倍速是 0.5；iOS 預設語速也是 0.5。
  double _rate(String? rate) {
    final bool slow = rate == 'slow';
    if (Platform.isIOS) {
      return slow ? 0.4 : 0.5;
    }
    return slow ? 0.35 : 0.5;
  }

  @override
  Future<void> handle({
    required Object? message,
    required WebUri? sourceOrigin,
    required bool isMainFrame,
    required Function(WebMessage replyWebMessage)? onReply,
  }) async {
    if (!isArrowNavOrigin(sourceOrigin)) {
      return;
    }
    if (message is! Map) {
      onReply?.call(replyWebMessage(data: {'ok': false, 'code': 'tts_error'}));
      return;
    }
    final Object? rawText = message['text'];
    final Object? rawLang = message['lang'];
    if (rawText is! String || rawText.trim().isEmpty || rawLang is! String || !_langs.contains(rawLang)) {
      onReply?.call(replyWebMessage(data: {'ok': false, 'code': 'tts_error'}));
      return;
    }
    final String text = rawText.length > _maxTextLength ? rawText.substring(0, _maxTextLength) : rawText;

    try {
      final FlutterTts tts = _engine;
      final Object? available = await tts.isLanguageAvailable(rawLang);
      if (available != true && available != 1) {
        onReply?.call(replyWebMessage(data: {'ok': false, 'code': 'no_voice'}));
        return;
      }
      if (message['interrupt'] != false) {
        await tts.stop();
      }
      await tts.setLanguage(rawLang);
      await tts.setSpeechRate(_rate(message['rate'] as String?));
      final Object? result = await tts.speak(text);
      final bool ok = result == 1 || result == true;
      onReply?.call(replyWebMessage(data: ok ? {'ok': true} : {'ok': false, 'code': 'tts_error'}));
    } catch (_) {
      onReply?.call(replyWebMessage(data: {'ok': false, 'code': 'tts_error'}));
    }
  }
}

/// `haptic`：網頁送 `{ pattern: 'turn' | 'arrive' | 'warn' }`，不回覆。
/// 三種節奏要摸得出差別：轉彎一下、警告兩下、抵達三下。
class HapticMessageHandler extends TPWebMessageHandler {
  @override
  String get name => 'haptic';

  @override
  Future<void> handle({
    required Object? message,
    required WebUri? sourceOrigin,
    required bool isMainFrame,
    required Function(WebMessage replyWebMessage)? onReply,
  }) async {
    if (!isArrowNavOrigin(sourceOrigin) || message is! Map) {
      return;
    }
    switch (message['pattern']) {
      case 'turn':
        await HapticFeedback.mediumImpact();
      case 'warn':
        await HapticFeedback.heavyImpact();
        await Future<void>.delayed(const Duration(milliseconds: 150));
        await HapticFeedback.heavyImpact();
      case 'arrive':
        for (int i = 0; i < 3; i++) {
          if (i > 0) {
            await Future<void>.delayed(const Duration(milliseconds: 180));
          }
          await HapticFeedback.heavyImpact();
        }
      default:
        return;
    }
  }
}
