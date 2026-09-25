//! Connectivity probe using the same streaming request and limits as generation.
//! Only a short synthetic prompt is sent; provider bodies and credentials stay private.
use super::{config::ConfigInput, credentials::Secret, stream, tasks::Cancellation};
use crate::storage::Result;
use std::sync::Arc;

pub struct Snapshot {
    pub config: ConfigInput,
    pub key: Secret,
}

pub async fn test(snapshot: Snapshot) -> Result<()> {
    stream::run(
        stream::StreamInput {
            config: snapshot.config,
            key: snapshot.key,
            context: "Reply with OK only.".into(),
            control: Arc::new(Cancellation::new()),
        },
        |_| {},
    )
    .await
    .map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::config::Protocol;
    use std::{
        io::{Read, Write},
        net::TcpListener,
        thread,
    };

    #[test]
    fn connection_probe_checks_configured_streaming_limits() {
        for (status, body, expected) in [
            ("400 Bad Request", "{}", Some("VALIDATION_ERROR")),
            ("200 OK", "event: response.output_text.delta\ndata: {\"delta\":\"OK\"}\n\nevent: response.completed\ndata: {\"response\":{}}\n\n", None),
            ("200 OK", "event: response.output_text.delta\ndata: {\"delta\":\"partial\"}\n\n", Some("PROTOCOL_ERROR")),
        ] {
            let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
            let address = listener.local_addr().unwrap();
            let server = thread::spawn(move || {
                let (mut socket, _) = listener.accept().unwrap();
                socket.set_read_timeout(Some(std::time::Duration::from_secs(5))).unwrap();
                let mut request = Vec::new();
                let mut buffer = [0; 4096];
                loop {
                    let count = socket.read(&mut buffer).unwrap();
                    assert!(count > 0);
                    request.extend_from_slice(&buffer[..count]);
                    if let Some(end) = request.windows(4).position(|w| w == b"\r\n\r\n") {
                        let headers = String::from_utf8_lossy(&request[..end]).to_lowercase();
                        let length: usize = headers.lines().find_map(|line| line.strip_prefix("content-length:")).unwrap().trim().parse().unwrap();
                        if request.len() >= end + 4 + length {
                            let body: serde_json::Value = serde_json::from_slice(&request[end+4..end+4+length]).unwrap();
                            assert_eq!(body["max_output_tokens"], 600000);
                            assert_eq!(body["stream"], true);
                            assert_eq!(body["input"], "Reply with OK only.");
                            break;
                        }
                    }
                }
                write!(socket, "HTTP/1.1 {status}\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
            });
            let result = tauri::async_runtime::block_on(test(Snapshot {
                config: ConfigInput { name: "Synthetic".into(), protocol: Protocol::OpenaiResponses, base_url: format!("http://{address}"), model_id: "synthetic-model".into(), timeout_ms: 5000, max_output_tokens: 600000 },
                key: Secret::new("synthetic-key".into()),
            }));
            server.join().unwrap();
            assert_eq!(result.err().map(|error| error.code), expected.map(str::to_owned));
        }
    }
}
