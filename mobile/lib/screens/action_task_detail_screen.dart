import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/action_task.dart';
import '../providers/action_tasks_provider.dart';

class ActionTaskDetailScreen extends StatelessWidget {
  final String taskId;

  const ActionTaskDetailScreen({super.key, required this.taskId});

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<ActionTasksProvider>();
    final task = provider.tasks.cast<ActionTask?>().firstWhere(
          (item) => item?.id == taskId,
          orElse: () => null,
        );
    if (task == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Görev Detayı')),
        body: const Center(child: Text('Görev artık bulunamıyor.')),
      );
    }

    return Scaffold(
      appBar: AppBar(
        title: const Text('Görev Detayı'),
        actions: [
          IconButton(
            tooltip: task.isPinned ? 'Sabitlemeyi kaldır' : 'Sabitle',
            onPressed: () => provider.setPinned(task.id, !task.isPinned),
            icon:
                Icon(task.isPinned ? Icons.push_pin : Icons.push_pin_outlined),
          ),
          IconButton(
            tooltip: task.isArchived ? 'Arşivden çıkar' : 'Arşivle',
            onPressed: () async {
              await provider.setArchived(task.id, !task.isArchived);
              if (context.mounted) Navigator.pop(context);
            },
            icon: Icon(task.isArchived
                ? Icons.unarchive_outlined
                : Icons.archive_outlined),
          ),
        ],
      ),
      body: SelectionArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text(task.title, style: Theme.of(context).textTheme.headlineSmall),
            const SizedBox(height: 12),
            LinearProgressIndicator(value: task.progress / 100),
            const SizedBox(height: 6),
            Text('${task.status.name} • %${task.progress}'),
            if (task.confidence != null) ...[
              const SizedBox(height: 6),
              Text('Güven: %${(task.confidence! * 100).round()}'),
            ],
            if (task.summary != null) ...[
              const SizedBox(height: 22),
              Text('Özet', style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 6),
              Text(task.summary!),
            ],
            if (task.errorMessage != null) ...[
              const SizedBox(height: 22),
              Text('Hata', style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 6),
              Text(
                '${task.errorCode ?? 'workflow_error'}: ${task.errorMessage}',
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            ],
            if (task.sources.isNotEmpty) ...[
              const SizedBox(height: 22),
              Text('Kaynaklar', style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 6),
              for (final source in task.sources)
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(source.label,
                          style: const TextStyle(fontWeight: FontWeight.w600)),
                      Text(source.url.toString()),
                    ],
                  ),
                ),
            ],
            if (task.result.isNotEmpty) ...[
              const SizedBox(height: 22),
              Text('Yapılandırılmış Sonuç',
                  style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 6),
              SelectableText(
                const JsonEncoder.withIndent('  ').convert(task.result),
                style: const TextStyle(fontFamily: 'monospace', fontSize: 12),
              ),
            ],
            const SizedBox(height: 32),
          ],
        ),
      ),
    );
  }
}
