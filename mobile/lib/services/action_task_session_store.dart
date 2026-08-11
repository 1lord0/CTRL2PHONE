import 'connection_settings_store.dart';

class ActionTaskSessionStore {
  final SecureSettingsBackend _secure;

  ActionTaskSessionStore({SecureSettingsBackend? secure})
      : _secure = secure ?? FlutterSecureSettingsBackend();

  String _sessionKey(String fingerprint) =>
      'ctrl2phone_action_session_v1_$fingerprint';
  String _channelKey(String fingerprint) =>
      'ctrl2phone_action_channel_v1_$fingerprint';

  Future<String?> loadSession(String fingerprint) =>
      _secure.read(_sessionKey(fingerprint));

  Future<void> saveSession(String fingerprint, String sessionJson) async {
    final key = _sessionKey(fingerprint);
    await _secure.write(key, sessionJson);
    if (await _secure.read(key) != sessionJson) {
      throw StateError('Görev oturumu güvenli depoya yazılamadı.');
    }
  }

  Future<String?> loadChannelId(String fingerprint) =>
      _secure.read(_channelKey(fingerprint));

  Future<void> saveChannelId(String fingerprint, String channelId) async {
    final key = _channelKey(fingerprint);
    await _secure.write(key, channelId);
    if (await _secure.read(key) != channelId) {
      throw StateError('Görev kanalı güvenli depoya yazılamadı.');
    }
  }

  Future<void> clear(String fingerprint) async {
    await _secure.delete(_sessionKey(fingerprint));
    await _secure.delete(_channelKey(fingerprint));
  }
}
