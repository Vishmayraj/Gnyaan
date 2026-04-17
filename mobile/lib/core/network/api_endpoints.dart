/// Centralized API endpoint constants for the Gnyaan backend.
class ApiEndpoints {
  ApiEndpoints._();

  // ── Base ────────────────────────────────────────────────────────────────────
  // 10.0.2.2 maps to host localhost inside the Android emulator.
  static const String baseUrl = 'http://10.33.56.111:3000/api';


  // ── Auth ────────────────────────────────────────────────────────────────────
  static const String register = '/auth/register';
  static const String login    = '/auth/login';

  // ── Document Upload / Ingestion ─────────────────────────────────────────────
  static const String uploadIngestion = '/upload/ingestion';
  static const String userDocuments   = '/upload/';
  static const String generateSummary = '/upload/summary';

  // ── Chat ────────────────────────────────────────────────────────────────────
  static const String chat        = '/chat/';
  static const String chatHistory = '/chat/';
}
