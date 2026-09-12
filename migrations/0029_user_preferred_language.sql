-- Migration 0029: User Preferred Language
-- Stores the SPA locale preference per user for i18n language detection.

ALTER TABLE user_metadata ADD COLUMN preferred_language TEXT;
