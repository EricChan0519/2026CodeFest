import 'package:flutter_inappwebview/flutter_inappwebview.dart';

final RegExp _allowedHost =
    RegExp(r'^townpass-hackathon-2026(--[a-z0-9-]+)?\.web\.app$');

/// 新增的 Handler 只接受我們自己的 Hosting（正式站與 preview channel）。
bool isAllowedOrigin(WebUri? origin) {
  if (origin == null || origin.scheme != 'https' || origin.hasPort) {
    return false;
  }
  return _allowedHost.hasMatch(origin.host);
}
