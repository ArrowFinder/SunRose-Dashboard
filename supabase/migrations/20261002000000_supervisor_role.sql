-- Commit the enum value before using it in the next migration.
alter type public.app_role add value if not exists 'supervisor' before 'employee';
