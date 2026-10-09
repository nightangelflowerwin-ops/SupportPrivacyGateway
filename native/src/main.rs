mod engine;
mod vault;

use axum::{
    extract::{rejection::JsonRejection, DefaultBodyLimit, State},
    http::{HeaderMap, HeaderValue, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use clap::{Parser, Subcommand};
use serde::Deserialize;
use serde_json::json;
use std::{
    io::{self, Read},
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Instant,
};
use tower_http::services::ServeDir;
use uuid::Uuid;

#[derive(Parser)]
#[command(
    version,
    about = "Native local privacy gateway. No cloud inference or forwarding."
)]
struct Args {
    #[command(subcommand)]
    command: Command,
}
#[derive(Subcommand)]
enum Command {
    Serve {
        #[arg(long, default_value_t = 8766)]
        port: u16,
        #[arg(long)]
        assets: Option<PathBuf>,
    },
    Redact {
        #[arg(long, default_value = "mask")]
        action: String,
    },
    Benchmark,
}
#[derive(Clone)]
struct AppState {
    vault: Arc<Mutex<vault::Vault>>,
    key: Arc<String>,
    host: Arc<String>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RedactInput {
    text: String,
    #[serde(default = "default_action")]
    action: String,
}
fn default_action() -> String {
    "mask".into()
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RestoreInput {
    text: String,
    conversation_id: String,
}
type ApiError = (StatusCode, Json<serde_json::Value>);
fn error(status: StatusCode, message: &'static str) -> ApiError {
    (status, Json(json!({"error": message})))
}
fn authenticated(headers: &HeaderMap, key: &str) -> bool {
    let candidate = headers
        .get("x-native-session")
        .and_then(|s| s.to_str().ok())
        .unwrap_or("");
    candidate.len() == key.len()
        && candidate
            .bytes()
            .zip(key.bytes())
            .fold(0u8, |acc, (a, b)| acc | (a ^ b))
            == 0
}
async fn boundary(
    State(state): State<AppState>,
    request: axum::extract::Request,
    next: Next,
) -> Response {
    let host = request.headers().get("host").and_then(|h| h.to_str().ok());
    let invalid_origin = request.headers().get("origin").is_some_and(|origin| {
        origin.to_str().ok() != Some(format!("http://{}", state.host).as_str())
    });
    let mut response = if host != Some(state.host.as_str()) {
        error(StatusCode::BAD_REQUEST, "invalid local host").into_response()
    } else if invalid_origin {
        error(StatusCode::FORBIDDEN, "cross-origin request rejected").into_response()
    } else {
        next.run(request).await
    };
    response
        .headers_mut()
        .insert("cache-control", HeaderValue::from_static("no-store"));
    response.headers_mut().insert(
        "x-content-type-options",
        HeaderValue::from_static("nosniff"),
    );
    response.headers_mut().insert("content-security-policy", HeaderValue::from_static("default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; object-src 'none'"));
    response
}
async fn redact(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Result<Json<RedactInput>, JsonRejection>,
) -> Result<Json<serde_json::Value>, ApiError> {
    if !authenticated(&headers, &state.key) {
        return Err(error(StatusCode::FORBIDDEN, "invalid native session"));
    }
    let Json(input) = body.map_err(|_| error(StatusCode::BAD_REQUEST, "invalid JSON request"))?;
    if input.text.chars().count() > 20000 {
        return Err(error(StatusCode::PAYLOAD_TOO_LARGE, "text limit exceeded"));
    }
    let spans = engine::detect(&input.text);
    let id = Uuid::new_v4().simple().to_string();
    let text = state
        .vault
        .lock()
        .map_err(|_| error(StatusCode::SERVICE_UNAVAILABLE, "vault unavailable"))?
        .redact(&input.text, &spans, &input.action, &id)
        .map_err(|_| error(StatusCode::BAD_REQUEST, "redaction failed"))?;
    Ok(Json(
        json!({"redacted": text, "entities": engine::utf16_spans(&input.text, &spans), "conversation_id": id, "detector": "rust-regional-rules", "offset_encoding": "UTF-16"}),
    ))
}
async fn restore(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Result<Json<RestoreInput>, JsonRejection>,
) -> Result<Json<serde_json::Value>, ApiError> {
    if !authenticated(&headers, &state.key) {
        return Err(error(StatusCode::FORBIDDEN, "invalid native session"));
    }
    let Json(input) = body.map_err(|_| error(StatusCode::BAD_REQUEST, "invalid JSON request"))?;
    if input.text.len() > 100000 || input.conversation_id.len() != 32 {
        return Err(error(
            StatusCode::BAD_REQUEST,
            "invalid restoration request",
        ));
    }
    let text = state
        .vault
        .lock()
        .map_err(|_| error(StatusCode::SERVICE_UNAVAILABLE, "vault unavailable"))?
        .restore(&input.text, &input.conversation_id)
        .map_err(|_| {
            error(
                StatusCode::CONFLICT,
                "unknown, expired or unauthenticated token",
            )
        })?;
    Ok(Json(json!({"restored": text})))
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    match Args::parse().command {
        Command::Serve { port, assets } => {
            let assets = assets.unwrap_or(std::env::current_exe()?.parent().unwrap().join("web"));
            if !assets.join("index.html").is_file() {
                return Err("Browser build missing. Run browser build and supply --assets, or use the packaged bundle.".into());
            }
            let state = AppState {
                vault: Arc::new(Mutex::new(vault::Vault::new())),
                key: Arc::new(Uuid::new_v4().to_string()),
                host: Arc::new(format!("127.0.0.1:{port}")),
            };
            let key = state.key.clone();
            let app = Router::new()
                .route("/native/health", get(|| async { Json(json!({"status": "ok", "detector": "rust-regional-rules", "forwarding": false})) }))
                .route("/native/session", get(move || { let key = key.clone(); async move { Json(json!({"session": key.as_str()})) } }))
                .route("/native/redact", post(redact)).route("/native/restore", post(restore))
                .fallback_service(ServeDir::new(assets))
                .layer(DefaultBodyLimit::max(128 * 1024))
                .layer(middleware::from_fn_with_state(state.clone(), boundary)).with_state(state);
            let listener =
                tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, port)).await?;
            println!("SupportPrivacyGateway running locally at http://127.0.0.1:{port}");
            axum::serve(listener, app).await?;
        }
        Command::Redact { action } => {
            let mut text = String::new();
            io::stdin().take(128 * 1024 + 1).read_to_string(&mut text)?;
            if text.len() > 128 * 1024 {
                return Err("input limit exceeded".into());
            }
            let spans = engine::detect(&text);
            let id = Uuid::new_v4().simple().to_string();
            let redacted = vault::Vault::new()
                .redact(&text, &spans, &action, &id)
                .map_err(io::Error::other)?;
            println!(
                "{}",
                json!({"redacted": redacted, "entities": engine::utf16_spans(&text, &spans), "offset_encoding": "UTF-16", "restoration": "CLI mappings discarded at process exit"})
            );
        }
        Command::Benchmark => {
            let input = "Jina langu ni Amina Wanjiku. Mail amina@example.com. Simu +254 712 345 678. KRA PIN A123456789Z. Card 4111 1111 1111 1111.";
            engine::detect(input);
            let mut timings = Vec::new();
            for _ in 0..1000 {
                let start = Instant::now();
                std::hint::black_box(engine::detect(input));
                timings.push(start.elapsed().as_secs_f64() * 1000.0);
            }
            timings.sort_by(f64::total_cmp);
            println!(
                "{}",
                json!({"engine": "rust-regional-rules", "iterations": 1000, "p50_ms": timings[500], "p95_ms": timings[950], "fixture_chars": input.chars().count(), "note": "Detector-only microbenchmark, not model or document performance"})
            );
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn session_key_required() {
        let mut headers = HeaderMap::new();
        assert!(!authenticated(&headers, "key"));
        headers.insert("x-native-session", HeaderValue::from_static("bad"));
        assert!(!authenticated(&headers, "key"));
        headers.insert("x-native-session", HeaderValue::from_static("key"));
        assert!(authenticated(&headers, "key"));
    }
}
