-- Roster: capitanes y sustitutos por día/hora
CREATE TABLE "roster_members" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "role" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "internal_notes" TEXT,
    "week_days" TEXT,
    "slot_times" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

CREATE INDEX "roster_members_role_is_active_idx" ON "roster_members"("role", "is_active");
