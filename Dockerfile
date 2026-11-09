FROM node:24-alpine
WORKDIR /app
COPY dist ./dist
COPY server ./server
ENV HOST=0.0.0.0 PORT=4180
RUN mkdir /app/.data && chown node:node /app/.data
USER node
EXPOSE 4180
CMD ["node", "server/site-server.mjs"]
