// RDP Client — orchestrates the full connection lifecycle
use crate::rdp::types::*;
use crate::rdp::connection::RdpConnection;
use std::sync::{Arc, Mutex};
use tokio::sync::mpsc;
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
    /// Channel to send input PDUs into the active session loop
    input_tx: Option<mpsc::UnboundedSender<Vec<u8>>>,
}

impl RdpClient {
    pub fn new(config: RdpClientConfig) -> Self {
        Self {
            config,
            connected: Arc::new(Mutex::new(false)),
            event_handler: None,
            stop_flag: Arc::new(Mutex::new(false)),
            input_tx: None,
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

        // Input channel so send_keyboard/send_mouse can inject PDUs
        let (input_tx, mut input_rx) = mpsc::unbounded_channel::<Vec<u8>>();
        self.input_tx = Some(input_tx);

        // Spawn the session loop
        let handler3 = self.event_handler.clone();
        tokio::spawn(async move {
            loop {
                if *stop_flag.lock().unwrap() { break; }

                // Drain any pending input PDUs first (non-blocking)
                while let Ok(pdu) = input_rx.try_recv() {
                    if let Err(e) = conn.send_io(&pdu).await {
                        if let Some(ref h) = handler3 {
                            h(RdpEvent::Log { message: format!("Input send error: {}", e) });
                        }
                    }
                }

                // Then receive one server PDU (with a short timeout to keep input responsive)
                match tokio::time::timeout(
                    tokio::time::Duration::from_millis(50),
                    conn.recv_pdu()
                ).await {
                    Ok(Ok((channel_id, data))) => {
                        if let Some(ev) = process_incoming(channel_id, &data, conn.io_channel_id) {
                            if let Some(ref h) = handler3 { h(ev); }
                        }
                    }
                    Ok(Err(e)) => {
                        if let Some(ref h) = handler3 {
                            h(RdpEvent::Error { message: format!("Receive error: {}", e) });
                            h(RdpEvent::Disconnected);
                        }
                        *connected_flag.lock().unwrap() = false;
                        break;
                    }
                    Err(_) => {} // timeout — loop again to process input
                }
            }
        });

        Ok(())
    }

    pub fn disconnect(&mut self) {
        *self.stop_flag.lock().unwrap() = true;
        *self.connected.lock().unwrap() = false;
        self.input_tx = None;
        self.emit_event(RdpEvent::Disconnected);
    }

    pub fn is_connected(&self) -> bool {
        *self.connected.lock().unwrap()
    }

    pub fn send_keyboard(&self, event_type: &str, scan_code: u16, extended: bool) {
        if let Some(ref tx) = self.input_tx {
            let pdu = build_keyboard_pdu(event_type, scan_code, extended);
            let _ = tx.send(pdu);
        }
    }

    pub fn send_mouse(&self, event_type: &str, x: u16, y: u16, button: Option<&str>, wheel_delta: Option<i16>) {
        if let Some(ref tx) = self.input_tx {
            let pdu = build_mouse_pdu(event_type, x, y, button, wheel_delta);
            let _ = tx.send(pdu);
        }
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

/// Build a Slow-Path Keyboard Input PDU (TS_KEYBOARD_EVENT wrapped in Share Data)
fn build_keyboard_pdu(event_type: &str, scan_code: u16, extended: bool) -> Vec<u8> {
    let mut kbd_flags: u16 = 0;
    if event_type == "keyup" { kbd_flags |= KBDFLAGS_RELEASE; }
    if extended { kbd_flags |= KBDFLAGS_EXTENDED; }

    // TS_INPUT_PDU_DATA -> TS_INPUT_EVENT -> TS_KEYBOARD_EVENT
    // One input event: messageType(2) + numEvents(2) + pad(4) + event(6)
    let mut events = Vec::new();
    events.extend_from_slice(&0u32.to_le_bytes()); // eventTime (unused)
    events.extend_from_slice(&INPUT_EVENT_SCANCODE.to_le_bytes());
    events.extend_from_slice(&kbd_flags.to_le_bytes());
    events.extend_from_slice(&scan_code.to_le_bytes());

    let num_events: u16 = 1;
    let mut inner = Vec::new();
    inner.extend_from_slice(&0u16.to_le_bytes()); // slow-path input type (unused for TS_INPUT_PDU)
    inner.extend_from_slice(&num_events.to_le_bytes());
    inner.extend_from_slice(&[0u8; 4]); // pad
    inner.extend_from_slice(&events);

    share_data_header_for_input(PDU_TYPE2_INPUT, inner.len() as u16, &inner)
}

/// Build a Slow-Path Mouse Input PDU (TS_POINTER_EVENT wrapped in Share Data)
fn build_mouse_pdu(
    event_type: &str,
    x: u16, y: u16,
    button: Option<&str>,
    wheel_delta: Option<i16>,
) -> Vec<u8> {
    let mut ptr_flags: u16 = 0;

    match event_type {
        "mousemove" => { ptr_flags |= PTRFLAGS_MOVE; }
        "mousedown" => {
            ptr_flags |= PTRFLAGS_DOWN;
            ptr_flags |= match button {
                Some("right")  => PTRFLAGS_BUTTON2,
                Some("middle") => PTRFLAGS_BUTTON3,
                _              => PTRFLAGS_BUTTON1,
            };
        }
        "mouseup" => {
            ptr_flags |= match button {
                Some("right")  => PTRFLAGS_BUTTON2,
                Some("middle") => PTRFLAGS_BUTTON3,
                _              => PTRFLAGS_BUTTON1,
            };
        }
        "wheel" => {
            ptr_flags |= PTRFLAGS_WHEEL;
            if let Some(delta) = wheel_delta {
                if delta < 0 { ptr_flags |= PTRFLAGS_WHEEL_NEGATIVE; }
                ptr_flags |= (delta.unsigned_abs() & 0x01FF) as u16;
            }
        }
        _ => {}
    }

    let mut events = Vec::new();
    events.extend_from_slice(&0u32.to_le_bytes()); // eventTime
    events.extend_from_slice(&INPUT_EVENT_MOUSE.to_le_bytes());
    events.extend_from_slice(&ptr_flags.to_le_bytes());
    events.extend_from_slice(&x.to_le_bytes());
    events.extend_from_slice(&y.to_le_bytes());

    let num_events: u16 = 1;
    let mut inner = Vec::new();
    inner.extend_from_slice(&0u16.to_le_bytes());
    inner.extend_from_slice(&num_events.to_le_bytes());
    inner.extend_from_slice(&[0u8; 4]);
    inner.extend_from_slice(&events);

    share_data_header_for_input(PDU_TYPE2_INPUT, inner.len() as u16, &inner)
}

fn share_data_header_for_input(pdu_type2: u8, data_len: u16, data: &[u8]) -> Vec<u8> {
    let total = 6u16 + 14 + data_len;
    let mut h = Vec::new();
    h.extend_from_slice(&total.to_le_bytes());
    h.extend_from_slice(&PDU_TYPE_DATA.to_le_bytes());
    h.extend_from_slice(&0u16.to_le_bytes());
    // Share Data Header
    h.extend_from_slice(&0x1003EAu32.to_le_bytes());
    h.push(0x00); h.push(0x01);
    h.extend_from_slice(&(14u16 + data_len).to_le_bytes());
    h.push(pdu_type2);
    h.push(0x00);
    h.extend_from_slice(&0u16.to_le_bytes());
    h.extend_from_slice(data);
    h
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
