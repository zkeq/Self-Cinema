# Stage 1: Base image with all runtimes
FROM debian:bullseye-slim AS base
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    python3 python3-pip \
    nginx \
    supervisor \
    curl \
    && \
    # Install Node.js v18 from NodeSource
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    # Clean up
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Stage 2: Build Frontend
FROM node:18-alpine AS frontend-builder
WORKDIR /app
RUN npm install -g pnpm
COPY frontend/package.json ./
RUN pnpm install
COPY frontend/ .
ARG NEXT_PUBLIC_API_URL=/api
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
RUN pnpm build

# Stage 3: Final image
FROM base
WORKDIR /app

# Copy backend
COPY backend/ /app/backend/
RUN pip3 install --no-cache-dir -r /app/backend/requirements.txt

# Create a staging area for default data to initialize volumes
RUN mkdir /defaults
COPY backend/config.yaml /defaults/
COPY backend/database.db /defaults/
# This project doesn't have config.yaml or music.db, so we remove these lines.

# Copy built frontend
COPY --from=frontend-builder /app/public /app/frontend/public
COPY --from=frontend-builder /app/.next/standalone /app/frontend/
COPY --from=frontend-builder /app/.next/static /app/frontend/.next/static

# Copy configs
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf
COPY nginx.standalone.conf /etc/nginx/sites-available/default
RUN rm -f /etc/nginx/sites-enabled/default && \
    ln -s /etc/nginx/sites-available/default /etc/nginx/sites-enabled/default

# Remove original files and create symlinks for data persistence.
# The entrypoint script will ensure the target files/dirs exist at runtime.
RUN rm /app/backend/database.db /app/backend/config.yaml && \
    rm -rf /app/backend/uploads && \
    ln -s /data/database.db /app/backend/database.db && \
    ln -s /data/config.yaml /app/backend/config.yaml && \
    ln -s /data/uploads /app/backend/uploads

VOLUME /data

# Expose the port Nginx is listening on
EXPOSE 80

# Copy and set entrypoint
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["/usr/bin/supervisord"]