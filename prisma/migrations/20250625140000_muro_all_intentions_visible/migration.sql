-- Todas las intenciones van al muro; las que eran "private" pasan a "wall".
UPDATE "prayer_intentions" SET "visibility" = 'wall' WHERE "visibility" = 'private';
