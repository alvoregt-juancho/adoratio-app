-- CreateTable
CREATE TABLE "settings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "freq_once_enabled" BOOLEAN NOT NULL DEFAULT true,
    "freq_daily_enabled" BOOLEAN NOT NULL DEFAULT true,
    "freq_weekly_enabled" BOOLEAN NOT NULL DEFAULT true,
    "freq_biweekly_enabled" BOOLEAN NOT NULL DEFAULT true,
    "freq_monthly_enabled" BOOLEAN NOT NULL DEFAULT true,
    "allow_offset_start_times" BOOLEAN NOT NULL DEFAULT false,
    "allow_thirty_minute_durations" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_reservations" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "slot_id" INTEGER NOT NULL,
    "user_id" INTEGER,
    "user_phone" TEXT NOT NULL,
    "user_first_name" TEXT NOT NULL DEFAULT '',
    "user_last_name" TEXT NOT NULL DEFAULT '',
    "user_name" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "frequency" TEXT NOT NULL DEFAULT 'WEEKLY',
    "duration_minutes" INTEGER NOT NULL DEFAULT 60,
    "start_time_offset" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'confirmed',
    "checked_in_at" DATETIME,
    "checked_in_via_qr_id" INTEGER,
    "cancelled_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "reservations_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "slots" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "reservations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "reservations_checked_in_via_qr_id_fkey" FOREIGN KEY ("checked_in_via_qr_id") REFERENCES "physical_qrs" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_reservations" ("id", "slot_id", "user_id", "user_phone", "user_first_name", "user_last_name", "user_name", "date", "status", "checked_in_at", "checked_in_via_qr_id", "cancelled_at", "created_at") SELECT "id", "slot_id", "user_id", "user_phone", "user_first_name", "user_last_name", "user_name", "date", "status", "checked_in_at", "checked_in_via_qr_id", "cancelled_at", "created_at" FROM "reservations";
DROP TABLE "reservations";
ALTER TABLE "new_reservations" RENAME TO "reservations";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
