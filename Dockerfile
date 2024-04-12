FROM hub.lumigame.com/base/node:20.9.0-alpine-24h1.1 AS builder
LABEL stage=builder
WORKDIR /app

COPY package.json .
COPY yarn.lock .
RUN yarn install
COPY . .
RUN npm run build

FROM hub.lumigame.com/base/node:20.9.0-alpine-24h1.1
WORKDIR /app

RUN apk --no-cache add curl
HEALTHCHECK  --interval=10s CMD curl --fail http://localhost:5000/health || exit 1

ARG NODE_ENV=production
ENV NODE_ENV $NODE_ENV
COPY package.json .
COPY yarn.lock .
RUN yarn install --prod

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/config/config.yaml ./dist/config/config.yaml

CMD [ "node", "./dist/main.js" ]
