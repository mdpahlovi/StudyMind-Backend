# Build App
FROM node:22-alpine AS build

WORKDIR /app

COPY package*.json ./

RUN npm ci --prefer-offline

COPY . .

RUN npm run build && \
    echo "Build complete"

# Take the build output and run it
FROM zenika/alpine-chrome:with-puppeteer

WORKDIR /app

RUN mkdir -p /app/public

COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/.env ./

EXPOSE 4000

CMD ["npm", "run", "start:prod"]

