-- CaptainRange provenance
ALTER TABLE "captain_ranges" ADD COLUMN "created_by_id" INTEGER;
ALTER TABLE "captain_ranges" ADD COLUMN "updated_by_id" INTEGER;

-- Substitution requests (formal substitute workflow)
CREATE TABLE "substitution_requests" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "reservation_id" INTEGER NOT NULL,
    "occurrence_date" TEXT NOT NULL,
    "requested_by_name" TEXT,
    "substitute_name" TEXT,
    "substitute_phone" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "captain_user_id" INTEGER,
    "notes" TEXT,
    "reviewed_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "substitution_requests_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "substitution_requests_captain_user_id_fkey" FOREIGN KEY ("captain_user_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "substitution_requests_captain_user_id_status_idx" ON "substitution_requests"("captain_user_id", "status");
CREATE INDEX "substitution_requests_reservation_id_occurrence_date_idx" ON "substitution_requests"("reservation_id", "occurrence_date");
