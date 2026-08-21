"""
Apply a migration file to the Supabase database.

    python scripts/apply-migration.py supabase/migrations/20260822140000_x.sql
    python scripts/apply-migration.py --check      # connect and report, change nothing

WHY THIS EXISTS RATHER THAN `psql` OR THE SUPABASE CLI

Neither is installed on this desktop, and two things about Supabase's current
networking make an ad-hoc connection string fail in ways that look like a wrong
password:

  1. THE DIRECT HOST IS IPv6-ONLY. `db.<ref>.supabase.co` resolves to a AAAA
     record and nothing else, so on an IPv4-only desktop it does not resolve at
     all -- "Name or service not known", which reads like a typo rather than a
     protocol gap. The Oracle box resolves it fine, which is a red herring: it
     has IPv6 DNS, not necessarily IPv6 routing.

  2. THE POOLER TAKES A DIFFERENT USERNAME. It is `postgres.<project-ref>`, not
     `postgres`. Get it wrong against the right region and the server answers
     "password authentication failed for user postgres" -- an error about
     credentials for a problem that is nothing to do with them.

And one trap of our own making: passing the URL straight through re-encodes an
already-percent-encoded password, so the correct secret is sent wrong. The
credentials go as keyword arguments here for exactly that reason.

Migrations run in ONE TRANSACTION. A file that fails halfway leaves nothing
behind, which matters because these files are written to be re-runnable but not
half-runnable.
"""

import re
import sys
import urllib.parse

import psycopg2

ENV_FILE = ".env.local"
# aws-0 is the long-standing pooler; aws-1 hosts newer projects. Tried in turn
# because the project's region is not recorded anywhere in the repo, and a
# wrong guess is cheap -- it fails in under a second with ENOTFOUND.
REGIONS = [
    "ap-southeast-1", "us-east-1", "us-west-1", "ap-south-1",
    "eu-central-1", "eu-west-2", "ap-northeast-1", "ap-southeast-2",
]


def connect():
    env = open(ENV_FILE, encoding="utf8").read()
    m = re.search(r"^(?:SUPABASE_DB_URL|DATABASE_URL)=(.*)$", env, re.M)
    if not m:
        sys.exit(f"No SUPABASE_DB_URL or DATABASE_URL in {ENV_FILE}.")
    parsed = urllib.parse.urlparse(m.group(1).strip().strip("\"'"))
    ref = parsed.hostname.split(".")[1]
    # unquote, because urlparse hands back the still-encoded substring and
    # psycopg2 wants the real password.
    password = urllib.parse.unquote(parsed.password or "")

    attempts = []
    for region in REGIONS:
        for prefix in ("aws-0", "aws-1"):
            host = f"{prefix}-{region}.pooler.supabase.com"
            try:
                conn = psycopg2.connect(
                    host=host, port=5432, user=f"postgres.{ref}",
                    password=password, dbname="postgres",
                    sslmode="require", connect_timeout=8,
                )
                return conn, host
            except Exception as e:  # noqa: BLE001
                attempts.append(f"  {host}: {str(e).strip().splitlines()[-1][:90]}")
    sys.exit("Could not reach the database via any pooler:\n" + "\n".join(attempts))


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    conn, host = connect()
    print(f"connected via {host}")

    if "--check" in sys.argv:
        with conn.cursor() as cur:
            cur.execute("select current_database(), current_user, version()")
            db, user, version = cur.fetchone()
        print(f"  database={db} user={user}")
        print(f"  {version.split(',')[0]}")
        conn.close()
        return

    if not args:
        sys.exit("Usage: apply-migration.py <file.sql> [more.sql ...]")

    for path in args:
        sql = open(path, encoding="utf8").read()
        try:
            with conn:                      # commits on success, rolls back on raise
                with conn.cursor() as cur:
                    cur.execute(sql)
            print(f"applied {path}")
        except Exception as e:  # noqa: BLE001
            conn.close()
            sys.exit(f"FAILED {path}\n{e}")
    conn.close()


if __name__ == "__main__":
    main()
