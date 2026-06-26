-- Días de la semana por turno (1=Lun … 7=Dom; NULL = todos los días)
ALTER TABLE "slots" ADD COLUMN "week_days" TEXT;
