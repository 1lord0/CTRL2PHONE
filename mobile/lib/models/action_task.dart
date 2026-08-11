import 'dart:convert';

const _uuidPattern =
    r'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
const _maxResultBytes = 100 * 1024;

enum ActionTaskStatus {
  queued,
  analyzing,
  researching,
  completed,
  failed,
  cancelled;

  static ActionTaskStatus parse(Object? value) => values.firstWhere(
        (status) => status.name == value,
        orElse: () => throw const FormatException('Invalid task status'),
      );

  bool get isTerminal =>
      this == completed || this == failed || this == cancelled;
}

enum ActionTaskIntent {
  pending,
  profileResearch,
  recipeExtraction,
  generalVisualAnalysis;

  String get wireName => switch (this) {
        pending => 'pending',
        profileResearch => 'profile_research',
        recipeExtraction => 'recipe_extraction',
        generalVisualAnalysis => 'general_visual_analysis',
      };

  static ActionTaskIntent parse(Object? value) => switch (value) {
        'pending' => pending,
        'profile_research' => profileResearch,
        'recipe_extraction' => recipeExtraction,
        'general_visual_analysis' => generalVisualAnalysis,
        _ => throw const FormatException('Invalid task intent'),
      };
}

class ActionTaskSource {
  final String label;
  final Uri url;

  const ActionTaskSource({required this.label, required this.url});

  factory ActionTaskSource.fromJson(Object? value) {
    if (value is! Map) throw const FormatException('Invalid task source');
    final label = _requiredString(value['label'] ?? value['title'], 240);
    final rawUrl = _requiredString(value['url'], 2048);
    final uri = Uri.tryParse(rawUrl);
    if (uri == null ||
        !uri.hasScheme ||
        !uri.hasAuthority ||
        (uri.scheme != 'http' && uri.scheme != 'https')) {
      throw const FormatException('Invalid task source URL');
    }
    return ActionTaskSource(label: label, url: uri);
  }

  Map<String, dynamic> toJson() => {'label': label, 'url': url.toString()};
}

class ActionTaskUserState {
  final String taskId;
  final DateTime? readAt;
  final DateTime? pinnedAt;
  final DateTime? archivedAt;
  final DateTime updatedAt;

  const ActionTaskUserState({
    required this.taskId,
    required this.readAt,
    required this.pinnedAt,
    required this.archivedAt,
    required this.updatedAt,
  });

  factory ActionTaskUserState.fromJson(Object? value) {
    final raw = value is List && value.length == 1 ? value.single : value;
    if (raw is! Map) throw const FormatException('Invalid task user state');
    final taskId = _uuid(raw['task_id']);
    return ActionTaskUserState(
      taskId: taskId,
      readAt: _optionalDate(raw['read_at']),
      pinnedAt: _optionalDate(raw['pinned_at']),
      archivedAt: _optionalDate(raw['archived_at']),
      updatedAt: _requiredDate(raw['updated_at']),
    );
  }
}

class ActionTask {
  final String id;
  final String channelId;
  final ActionTaskIntent intent;
  final ActionTaskStatus status;
  final int progress;
  final String title;
  final String? summary;
  final Map<String, dynamic> result;
  final List<ActionTaskSource> sources;
  final double? confidence;
  final String? errorCode;
  final String? errorMessage;
  final int version;
  final DateTime createdAt;
  final DateTime updatedAt;
  final DateTime? completedAt;
  final DateTime? readAt;
  final DateTime? pinnedAt;
  final DateTime? archivedAt;
  final DateTime? userStateUpdatedAt;

  ActionTask({
    required this.id,
    required this.channelId,
    required this.intent,
    required this.status,
    required this.progress,
    required this.title,
    required this.summary,
    required Map<String, dynamic> result,
    required List<ActionTaskSource> sources,
    required this.confidence,
    required this.errorCode,
    required this.errorMessage,
    required this.version,
    required this.createdAt,
    required this.updatedAt,
    required this.completedAt,
    this.readAt,
    this.pinnedAt,
    this.archivedAt,
    this.userStateUpdatedAt,
  })  : result = Map.unmodifiable(result),
        sources = List.unmodifiable(sources);

  factory ActionTask.fromJson(Object? value) {
    if (value is! Map) throw const FormatException('Invalid task row');
    final rawResult = value['result_json'];
    if (rawResult is! Map) throw const FormatException('Invalid task result');
    final result = Map<String, dynamic>.from(rawResult);
    if (utf8.encode(jsonEncode(result)).length > _maxResultBytes) {
      throw const FormatException('Task result is too large');
    }

    final rawSources = value['sources'];
    if (rawSources is! List || rawSources.length > 50) {
      throw const FormatException('Invalid task sources');
    }
    final confidence = value['confidence'] == null
        ? null
        : _number(value['confidence'], 'confidence').toDouble();
    if (confidence != null && (confidence < 0 || confidence > 1)) {
      throw const FormatException('Invalid task confidence');
    }

    final progress = _integer(value['progress'], 'progress');
    final version = _integer(value['version'], 'version');
    if (progress < 0 || progress > 100 || version < 0) {
      throw const FormatException('Invalid task counters');
    }

    return ActionTask(
      id: _uuid(value['id']),
      channelId: _uuid(value['channel_id']),
      intent: ActionTaskIntent.parse(value['intent_type']),
      status: ActionTaskStatus.parse(value['workflow_status']),
      progress: progress,
      title: _requiredString(value['title'], 160),
      summary: _optionalString(value['summary'], 20000),
      result: result,
      sources: rawSources.map(ActionTaskSource.fromJson).toList(),
      confidence: confidence,
      errorCode: _optionalString(value['error_code'], 120),
      errorMessage: _optionalString(value['error_message'], 2000),
      version: version,
      createdAt: _requiredDate(value['created_at']),
      updatedAt: _requiredDate(value['updated_at']),
      completedAt: _optionalDate(value['completed_at']),
      readAt: _optionalDate(value['read_at']),
      pinnedAt: _optionalDate(value['pinned_at']),
      archivedAt: _optionalDate(value['archived_at']),
      userStateUpdatedAt: _optionalDate(value['user_state_updated_at']),
    );
  }

