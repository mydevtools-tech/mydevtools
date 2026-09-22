//! Local mirror of `/api/v1/dashboard/analytics`.
//!
//! The dashboard needs one number per tool, not the rows themselves. Counting
//! them here is a single grouped query over `entries`; the alternative — the UI
//! listing every note, bookmark and API-client history entry just to read
//! `.length` — moves megabytes across the bridge to produce a dozen integers.

use std::collections::HashMap;

use rusqlite::params;
use serde_json::{json, Value};

use crate::error::Result;
use crate::router::entries::{active_workspace, list_docs};
use crate::router::secure_files;
use crate::router::ApiResponse;
use crate::state::AppState;

pub fn handle(state: &AppState, method: &str, rest: &str) -> Result<ApiResponse> {
    if method != "GET" || !rest.is_empty() {
        return Ok(ApiResponse::detail(404, "Not found"));
    }

    // Secure Files lives on disk, not in `entries`, and takes the db lock of its
    // own to read its config — so it runs before this handler takes that lock.
    let files = secure_files::storage_stats(state);

    let db = state.db.lock().unwrap();
    let ws = active_workspace(&db);

    let mut counts: HashMap<String, i64> = HashMap::new();
    {
        let mut stmt = db.prepare(
            "SELECT tool_kind, COUNT(*) FROM entries
             WHERE workspace_id = ?1 AND deleted_at IS NULL
             GROUP BY tool_kind",
        )?;
        let rows = stmt.query_map(params![ws], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
        })?;
        for row in rows {
            let (kind, n) = row?;
            counts.insert(kind, n);
        }
    }
    let count = |kind: &str| counts.get(kind).copied().unwrap_or(0);

    // Tasks: the grouped count above includes archived rows. The dashboard
    // shows the same active-only breakdown as `/tasks/stats`.
    let tasks = list_docs(&db, "tasks", &ws)?;
    let active: Vec<&Value> = tasks
        .iter()
        .filter(|d| !d["archived"].as_bool().unwrap_or(false))
        .collect();
    let by_status =
        |s: &str| active.iter().filter(|d| d["status"].as_str() == Some(s)).count();

    ApiResponse::ok(&json!({
        "passwordEntries": count("password_entries"),
        "bookmarks": count("bookmarks"),
        "bookmarkFolders": count("bookmark_folders"),
        "tasks": {
            "total": active.len(),
            "completed": by_status("completed"),
            "ongoing": by_status("ongoing"),
            "notStarted": by_status("not-started"),
        },
        "projects": count("projects"),
        "notes": count("notes"),
        // "NoSQL connections" predates the unified data explorer; rows written
        // by either generation of the tool belong to the same chip.
        "nosqlConnections": count("data_explorer_connections") + count("nosql_connections"),
        "apiClientCollections": count("api_client_collections"),
        "apiClientEnvironments": count("api_client_environments"),
        "apiClientHistoryEntries": count("api_client_history"),
        "jsonFormatterDocuments": count("json_formatter_documents"),
        "codeSnippets": count("code_snippets"),
        "files": files,
    }))
}
