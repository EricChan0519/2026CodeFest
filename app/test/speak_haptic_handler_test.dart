import 'dart:convert';

import 'package:flutter/services.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:town_pass/util/web_message_handler/haptic_message_handler.dart';
import 'package:town_pass/util/web_message_handler/speak_message_handler.dart';

final _ok = WebUri('https://townpass-hackathon-2026.web.app');
final _evil = WebUri('https://evil.example');

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final messenger = TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;

  group('speak', () {
    const channel = MethodChannel('flutter_tts');
    late List<MethodCall> calls;
    late bool languageAvailable;
    late List<Map> replies;

    setUp(() {
      calls = [];
      replies = [];
      languageAvailable = true;
      messenger.setMockMethodCallHandler(channel, (call) async {
        calls.add(call);
        if (call.method == 'isLanguageAvailable') return languageAvailable;
        return 1;
      });
    });

    tearDown(() => messenger.setMockMethodCallHandler(channel, null));

    Future<void> send(Object? data, {WebUri? origin}) => SpeakMessageHandler().handle(
          message: data,
          sourceOrigin: origin ?? _ok,
          isMainFrame: true,
          onReply: (m) => replies.add(jsonDecode(m.data as String)),
        );

    List<String> methods() => calls.map((c) => c.method).toList();

    test('speaks text and replies ok', () async {
      await send({'text': '前面左轉', 'lang': 'zh-TW', 'rate': 'normal', 'interrupt': false});
      expect(calls.lastWhere((c) => c.method == 'speak').arguments, contains('前面左轉'));
      expect(replies.single, {
        'name': 'speak',
        'data': {'ok': true},
      });
    });

    test('replies no_voice and does not speak when language is missing', () async {
      languageAvailable = false;
      await send({'text': 'x', 'lang': 'km-KH', 'rate': 'normal', 'interrupt': false});
      expect(methods(), isNot(contains('speak')));
      expect(replies.single['data'], {'ok': false, 'code': 'no_voice'});
    });

    test('interrupt stops before speaking', () async {
      await send({'text': 'x', 'lang': 'zh-TW', 'rate': 'slow', 'interrupt': true});
      expect(methods().indexOf('stop'), lessThan(methods().indexOf('speak')));
      expect(methods(), contains('stop'));
    });

    test('malformed message replies tts_error', () async {
      await send({'lang': 'zh-TW'});
      await send(null);
      expect(methods(), isNot(contains('speak')));
      expect(replies.map((r) => r['data']['code']), ['tts_error', 'tts_error']);
    });

    test('platform failure replies tts_error instead of throwing', () async {
      messenger.setMockMethodCallHandler(channel, (call) async {
        if (call.method == 'isLanguageAvailable') return true;
        throw PlatformException(code: 'boom');
      });
      await send({'text': 'x', 'lang': 'zh-TW', 'rate': 'normal', 'interrupt': false});
      expect(replies.single['data'], {'ok': false, 'code': 'tts_error'});
    });

    test('other origins are ignored', () async {
      await send({'text': 'x', 'lang': 'zh-TW', 'rate': 'normal', 'interrupt': true}, origin: _evil);
      expect(calls, isEmpty);
      expect(replies, isEmpty);
    });

    test('rates are the plan starting values', () {
      expect(ttsRateFor('slow', isIOS: false), 0.35);
      expect(ttsRateFor('normal', isIOS: false), 0.5);
      expect(ttsRateFor('slow', isIOS: true), 0.35);
      expect(ttsRateFor('normal', isIOS: true), 0.5);
    });
  });

  group('haptic', () {
    late List<String> vibrations;

    setUp(() {
      vibrations = [];
      messenger.setMockMethodCallHandler(SystemChannels.platform, (call) async {
        if (call.method == 'HapticFeedback.vibrate') vibrations.add(call.arguments as String);
        return null;
      });
    });

    tearDown(() => messenger.setMockMethodCallHandler(SystemChannels.platform, null));

    Future<void> send(Object? data, {WebUri? origin}) => HapticMessageHandler().handle(
          message: data,
          sourceOrigin: origin ?? _ok,
          isMainFrame: true,
          onReply: null,
        );

    const medium = 'HapticFeedbackType.mediumImpact';
    const heavy = 'HapticFeedbackType.heavyImpact';

    test('turn is one medium impact', () async {
      await send({'pattern': 'turn'});
      expect(vibrations, [medium]);
    });

    test('warn is two heavy impacts', () async {
      await send({'pattern': 'warn'});
      expect(vibrations, [heavy, heavy]);
    });

    test('arrive is three heavy impacts', () async {
      await send({'pattern': 'arrive'});
      expect(vibrations, [heavy, heavy, heavy]);
    });

    test('unknown pattern and other origins do nothing', () async {
      await send({'pattern': 'nope'});
      await send(null);
      await send({'pattern': 'turn'}, origin: _evil);
      expect(vibrations, isEmpty);
    });
  });
}
