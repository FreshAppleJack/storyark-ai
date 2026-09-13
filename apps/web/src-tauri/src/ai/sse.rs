use crate::storage::{Result, StorageError};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Event {
    pub name: Option<String>,
    pub data: String,
}

pub struct Parser {
    buffer: Vec<u8>,
    event: Option<String>,
    data: Vec<String>,
    bytes_seen: usize,
}

impl Parser {
    pub fn new() -> Self {
        Self {
            buffer: Vec::new(),
            event: None,
            data: Vec::new(),
            bytes_seen: 0,
        }
    }

    pub fn push(&mut self, bytes: &[u8]) -> Result<Vec<Event>> {
        self.bytes_seen = self.bytes_seen.saturating_add(bytes.len());
        if self.bytes_seen > 8 * 1024 * 1024 {
            return Err(error("Response exceeded the maximum streaming size"));
        }
        self.buffer.extend_from_slice(bytes);
        let mut events = Vec::new();
        while let Some(index) = self.buffer.iter().position(|byte| *byte == b'\n') {
            let line = self.buffer.drain(..=index).collect::<Vec<_>>();
            let line = &line[..line.len() - 1];
            let line = line.strip_suffix(&[b'\r']).unwrap_or(line);
            self.line(line, &mut events)?;
        }
        Ok(events)
    }

    pub fn finish(&mut self) -> Result<Vec<Event>> {
        if !self.buffer.is_empty() {
            let line = std::mem::take(&mut self.buffer);
            self.line(&line, &mut Vec::new())?;
        }
        let mut events = Vec::new();
        self.dispatch(&mut events)?;
        Ok(events)
    }

    fn line(&mut self, raw: &[u8], events: &mut Vec<Event>) -> Result<()> {
        if raw.is_empty() {
            self.dispatch(events)?;
            return Ok(());
        }
        if raw[0] == b':' {
            return Ok(());
        }
        let text = std::str::from_utf8(raw).map_err(|_| error("SSE contained invalid UTF-8"))?;
        let (field, value) = text
            .split_once(':')
            .map_or((text, ""), |(f, v)| (f, v.strip_prefix(' ').unwrap_or(v)));
        match field {
            "event" => self.event = Some(value.to_owned()),
            "data" => {
                if self.data.iter().map(String::len).sum::<usize>() + value.len() > 2 * 1024 * 1024
                {
                    return Err(error("SSE event exceeded the maximum size"));
                }
                self.data.push(value.to_owned());
            }
            // id/retry are intentionally ignored: requests cannot be replayed safely.
            _ => {}
        }
        Ok(())
    }

    fn dispatch(&mut self, events: &mut Vec<Event>) -> Result<()> {
        if self.event.is_none() && self.data.is_empty() {
            return Ok(());
        }
        events.push(Event {
            name: self.event.take(),
            data: self.data.drain(..).collect::<Vec<_>>().join("\n"),
        });
        Ok(())
    }
}

fn error(message: &str) -> StorageError {
    StorageError::new("PROTOCOL_ERROR", message)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn handles_split_utf8_multiline_events_and_heartbeats() {
        let mut parser = Parser::new();
        let input = "event: delta\ndata: 你好\ndata: 世界\n\n: ping\n\ndata: [DONE]\n\n";
        let bytes = input.as_bytes();
        let mut events = Vec::new();
        for chunk in bytes.chunks(3) {
            events.extend(parser.push(chunk).unwrap());
        }
        events.extend(parser.finish().unwrap());
        assert_eq!(
            events,
            vec![
                Event {
                    name: Some("delta".into()),
                    data: "你好\n世界".into()
                },
                Event {
                    name: None,
                    data: "[DONE]".into()
                },
            ]
        );
    }

    #[test]
    fn rejects_invalid_utf8_in_a_complete_line() {
        let mut parser = Parser::new();
        assert!(parser.push(b"data: \xff\n\n").is_err());
    }
}
