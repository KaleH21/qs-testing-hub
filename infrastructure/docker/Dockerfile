# Một Dockerfile, nhiều target: api | worker | web. Build từ gốc repo:
#   docker build -f infrastructure/docker/Dockerfile --target api .
FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build

# shortcut: image runtime mang cả node_modules của workspace (to hơn cần thiết);
# chuyển sang `pnpm deploy --prod` khi có packages/ dùng chung và cần image nhỏ.
FROM node:24-alpine AS runtime
WORKDIR /repo
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/package.json ./

FROM runtime AS api
COPY --from=build /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY --from=build /repo/apps/api/drizzle ./apps/api/drizzle
COPY --from=build /repo/apps/api/package.json ./apps/api/
EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]

FROM runtime AS worker
COPY --from=build /repo/apps/worker/node_modules ./apps/worker/node_modules
COPY --from=build /repo/apps/worker/dist ./apps/worker/dist
COPY --from=build /repo/apps/worker/package.json ./apps/worker/

FROM nginxinc/nginx-unprivileged:1.29-alpine AS web
COPY infrastructure/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
