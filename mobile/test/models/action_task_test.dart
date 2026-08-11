import 'package:ctrl2phone_mobile/models/action_task.dart';
import 'package:flutter_test/flutter_test.dart';

Map<String, dynamic> taskRow({int version = 0, String status = 'queued'}) => {
      'id': '123e4567-e89b-42d3-a456-426614174001',
      'channel_id': '123e4567-e89b-42d3-a456-426614174000',
      'intent_type': 'profile_research',
      'workflow_status': status,
      'progress': status == 'completed' ? 100 : 10,
      'title': 'Profil araştırması',
      'summary': 'Özet',
      'result_json': {'name': 'Ada'},
      'sources': [
        {'label': 'Kaynak', 'url': 'https://example.com/profile'}
      ],
      'confidence': 0.8,
      'error_code': null,
      'error_message': null,
      'version': version,
      'created_at': '2026-08-07T10:00:00Z',
      'updated_at': '2026-08-07T10:01:00Z',
      'completed_at': status == 'completed' ? '2026-08-07T10:01:00Z' : null,
    };

void main() {
  test('strictly parses a valid action task', () {
    final task = ActionTask.fromJson(taskRow(version: 2));
    expect(task.version, 2);
    expect(task.intent, ActionTaskIntent.profileResearch);
    expect(task.sources.single.url.scheme, 'https');
  });

  test('rejects unsafe source schemes and invalid counters', () {
    final unsafe = taskRow();
    unsafe['sources'] = [
      {'label': 'bad', 'url': 'javascript:alert(1)'}
    ];
    expect(() => ActionTask.fromJson(unsafe), throwsFormatException);

    final badProgress = taskRow()..['progress'] = 101;
    expect(() => ActionTask.fromJson(badProgress), throwsFormatException);
  });

  test('an older realtime version cannot overwrite a newer result', () {
    final newer = ActionTask.fromJson(taskRow(version: 3, status: 'completed'));
    final older = ActionTask.fromJson(taskRow(version: 2));
    expect(newer.mergeWorkflow(older).version, 3);
    expect(newer.mergeWorkflow(older).status, ActionTaskStatus.completed);
  });

  test('workflow updates preserve mobile-only user state', () {
    final state = ActionTaskUserState.fromJson({
      'task_id': '123e4567-e89b-42d3-a456-426614174001',
      'read_at': '2026-08-07T10:02:00Z',
      'pinned_at': '2026-08-07T10:02:00Z',
      'archived_at': null,
      'updated_at': '2026-08-07T10:02:00Z',
    });
    final current =
        ActionTask.fromJson(taskRow(version: 1)).withUserState(state);
    final incoming =
        ActionTask.fromJson(taskRow(version: 2, status: 'completed'));
    final merged = current.mergeWorkflow(incoming);

    expect(merged.version, 2);
    expect(merged.isRead, isTrue);
    expect(merged.isPinned, isTrue);
  });
}
