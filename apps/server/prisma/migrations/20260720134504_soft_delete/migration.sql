-- AlterTable
ALTER TABLE "Company" ADD COLUMN "deletedAt" DATETIME;

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN "deletedAt" DATETIME;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN "deletedAt" DATETIME;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN "deletedAt" DATETIME;
