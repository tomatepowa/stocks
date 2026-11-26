//! Serveur de gestion des stocks pharmacie et économat : API et pages web.
//!
//! Au démarrage, applique les migrations de `migrations/` qui manquent, puis sert l'API
//! (`/api/…`) et les pages de `web/`.

mod crud;
mod referentiels;
mod registre;
mod schema;

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result};
use axum::extract::DefaultBodyLimit;
use axum::routing::{get, post};
use axum::Router;
use clap::Parser;
use deadpool_postgres::{Manager, Pool};
use tokio_postgres::NoTls;
use axum::http::{header, HeaderValue};
use tower_http::services::ServeDir;
use tower_http::set_header::SetResponseHeader;

#[derive(Parser)]
#[command(about = "Serveur de gestion des stocks pharmacie et économat")]
struct Cli {
    /// Chaîne de connexion PostgreSQL.
    #[arg(
        long,
        env = "DATABASE_URL",
        default_value = "host=localhost port=5433 user=stocks password=stocks_dev dbname=stocks"
    )]
    db: String,

    /// Port d'écoute.
    #[arg(long, default_value_t = 8090)]
    port: u16,

    /// Adresse d'écoute : 127.0.0.1 (ce poste seulement), 0.0.0.0 dans le conteneur Docker.
    #[arg(long, default_value = "127.0.0.1")]
    hote: String,

    /// Dossier des pages.
    #[arg(long, default_value = concat!(env!("CARGO_MANIFEST_DIR"), "/web"))]
    web: PathBuf,
}

pub struct Etat {
    pub pool: Pool,
}

/// Migrations, dans l'ordre ; une migration appliquée ne se modifie plus, on en ajoute une nouvelle.
const MIGRATIONS: &[(&str, &str)] = &[
    ("001_schema", include_str!("../migrations/001_schema.sql")),
    ("002_stupefiants_securises", include_str!("../migrations/002_stupefiants_securises.sql")),
    ("003_lots", include_str!("../migrations/003_lots.sql")),
];

async fn migrer(pool: &Pool) -> Result<()> {
    // La base peut démarrer après le serveur (docker compose) : on attend jusqu'à une minute.
    let mut client = None;
    for essai in 0..60 {
        match pool.get().await {
            Ok(c) => {
                client = Some(c);
                break;
            }
            Err(e) if essai == 59 => return Err(e).context("connexion à la base"),
            Err(_) => tokio::time::sleep(Duration::from_secs(1)).await,
        }
    }
    let mut c = client.unwrap();
    c.batch_execute(
        "create table if not exists _migration (nom text primary key, appliquee_le timestamptz not null default now())",
    )
    .await?;
    for (nom, sql) in MIGRATIONS {
        if c.query_opt("select 1 from _migration where nom = $1", &[nom]).await?.is_some() {
            continue;
        }
        let tx = c.transaction().await?;
        tx.batch_execute(sql).await.with_context(|| format!("migration {nom}"))?;
        tx.execute("insert into _migration (nom) values ($1)", &[nom]).await?;
        tx.commit().await?;
        println!("migration appliquée : {nom}");
    }
    Ok(())
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();
    let config: tokio_postgres::Config = cli.db.parse().context("chaîne de connexion")?;
    let pool = Pool::builder(Manager::new(config, NoTls)).max_size(16).build()?;
    migrer(&pool).await?;

    let etat = Arc::new(Etat { pool });
    let app = Router::new()
        .route("/api/schema", get(crud::schema_json))
        .route("/api/e/{entite}", get(crud::lister).post(crud::creer))
        .route("/api/e/{entite}/{id}", get(crud::lire).put(crud::modifier).delete(crud::supprimer))
        .route("/api/journal/{entite}/{id}", get(crud::journal))
        .route("/api/etablissement/{id}/referencer", post(crud::referencer))
        .route("/api/article/{id}/sources", get(referentiels::sources))
        .route("/api/article/{id}/reprendre", post(referentiels::reprendre))
        .route("/api/registre", get(registre::registre))
        .route("/api/catalogue", get(referentiels::rechercher))
        .route("/api/catalogue/imports", get(referentiels::imports))
        .route(
            "/api/catalogue/import",
            // Un catalogue complet peut peser plusieurs dizaines de Mo.
            post(referentiels::importer).layer(DefaultBodyLimit::max(200 * 1024 * 1024)),
        )
        .with_state(etat)
        // Pages : le navigateur revérifie chaque fichier (sans le retélécharger s'il n'a pas changé),
        // pour qu'une mise à jour soit vue tout de suite.
        .fallback_service(SetResponseHeader::overriding(
            ServeDir::new(&cli.web),
            header::CACHE_CONTROL,
            HeaderValue::from_static("no-cache"),
        ));

    let adresse = format!("{}:{}", cli.hote, cli.port);
    let ecoute = tokio::net::TcpListener::bind(&adresse).await.with_context(|| format!("écoute sur {adresse}"))?;
    println!("stocks : http://{adresse}");
    axum::serve(ecoute, app).await?;
    Ok(())
}
