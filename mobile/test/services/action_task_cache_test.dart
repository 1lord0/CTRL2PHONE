import 'package:ctrl2phone_mobile/models/action_task.dart';
import 'package:ctrl2phone_mobile/services/action_task_cache.dart';
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

ActionTask cachedTask(int index) => ActionTask.fromJson({
      'id':
          '123e4567-e89b-42d3-a456-${(426614174000 + index).toString().padLeft(12, '0')}',
      'channel_id': '123e4567-e89b-42d3-a456-426614174000',
      'intent_type': 'general_visual_analysis',
      'workflow_status': 'completed',
      'progress': 100,
      'title': 'Task $index',
      'summary': null,
      'result_json': {'index': index},
      'sources': [],
      'confidence': null,
      'error_code': null,
      'error_message': null,
      'version': index,
      'created_at': DateTime.utc(2026, 8, 7)
          .add(Duration(minutes: index))
          .toIso8601String(),
      'updated_at': DateTime.utc(2026, 8, 7)
          .add(Duration(minutes: index))
          .toIso8601String(),
      'completed_at': DateTime.utc(2026, 8, 7)
          .add(Duration(minutes: index))
          .toIso8601String(),
    });

void main() {
  test('cache is isolated by channel and survives a round trip', () async {
    final backend = MemoryCacheBackend();
    final cache = ActionTaskCache(backend: backend);
    await cache.save(
      fingerprint: 'account',
      channelId: '123e4567-e89b-42d3-a456-426614174000',
      tasks: [cachedTask(1)],
    );

    final restored = await cache.load(
      fingerprint: 'account',
      channelId: '123e4567-e89b-42d3-a456-426614174000',
    );
    final otherChannel = await cache.load(
      fingerprint: 'account',
      channelId: '123e4567-e89b-42d3-a456-426614174999',
    );
    expect(restored.single.title, 'Task 1');
    expect(otherChannel, isEmpty);
  });

  test('cache retains at most the newest 100 tasks', () async {
    final cache = ActionTaskCache(backend: MemoryCacheBackend());
    await cache.save(
      fingerprint: 'account',
      channelId: '123e4567-e89b-42d3-a456-426614174000',
      tasks: List.generate(120, cachedTask),
    );
    final restored = await cache.load(
      fingerprint: 'account',
      channelId: '123e4567-e89b-42d3-a456-426614174000',
    );
    expect(restored, hasLength(actionTaskCacheLimit));
    expect(restored.first.title, 'Task 119');
  });
}
