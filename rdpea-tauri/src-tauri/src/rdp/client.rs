// RDP Client — orchestrates the full connection lifecycle
use crate::rdp::types::*;
use crate::rdp::connection::RdpConnection;
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

type EventHandler = Arc<dyn Fn(RdpEvent) + Send + Sync + 'static>;

pub struct RdpClient {
    config: RdpClientConfig,
    connected: Arc<Mutex<bool>>,
    event_handler: Option<EventHandler>,
    stop_flag: Arc<Mutex<bool>>,
}

impl RdpClient {
    pub fn new(config: RdpClientConfig) -> Self {
        Self {
            config,
            connected: Arc::new(Mutex::new(false)),
            event_handler: None,
            stop_flag: Arc::new(Mutex::new(false)),
        }
    }

    pub fn set_event_handler<F>(&mut self, handler: F)
    where
        F: Fn(RdpEvent) + Send + Sync + 'static,
    {
        self.event_handler = Some(Arc::new(handler));
    }

    pub async fn connect(&mut self) -> Result<(), RdpError> {
        *self.stop_flag.lock().unwrap() = false;

        let config = self.config.clone();
        let handler = self.event_handler.clone();
        let connected_flag = self.connected.clone();
        let stop_flag = self.stop_flag.clone();

        let emit = move |ev: RdpEvent| {
            if let Some(ref h) = handler {
                h(ev);
            }
        };

        emit(RdpEvent::Log {
            message: format!("Connecting to {}:{}...", config.host, config.port),
        });

        // Build the log closure for the connection driver
        let emit2 = {
            let handler2 = self.event_handler.clone();
            move |msg: String| {
                if let Some(ref h) = handler2 {
                    h(RdpEvent::Log { message: msg });
                }
            }
        };

        // Run the real RDP handshake
        let mut conn = match RdpConnection::establish(&config, &mut { emit2 }).await {
            Ok(c) => c,
            Err(e) => {
                let msg = format!("Connection failed: {}", e);
                emit(RdpEvent::Error { message: msg });
                return Err(e);
            }
        };

        *connected_flag.lock().unwrap() = true;
        emit(RdpEvent::Connected {
            width: config.width,
            height: config.height,
        });

        // Spawn the receive loop
        let handler3 = self.event_handler.clone();
        tokio::spawn(async move {
            loop {
                if *stop_flag.lock().unwrap() {
                    break;
                }
                match conn.recv_pdu().await {
                    Ok((channel_id, data)) => {
                        if let Some(ev) = process_incoming(channel_id, &data, conn.io_channel_id) {
                            if let Some(ref h) = handler3 {
                                h(ev);
                            }
                        }
                    }
                    Err(e) => {
                        if let Some(ref h) = handler3 {
                            h(RdpEvent::Error { message: format!("Receive error: {}", e) });
                            h(RdpEvent::Disconnected);
                        }
                        *connected_flag.lock().unwrap() = false;
                        break;
                    }
                }
            }
        });

        Ok(())
    }

    pub fn disconnect(&mut self) {
        *self.stop_flag.lock().unwrap() = true;
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

/// Decode an incoming PDU from the active session and produce an RdpEvent if relevant.
fn process_incoming(channel_id: u16, data: &[u8], io_channel: u16) -> Option<RdpEvent> {
    if channel_id != io_channel {
        return None;
    }
    if data.len() < 6 {
        return None;
    }

    // Check for bitmap update (Share Data, PDUType2=UPDATE)
    let pdu_type = u16::from_le_bytes([data[2], data[3]]) & 0x0F;
    if pdu_type == PDU_TYPE_DATA && data.len() > 20 {
        let pdu_type2 = data[18];
        if pdu_type2 == PDU_TYPE2_UPDATE {
            let rects = decode_bitmap_update(&data[20..]);
            if !rects.is_empty() {
                return Some(RdpEvent::Bitmap { rects });
            }
        }
    }

    None
}

/// Minimal bitmap update decoder (uncompressed rectangles)
fn decode_bitmap_update(data: &[u8]) -> Vec<BitmapRectIpc> {
    let mut rects = Vec::new();
    if data.len() < 4 { return rects; }

    let update_type = u16::from_le_bytes([data[0], data[1]]);
    if update_type != UPDATE_TYPE_BITMAP { return rects; }

    let num_rects = u16::from_le_bytes([data[2], data[3]]) as usize;
    let mut pos = 4;

    for _ in 0..num_rects {
        if pos + 18 > data.len() { break; }
        let dest_left   = u16::from_le_bytes([data[pos],   data[pos+1]]);
        let dest_top    = u16::from_le_bytes([data[pos+2], data[pos+3]]);
        let dest_right  = u16::from_le_bytes([data[pos+4], data[pos+5]]);
        let dest_bottom = u16::from_le_bytes([data[pos+6], data[pos+7]]);
        let width       = u16::from_le_bytes([data[pos+8], data[pos+9]]);
        let height      = u16::from_le_bytes([data[pos+10],data[pos+11]]);
        let bits_per_px = u16::from_le_bytes([data[pos+12],data[pos+13]]);
        let flags       = u16::from_le_bytes([data[pos+14],data[pos+15]]);
        let bmp_len     = u16::from_le_bytes([data[pos+16],data[pos+17]]) as usize;
        pos += 18;

        if pos + bmp_len > data.len() { break; }
        let bmp_data = data[pos..pos + bmp_len].to_vec();
        pos += bmp_len;

        let rect_w = (dest_right - dest_left) as usize;
        let rect_h = (dest_bottom - dest_top) as usize;

        // Convert to RGBA (very simplified — treats data as-is for now)
        let rgba = if flags & 0x0400 != 0 {
            // Compressed — emit raw for now, frontend can handle
            bmp_data
        } else {
            bmp_to_rgba(&bmp_data, width as usize, height as usize, bits_per_px)
        };

        rects.push(BitmapRectIpc {
            x: dest_left,
            y: dest_top,
            width: rect_w as u16,
            height: rect_h as u16,
            data: rgba,
        });
    }

    rects
}

fn bmp_to_rgba(data: &[u8], width: usize, height: usize, bpp: u16) -> Vec<u8> {
    let mut rgba = Vec::with_capacity(width * height * 4);
    let bytes_per_pixel = (bpp / 8) as usize;
    // RDP bitmaps are bottom-up
    for row in (0..height).rev() {
        let row_start = row * width * bytes_per_pixel;
        let row_end = row_start + width * bytes_per_pixel;
        if row_end > data.len() { break; }
        for chunk in data[row_start..row_end].chunks(bytes_per_pixel) {
            let (r, g, b) = match bpp {
                32 => (chunk.get(2).copied().unwrap_or(0),
                       chunk.get(1).copied().unwrap_or(0),
                       chunk.get(0).copied().unwrap_or(0)),
                24 => (chunk.get(2).copied().unwrap_or(0),
                       chunk.get(1).copied().unwrap_or(0),
                       chunk.get(0).copied().unwrap_or(0)),
                16 => {
                    let px = u16::from_le_bytes([chunk[0], chunk.get(1).copied().unwrap_or(0)]);
                    ((px >> 11 & 0x1F) as u8 * 8,
                     (px >> 5 & 0x3F) as u8 * 4,
                     (px & 0x1F) as u8 * 8)
                }
                _ => (0, 0, 0),
            };
            rgba.extend_from_slice(&[r, g, b, 255]);
        }
    }
    rgba
}
