import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/action_task.dart';
import '../providers/action_tasks_provider.dart';
import 'action_task_detail_screen.dart';

class TasksScreen extends StatefulWidget {
  const TasksScreen({super.key});

  @override
  State<TasksScreen> createState() => _TasksScreenState();
}

class _TasksScreenState extends State<TasksScreen> {
  bool _showArchived = false;

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<ActionTasksProvider>();
    final visible = provider.tasks
        .where((task) => task.isArchived == _showArchived)
        .toList();

    return Scaffold(
      appBar: AppBar(
        title: Text(_showArchived ? 'Arşivlenmiş Görevler' : 'Görevler'),
        centerTitle: true,
        actions: [
          IconButton(
            tooltip: _showArchived ? 'Gelen kutusunu göster' : 'Arşivi göster',
            onPressed: () => setState(() => _showArchived = !_showArchived),
            icon: Icon(
                _showArchived ? Icons.inbox_rounded : Icons.archive_outlined),
          ),
          IconButton(
            tooltip: 'Yenile',
            onPressed: provider.isLoading ? null : provider.refresh,
            icon: const Icon(Icons.refresh_rounded),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: provider.refresh,
        child: _buildBody(context, provider, visible),
      ),
    );
  }

  Widget _buildBody(
    BuildContext context,
    ActionTasksProvider provider,
    List<ActionTask> tasks,
  ) {
    if (provider.isLoading && tasks.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }
    if (provider.needsPairing) {
      return _ScrollableMessage(
        icon: Icons.qr_code_2_rounded,
        title: 'Görev kanalı eşleştirilmedi',
        message: provider.errorMessage ??
            'Masaüstü ayarlarından yeni QR oluşturun ve telefon ayarlarında tarayın.',
      );
    }
    if (tasks.isEmpty) {
      return _ScrollableMessage(
        icon: _showArchived ? Icons.archive_outlined : Icons.task_alt_rounded,
        title: _showArchived ? 'Arşiv boş' : 'Henüz görev yok',
        message: provider.errorMessage ??
            'Bilgisayarda bir ekran alanı seçip Action düğmesine bastığınızda sonuç burada görünecek.',
      );
    }

    return CustomScrollView(
      physics: const AlwaysScrollableScrollPhysics(),
      slivers: [
        if (provider.isOffline || provider.errorMessage != null)
          SliverToBoxAdapter(child: _ConnectionBanner(provider: provider)),
        SliverPadding(
          padding: const EdgeInsets.fromLTRB(12, 8, 12, 24),
          sliver: SliverList.separated(
            itemCount: tasks.length,
            separatorBuilder: (_, __) => const SizedBox(height: 8),
            itemBuilder: (context, index) => _TaskCard(task: tasks[index]),
          ),
        ),
      ],
    );
  }
}

class _TaskCard extends StatelessWidget {
  final ActionTask task;

  const _TaskCard({required this.task});

  @override
  Widget build(BuildContext context) {
    final provider = context.read<ActionTasksProvider>();
    final colors = Theme.of(context).colorScheme;
    return Card(
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: () {
          if (!task.isRead) unawaited(provider.markRead(task.id, true));
          Navigator.push(
            context,
            MaterialPageRoute(
              builder: (_) => ActionTaskDetailScreen(taskId: task.id),
            ),
          );
        },
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  if (!task.isRead)
                    Container(
                      width: 9,
                      height: 9,
                      margin: const EdgeInsets.only(right: 8),
                      decoration: BoxDecoration(
                        color: colors.primary,
                        shape: BoxShape.circle,
                      ),
                    ),
                  Expanded(
                    child: Text(
                      task.title,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontWeight: FontWeight.w700),
                    ),
                  ),
                  if (task.isPinned) const Icon(Icons.push_pin, size: 18),
                ],
              ),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                runSpacing: 6,
                children: [
                  _Chip(label: _intentLabel(task.intent)),
                  _Chip(
                    label: _statusLabel(task.status),
                    color: _statusColor(task.status, colors),
                  ),
                ],
              ),
              if (task.summary != null) ...[
                const SizedBox(height: 8),
                Text(
                  task.summary!,
                  maxLines: 3,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
              const SizedBox(height: 10),
              LinearProgressIndicator(value: task.progress / 100),
              const SizedBox(height: 5),
              Text(
                '%${task.progress} • ${_shortDate(task.updatedAt)}',
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Chip extends StatelessWidget {
  final String label;
  final Color? color;

  const _Chip({required this.label, this.color});

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
        decoration: BoxDecoration(
          color: (color ?? Theme.of(context).colorScheme.secondaryContainer)
              .withValues(alpha: 0.22),
          borderRadius: BorderRadius.circular(99),
        ),
        child: Text(label, style: const TextStyle(fontSize: 12)),
      );
}

class _ConnectionBanner extends StatelessWidget {
  final ActionTasksProvider provider;

  const _ConnectionBanner({required this.provider});

  @override
  Widget build(BuildContext context) => Material(
        color: Theme.of(context).colorScheme.errorContainer,
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            children: [
              const Icon(Icons.cloud_off_rounded),
              const SizedBox(width: 8),
              Expanded(
                child: Text(provider.errorMessage ??
                    'Çevrimdışı önbellek gösteriliyor.'),
              ),
            ],
          ),
        ),
      );
}

class _ScrollableMessage extends StatelessWidget {
  final IconData icon;
  final String title;
  final String message;

  const _ScrollableMessage({
    required this.icon,
    required this.title,
    required this.message,
  });

  @override
  Widget build(BuildContext context) => ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(32),
        children: [
          const SizedBox(height: 80),
          Icon(icon, size: 64, color: Theme.of(context).colorScheme.primary),
          const SizedBox(height: 16),
          Text(
            title,
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.titleLarge,
          ),
          const SizedBox(height: 8),
          Text(message, textAlign: TextAlign.center),
        ],
      );
}

String _intentLabel(ActionTaskIntent intent) => switch (intent) {
      ActionTaskIntent.pending => 'Niyet belirleniyor',
      ActionTaskIntent.profileResearch => 'Profil araştırması',
      ActionTaskIntent.recipeExtraction => 'Tarif çıkarma',
      ActionTaskIntent.generalVisualAnalysis => 'Görsel analiz',
    };

String _statusLabel(ActionTaskStatus status) => switch (status) {
      ActionTaskStatus.queued => 'Sırada',
      ActionTaskStatus.analyzing => 'Analiz ediliyor',
      ActionTaskStatus.researching => 'Araştırılıyor',
      ActionTaskStatus.completed => 'Tamamlandı',
      ActionTaskStatus.failed => 'Hata',
      ActionTaskStatus.cancelled => 'İptal',
    };

Color _statusColor(ActionTaskStatus status, ColorScheme colors) =>
    switch (status) {
      ActionTaskStatus.completed => colors.primary,
      ActionTaskStatus.failed => colors.error,
      ActionTaskStatus.cancelled => colors.outline,
      _ => colors.tertiary,
    };

String _shortDate(DateTime date) {
  final local = date.toLocal();
  String two(int value) => value.toString().padLeft(2, '0');
  return '${two(local.day)}.${two(local.month)} ${two(local.hour)}:${two(local.minute)}';
}
