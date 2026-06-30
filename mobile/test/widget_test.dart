import 'package:flutter_test/flutter_test.dart';
import 'package:ctrl2phone_mobile/main.dart';

void main() {
  group('PhoneApp', () {
    testWidgets('shows SettingsScreen when not initialized', (WidgetTester tester) async {
      await tester.pumpWidget(const PhoneApp(isInitialized: false));
      expect(find.text('Kurulum'), findsOneWidget);
    });

    testWidgets('shows HomeScreen when initialized', (WidgetTester tester) async {
      await tester.pumpWidget(const PhoneApp(isInitialized: true));
      expect(find.text('Fotoğraf Galerisi'), findsOneWidget);
    });
  });
}
