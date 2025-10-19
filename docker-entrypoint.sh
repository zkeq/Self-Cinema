#!/bin/sh
set -e

# Create directories inside the volume if they don't exist.
mkdir -p /data/logs
mkdir -p /data/uploads

# In this project, we don't have default config.yaml or music.db.
# So, we'll comment out or remove these lines.
cp -n /defaults/config.yaml /data/config.yaml || true
cp -n /defaults/database.db /data/database.db || true

# Execute the main command (supervisord)
exec "$@"