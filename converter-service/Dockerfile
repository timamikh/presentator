FROM ghcr.io/puppeteer/puppeteer:24.6.1

USER root
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --production

COPY src/ ./src/

EXPOSE 3002
CMD ["node", "src/index.js"]
