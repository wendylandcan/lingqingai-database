FROM node:22-alpine

WORKDIR /app

COPY package*.json ./

RUN npm ci

COPY . .

RUN NODE_OPTIONS="--max-old-space-size=2048" npm run build

CMD ["npm", "run", "start"]
