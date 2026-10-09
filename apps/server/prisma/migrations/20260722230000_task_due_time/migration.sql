-- Orario di scadenza facoltativo ("HH:MM", ora italiana): il giorno resta in dueDate.
ALTER TABLE "Task" ADD COLUMN "dueTime" TEXT;
