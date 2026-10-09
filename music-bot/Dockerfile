FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci --omit=dev --ignore-scripts

RUN node node_modules/youtube-dl-exec/scripts/postinstall.js

RUN ./node_modules/youtube-dl-exec/bin/yt-dlp --version \
    && ffmpeg -version \
    && node --version

COPY index.js ./

ENV NODE_ENV=production

CMD ["node", "index.js"]
