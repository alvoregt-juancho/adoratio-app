-- Un solo QR de capilla (tótem de ingreso) para todos los adoradores
ALTER TABLE "physical_qrs" ADD COLUMN "is_chapel_totem" BOOLEAN NOT NULL DEFAULT false;
