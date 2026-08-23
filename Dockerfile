FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src

ENV MCP_PORT=8090
EXPOSE 8090

USER node
CMD ["node", "src/http.js"]
