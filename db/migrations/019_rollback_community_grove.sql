-- Manual rollback only. Back up first: this permanently removes Grove check-ins.
BEGIN;

DROP TABLE IF EXISTS community_checkin_supports;
DROP TABLE IF EXISTS community_checkins;

COMMIT;
