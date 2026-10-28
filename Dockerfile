# Imagem do Conector, que também serve os estáticos da extensão em /extensao/.
FROM node:22-alpine
WORKDIR /app/connector
COPY packages/connector/package*.json ./
RUN npm ci --include=dev
COPY packages/connector/ ./
RUN npm run build && npm prune --omit=dev
COPY packages/extension/ /app/extension/
ENV NODE_ENV=production EXTENSION_DIR=/app/extension
RUN chown -R node:node /app
USER node
CMD ["node", "dist/server.js"]