  bool get isRead => readAt != null;
  bool get isPinned => pinnedAt != null;
  bool get isArchived => archivedAt != null;

  ActionTask withUserState(ActionTaskUserState? state) {
    if (state == null) {
      return _copyWith(
        readAt: null,
        pinnedAt: null,
        archivedAt: null,
        userStateUpdatedAt: null,
        replaceUserState: true,
      );
    }
    if (state.taskId != id) throw const FormatException('Task state mismatch');
    return _copyWith(
      readAt: state.readAt,
      pinnedAt: state.pinnedAt,
      archivedAt: state.archivedAt,
      userStateUpdatedAt: state.updatedAt,
      replaceUserState: true,
    );
  }

  /// Applies workflow data only when the server's monotonic version is newer.
  ActionTask mergeWorkflow(ActionTask incoming) {
    if (incoming.id != id || incoming.channelId != channelId) return this;
    if (incoming.version <= version) return this;
    return incoming._copyWith(
      readAt: readAt,
      pinnedAt: pinnedAt,
      archivedAt: archivedAt,
      userStateUpdatedAt: userStateUpdatedAt,
      replaceUserState: true,
    );
  }

  ActionTask _copyWith({
    DateTime? readAt,
    DateTime? pinnedAt,
    DateTime? archivedAt,
    DateTime? userStateUpdatedAt,
    bool replaceUserState = false,
  }) =>
      ActionTask(
        id: id,
        channelId: channelId,
        intent: intent,
        status: status,
        progress: progress,
        title: title,
        summary: summary,
        result: result,
        sources: sources,
        confidence: confidence,
        errorCode: errorCode,
        errorMessage: errorMessage,
        version: version,
        createdAt: createdAt,
        updatedAt: updatedAt,
        completedAt: completedAt,
        readAt: replaceUserState ? readAt : this.readAt,
        pinnedAt: replaceUserState ? pinnedAt : this.pinnedAt,
        archivedAt: replaceUserState ? archivedAt : this.archivedAt,
        userStateUpdatedAt:
            replaceUserState ? userStateUpdatedAt : this.userStateUpdatedAt,
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'channel_id': channelId,
        'intent_type': intent.wireName,
        'workflow_status': status.name,
        'progress': progress,
        'title': title,
        'summary': summary,
        'result_json': result,
        'sources': sources.map((source) => source.toJson()).toList(),
        'confidence': confidence,
        'error_code': errorCode,
        'error_message': errorMessage,
        'version': version,
        'created_at': createdAt.toUtc().toIso8601String(),
        'updated_at': updatedAt.toUtc().toIso8601String(),
        'completed_at': completedAt?.toUtc().toIso8601String(),
        'read_at': readAt?.toUtc().toIso8601String(),
        'pinned_at': pinnedAt?.toUtc().toIso8601String(),
        'archived_at': archivedAt?.toUtc().toIso8601String(),
        'user_state_updated_at': userStateUpdatedAt?.toUtc().toIso8601String(),
      };
}

String _uuid(Object? value) {
  final text = _requiredString(value, 36);
  if (!RegExp(_uuidPattern).hasMatch(text)) {
    throw const FormatException('Invalid UUID');
  }
  return text;
}

String _requiredString(Object? value, int maxLength) {
  if (value is! String || value.isEmpty || value.length > maxLength) {
    throw const FormatException('Invalid string');
  }
  return value;
}

String? _optionalString(Object? value, int maxLength) {
  if (value == null) return null;
  return _requiredString(value, maxLength);
}

num _number(Object? value, String field) {
  if (value is num) return value;
  final parsed = num.tryParse(value?.toString() ?? '');
  if (parsed == null || !parsed.isFinite) {
    throw FormatException('Invalid $field');
  }
  return parsed;
}

int _integer(Object? value, String field) {
  final number = _number(value, field);
  if (number != number.roundToDouble()) throw FormatException('Invalid $field');
  return number.toInt();
}

DateTime _requiredDate(Object? value) {
  final parsed = DateTime.tryParse(value?.toString() ?? '');
  if (parsed == null) throw const FormatException('Invalid date');
  return parsed.toUtc();
}

DateTime? _optionalDate(Object? value) =>
    value == null ? null : _requiredDate(value);
