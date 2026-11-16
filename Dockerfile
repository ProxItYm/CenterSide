FROM node:22-slim

WORKDIR /app

# Install dependencies first so the layer caches between code changes.
COPY bot/package*.json ./bot/
RUN cd bot && npm ci --omit=dev

COPY bot ./bot
COPY README.md ./

ENV NODE_ENV=production
WORKDIR /app/bot

# State and transcripts live here — mount a volume at /app/bot/data.
VOLUME ["/app/bot/data"]

CMD ["node", "src/index.js"]
