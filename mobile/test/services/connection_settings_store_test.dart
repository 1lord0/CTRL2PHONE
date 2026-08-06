import 'package:ctrl2phone_mobile/services/connection_settings_store.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

class FakeSecureBackend implements SecureSettingsBackend {
  final Map<String, String> values = {};
  bool discardWrites = false;

  @override
  Future<void> delete(String key) async => values.remove(key);

  @override
  Future<String?> read(String key) async => values[key];

  @override
  Future<void> write(String key, String value) async {
    if (!discardWrites) values[key] = value;
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  test('migrates a plaintext key only after a verified secure write', () async {
    SharedPreferences.setMockInitialValues({
      supabaseUrlPreference: 'https://EXAMPLE.supabase.co/',
      legacySupabaseKeyPreference: 'legacy-key',
      supabaseBucketPreference: 'screenshots',
    });
    final secure = FakeSecureBackend();
    final store = ConnectionSettingsStore(secure: secure);

    final settings = await store.load();
    final prefs = await SharedPreferences.getInstance();

    expect(settings?.anonKey, 'legacy-key');
    expect(secure.values[secureSupabaseKeyName], 'legacy-key');
    expect(prefs.containsKey(legacySupabaseKeyPreference), isFalse);
    expect(
        prefs.getString(accountFingerprintPreference), settings?.fingerprint);
  });

  test('failed secure migration preserves the plaintext key', () async {
    SharedPreferences.setMockInitialValues({
      supabaseUrlPreference: 'https://example.supabase.co',
      legacySupabaseKeyPreference: 'legacy-key',
    });
    final secure = FakeSecureBackend()..discardWrites = true;
    final store = ConnectionSettingsStore(secure: secure);

    await expectLater(store.load(), throwsStateError);
    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getString(legacySupabaseKeyPreference), 'legacy-key');
  });

  test('migration is idempotent when the secure key already exists', () async {
    SharedPreferences.setMockInitialValues({
      supabaseUrlPreference: 'https://example.supabase.co',
      legacySupabaseKeyPreference: 'stale-copy',
    });
    final secure = FakeSecureBackend()
      ..values[secureSupabaseKeyName] = 'secure-key';
    final store = ConnectionSettingsStore(secure: secure);

    final first = await store.load();
    final second = await store.load();

    expect(first?.anonKey, 'secure-key');
    expect(second?.anonKey, 'secure-key');
    final prefs = await SharedPreferences.getInstance();
    expect(prefs.containsKey(legacySupabaseKeyPreference), isFalse);
  });

  test('fingerprint normalizes URL but distinguishes buckets', () {
    expect(
      connectionFingerprint('HTTPS://Example.Supabase.co/', 'screenshots'),
      connectionFingerprint('https://example.supabase.co', 'screenshots'),
    );
    expect(
      connectionFingerprint('https://example.supabase.co', 'screenshots'),
      isNot(connectionFingerprint('https://example.supabase.co', 'other')),
    );
  });
}
