-- Fun Day timer schema (plain Postgres).
-- The API applies this file on first request. Safe to run more than once.
-- No Supabase auth, row level security, or realtime publication.

DO $ext$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pgcrypto;
EXCEPTION
  WHEN OTHERS THEN
    NULL;
END
$ext$;

CREATE TABLE IF NOT EXISTS events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL DEFAULT '陀螺 Fun Day',
  school_name text NOT NULL DEFAULT '香港佛教劉金龍中學',
  password_hash text NOT NULL,
  active_round integer NOT NULL DEFAULT 0,
  round_count integer NOT NULL DEFAULT 9,
  electric_round_count integer NOT NULL DEFAULT 9,
  manual_round_count integer NOT NULL DEFAULT 9,
  electric_active_round integer NOT NULL DEFAULT 0,
  manual_active_round integer NOT NULL DEFAULT 0,
  battle_tallied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT events_code_check CHECK (code = upper(code) AND code ~ '^[A-Z0-9-]{3,20}$'),
  CONSTRAINT events_active_round_check CHECK (active_round >= 0),
  CONSTRAINT events_round_count_check CHECK (round_count >= 1),
  CONSTRAINT events_electric_round_count_check CHECK (electric_round_count >= 1),
  CONSTRAINT events_manual_round_count_check CHECK (manual_round_count >= 1),
  CONSTRAINT events_electric_active_round_check CHECK (electric_active_round >= 0),
  CONSTRAINT events_manual_active_round_check CHECK (manual_active_round >= 0)
);

CREATE TABLE IF NOT EXISTS battle_teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  team_number integer NOT NULL,
  name text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, team_number),
  CONSTRAINT battle_teams_team_number_check CHECK (team_number >= 1)
);

CREATE TABLE IF NOT EXISTS endurance_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  battle_team_id uuid REFERENCES battle_teams (id) ON DELETE CASCADE,
  category text NOT NULL,
  name text NOT NULL,
  position integer NOT NULL DEFAULT 0,
  elapsed_ms bigint NOT NULL DEFAULT 0,
  best_elapsed_ms bigint NOT NULL DEFAULT 0,
  started_at timestamptz,
  status text NOT NULL DEFAULT 'idle',
  archived boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT endurance_entries_category_check CHECK (category IN ('electric', 'manual')),
  CONSTRAINT endurance_entries_elapsed_ms_check CHECK (elapsed_ms >= 0),
  CONSTRAINT endurance_entries_best_elapsed_ms_check CHECK (best_elapsed_ms >= 0),
  CONSTRAINT endurance_entries_status_check CHECK (status IN ('idle', 'running', 'done'))
);

CREATE UNIQUE INDEX IF NOT EXISTS endurance_entries_team_category_idx
  ON endurance_entries (event_id, category, battle_team_id)
  WHERE battle_team_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS endurance_entries_event_category_idx
  ON endurance_entries (event_id, category, position);

CREATE TABLE IF NOT EXISTS battle_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  category text NOT NULL DEFAULT 'electric',
  round_number integer NOT NULL,
  match_number integer NOT NULL,
  team_a_id uuid NOT NULL REFERENCES battle_teams (id) ON DELETE CASCADE,
  team_b_id uuid NOT NULL REFERENCES battle_teams (id) ON DELETE CASCADE,
  a_score integer NOT NULL DEFAULT 0,
  b_score integer NOT NULL DEFAULT 0,
  complete boolean NOT NULL DEFAULT false,
  timer_elapsed_ms bigint NOT NULL DEFAULT 0,
  timer_started_at timestamptz,
  timer_running boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT battle_matches_category_check CHECK (category IN ('electric', 'manual')),
  CONSTRAINT battle_matches_round_number_check CHECK (round_number >= 0),
  CONSTRAINT battle_matches_match_number_check CHECK (match_number >= 0),
  CONSTRAINT battle_matches_a_score_check CHECK (a_score BETWEEN 0 AND 2),
  CONSTRAINT battle_matches_b_score_check CHECK (b_score BETWEEN 0 AND 2),
  CONSTRAINT battle_matches_timer_elapsed_ms_check CHECK (timer_elapsed_ms >= 0),
  CONSTRAINT battle_matches_distinct_teams_check CHECK (team_a_id <> team_b_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS battle_matches_event_category_round_match_idx
  ON battle_matches (event_id, category, round_number, match_number);

CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  NEW.updated_at = clock_timestamp();
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS events_touch_updated_at ON events;
CREATE TRIGGER events_touch_updated_at
  BEFORE UPDATE ON events
  FOR EACH ROW EXECUTE PROCEDURE touch_updated_at();

DROP TRIGGER IF EXISTS endurance_touch_updated_at ON endurance_entries;
CREATE TRIGGER endurance_touch_updated_at
  BEFORE UPDATE ON endurance_entries
  FOR EACH ROW EXECUTE PROCEDURE touch_updated_at();

DROP TRIGGER IF EXISTS battle_teams_touch_updated_at ON battle_teams;
CREATE TRIGGER battle_teams_touch_updated_at
  BEFORE UPDATE ON battle_teams
  FOR EACH ROW EXECUTE PROCEDURE touch_updated_at();

DROP TRIGGER IF EXISTS battle_matches_touch_updated_at ON battle_matches;
CREATE TRIGGER battle_matches_touch_updated_at
  BEFORE UPDATE ON battle_matches
  FOR EACH ROW EXECUTE PROCEDURE touch_updated_at();
