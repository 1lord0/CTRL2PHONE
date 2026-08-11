import 'dart:async';

import 'package:flutter/foundation.dart';

import '../models/action_task.dart';
import '../services/action_task_cache.dart';
import '../services/action_tasks_service.dart';
import '../services/connection_settings_store.dart';
import '../services/qr_payload.dart';

class ActionTasksProvider extends ChangeNotifier {
  final ActionTasksGateway _gateway;
  final ActionTaskCache _cache;
  final Duration pollInterval;

  List<ActionTask> _tasks = const [];
  bool _isLoading = false;
  bool _isOffline = false;
  bool _needsPairing = false;
  String? _errorMessage;
  String? _fingerprint;
  String? _channelId;
  ConnectionSettings? _settings;
  Timer? _pollTimer;
  Future<void> _operationTail = Future.value();
  int _generation = 0;
  bool _disposed = false;

  ActionTasksProvider({
    ActionTasksGateway? gateway,
    ActionTaskCache? cache,
    this.pollInterval = const Duration(seconds: 15),
  })  : _gateway = gateway ?? ActionTasksService(),
        _cache = cache ?? ActionTaskCache();

  List<ActionTask> get tasks => List.unmodifiable(_tasks);
  bool get isLoading => _isLoading;
  bool get isOffline => _isOffline;
  bool get needsPairing => _needsPairing;
  String? get errorMessage => _errorMessage;
  String? get channelId => _channelId;
  bool get isReady => _channelId != null && !_needsPairing && !_isOffline;
  int get unreadCount =>
      _tasks.where((task) => !task.isRead && !task.isArchived).length;

  Future<void> initialize(
    ConnectionSettings settings, {
    ActionPairingPayload? pairing,
  }) {
    final generation = ++_generation;
    return _serialize(() => _initialize(generation, settings, pairing));
  }

  Future<void> _initialize(
    int generation,
    ConnectionSettings settings,
    ActionPairingPayload? pairing,
  ) async {
    _pollTimer?.cancel();
    _pollTimer = null;
    await _gateway.stopRealtime();
    if (!_isCurrent(generation)) return;

    _settings = settings;
    _isLoading = true;
    _isOffline = false;
    _errorMessage = null;
    _notify();

    ActionTaskConnection connection;
    try {
      connection = await _gateway.connect(settings, pairing: pairing);
    } catch (error) {
      if (!_isCurrent(generation)) return;
      _fingerprint = settings.fingerprint;
      _channelId = null;
      _tasks = const [];
      _needsPairing = true;
      _isOffline = true;
      _isLoading = false;
      _errorMessage = _friendlyError(error);
      _notify();
      _startPolling(generation);
      return;
    }
    if (!_isCurrent(generation)) return;

    _fingerprint = connection.fingerprint;
    _channelId = connection.channelId;
    _needsPairing = connection.needsPairing;

    if (_channelId != null) {
      _tasks = await _cache.load(
        fingerprint: connection.fingerprint,
        channelId: _channelId!,
      );
      if (!_isCurrent(generation)) return;
      _notify();
    } else {
      _tasks = const [];
    }

    if (!connection.authenticated) {
      _isOffline = true;
      _isLoading = false;
      _errorMessage = _friendlyError(connection.error);
      _notify();
      _startPolling(generation);
      return;
    }

    if (_channelId == null) {
      _isLoading = false;
      _errorMessage =
          'Masaüstündeki QR kodu tarayarak görev kanalını eşleştirin.';
      _notify();
      return;
    }

    final subscribedChannelId = _channelId!;
    try {
      await _gateway.subscribe(
        onTask: (task) =>
            _queueRealtimeTask(generation, subscribedChannelId, task),
        onUserState: (state) =>
            _queueRealtimeUserState(generation, subscribedChannelId, state),
        onRefreshRequired: () => unawaited(refresh()),
      );
      if (!_isCurrent(generation)) return;
      final fetched = await _gateway.fetchTasks();
      if (!_isCurrent(generation)) return;
      _replaceFromServer(fetched);
      _isOffline = false;
      _errorMessage = null;
      await _persist();
    } catch (error) {
      if (!_isCurrent(generation)) return;
      _isOffline = true;
      _errorMessage = _friendlyError(error);
    } finally {
      if (_isCurrent(generation)) {
        _isLoading = false;
        _notify();
        _startPolling(generation);
      }
    }
  }

