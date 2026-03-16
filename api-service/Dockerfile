FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --production
COPY src/ ./src/
EXPOSE 3001
CMD ["sh", "-c", "node src/scripts/seed-user.js && node src/index.js"]
