FROM node:24-alpine

RUN apk add --no-cache docker-cli docker-cli-compose

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

EXPOSE 3101

CMD ["node", "server.js"]
