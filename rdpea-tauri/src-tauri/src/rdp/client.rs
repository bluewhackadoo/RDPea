// RDP Client — orchestrates the full connection lifecycle
use crate::rdp::types::*;
use std::sync::{Arc, Mutex};
use thiserror::Error;

#[derive(Error, Debug)]
pub enum RdpError {
    #[error("Connection error: {0}")]
    Connection(String),
    #[error("Protocol error: {0}")]
    Protocol(String),
    #[error("Authentication error: {0}")]
    Auth(String),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

// Events emitted by the RDP client to the frontend
#[derive(Debug, Clone)]
pub enum RdpEvent {
    Connected { width: u32, height: u32 },
    Bitmap { rects: Vec<BitmapRectIpc> },
    Audio { data: Vec<u8>, channels: u16, sample_rate: u32, bits_per_sample: u16 },
    Clipboard { text: String },
    Disconnected,
    Error { message: String },
    Log { message: String },
}

type EventHandler = Arc<dyn Fn(RdpEvent) + Send + Sync>;

pub struct RdpClient {
    config: RdpClientConfig,
    connected: Arc<Mutex<bool>>,
    event_handler: Option<EventHandler>,
}

impl RdpClient {
    pub fn new(config: RdpClientConfig) -> Self {
        Self {
            config,
            connected: Arc::new(Mutex::new(false)),
            event_handler: None,
        }
    }

    pub fn set_event_handler<F>(&mut self, handler: F)
    where
        F: Fn(RdpEvent) + Send + Sync + 'static,
    {
        self.event_handler = Some(Arc::new(handler));
    }

    pub async fn connect(&mut self) -> Result<(), RdpError> {
        // TODO: Implement full RDP connection lifecycle
        // For now, just emit a stub connected event
        self.emit_event(RdpEvent::Log {
            message: format!("Connecting to {}:{}...", self.config.host, self.config.port),
        });

        // Simulate connection
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

        *self.connected.lock().unwrap() = true;

        self.emit_event(RdpEvent::Connected {
            width: self.config.width,
            height: self.config.height,
        });

        self.emit_event(RdpEvent::Log {
            message: "Connected (stub implementation)".to_string(),
        });

        Ok(())
    }

    pub fn disconnect(&mut self) {
        *self.connected.lock().unwrap() = false;
        self.emit_event(RdpEvent::Disconnected);
    }

    pub fn is_connected(&self) -> bool {
        *self.connected.lock().unwrap()
    }

    pub fn send_keyboard(&self, event_type: &str, scan_code: u16, extended: bool) {
        self.emit_event(RdpEvent::Log {
            message: format!("Keyboard: {} scancode={} ext={}", event_type, scan_code, extended),
        });
    }

    pub fn send_mouse(&self, event_type: &str, x: u16, y: u16, button: Option<&str>, wheel_delta: Option<i16>) {
        self.emit_event(RdpEvent::Log {
            message: format!(
                "Mouse: {} x={} y={} btn={:?} wheel={:?}",
                event_type, x, y, button, wheel_delta
            ),
        });
    }

    fn emit_event(&self, event: RdpEvent) {
        if let Some(handler) = &self.event_handler {
            handler(event);
        }
    }
}
