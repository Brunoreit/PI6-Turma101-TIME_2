# Gera os arquivos estáticos com Node e serve com nginx.
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_FONTE_DADOS=exemplo
ENV VITE_FONTE_DADOS=$VITE_FONTE_DADOS
RUN npm run build

FROM nginx:1.29-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
