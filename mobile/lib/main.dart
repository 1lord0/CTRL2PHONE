import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'services/connection_settings_store.dart';
import 'services/supabase_service.dart';
import 'providers/photos_provider.dart';
import 'providers/action_tasks_provider.dart';
import 'screens/app_shell_screen.dart';
import 'screens/settings_screen.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  bool isInitialized = false;
  try {
    final settings = await ConnectionSettingsStore().load();
    if (settings != null) {
      SupabaseService.initClient(
        settings.url,
        settings.anonKey,
        settings.bucket,
      );
      isInitialized = true;
    }
  } catch (e) {
    debugPrint('Supabase init failed: $e');
  }

  runApp(PhoneApp(isInitialized: isInitialized));
}

class PhoneApp extends StatelessWidget {
  final bool isInitialized;
  const PhoneApp({super.key, required this.isInitialized});

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => PhotosProvider()),
        ChangeNotifierProvider(create: (_) => ActionTasksProvider()),
      ],
      child: MaterialApp(
        title: 'Phone Gallery',
        debugShowCheckedModeBanner: false,
        theme: ThemeData(
          colorScheme: ColorScheme.fromSeed(
            seedColor: Colors.indigo,
            brightness: Brightness.light,
          ),
          useMaterial3: true,
        ),
        darkTheme: ThemeData(
          colorScheme: ColorScheme.fromSeed(
            seedColor: Colors.indigo,
            brightness: Brightness.dark,
          ),
          useMaterial3: true,
        ),
        home: isInitialized
            ? const AppShellScreen()
            : const SettingsScreen(isInitialSetup: true),
      ),
    );
  }
}