  Future<void> refresh() {
    final generation = _generation;
    return _serialize(() async {
      if (!_isCurrent(generation)) return;
      if (_channelId == null || _isOffline) {
        final settings = _settings;
        if (settings != null) {
          final nextGeneration = ++_generation;
          await _initialize(nextGeneration, settings, null);
        }
        return;
      }
      try {
        final fetched = await _gateway.fetchTasks();
        if (!_isCurrent(generation)) return;
        _replaceFromServer(fetched);
        _isOffline = false;
        _errorMessage = null;
        await _persist();
      } catch (error) {
        if (!_isCurrent(generation)) return;
        _isOffline = true;
        _errorMessage = _friendlyError(error);
      }
      _notify();
    });
  }

  Future<void> markRead(String taskId, bool value) =>
      _setUserState(taskId, isRead: value);

  Future<void> setPinned(String taskId, bool value) =>
      _setUserState(taskId, isPinned: value);

  Future<void> setArchived(String taskId, bool value) =>
      _setUserState(taskId, isArchived: value);

  Future<void> _setUserState(
    String taskId, {
    bool? isRead,
    bool? isPinned,
    bool? isArchived,
  }) {
    final generation = _generation;
    return _serialize(() async {
      if (!_isCurrent(generation)) return;
      try {
        final state = await _gateway.setUserState(
          taskId,
          isRead: isRead,
          isPinned: isPinned,
          isArchived: isArchived,
        );
        if (!_isCurrent(generation)) return;
        _applyUserState(state);
        _errorMessage = null;
        await _persist();
      } catch (error) {
        if (!_isCurrent(generation)) return;
        _errorMessage = _friendlyError(error);
      }
      _notify();
    });
  }

  void _queueRealtimeTask(
    int generation,
    String channelId,
    ActionTask incoming,
  ) {
    unawaited(_serialize(() async {
      if (!_isCurrent(generation) || _channelId != channelId) return;
      if (incoming.channelId != channelId) return;
      final index = _tasks.indexWhere((task) => task.id == incoming.id);
      if (index < 0) {
        _tasks = [..._tasks, incoming];
      } else {
        final updated = [..._tasks];
        updated[index] = updated[index].mergeWorkflow(incoming);
        _tasks = updated;
      }
      _sortTasks();
      await _persist();
      _notify();
    }));
  }

  void _queueRealtimeUserState(
    int generation,
    String channelId,
    ActionTaskUserState state,
  ) {
    unawaited(_serialize(() async {
      if (!_isCurrent(generation) || _channelId != channelId) return;
      _applyUserState(state);
      await _persist();
      _notify();
    }));
  }

  void _applyUserState(ActionTaskUserState state) {
    final index = _tasks.indexWhere((task) => task.id == state.taskId);
    if (index < 0) return;
    final current = _tasks[index];
    final currentUpdatedAt = current.userStateUpdatedAt;
    if (currentUpdatedAt != null &&
        !state.updatedAt.isAfter(currentUpdatedAt)) {
      return;
    }
    final updated = [..._tasks];
    updated[index] = current.withUserState(state);
    _tasks = updated;
    _sortTasks();
  }

