// RDP Transport Layer — TCP/TLS connection handling
// AGENT-A: Implement this module for TPKT + TCP + TLS

use crate::rdp::client::RdpError;
use tokio::net::TcpStream;
use tokio_native_tls::TlsStream;
use std::io::Cursor;
use native_tls;

/// TPKT (RFC 2126) frame structure
/// Version (1) | Reserved (1) | Length (2) | Payload (variable)
#[derive(Debug, Clone)]
pub struct TpktFrame {
    pub version: u8,
    pub length: u16,
    pub payload: Vec<u8>,
}

impl TpktFrame {
    /// Create a new TPKT frame with version 3 (standard)
    pub fn new(payload: &[u8]) -> Self {
        // Length = 4 byte header + payload
        let length = 4 + payload.len() as u16;
        Self {
            version: 0x03,
            length,
            payload: payload.to_vec(),
        }
    }

    /// Encode TPKT frame to bytes
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut result = Vec::with_capacity(self.length as usize);
        result.push(self.version);
        result.push(0x00); // Reserved
        result.extend_from_slice(&self.length.to_be_bytes());
        result.extend_from_slice(&self.payload);
        result
    }

    /// Decode TPKT frame from bytes
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, RdpError> {
        // Validate minimum length (4 bytes for header)
        if bytes.len() < 4 {
            return Err(RdpError::Connection(format!(
                "TPKT frame too short: {} bytes (minimum 4)",
                bytes.len()
            )));
        }

        // Check version is 3 (standard for RDP)
        let version = bytes[0];
        if version != 0x03 {
            return Err(RdpError::Connection(format!(
                "Invalid TPKT version: {} (expected 3)",
                version
            )));
        }

        // Parse length (big-endian u16 at offset 2)
        let length = u16::from_be_bytes([bytes[2], bytes[3]]) as usize;

        // Validate length is reasonable
        if length < 4 || length > 65535 {
            return Err(RdpError::Connection(format!(
                "Invalid TPKT length: {}",
                length
            )));
        }

        // Check we have enough data
        if bytes.len() < length {
            return Err(RdpError::Connection(format!(
                "Incomplete TPKT frame: {} of {} bytes",
                bytes.len(),
                length
            )));
        }

        // Extract payload (bytes 4..length)
        let payload = bytes[4..length].to_vec();

        Ok(Self {
            version,
            length: length as u16,
            payload,
        })
    }
}

/// RDP Transport handles TCP connection and TLS upgrade
pub struct RdpTransport {
    stream: Option<RdpStream>,
    read_buffer: Vec<u8>,
    hostname: String,
}

/// Enum to hold either plain TCP or TLS-wrapped stream
enum RdpStream {
    Plain(TcpStream),
    Tls(TlsStream<TcpStream>),
}

impl tokio::io::AsyncRead for RdpStream {
    fn poll_read(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
        buf: &mut tokio::io::ReadBuf<'_>,
    ) -> std::task::Poll<std::io::Result<()>> {
        match &mut *self {
            RdpStream::Plain(s) => std::pin::Pin::new(s).poll_read(cx, buf),
            RdpStream::Tls(s) => std::pin::Pin::new(s).poll_read(cx, buf),
        }
    }
}

impl tokio::io::AsyncWrite for RdpStream {
    fn poll_write(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
        buf: &[u8],
    ) -> std::task::Poll<std::io::Result<usize>> {
        match &mut *self {
            RdpStream::Plain(s) => std::pin::Pin::new(s).poll_write(cx, buf),
            RdpStream::Tls(s) => std::pin::Pin::new(s).poll_write(cx, buf),
        }
    }

    fn poll_flush(mut self: std::pin::Pin<&mut Self>, cx: &mut std::task::Context<'_>) -> std::task::Poll<std::io::Result<()>> {
        match &mut *self {
            RdpStream::Plain(s) => std::pin::Pin::new(s).poll_flush(cx),
            RdpStream::Tls(s) => std::pin::Pin::new(s).poll_flush(cx),
        }
    }

    fn poll_shutdown(mut self: std::pin::Pin<&mut Self>, cx: &mut std::task::Context<'_>) -> std::task::Poll<std::io::Result<()>> {
        match &mut *self {
            RdpStream::Plain(s) => std::pin::Pin::new(s).poll_shutdown(cx),
            RdpStream::Tls(s) => std::pin::Pin::new(s).poll_shutdown(cx),
        }
    }
}

impl RdpTransport {
    /// Connect to RDP server via TCP
    pub async fn connect(host: &str, port: u16) -> Result<Self, RdpError> {
        let addr = format!("{}:{}", host, port);
        let tcp_stream = TcpStream::connect(&addr)
            .await
            .map_err(|e| RdpError::Connection(format!("TCP connect failed: {}", e)))?;

        Ok(Self {
            stream: Some(RdpStream::Plain(tcp_stream)),
            read_buffer: Vec::with_capacity(65535),
            hostname: host.to_string(),
        })
    }

    /// Upgrade TCP connection to TLS (required after X.224 SSL/NLA negotiation)
    pub async fn upgrade_tls(&mut self) -> Result<(), RdpError> {
        let tcp_stream = match self.stream.take() {
            Some(RdpStream::Plain(s)) => s,
            Some(other) => {
                self.stream = Some(other);
                return Ok(()); // already TLS
            }
            None => return Err(RdpError::Connection("Not connected".to_string())),
        };

        let connector = native_tls::TlsConnector::builder()
            .danger_accept_invalid_certs(true)
            .danger_accept_invalid_hostnames(true)
            .build()
            .map_err(|e| RdpError::Connection(format!("TLS connector build failed: {}", e)))?;

        let async_connector = tokio_native_tls::TlsConnector::from(connector);
        let tls_stream = async_connector
            .connect(&self.hostname, tcp_stream)
            .await
            .map_err(|e| RdpError::Connection(format!("TLS handshake failed: {}", e)))?;

        self.stream = Some(RdpStream::Tls(tls_stream));
        Ok(())
    }

