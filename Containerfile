FROM caddy:2.10.2 AS caddy
FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY test ./test
COPY public ./public
COPY scripts ./scripts
RUN npm run build
COPY --from=caddy /usr/bin/caddy /usr/local/bin/caddy
COPY Caddyfile /etc/caddy/Caddyfile
COPY container-entrypoint.sh /usr/local/bin/container-entrypoint
RUN chmod +x /usr/local/bin/container-entrypoint
ENV PORT=3000
ENV SHORT_URL_BASE_URL=https://example.com
EXPOSE 80 443
CMD ["container-entrypoint"]
