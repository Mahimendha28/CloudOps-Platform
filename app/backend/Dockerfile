
FROM node:22-alpine

WORKDIR /app

COPY package*.json ./

RUN npm ci --omit=dev

COPY src ./src

USER node

EXPOSE 3001

CMD ["npm", "start"]
