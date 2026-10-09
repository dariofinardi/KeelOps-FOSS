-- Manager di gruppo: legge le attività dei membri del suo gruppo in ogni area,
-- gestisce i membri e configura stati e tipi di attività.
ALTER TABLE "GroupMember" ADD COLUMN "isManager" BOOLEAN NOT NULL DEFAULT false;
