import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:town_pass/util/web_message_handler/allowed_origins.dart';

void main() {
  test('allows production and preview', () {
    expect(isAllowedOrigin(WebUri('https://townpass-hackathon-2026.web.app')), true);
    expect(isAllowedOrigin(WebUri('https://townpass-hackathon-2026--dev-abc.web.app')), true);
  });

  test('rejects others', () {
    expect(isAllowedOrigin(WebUri('https://evil.example')), false);
    expect(isAllowedOrigin(WebUri('https://townpass-hackathon-2026.web.app.evil.example')), false);
    expect(isAllowedOrigin(null), false);
  });

  test('rejects http and non-web schemes', () {
    expect(isAllowedOrigin(WebUri('http://townpass-hackathon-2026.web.app')), false);
    expect(isAllowedOrigin(WebUri('about:blank')), false);
  });
}
