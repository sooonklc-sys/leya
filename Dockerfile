FROM node:22-alpine
WORKDIR /app
COPY --chown=node:node package.json serve.mjs ./
COPY --chown=node:node config/server.json ./config/server.json
COPY --chown=node:node dist ./dist
USER node
ENV HOST=0.0.0.0 PORT=8765
EXPOSE 8765
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:8765/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "serve.mjs"]
