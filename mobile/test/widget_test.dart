import 'package:flutter_test/flutter_test.dart';
import 'package:ctrl2phone_mobile/main.dart';

void main() {
  group('PhoneApp', () {
    testWidgets('shows SettingsScreen when not initialized',
        (WidgetTester tester) async {
      await tester.pumpWidget(const PhoneApp(isInitialized: false));
      expect(find.text('Kurulum'), findsOneWidget);
    });

    testWidgets('shows HomeScreen when initialized',
        (WidgetTester tester) async {
      await tester.pumpWidget(const PhoneApp(isInitialized: true));
      expect(find.text('Fotoğraf Galerisi'), findsOneWidget);
      expect(find.text('Görevler'), findsOneWidget);
    });

    testWidgets('opens the separate task inbox from bottom navigation',
        (WidgetTester tester) async {
      await tester.pumpWidget(const PhoneApp(isInitialized: true));
      await tester.tap(find.text('Görevler'));
      await tester.pump();

      expect(find.text('Henüz görev yok'), findsOneWidget);
      expect(find.text('Fotoğraflar'), findsOneWidget);
    });
  });
}
