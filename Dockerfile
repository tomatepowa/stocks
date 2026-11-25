# Image du serveur (API et pages), construite et lancée par docker compose.

FROM rust:1.99-slim-trixie AS build
WORKDIR /build
COPY Cargo.toml Cargo.lock ./
COPY src src
COPY migrations migrations
RUN cargo build --release

FROM debian:trixie-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /build/target/release/stocks /usr/local/bin/
COPY web web
ENV DATABASE_URL="host=db user=stocks password=stocks_dev dbname=stocks"
CMD ["stocks", "--hote", "0.0.0.0", "--web", "/app/web"]
