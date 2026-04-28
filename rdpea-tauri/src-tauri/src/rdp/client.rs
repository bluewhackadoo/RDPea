// RDP Client — orchestrates the full connection lifecycle
use crate::rdp::types::*;
use crate::rdp::connection::RdpConnection;
use std::sync::{Arc, Mutex};
use tokio::sync::mpsc;
use thiserror::Error;
use ironrdp::session::ActiveStageOutput;
use ironrdp::session::image::DecodedImage;
use ironrdp_graphics::image_processing::PixelFormat;
use ironrdp_tokio::{FramedRead as _, FramedWrite as _};

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

        eprintln!("[RDP] connect() called for {}:{}", config.host, config.port);
        let _ = handler; // handler clone moved into handler3 below

        // Input channel so send_keyboard/send_mouse can inject PDUs
        let (input_tx, mut input_rx) = mpsc::unbounded_channel::<Vec<u8>>();
        self.input_tx = Some(input_tx);

        // Spawn connection + session loop in background so rdp_connect returns immediately
        // (the session window JS needs time to load and register its event listeners)
        let handler3 = self.event_handler.clone();
        tokio::spawn(async move {
            // Small delay to let the session window JS finish loading
            tokio::time::sleep(tokio::time::Duration::from_millis(800)).await;

            // Log closure that emits to frontend AND stderr
            let handler_log = handler3.clone();
            let mut log_fn = |msg: String| {
                eprintln!("[RDP] {}", msg);
                if let Some(ref h) = handler_log {
                    h(RdpEvent::Log { message: msg });
                }
            };

            // Run the real RDP handshake
            let mut conn = match RdpConnection::establish(&config, &mut log_fn).await {
                Ok(c) => c,
                Err(e) => {
                    let msg = format!("Connection failed: {}", e);
                    eprintln!("[RDP] {}", msg);
                    if let Some(ref h) = handler3 { h(RdpEvent::Error { message: msg }); }
                    *connected_flag.lock().unwrap() = false;
                    return;
                }
            };

            *connected_flag.lock().unwrap() = true;
            let w = conn.width;
            let h_px = conn.height;
            if let Some(ref h) = handler3 {
                h(RdpEvent::Connected { width: w as u32, height: h_px as u32 });
            }
            eprintln!("[RDP] Active session established");

            // Decoded image buffer — updated by IronRDP on every bitmap update
            let mut image = DecodedImage::new(PixelFormat::RgbA32, w, h_px);

            loop {
                if *stop_flag.lock().unwrap() { break; }

                // Drain any pending input PDUs first (non-blocking)
                while let Ok(frame) = input_rx.try_recv() {
                    if let Err(_) = conn.framed.write_all(&frame).await {
                        break; // connection dead, stop draining
                    }
                }

                // Receive one PDU with short timeout so input stays responsive
                let read_result = tokio::time::timeout(
                    tokio::time::Duration::from_millis(50),
                    conn.framed.read_pdu()
                ).await;

                let (action, payload) = match read_result {
                    Ok(Ok(pdu)) => pdu,
                    Ok(Err(e)) => {
                        eprintln!("[RDP] Session read error: {}", e);
                        if let Some(ref h) = handler3 {
                            h(RdpEvent::Error { message: format!("Read error: {}", e) });
                            h(RdpEvent::Disconnected);
                        }
                        *connected_flag.lock().unwrap() = false;
                        break;
                    }
                    Err(_) => continue, // timeout — loop to drain input
                };

                let outputs = match conn.active_stage.process(&mut image, action, &payload) {
                    Ok(o) => o,
                    Err(e) => {
                        eprintln!("[RDP] Protocol error: {}", e);
                        if let Some(ref h) = handler3 {
                            h(RdpEvent::Error { message: format!("Protocol error: {}", e) });
                            h(RdpEvent::Disconnected);
                        }
                        *connected_flag.lock().unwrap() = false;
                        break;
                    }
                };

                for output in outputs {
                    match output {
                        ActiveStageOutput::ResponseFrame(frame) => {
                            let _ = conn.framed.write_all(&frame).await;
                        }
                        ActiveStageOutput::GraphicsUpdate(_region) => {
                            // Emit changed region as RGBA bitmap
                            let rects = vec![BitmapRectIpc {
                                x: 0, y: 0,
                                width: w,
                                height: h_px,
                                data: image.data().to_vec(),
                            }];
                            if let Some(ref h) = handler3 {
                                h(RdpEvent::Bitmap { rects });
                            }
                        }
                        ActiveStageOutput::Terminate(_) => {
                            if let Some(ref h) = handler3 { h(RdpEvent::Disconnected); }
                            *connected_flag.lock().unwrap() = false;
                            return;
                        }
                        _ => {}
                    }
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

/// Build a keyboard fast-path input PDU using IronRDP.
fn build_keyboard_pdu(event_type: &str, scan_code: u16, extended: bool) -> Vec<u8> {
    use ironrdp::pdu::input::fast_path::{FastPathInput, FastPathInputEvent, KeyboardFlags};
    use ironrdp::core::encode_vec;

    let mut flags = KeyboardFlags::empty();
    if event_type == "keyup" { flags |= KeyboardFlags::RELEASE; }
    if extended { flags |= KeyboardFlags::EXTENDED; }

    let pdu = FastPathInput::single(FastPathInputEvent::KeyboardEvent(flags, scan_code as u8));
    encode_vec(&pdu).unwrap_or_default()
}

/// Build a mouse fast-path input PDU using IronRDP.
fn build_mouse_pdu(
    event_type: &str,
    x: u16, y: u16,
    button: Option<&str>,
    wheel_delta: Option<i16>,
) -> Vec<u8> {
    use ironrdp::pdu::input::fast_path::{FastPathInput, FastPathInputEvent};
    use ironrdp::pdu::input::mouse::{MousePdu, PointerFlags};
    use ironrdp::core::encode_vec;

    let mut flags = PointerFlags::empty();
    match event_type {
        "mousemove" => { flags |= PointerFlags::MOVE; }
        "mousedown" => {
            flags |= PointerFlags::DOWN;
            flags |= match button {
                Some("right")  => PointerFlags::RIGHT_BUTTON,
                Some("middle") => PointerFlags::MIDDLE_BUTTON_OR_WHEEL,
                _              => PointerFlags::LEFT_BUTTON,
            };
        }
        "mouseup" => {
            flags |= match button {
                Some("right")  => PointerFlags::RIGHT_BUTTON,
                Some("middle") => PointerFlags::MIDDLE_BUTTON_OR_WHEEL,
                _              => PointerFlags::LEFT_BUTTON,
            };
        }
        "wheel" => {
            flags |= PointerFlags::VERTICAL_WHEEL;
            if let Some(delta) = wheel_delta {
                if delta < 0 { flags |= PointerFlags::WHEEL_NEGATIVE; }
            }
        }
        _ => {}
    }

    let pdu = FastPathInput::single(FastPathInputEvent::MouseEvent(MousePdu {
        flags,
        number_of_wheel_rotation_units: wheel_delta.unwrap_or(0),
        x_position: x,
        y_position: y,
    }));
    encode_vec(&pdu).unwrap_or_default()
}