  void _replaceFromServer(List<ActionTask> incoming) {
    final previous = {for (final task in _tasks) task.id: task};
    final merged = <ActionTask>[];
    for (final serverTask in incoming) {
      if (serverTask.channelId != _channelId) continue;
      final current = previous[serverTask.id];
      if (current == null) {
        merged.add(serverTask);
        continue;
      }
      var selected =
          current.version > serverTask.version ? current : serverTask;
      final currentStateAt = current.userStateUpdatedAt;
      final serverStateAt = serverTask.userStateUpdatedAt;
      if (currentStateAt != null &&
          (serverStateAt == null || currentStateAt.isAfter(serverStateAt))) {
        selected = selected.withUserState(ActionTaskUserState(
          taskId: current.id,
          readAt: current.readAt,
          pinnedAt: current.pinnedAt,
          archivedAt: current.archivedAt,
          updatedAt: currentStateAt,
        ));
      } else if (serverStateAt != null) {
        selected = selected.withUserState(ActionTaskUserState(
          taskId: serverTask.id,
          readAt: serverTask.readAt,
          pinnedAt: serverTask.pinnedAt,
          archivedAt: serverTask.archivedAt,
          updatedAt: serverStateAt,
        ));
      } else {
        selected = selected.withUserState(null);
      }
      merged.add(selected);
    }
    _tasks = merged;
    _sortTasks();
  }

  void _sortTasks() {
    final sorted = [..._tasks]..sort((left, right) {
        final pinned =
            (right.isPinned ? 1 : 0).compareTo(left.isPinned ? 1 : 0);
        if (pinned != 0) return pinned;
        final created = right.createdAt.compareTo(left.createdAt);
        return created != 0 ? created : right.id.compareTo(left.id);
      });
    _tasks = sorted;
  }

  Future<void> _persist() async {
    final fingerprint = _fingerprint;
    final channelId = _channelId;
    if (fingerprint == null || channelId == null) return;
    try {
      await _cache.save(
        fingerprint: fingerprint,
        channelId: channelId,
        tasks: _tasks,
      );
    } catch (error) {
      debugPrint('Action task cache write failed: $error');
    }
  }

  void _startPolling(int generation) {
    _pollTimer?.cancel();
    if (!_isCurrent(generation) || _needsPairing) return;
    _pollTimer = Timer.periodic(pollInterval, (_) {
      if (_isCurrent(generation)) unawaited(refresh());
    });
  }

  Future<void> disconnect({bool clearPersistent = false}) {
    final generation = ++_generation;
    return _serialize(() async {
      _pollTimer?.cancel();
      _pollTimer = null;
      final fingerprint = _fingerprint;
      await _gateway.disconnect(clearPersistent: clearPersistent);
      if (clearPersistent && fingerprint != null) {
        await _cache.clear(fingerprint);
      }
      if (!_isCurrent(generation)) return;
      _tasks = const [];
      _isLoading = false;
      _isOffline = false;
      _needsPairing = false;
      _errorMessage = null;
      _fingerprint = null;
      _channelId = null;
      _settings = null;
      _notify();
    });
  }

  Future<T> _serialize<T>(Future<T> Function() operation) {
    final next = _operationTail.then((_) => operation());
    _operationTail = next.then<void>(
      (_) {},
      onError: (Object _, StackTrace __) {},
    );
    return next;
  }

  bool _isCurrent(int generation) => !_disposed && generation == _generation;

  String _friendlyError(Object? error) {
    final message = error?.toString() ?? 'Bilinmeyen görev bağlantısı hatası.';
    if (message.contains('invalid_or_expired_action_channel_invite')) {
      return 'QR görev daveti geçersiz veya süresi dolmuş. Yeni QR oluşturun.';
    }
    if (message.contains('anonymous') || message.contains('Anonim')) {
      return 'Supabase Anonymous Sign-Ins özelliğini açın ve tekrar deneyin.';
    }
    return message.replaceFirst('StateError: ', '');
  }

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    _generation++;
    _pollTimer?.cancel();
    unawaited(_gateway.disconnect());
    super.dispose();
  }
}
