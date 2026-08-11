import 'package:ctrl2phone_mobile/services/action_task_session_store.dart';
import 'package:ctrl2phone_mobile/services/connection_settings_store.dart';
import 'package:flutter_test/flutter_test.dart';

class MemorySecureBackend implements SecureSettingsBackend {
  final values = <String, String>{};

  @override
  Future<void> delete(String key) async => values.remove(key);

  @override
  Future<String?> read(String key) async => values[key];

  @override
  Future<void> write(String key, String value) async => values[key] = value;
}

void main() {
  test('session and channel are isolated and removable per connection',
      () async {
    final store = ActionTaskSessionStore(secure: MemorySecureBackend());
    await store.saveSession('account-a', '{"access_token":"secret"}');
    await store.saveChannelId(
      'account-a',
      '123e4567-e89b-42d3-a456-426614174000',
    );

    expect(await store.loadSession('account-a'), contains('secret'));
    expect(await store.loadSession('account-b'), isNull);
    expect(
      await store.loadChannelId('account-a'),
      '123e4567-e89b-42d3-a456-426614174000',
    );

    await store.clear('account-a');
    expect(await store.loadSession('account-a'), isNull);
    expect(await store.loadChannelId('account-a'), isNull);
  });
}
