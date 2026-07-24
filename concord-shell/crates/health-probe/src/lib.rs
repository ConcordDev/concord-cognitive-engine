//! Minimal, dependency-free process health probing over raw TCP/HTTP.
//!
//! Deliberately does NOT pull in `reqwest`/`hyper`/`ureq` -- the shell only
//! ever needs two questions answered: "is something listening on this
//! port" and "did `GET /` come back with a non-5xx status", and a full
//! HTTP client is unnecessary weight for a desktop-shell health check.
//!
//! This crate has no dependency on `tauri` or any GUI/webview library and
//! compiles + tests standalone with plain `std`. That matters concretely in
//! this repo: it is one of the few pieces of the `concord-shell` glue layer
//! that could be genuinely compiled AND tested in the sandboxed container
//! this was authored in (see `../../README.md` for the full honesty
//! ledger) -- verified against real, test-local `TcpListener`s, not mocked.

use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;

/// Attempts a TCP connect with a bounded timeout. `true` means *something*
/// is listening on that address. Says nothing about HTTP-level health --
/// use [`http_get_status`] for that.
pub fn tcp_port_open(addr: &str, timeout: Duration) -> bool {
    let Ok(mut addrs) = addr.to_socket_addrs() else {
        return false;
    };
    let Some(sock_addr) = addrs.next() else {
        return false;
    };
    TcpStream::connect_timeout(&sock_addr, timeout).is_ok()
}

/// Issues a minimal raw HTTP/1.1 GET and returns the parsed status code, or
/// `None` on any connection/timeout/parse failure. Never panics, never
/// fabricates a status code when the real request failed.
pub fn http_get_status(host: &str, port: u16, path: &str, timeout: Duration) -> Option<u16> {
    let addr_str = format!("{host}:{port}");
    let sock_addr = addr_str.to_socket_addrs().ok()?.next()?;
    let mut stream = TcpStream::connect_timeout(&sock_addr, timeout).ok()?;
    stream.set_read_timeout(Some(timeout)).ok()?;
    stream.set_write_timeout(Some(timeout)).ok()?;

    let request = format!(
        "GET {path} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\nUser-Agent: concord-shell-health-probe/0.1\r\n\r\n"
    );
    stream.write_all(request.as_bytes()).ok()?;

    let mut buf = [0u8; 512];
    let n = stream.read(&mut buf).ok()?;
    if n == 0 {
        return None;
    }
    let text = String::from_utf8_lossy(&buf[..n]);
    parse_status_line(&text)
}

/// Pure parse helper, split out so it's testable without any socket at all.
fn parse_status_line(response_head: &str) -> Option<u16> {
    // e.g. "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n"
    let first_line = response_head.lines().next()?;
    let mut parts = first_line.split_whitespace();
    let _http_version = parts.next()?;
    let code_str = parts.next()?;
    code_str.parse::<u16>().ok()
}

/// A status counts as "healthy" for the shell's purposes if it's anything
/// short of a server error -- a frontend answering with a 404 or a
/// redirect is still alive and serving; only "nothing answered" (`None`
/// from [`http_get_status`]) or a 5xx count as unhealthy.
pub fn is_healthy_status(status: u16) -> bool {
    status < 500
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;
    use std::thread;

    #[test]
    fn parse_status_line_handles_real_response_heads() {
        assert_eq!(
            parse_status_line("HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n"),
            Some(200)
        );
        assert_eq!(parse_status_line("HTTP/1.1 404 Not Found\r\n\r\n"), Some(404));
        assert_eq!(
            parse_status_line("HTTP/1.1 503 Service Unavailable\r\n\r\n"),
            Some(503)
        );
        assert_eq!(parse_status_line("HTTP/1.0 302 Found\r\n\r\n"), Some(302));
    }

    #[test]
    fn parse_status_line_returns_none_on_garbage() {
        assert_eq!(parse_status_line(""), None);
        assert_eq!(parse_status_line("not even http"), None);
        assert_eq!(parse_status_line("HTTP/1.1 not-a-number OK\r\n\r\n"), None);
    }

    #[test]
    fn is_healthy_status_excludes_server_errors_only() {
        assert!(is_healthy_status(200));
        assert!(is_healthy_status(302));
        assert!(is_healthy_status(404)); // alive, just a bad route -- still "serving"
        assert!(!is_healthy_status(500));
        assert!(!is_healthy_status(503));
    }

    #[test]
    fn tcp_port_open_true_against_a_real_local_listener() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let addr = listener.local_addr().expect("addr");
        let handle = thread::spawn(move || {
            let _ = listener.accept();
        });
        assert!(tcp_port_open(&addr.to_string(), Duration::from_millis(500)));
        handle.join().ok();
    }

    #[test]
    fn tcp_port_open_false_against_a_closed_port() {
        // Bind to claim a real free port, then drop the listener so nothing
        // is listening there anymore -- a genuine "connection refused" case,
        // not a guessed/likely-free port number.
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let addr = listener.local_addr().expect("addr");
        drop(listener);
        assert!(!tcp_port_open(&addr.to_string(), Duration::from_millis(200)));
    }

    #[test]
    fn http_get_status_against_a_real_minimal_server() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let addr = listener.local_addr().expect("addr");
        let handle = thread::spawn(move || {
            if let Ok((mut socket, _)) = listener.accept() {
                let mut buf = [0u8; 1024];
                let _ = socket.read(&mut buf);
                let _ = socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok");
            }
        });
        let status = http_get_status(&addr.ip().to_string(), addr.port(), "/", Duration::from_secs(2));
        assert_eq!(status, Some(200));
        handle.join().ok();
    }

    #[test]
    fn http_get_status_reports_server_error_honestly() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let addr = listener.local_addr().expect("addr");
        let handle = thread::spawn(move || {
            if let Ok((mut socket, _)) = listener.accept() {
                let mut buf = [0u8; 1024];
                let _ = socket.read(&mut buf);
                let _ = socket.write_all(b"HTTP/1.1 503 Service Unavailable\r\n\r\n");
            }
        });
        let status = http_get_status(&addr.ip().to_string(), addr.port(), "/", Duration::from_secs(2));
        assert_eq!(status, Some(503));
        assert!(!is_healthy_status(status.unwrap()));
        handle.join().ok();
    }

    #[test]
    fn http_get_status_none_when_nothing_listening() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let addr = listener.local_addr().expect("addr");
        drop(listener);
        let status = http_get_status(&addr.ip().to_string(), addr.port(), "/", Duration::from_millis(200));
        assert_eq!(status, None);
    }
}
