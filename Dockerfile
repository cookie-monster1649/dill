# ── Build stage ────────────────────────────────────────────────────────────────
# Install only production dependencies in a temporary layer so the final image
# doesn't include devDependencies or npm's cache.
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# ── Runtime stage ──────────────────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app

# Run as a non-root user for security
RUN addgroup -S dill && adduser -S dill -G dill

# Copy dependencies from the build stage and application source
COPY --from=deps /app/node_modules ./node_modules
COPY src/ ./src/
COPY config.js package.json ./

# Create empty data files so the app can write to them on first run.
# In production, use DILL_STORAGE_CHANNEL_ID for persistence instead of
# relying on these files surviving container restarts.
#
# Example data structure (what configs.json looks like once a rotation is created):
# { "C1234567890": { "My Rotation": { "members": [...], "days": [...], ... } } }
RUN echo '{}' > configs.json && \
    echo '{}' > rotations.json && \
    echo '{}' > activestate.json && \
    echo '{}' > analytics.json && \
    echo '{}' > leave.json && \
    chown -R dill:dill /app

USER dill

EXPOSE 3000

# Health check uses the bot's built-in HTTP endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || 3000) + '/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "src/index.js"]
