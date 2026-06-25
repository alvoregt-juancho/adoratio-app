-- CaptainRange: usuario con responsabilidad sobre día/hora
CREATE TABLE "captain_ranges" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL,
    "day_of_week" INTEGER,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "label" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "captain_ranges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "captain_ranges_user_id_is_active_idx" ON "captain_ranges"("user_id", "is_active");

-- CaptainNotification: alertas para el capitán de un bloque
CREATE TABLE "captain_notifications" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "captain_user_id" INTEGER NOT NULL,
    "captain_range_id" INTEGER,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "slot_id" INTEGER,
    "reservation_id" INTEGER,
    "occurrence_date" TEXT,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "is_urgent" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "captain_notifications_captain_user_id_fkey" FOREIGN KEY ("captain_user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "captain_notifications_captain_range_id_fkey" FOREIGN KEY ("captain_range_id") REFERENCES "captain_ranges" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "captain_notifications_captain_user_id_is_read_idx" ON "captain_notifications"("captain_user_id", "is_read");
