import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../models/action_task.dart';
import 'action_task_session_store.dart';
import 'connection_settings_store.dart';
import 'qr_payload.dart';

const _taskColumns =
    'id,channel_id,intent_type,workflow_status,progress,title,summary,'
    'result_json,sources,confidence,error_code,error_message,version,'
    'created_at,updated_at,completed_at';
const _userStateColumns = 'task_id,read_at,pinned_at,archived_at,updated_at';

class ActionTaskConnection {
  final String fingerprint;
  final String? channelId;
  final bool authenticated;
  final Object? error;

  const ActionTaskConnection({
    required this.fingerprint,
    required this.channelId,
    required this.authenticated,
    this.error,
  });

  bool get needsPairing => channelId == null;
}

abstract class ActionTasksGateway {
  Future<ActionTaskConnection> connect(
    ConnectionSettings settings, {
    ActionPairingPayload? pairing,
  });

  Future<List<ActionTask>> fetchTasks();

  Future<ActionTaskUserState> setUserState(
    String taskId, {
    bool? isRead,
    bool? isPinned,
    bool? isArchived,
  });

  Future<void> subscribe({
    required void Function(ActionTask task) onTask,
    required void Function(ActionTaskUserState state) onUserState,
    required void Function() onRefreshRequired,
  });

  Future<void> stopRealtime();

  Future<void> disconnect({bool clearPersistent = false});
}

class ActionTasksService implements ActionTasksGateway {
  final ActionTaskSessionStore _sessionStore;
  SupabaseClient? _client;
  StreamSubscription<AuthState>? _authSubscription;
  RealtimeChannel? _tasksChannel;
  RealtimeChannel? _userStateChannel;
  String? _fingerprint;
  String? _anonKey;
  String? _channelId;
  Future<void> _persistenceTail = Future.value();

  ActionTasksService({ActionTaskSessionStore? sessionStore})
      : _sessionStore = sessionStore ?? ActionTaskSessionStore();

  @override
  Future<ActionTaskConnection> connect(
    ConnectionSettings settings, {
    ActionPairingPayload? pairing,
  }) async {
    final fingerprint = settings.fingerprint;
    final sameClient = _fingerprint == fingerprint &&
        _anonKey == settings.anonKey &&
        _client != null;
    if (!sameClient) {
      await _disposeClient();
      _fingerprint = fingerprint;
      _anonKey = settings.anonKey;
      _channelId = await _sessionStore.loadChannelId(fingerprint);
      _client = SupabaseClient(settings.url, settings.anonKey);
      _listenForAuthChanges(fingerprint);
    }

    try {
      await _ensureAuthenticated(
        fingerprint,
        allowNewIdentity: pairing != null,
      );
      if (pairing != null) await _claimPairing(pairing, fingerprint);
      return ActionTaskConnection(
        fingerprint: fingerprint,
        channelId: _channelId,
        authenticated: true,
      );
    } catch (error) {
      if (pairing != null) rethrow;
      return ActionTaskConnection(
        fingerprint: fingerprint,
        channelId: _channelId,
        authenticated: false,
        error: error,
      );
    }
  }

  void _listenForAuthChanges(String fingerprint) {
    final client = _client!;
    _authSubscription = client.auth.onAuthStateChange.listen((state) {
      if (_fingerprint != fingerprint) return;
      _persistenceTail = _persistenceTail.then((_) async {
        if (_fingerprint != fingerprint) return;
        final session = state.session;
        if (session != null) {
          await _sessionStore.saveSession(
            fingerprint,
            jsonEncode(session.toJson()),
          );
        }
      }).catchError((Object error, StackTrace stackTrace) {
        debugPrint('Action session persistence failed: $error');
      });
    });
  }

  Future<void> _ensureAuthenticated(
    String fingerprint, {
    required bool allowNewIdentity,
  }) async {
    final client = _client!;
    if (client.auth.currentSession != null) return;

    final stored = await _sessionStore.loadSession(fingerprint);
    if (stored != null && stored.isNotEmpty) {
      try {
        final restored = await client.auth.recoverSession(stored);
        if (restored.session != null) {
          await _saveCurrentSession(fingerprint);
          return;
        }
      } catch (error) {
        if (_channelId != null && !allowNewIdentity) {
          throw StateError(
              'Görev oturumu yenilenemedi; QR ile tekrar eşleştirin.');
        }
        debugPrint('Discarding unusable unpaired action session: $error');
      }
    }

    if (_channelId != null && !allowNewIdentity) {
      throw StateError('Görev oturumu bulunamadı; QR ile tekrar eşleştirin.');
    }
    if (allowNewIdentity) {
      await _sessionStore.clear(fingerprint);
      _channelId = null;
    }
    final response = await client.auth.signInAnonymously();
    if (response.session == null) {
      throw StateError('Anonim Supabase oturumu açılamadı.');
    }
    await _saveCurrentSession(fingerprint);
  }

  Future<void> _saveCurrentSession(String fingerprint) async {
    final session = _client?.auth.currentSession;
    if (session == null) throw StateError('Görev oturumu bulunamadı.');
    await _sessionStore.saveSession(fingerprint, jsonEncode(session.toJson()));
  }