    /// Send data wrapped in TPKT frame
    pub async fn send_tpkt(&mut self, data: &[u8]) -> Result<(), RdpError> {
        let frame = TpktFrame::new(data);
        let bytes = frame.to_bytes();

        let stream = self
            .stream
            .as_mut()
            .ok_or_else(|| RdpError::Connection("Not connected".to_string()))?;

        // Write all bytes
        tokio::io::AsyncWriteExt::write_all(stream, &bytes)
            .await
            .map_err(|e| RdpError::Connection(format!("Write failed: {}", e)))?;

        // Flush to ensure data is sent
        tokio::io::AsyncWriteExt::flush(stream)
            .await
            .map_err(|e| RdpError::Connection(format!("Flush failed: {}", e)))?;

        Ok(())
    }

    /// Receive TPKT frame (blocking read)
    pub async fn recv_tpkt(&mut self) -> Result<TpktFrame, RdpError> {
        let stream = self
            .stream
            .as_mut()
            .ok_or_else(|| RdpError::Connection("Not connected".to_string()))?;

        // Read until we have at least 4 bytes for header
        while self.read_buffer.len() < 4 {
            let mut temp_buf = [0u8; 1024];
            let n = tokio::io::AsyncReadExt::read(stream, &mut temp_buf)
                .await
                .map_err(|e| RdpError::Connection(format!("Read failed: {}", e)))?;

            if n == 0 {
                return Err(RdpError::Connection("Connection closed".to_string()));
            }

            self.read_buffer.extend_from_slice(&temp_buf[..n]);
        }

        // Parse length from header
        let len = u16::from_be_bytes([self.read_buffer[2], self.read_buffer[3]]) as usize;

        // Read remaining bytes for full frame
        while self.read_buffer.len() < len {
            let mut temp_buf = [0u8; 1024];
            let n = tokio::io::AsyncReadExt::read(stream, &mut temp_buf)
                .await
                .map_err(|e| RdpError::Connection(format!("Read failed: {}", e)))?;

            if n == 0 {
                return Err(RdpError::Connection("Connection closed".to_string()));
            }

            self.read_buffer.extend_from_slice(&temp_buf[..n]);
        }

        // Parse the frame
        let frame = TpktFrame::from_bytes(&self.read_buffer[..len])?;

        // Remove consumed bytes from buffer
        self.read_buffer.drain(0..len);

        Ok(frame)
    }

    /// Close the connection
    pub async fn close(&mut self) -> Result<(), RdpError> {
        if let Some(mut stream) = self.stream.take() {
            // Shutdown the stream
            let _ = tokio::io::AsyncWriteExt::shutdown(&mut stream).await;
        }
        self.read_buffer.clear();
        Ok(())
    }
}

/// Mock transport for testing without real network
#[cfg(test)]
pub struct MockTransport {
    read_buffer: Vec<u8>,
    write_buffer: Vec<u8>,
}

#[cfg(test)]
impl MockTransport {
    pub fn new() -> Self {
        Self {
            read_buffer: Vec::new(),
            write_buffer: Vec::new(),
        }
    }

    pub fn push_read(&mut self, data: Vec<u8>) {
        self.read_buffer.extend(data);
    }

    pub async fn send_tpkt(&mut self, data: &[u8]) -> Result<(), RdpError> {
        let len = 4 + data.len() as u16;
        self.write_buffer.push(0x03);
        self.write_buffer.push(0x00);
        self.write_buffer.extend(&len.to_be_bytes());
        self.write_buffer.extend(data);
        Ok(())
    }

    pub async fn recv_tpkt(&mut self) -> Result<TpktFrame, RdpError> {
        if self.read_buffer.len() < 4 {
            return Err(RdpError::Connection("No data".to_string()));
        }
        
        let version = self.read_buffer[0];
        let len = u16::from_be_bytes([self.read_buffer[2], self.read_buffer[3]]) as usize;
        
        if self.read_buffer.len() < len {
            return Err(RdpError::Connection("Incomplete frame".to_string()));
        }
        
        let payload = self.read_buffer[4..len].to_vec();
        self.read_buffer.drain(0..len);
        
        Ok(TpktFrame { version, length: len as u16, payload })
    }
}

// Test module
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tpkt_frame_encoding() {
        let data = vec![0x01, 0x02, 0x03, 0x04];
        let tpkt = TpktFrame::new(&data);
        let encoded = tpkt.to_bytes();

        assert_eq!(encoded[0], 0x03); // version
        assert_eq!(encoded[1], 0x00); // reserved
        assert_eq!(&encoded[4..], &data); // payload
        assert_eq!(encoded.len(), 4 + data.len());
    }

    #[test]
    fn test_tpkt_frame_decoding() {
        let raw = vec![0x03, 0x00, 0x00, 0x08, 0x01, 0x02, 0x03, 0x04];
        let tpkt = TpktFrame::from_bytes(&raw).unwrap();

        assert_eq!(tpkt.version, 0x03);
        assert_eq!(tpkt.length, 8);
        assert_eq!(tpkt.payload, vec![0x01, 0x02, 0x03, 0x04]);
    }

    #[test]
    fn test_tpkt_invalid_version() {
        let raw = vec![0x02, 0x00, 0x00, 0x04]; // version 2 is invalid
        assert!(TpktFrame::from_bytes(&raw).is_err());
    }
}
