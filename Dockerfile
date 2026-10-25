# Agent Depot — production image for Vultr (Container Registry / VPS / Kubernetes).
FROM node:22-alpine AS build
WORKDIR /app

# Install full deps (build needs Prisma, Tailwind, TypeScript devDependencies).
COPY package.json package-lock.json ./
RUN npm ci

# Generate the Prisma client and build the Next.js server.
COPY . .
RUN npm run db:generate && npm run build

# ---- Runtime ----
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Prisma CLI + migrations + schema so the container can self-migrate on boot.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./prisma.config.ts
COPY --from=build /app/generated ./generated

# Built app.
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/next.config.ts ./next.config.ts

EXPOSE 3000
# Apply committed migrations, then start the server.
CMD ["sh", "-c", "npx prisma migrate deploy && npx next start -H 0.0.0.0 -p 3000"]
