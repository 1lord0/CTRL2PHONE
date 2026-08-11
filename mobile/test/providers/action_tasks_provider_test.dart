import 'dart:async';
import 'dart:collection';

import 'package:ctrl2phone_mobile/models/action_task.dart';
import 'package:ctrl2phone_mobile/providers/action_tasks_provider.dart';
import 'package:ctrl2phone_mobile/services/action_task_cache.dart';
import 'package:ctrl2phone_mobile/services/action_tasks_service.dart';
import 'package:ctrl2phone_mobile/services/connection_settings_store.dart';
import 'package:ctrl2phone_mobile/services/qr_payload.dart';
import 'package:flutter_test/flutter_test.dart';

class MemoryCacheBackend implements ActionTaskCacheBackend {
  final values = <String, String>{};

  @override
  Future<void> delete(String key) async => values.remove(key);

  @override
  Future<String?> read(String key) async => values[key];

  @override
  Future<void> write(String key, String value) async => values[key] = value;
}

class FakeActionTasksGateway implements ActionTasksGateway {
  final fetches = Queue<Future<List<ActionTask>>>();
  final fetchStarted = Completer<void>();
  void Function(ActionTask task)? onTask;
  void Function(ActionTaskUserState state)? onUserState;
  String currentChannel = channelA;

  static const channelA = '123e4567-e89b-42d3-a456-426614174000';
  static const channelB = '123e4567-e89b-42d3-a456-426614174010';

  @override
  Future<ActionTaskConnection> connect(
    ConnectionSettings settings, {
    ActionPairingPayload? pairing,
  }) async {
    currentChannel = settings.url.contains('account-b') ? channelB : channelA;
    return ActionTaskConnection(
      fingerprint: settings.fingerprint,
      channelId: currentChannel,
      authenticated: true,
    );
  }

  @override
  Future<void> disconnect({bool clearPersistent = false}) async {}

  @override
  Future<List<ActionTask>> fetchTasks() {
    if (!fetchStarted.isCompleted) fetchStarted.complete();
    return fetches.removeFirst();
  }

  @override
  Future<ActionTaskUserState> setUserState(
    String taskId, {
    bool? isRead,
    bool? isPinned,
    bool? isArchived,
  }) async =>
      ActionTaskUserState(
        taskId: taskId,
        readAt: isRead == true ? DateTime.utc(2026, 8, 7, 12) : null,
        pinnedAt: isPinned == true ? DateTime.utc(2026, 8, 7, 12) : null,
        archivedAt: isArchived == true ? DateTime.utc(2026, 8, 7, 12) : null,
        updatedAt: DateTime.utc(2026, 8, 7, 12),
      );

  @override
  Future<void> stopRealtime() async {}

  @override
  Future<void> subscribe({
    required void Function(ActionTask task) onTask,
    required void Function(ActionTaskUserState state) onUserState,
    required void Function() onRefreshRequired,
  }) async {
    this.onTask = onTask;
    this.onUserState = onUserState;
  }
}

ConnectionSettings settings(String account) => ConnectionSettings(
      url: 'https://$account.supabase.co',
      anonKey: 'anon-key',
      bucket: 'SCREENSHOTS',
    );

ActionTask task({
  required String channelId,
  required int version,
  required String title,
  String status = 'queued',
}) =>
    ActionTask.fromJson({
      'id': channelId == FakeActionTasksGateway.channelA
          ? '123e4567-e89b-42d3-a456-426614174001'
          : '123e4567-e89b-42d3-a456-426614174011',
      'channel_id': channelId,
      'intent_type': 'general_visual_analysis',
      'workflow_status': status,
      'progress': status == 'completed' ? 100 : 10,
      'title': title,
      'summary': null,
      'result_json': const {},
      'sources': const [],
      'confidence': null,
      'error_code': null,
      'error_message': null,
      'version': version,
      'created_at': '2026-08-07T10:00:00Z',
      'updated_at': '2026-08-07T10:01:00Z',
      'completed_at': status == 'completed' ? '2026-08-07T10:01:00Z' : null,
    });

void main() {
  test('late fetch from an old account cannot overwrite the new account',
      () async {
    final gateway = FakeActionTasksGateway();
    final oldFetch = Completer<List<ActionTask>>();
    gateway.fetches
      ..add(oldFetch.future)
      ..add(Future.value([
        task(
          channelId: FakeActionTasksGateway.channelB,
          version: 1,
          title: 'new account',
        ),
      ]));
    final provider = ActionTasksProvider(
      gateway: gateway,
      cache: ActionTaskCache(backend: MemoryCacheBackend()),
      pollInterval: const Duration(days: 1),
    );

    final first = provider.initialize(settings('account-a'));
    await gateway.fetchStarted.future;
    final second = provider.initialize(settings('account-b'));
    oldFetch.complete([
      task(
        channelId: FakeActionTasksGateway.channelA,
        version: 9,
        title: 'stale account',
      ),
    ]);

    await Future.wait([first, second]);
    expect(provider.tasks.single.title, 'new account');
    expect(provider.channelId, FakeActionTasksGateway.channelB);
    provider.dispose();
  });

  test('an older realtime task event cannot replace a newer version', () async {
    final gateway = FakeActionTasksGateway();
    gateway.fetches.add(Future.value([
      task(
        channelId: FakeActionTasksGateway.channelA,
        version: 3,
        title: 'completed result',
        status: 'completed',
      ),
    ]));
    final provider = ActionTasksProvider(
      gateway: gateway,
      cache: ActionTaskCache(backend: MemoryCacheBackend()),
      pollInterval: const Duration(days: 1),
    );
    await provider.initialize(settings('account-a'));

    gateway.onTask!(task(
      channelId: FakeActionTasksGateway.channelA,
      version: 2,
      title: 'late analyzing result',
    ));
    await provider.markRead(provider.tasks.single.id, true);

    expect(provider.tasks.single.version, 3);
    expect(provider.tasks.single.title, 'completed result');
    expect(provider.tasks.single.isRead, isTrue);
    provider.dispose();
  });
}
