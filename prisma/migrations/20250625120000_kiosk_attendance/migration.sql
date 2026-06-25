-- phone_number único en users + tabla attendance_logs
ALTER TABLE "users" ADD COLUMN "phone_number" TEXT;

CREATE UNIQUE INDEX "users_phone_number_key" ON "users"("phone_number");

CREATE TABLE "attendance_logs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL,
    "check_in_at" DATETIME NOT NULL,
    "check_out_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "attendance_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "attendance_logs_user_id_check_in_at_idx" ON "attendance_logs"("user_id", "check_in_at");
