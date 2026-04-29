FROM node:20-alpine

WORKDIR /app

# workspaces のために root の package.json を先にコピー
COPY package.json package-lock.json ./
COPY apps/liff/package.json ./apps/liff/

RUN npm install

# ソース全体をコピー
COPY apps/liff ./apps/liff
COPY packages ./packages

WORKDIR /app/apps/liff

EXPOSE 3000

CMD ["npx", "nuxt", "dev", "--host", "0.0.0.0"]
