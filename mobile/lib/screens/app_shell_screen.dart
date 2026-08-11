import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../providers/action_tasks_provider.dart';
import '../services/connection_settings_store.dart';
import 'home_screen.dart';
import 'tasks_screen.dart';

class AppShellScreen extends StatefulWidget {
  const AppShellScreen({super.key});

  @override
  State<AppShellScreen> createState() => _AppShellScreenState();
}

class _AppShellScreenState extends State<AppShellScreen> {
  int _selectedIndex = 0;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      final settings = await ConnectionSettingsStore().load();
      if (!mounted || settings == null) return;
      await context.read<ActionTasksProvider>().initialize(settings);
    });
  }

  @override
  Widget build(BuildContext context) {
    final unread = context.select<ActionTasksProvider, int>(
      (provider) => provider.unreadCount,
    );
    return Scaffold(
      body: IndexedStack(
        index: _selectedIndex,
        children: const [HomeScreen(), TasksScreen()],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _selectedIndex,
        onDestinationSelected: (index) =>
            setState(() => _selectedIndex = index),
        destinations: [
          const NavigationDestination(
            icon: Icon(Icons.photo_library_outlined),
            selectedIcon: Icon(Icons.photo_library_rounded),
            label: 'Fotoğraflar',
          ),
          NavigationDestination(
            icon: Badge(
              isLabelVisible: unread > 0,
              label: Text(unread > 99 ? '99+' : '$unread'),
              child: const Icon(Icons.task_alt_outlined),
            ),
            selectedIcon: Badge(
              isLabelVisible: unread > 0,
              label: Text(unread > 99 ? '99+' : '$unread'),
              child: const Icon(Icons.task_alt_rounded),
            ),
            label: 'Görevler',
          ),
        ],
      ),
    );
  }
}