  Future<void> _claimPairing(
    ActionPairingPayload pairing,
    String fingerprint,
  ) async {
    if (!pairing.inviteExpiresAt.isAfter(DateTime.now().toUtc())) {
      throw StateError('Görev eşleştirme davetinin süresi dolmuş.');
    }
    final claimed = await _client!.rpc(
      'claim_action_channel',
      params: {
        'p_channel_id': pairing.channelId,
        'p_invite_token': pairing.inviteToken,
      },
    );
    if (claimed?.toString() != pairing.channelId) {
      throw StateError('Görev kanalı doğrulanamadı.');
    }
    await _sessionStore.saveChannelId(fingerprint, pairing.channelId);
    _channelId = pairing.channelId;
  }

  @override
  Future<List<ActionTask>> fetchTasks() async {
    final client = _requireAuthenticatedClient();
    final channelId = _requireChannelId();
    final rawTasks = await client
        .from('action_tasks')
        .select(_taskColumns)
        .eq('channel_id', channelId)
        .eq('sent_to_phone', true)
        .order('created_at', ascending: false)
        .limit(200);
    final rawStates = await client
        .from('action_task_user_state')
        .select(_userStateColumns)
        .eq('channel_id', channelId)
        .limit(200);

    final states = <String, ActionTaskUserState>{};
    for (final raw in rawStates as List) {
      final state = ActionTaskUserState.fromJson(raw);
      states[state.taskId] = state;
    }

    final tasks = <ActionTask>[];
    for (final raw in rawTasks as List) {
      final task = ActionTask.fromJson(raw);
      if (task.channelId == channelId) {
        tasks.add(task.withUserState(states[task.id]));
      }
    }
    return tasks;
  }

  @override
  Future<ActionTaskUserState> setUserState(
    String taskId, {
    bool? isRead,
    bool? isPinned,
    bool? isArchived,
  }) async {
    final client = _requireAuthenticatedClient();
    final raw = await client.rpc(
      'set_action_task_user_state',
      params: {
        'p_task_id': taskId,
        'p_is_read': isRead,
        'p_is_pinned': isPinned,
        'p_is_archived': isArchived,
      },
    );
    return ActionTaskUserState.fromJson(raw);
  }

  @override
  Future<void> subscribe({
    required void Function(ActionTask task) onTask,
    required void Function(ActionTaskUserState state) onUserState,
    required void Function() onRefreshRequired,
  }) async {
    await stopRealtime();
    final client = _requireAuthenticatedClient();
    final channelId = _requireChannelId();

    _tasksChannel = client
        .channel('ctrl2phone-mobile-action-tasks-$channelId')
        .onPostgresChanges(
          event: PostgresChangeEvent.all,
          schema: 'public',
          table: 'action_tasks',
          filter: PostgresChangeFilter(
            type: PostgresChangeFilterType.eq,
            column: 'channel_id',
            value: channelId,
          ),
          callback: (payload) {
            if (payload.newRecord.isEmpty) {
              onRefreshRequired();
              return;
            }
            try {
              final sentToPhone = payload.newRecord['sent_to_phone'] as bool? ?? false;
              if (!sentToPhone) {
                onRefreshRequired();
                return;
              }
              onTask(ActionTask.fromJson(payload.newRecord));
            } catch (error) {
              debugPrint('Rejected malformed action task event: $error');
              onRefreshRequired();
            }
          },
        )
        .subscribe();

    _userStateChannel = client
        .channel('ctrl2phone-mobile-action-state-$channelId')
        .onPostgresChanges(
          event: PostgresChangeEvent.all,
          schema: 'public',
          table: 'action_task_user_state',
          filter: PostgresChangeFilter(
            type: PostgresChangeFilterType.eq,
            column: 'channel_id',
            value: channelId,
          ),
          callback: (payload) {
            if (payload.newRecord.isEmpty) {
              onRefreshRequired();
              return;
            }
            try {
              onUserState(ActionTaskUserState.fromJson(payload.newRecord));
            } catch (error) {
              debugPrint('Rejected malformed task state event: $error');
              onRefreshRequired();
            }
          },
        )
        .subscribe();
  }

  @override
  Future<void> stopRealtime() async {
    final client = _client;
    final tasks = _tasksChannel;
    final states = _userStateChannel;
    _tasksChannel = null;
    _userStateChannel = null;
    if (client != null && tasks != null) await client.removeChannel(tasks);
    if (client != null && states != null) await client.removeChannel(states);
  }

  SupabaseClient _requireAuthenticatedClient() {
    final client = _client;
    if (client == null || client.auth.currentSession == null) {
      throw StateError('Görev bağlantısı çevrimdışı.');
    }
    return client;
  }

  String _requireChannelId() {
    final channelId = _channelId;
    if (channelId == null) {
      throw StateError('Görev kanalı henüz eşleştirilmedi.');
    }
    return channelId;
  }

  @override
  Future<void> disconnect({bool clearPersistent = false}) async {
    final fingerprint = _fingerprint;
    await _disposeClient();
    if (clearPersistent && fingerprint != null) {
      await _sessionStore.clear(fingerprint);
    }
    _fingerprint = null;
    _anonKey = null;
    _channelId = null;
  }

  Future<void> _disposeClient() async {
    await stopRealtime();
    await _authSubscription?.cancel();
    _authSubscription = null;
    await _persistenceTail;
    final client = _client;
    _client = null;
    if (client != null) await client.dispose();
  }
}
