FROM node:20-alpine
WORKDIR /app
COPY package.json tsconfig.json ./
RUN npm install
COPY src ./src
CMD ["node", "-r", "ts-node/register/transpile-only", "src/bootstrap.ts"]
