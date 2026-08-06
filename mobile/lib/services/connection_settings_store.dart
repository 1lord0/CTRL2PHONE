import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

const supabaseUrlPreference = 'supabase_url';
const legacySupabaseKeyPreference = 'supabase_anon_key';
const supabaseBucketPreference = 'supabase_bucket';
const accountFingerprintPreference = 'supabase_account_fingerprint';
const secureSupabaseKeyName = 'ctrl2phone_supabase_anon_key';

class ConnectionSettings {
  final String url;
  final String anonKey;
  final String bucket;

  const ConnectionSettings({
    required this.url,
    required this.anonKey,
    required this.bucket,
  });

  String get fingerprint => connectionFingerprint(url, bucket);
}

String normalizeSupabaseUrl(String raw) {
  final trimmed = raw.trim();
  final uri = Uri.tryParse(trimmed);
  if (uri == null || !uri.hasScheme || uri.host.isEmpty) {
    return trimmed.replaceAll(RegExp(r'/+$'), '');
  }
  final path = uri.path.replaceAll(RegExp(r'/+$'), '');
  return uri
      .replace(
          scheme: uri.scheme.toLowerCase(),
          host: uri.host.toLowerCase(),
          path: path)
      .toString();
}

String connectionFingerprint(String url, String bucket) {
  final identity = '${normalizeSupabaseUrl(url)}\n${bucket.trim()}';
  return sha256.convert(utf8.encode(identity)).toString();
}

abstract class SecureSettingsBackend {
  Future<String?> read(String key);
  Future<void> write(String key, String value);
  Future<void> delete(String key);
}

class FlutterSecureSettingsBackend implements SecureSettingsBackend {
  final FlutterSecureStorage _storage;

  FlutterSecureSettingsBackend([FlutterSecureStorage? storage])
      : _storage = storage ?? const FlutterSecureStorage();

  @override
  Future<String?> read(String key) => _storage.read(key: key);

  @override
  Future<void> write(String key, String value) =>
      _storage.write(key: key, value: value);

  @override
  Future<void> delete(String key) => _storage.delete(key: key);
}

class ConnectionSettingsStore {
  final SecureSettingsBackend _secure;
  final Future<SharedPreferences> Function() _preferences;

  ConnectionSettingsStore({
    SecureSettingsBackend? secure,
    Future<SharedPreferences> Function()? preferences,
  })  : _secure = secure ?? FlutterSecureSettingsBackend(),
        _preferences = preferences ?? SharedPreferences.getInstance;

  Future<ConnectionSettings?> load() async {
    final prefs = await _preferences();
    var key = await _secure.read(secureSupabaseKeyName);
    final legacyKey = prefs.getString(legacySupabaseKeyPreference);

    if ((key == null || key.isEmpty) &&
        legacyKey != null &&
        legacyKey.isNotEmpty) {
      await _secure.write(secureSupabaseKeyName, legacyKey);
      final verified = await _secure.read(secureSupabaseKeyName);
      if (verified != legacyKey) {
        throw StateError(
            'Supabase anahtarı güvenli depoya doğrulanarak taşınamadı.');
      }
      key = verified;
      await prefs.remove(legacySupabaseKeyPreference);
    } else if (key != null && key.isNotEmpty && legacyKey != null) {
      await prefs.remove(legacySupabaseKeyPreference);
    }

    final url = prefs.getString(supabaseUrlPreference)?.trim() ?? '';
    final bucket =
        prefs.getString(supabaseBucketPreference)?.trim() ?? 'SCREENSHOTS';
    if (url.isEmpty || key == null || key.isEmpty) return null;

    final settings = ConnectionSettings(url: url, anonKey: key, bucket: bucket);
    await prefs.setString(accountFingerprintPreference, settings.fingerprint);
    return settings;
  }

  Future<void> save(ConnectionSettings settings) async {
    await _secure.write(secureSupabaseKeyName, settings.anonKey);
    final verified = await _secure.read(secureSupabaseKeyName);
    if (verified != settings.anonKey) {
      throw StateError('Supabase anahtarı güvenli depoya yazılamadı.');
    }

    final prefs = await _preferences();
    await prefs.setString(
        supabaseUrlPreference, normalizeSupabaseUrl(settings.url));
    await prefs.setString(supabaseBucketPreference, settings.bucket.trim());
    await prefs.setString(accountFingerprintPreference, settings.fingerprint);
    await prefs.remove(legacySupabaseKeyPreference);
  }

  Future<void> clear() async {
    await _secure.delete(secureSupabaseKeyName);
    final prefs = await _preferences();
    await prefs.remove(supabaseUrlPreference);
    await prefs.remove(legacySupabaseKeyPreference);
    await prefs.remove(supabaseBucketPreference);
    await prefs.remove(accountFingerprintPreference);
  }
}
