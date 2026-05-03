FROM node:22-bookworm

USER root
WORKDIR /app

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
RUN apt-get update \
  && apt-get install -y --no-install-recommends chromium fonts-noto-color-emoji fonts-noto-cjk ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm install --production

COPY src/ ./src/

ENV CHROME_PATH=/usr/bin/chromium
EXPOSE 3002
CMD ["node", "src/index.js"]
