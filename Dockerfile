# syntax=docker/dockerfile:1

FROM node:22-alpine AS web-build
WORKDIR /web
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html tsconfig.json ./
COPY src/ ./src/
RUN npm run build

FROM golang:1.27-alpine AS go-build
WORKDIR /src
COPY go.mod main.go ./
COPY --from=web-build /web/dist ./dist
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/boar .

FROM alpine:3.22
RUN adduser -D -u 1000 app
COPY --from=go-build /out/boar /usr/local/bin/boar
USER app
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/boar"]
