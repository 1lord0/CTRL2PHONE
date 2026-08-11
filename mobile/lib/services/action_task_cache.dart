import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import '../models/action_task.dart';

const actionTaskCacheLimit = 100;
const actionTaskCacheByteLimit = 2 * 1024 * 1024;

abstract class ActionTaskCacheBackend {
  Future<String?> read(String key);
  Future<void> write(String key, String value);
  Future<void> delete(String key);
}

class SharedPreferencesActionTaskCacheBackend
    implements ActionTaskCacheBackend {
  final Future<SharedPreferences> Function() _preferences;

  SharedPreferencesActionTaskCacheBackend({
    Future<SharedPreferences> Function()? preferences,
  }) : _preferences = preferences ?? SharedPreferences.getInstance;

  @override
  Future<String?> read(String key) async =>
      (await _preferences()).getString(key);

  @override
  Future<void> write(String key, String value) async {
    await (await _preferences()).setString(key, value);
  }

  @override
  Future<void> delete(String key) async {
    await (await _preferences()).remove(key);
  }
}

class ActionTaskCache {
  final ActionTaskCacheBackend _backend;

  ActionTaskCache({ActionTaskCacheBackend? backend})
      : _backend = backend ?? SharedPreferencesActionTaskCacheBackend();

  String _key(String fingerprint) => 'action_tasks_cache_v1_$fingerprint';

  Future<List<ActionTask>> load({
    required String fingerprint,
    required String channelId,
  }) async {
    final key = _key(fingerprint);
    final raw = await _backend.read(key);
    if (raw == null || raw.isEmpty) return const [];
    try {
      if (utf8.encode(raw).length > actionTaskCacheByteLimit) {
        throw const FormatException('Task cache is too large');
      }
      final decoded = jsonDecode(raw);
      if (decoded is! Map ||
          decoded['schemaVersion'] != 1 ||
          decoded['channelId'] != channelId ||
          decoded['tasks'] is! List) {
        return const [];
      }
      final tasks = (decoded['tasks'] as List)
          .take(actionTaskCacheLimit)
          .map(ActionTask.fromJson)
          .where((task) => task.channelId == channelId)
          .toList();
      tasks.sort(_taskOrder);
      return tasks;
    } catch (_) {
      await _backend.delete(key);
      return const [];
    }
  }

  Future<void> save({
    required String fingerprint,
    required String channelId,
    required List<ActionTask> tasks,
  }) async {
    final ordered = tasks.where((task) => task.channelId == channelId).toList()
      ..sort(_taskOrder);
    final retained = <Map<String, dynamic>>[];

    for (final task in ordered.take(actionTaskCacheLimit)) {
      final candidate = [...retained, task.toJson()];
      final encoded = _encode(channelId, candidate);
      if (utf8.encode(encoded).length > actionTaskCacheByteLimit) break;
      retained.add(task.toJson());
    }

    await _backend.write(_key(fingerprint), _encode(channelId, retained));
  }

  Future<void> clear(String fingerprint) => _backend.delete(_key(fingerprint));

  String _encode(String channelId, List<Map<String, dynamic>> tasks) =>
      jsonEncode({
        'schemaVersion': 1,
        'channelId': channelId,
        'tasks': tasks,
      });
}

int _taskOrder(ActionTask left, ActionTask right) {
  final pinned = (right.isPinned ? 1 : 0).compareTo(left.isPinned ? 1 : 0);
  if (pinned != 0) return pinned;
  final created = right.createdAt.compareTo(left.createdAt);
  return created != 0 ? created : right.id.compareTo(left.id);
}
