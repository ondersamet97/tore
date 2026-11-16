use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
};
/// CSP source for the map export's stylesheet, so its preview renders styled.
pub fn export_style_hash() -> String {
    use base64::Engine;
    use sha2::{Digest, Sha256};
    let hash = Sha256::digest(crate::workspace::EXPORT_CSS.as_bytes());
    format!("'sha256-{}'", base64::engine::general_purpose::STANDARD.encode(hash))
}

pub fn asset(path: &str) -> Response {
    let found: Option<(&str, &[u8])> = match path {
        "konular" => Some((
            "text/html; charset=utf-8",
            include_bytes!("../../web/return.html"),
        )),
        "return.js" => Some((
            "text/javascript; charset=utf-8",
            include_bytes!("../../web/return.js"),
        )),
        "return.css" => Some((
            "text/css; charset=utf-8",
            include_bytes!("../../web/return.css"),
        )),
        "dusunurler" => Some((
            "text/html; charset=utf-8",
            include_bytes!("../../web/thinkers.html"),
        )),
        "thinkers.js" => Some((
            "text/javascript; charset=utf-8",
            include_bytes!("../../web/thinkers.js"),
        )),
        "harita" => Some((
            "text/html; charset=utf-8",
            include_bytes!("../../web/map.html"),
        )),
        "map.js" => Some((
            "text/javascript; charset=utf-8",
            include_bytes!("../../web/map.js"),
        )),
        "map.css" => Some((
            "text/css; charset=utf-8",
            include_bytes!("../../web/map.css"),
        )),
        "gorusler" => Some((
            "text/html; charset=utf-8",
            include_bytes!("../../web/opinions.html"),
        )),
        "opinions.js" => Some((
            "text/javascript; charset=utf-8",
            include_bytes!("../../web/opinions.js"),
        )),
        "ideology.js" => Some((
            "text/javascript; charset=utf-8",
            include_bytes!("../../web/ideology.js"),
        )),
        "opinions.css" => Some((
            "text/css; charset=utf-8",
            include_bytes!("../../web/opinions.css"),
        )),
        "workspace" | "calisma" => Some((
            "text/html; charset=utf-8",
            include_bytes!("../../web/workspace.html"),
        )),
        "workspace.js" => Some((
            "text/javascript; charset=utf-8",
            include_bytes!("../../web/workspace.js"),
        )),
        "workspace.css" => Some((
            "text/css; charset=utf-8",
            include_bytes!("../../web/workspace.css"),
        )),
        "private" => Some((
            "text/html; charset=utf-8",
            include_bytes!("../../local-reader/Hosted.html"),
        )),
        "" | "index.html" => Some((
            "text/html; charset=utf-8",
            include_bytes!("../../web/index.html"),
        )),
        "kaynaklar" => Some((
            "text/html; charset=utf-8",
            include_bytes!("../../web/sources.html"),
        )),
        "entegrasyonlar" => Some((
            "text/html; charset=utf-8",
            include_bytes!("../../web/integrations.html"),
        )),
        "integrations.js" => Some((
            "text/javascript; charset=utf-8",
            include_bytes!("../../web/integrations.js"),
        )),
        "integrations.css" => Some((
            "text/css; charset=utf-8",
            include_bytes!("../../web/integrations.css"),
        )),
        "sources.js" => Some((
            "text/javascript; charset=utf-8",
            include_bytes!("../../web/sources.js"),
        )),
        "sources.css" => Some((
            "text/css; charset=utf-8",
            include_bytes!("../../web/sources.css"),
        )),
        "source-guard.js" => Some((
            "text/javascript; charset=utf-8",
            include_bytes!("../../web/source-guard.js"),
        )),
        "private-client.js" => Some((
            "text/javascript; charset=utf-8",
            include_bytes!("../../web/private-client.js"),
        )),
        "yardimci" => Some((
            "text/html; charset=utf-8",
            include_bytes!("../../web/assistant.html"),
        )),
        "assistant.js" => Some((
            "text/javascript; charset=utf-8",
            include_bytes!("../../web/assistant.js"),
        )),
        "video" => Some((
            "text/html; charset=utf-8",
            include_bytes!("../../web/video.html"),
        )),
        "video.js" => Some((
            "text/javascript; charset=utf-8",
            include_bytes!("../../web/video.js"),
        )),
        "video.css" => Some((
            "text/css; charset=utf-8",
            include_bytes!("../../web/video.css"),
        )),
        "app.js" => Some((
            "text/javascript; charset=utf-8",
            include_bytes!("../../web/app.js"),
        )),
        "identity.js" => Some((
            "text/javascript; charset=utf-8",
            include_bytes!("../../web/identity.js"),
        )),
        "reader.js" => Some((
            "text/javascript; charset=utf-8",
            include_bytes!("../../web/reader.js"),
        )),
        "style.css" => Some((
            "text/css; charset=utf-8",
            include_bytes!("../../web/style.css"),
        )),
        "vendor/marked-18.2.0.js" | "vendor/marked.js" => Some((
            "text/javascript; charset=utf-8",
            include_bytes!("../../vendor/marked-18.2.0.js"),
        )),
        "vendor/dompurify-3.4.17.js" | "vendor/purify.js" => Some((
            "text/javascript; charset=utf-8",
            include_bytes!("../../vendor/dompurify-3.4.17.js"),
        )),
        _ => None,
    };
    match found {
        Some((ty, b)) => {
            let mut r = b.to_vec().into_response();
            let h = r.headers_mut();
            h.insert("content-type", ty.parse().unwrap());
            if path != "private" {
                // The map page previews its own script-free export in a sandboxed
                // srcdoc frame, which inherits this policy; allow exactly the
                // export's one stylesheet by hash and nothing else inline.
                let style = if path == "harita" {
                    format!("'self' {}", export_style_hash())
                } else {
                    "'self'".to_owned()
                };
                h.insert("content-security-policy",format!("default-src 'none'; script-src 'self'; style-src {style}; connect-src 'self'; img-src 'none'; font-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'").parse().unwrap());
            }
            h.insert("x-content-type-options", "nosniff".parse().unwrap());
            h.insert("referrer-policy", "no-referrer".parse().unwrap());
            h.insert("cache-control", "no-store".parse().unwrap());
            r
        }
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_map_page_allows_the_export_stylesheet_by_hash() {
        let csp = |p: &str| asset(p).headers()["content-security-policy"].to_str().unwrap().to_owned();
        let map = csp("harita");
        assert!(map.contains(&export_style_hash()) && !map.contains("unsafe-inline"));
        assert!(map.contains("script-src 'self';") && map.contains("frame-src 'none'"));
        assert!(!csp("konular").contains("sha256-"));
    }
}
