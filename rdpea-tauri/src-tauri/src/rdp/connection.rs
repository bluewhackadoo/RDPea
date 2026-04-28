// RDP Connection — thin wrapper around IronRDP's async connector
// Translated from electron/rdp/client.ts connect() flow

use crate::rdp::client::RdpError;
use crate::rdp::types::RdpClientConfig;

use std::net::ToSocketAddrs;
use std::sync::Arc;

use ironrdp::connector::{self, Credentials};
use ironrdp::session::ActiveStage;
use ironrdp_tokio::{
    TokioFramed, MovableTokioFramed,
    connect_begin, connect_finalize, mark_as_upgraded,
};
use ironrdp::connector::ServerName as RdpServerName;

use tokio::net::TcpStream;
use tokio_rustls::TlsConnector;
use tokio_rustls::rustls::{self, ClientConfig};
use tokio_rustls::rustls::pki_types::ServerName as TlsServerName;

/// Established RDP session — wraps IronRDP ActiveStage + framed TLS stream.
pub struct RdpConnection {
    pub active_stage: ActiveStage,
    pub framed: MovableTokioFramed<tokio_rustls::client::TlsStream<TcpStream>>,
    pub width: u16,
    pub height: u16,
}

impl RdpConnection {
    /// Perform the complete RDP connection handshake using IronRDP.
    /// Mirrors electron/rdp/client.ts: TCP → X.224 → TLS → CredSSP/NLA → MCS → Active.
    pub async fn establish(
        config: &RdpClientConfig,
        log: &mut impl FnMut(String),
    ) -> Result<Self, RdpError> {

        // ── 1. TCP connect ───────────────────────────────────────────────────
        log(format!("TCP connecting to {}:{}", config.host, config.port));
        let addr = format!("{}:{}", config.host, config.port)
            .to_socket_addrs()
            .map_err(|e| RdpError::Connection(format!("DNS lookup failed: {}", e)))?
            .next()
            .ok_or_else(|| RdpError::Connection("No addresses resolved".into()))?;

        let tcp = TcpStream::connect(addr)
            .await
            .map_err(|e| RdpError::Connection(format!("TCP connect failed: {}", e)))?;
        log("TCP connected".into());

        // ── 2. IronRDP connector config ───────────────────────────────────────
        let ironrdp_config = connector::Config {
            credentials: Credentials::UsernamePassword {
                username: config.username.clone(),
                password: config.password.clone(),
            },
            domain: if config.domain.is_empty() { None } else { Some(config.domain.clone()) },
            enable_tls: false,
            enable_credssp: true,
            keyboard_type: ironrdp::pdu::gcc::KeyboardType::IbmEnhanced,
            keyboard_subtype: 0,
            keyboard_layout: 0,
            keyboard_functional_keys_count: 12,
            ime_file_name: String::new(),
            dig_product_id: String::new(),
            desktop_size: connector::DesktopSize {
                width: config.width as u16,
                height: config.height as u16,
            },
            bitmap: None,
            client_build: 0,
            client_name: "RDPea".to_owned(),
            client_dir: "C:\\Windows\\System32\\mstscax.dll".to_owned(),
            platform: ironrdp::pdu::rdp::capability_sets::MajorPlatformType::WINDOWS,
            enable_server_pointer: true,
            request_data: None,
            autologon: false,
            enable_audio_playback: false,
            pointer_software_rendering: true,
            performance_flags: ironrdp::pdu::rdp::client_info::PerformanceFlags::default(),
            desktop_scale_factor: 0,
            hardware_id: None,
            license_cache: None,
            timezone_info: ironrdp::pdu::rdp::client_info::TimezoneInfo::default(),
        };

        // ── 3. X.224 negotiation ─────────────────────────────────────────────
        log("X.224 negotiation...".into());
        let client_addr = tcp.local_addr()
            .map_err(|e| RdpError::Connection(format!("local addr: {}", e)))?;

        let mut connector = connector::ClientConnector::new(ironrdp_config, client_addr);
        let mut framed = TokioFramed::<TcpStream>::new(tcp);

        let should_upgrade = connect_begin(&mut framed, &mut connector)
            .await
            .map_err(|e| RdpError::Protocol(format!("connect_begin: {}", e)))?;
        log("X.224 complete, upgrading to TLS...".into());

        // ── 4. TLS upgrade ────────────────────────────────────────────────────
        let tls_config = ClientConfig::builder()
            .dangerous()
            .with_custom_certificate_verifier(Arc::new(NoCertVerify))
            .with_no_client_auth();
        let mut tls_config = tls_config;
        tls_config.resumption = rustls::client::Resumption::disabled();
        let tls_connector = TlsConnector::from(Arc::new(tls_config));

        let server_name = TlsServerName::try_from(config.host.clone())
            .map_err(|e| RdpError::Connection(format!("invalid server name: {}", e)))?;

        // Must have no leftover bytes — TLS handshake consumes raw TCP bytes directly
        let tcp_stream = framed.into_inner_no_leftover();

        let mut tls_stream = tls_connector
            .connect(server_name, tcp_stream)
            .await
            .map_err(|e| RdpError::Connection(format!("TLS upgrade failed: {}", e)))?;

        // Flush to drive handshake to completion so peer cert is available
        use tokio::io::AsyncWriteExt as _;
        tls_stream.flush().await
            .map_err(|e| RdpError::Connection(format!("TLS flush failed: {}", e)))?;
        log("TLS established".into());

        // ── 5. Extract server public key from peer cert (for CredSSP) ─────────
        let server_public_key = {
            let cert = tls_stream.get_ref().1
                .peer_certificates()
                .and_then(|c| c.first().cloned());
            match cert {
                Some(c) => extract_public_key(c.as_ref())
                    .map_err(|e| RdpError::Auth(format!("cert key: {}", e)))?,
                None => return Err(RdpError::Auth("No peer certificate".into())),
            }
        };
        log("Server public key extracted".into());

        // ── 6. CredSSP / NLA + MCS + capabilities (connect_finalize) ─────────
        log("NLA/CredSSP + MCS negotiation...".into());
        let upgraded = mark_as_upgraded(should_upgrade, &mut connector);
        let mut upgraded_framed = MovableTokioFramed::<tokio_rustls::client::TlsStream<TcpStream>>::new(tls_stream);
        let mut network_client = ironrdp_tokio::reqwest::ReqwestNetworkClient::new();

        let connection_result = connect_finalize(
            upgraded,
            connector,
            &mut upgraded_framed,
            &mut network_client,
            RdpServerName::new(config.host.clone()),
            server_public_key,
            None,
        )
        .await
        .map_err(|e| RdpError::Auth(format!("connect_finalize: {}", e)))?;

        let w = connection_result.desktop_size.width;
        let h = connection_result.desktop_size.height;
        log(format!("Connected! Desktop: {}x{}", w, h));

        Ok(Self {
            active_stage: ActiveStage::new(connection_result),
            framed: upgraded_framed,
            width: w,
            height: h,
        })
    }
}

/// Extract the SubjectPublicKey bytes from a DER-encoded X.509 certificate.
fn extract_public_key(cert_der: &[u8]) -> Result<Vec<u8>, String> {
    use x509_cert::der::Decode as _;
    let cert = x509_cert::Certificate::from_der(cert_der)
        .map_err(|e| format!("DER parse: {}", e))?;
    cert.tbs_certificate
        .subject_public_key_info
        .subject_public_key
        .as_bytes()
        .ok_or_else(|| "SubjectPublicKey not byte-aligned".into())
        .map(|b| b.to_owned())
}

/// rustls verifier that accepts any certificate (RDP servers use self-signed certs).
#[derive(Debug)]
struct NoCertVerify;

impl rustls::client::danger::ServerCertVerifier for NoCertVerify {
    fn verify_server_cert(
        &self,
        _: &rustls::pki_types::CertificateDer<'_>,
        _: &[rustls::pki_types::CertificateDer<'_>],
        _: &rustls::pki_types::ServerName<'_>,
        _: &[u8],
        _: rustls::pki_types::UnixTime,
    ) -> Result<rustls::client::danger::ServerCertVerified, rustls::Error> {
        Ok(rustls::client::danger::ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        _: &[u8],
        _: &rustls::pki_types::CertificateDer<'_>,
        _: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        Ok(rustls::client::danger::HandshakeSignatureValid::assertion())
    }

    fn verify_tls13_signature(
        &self,
        _: &[u8],
        _: &rustls::pki_types::CertificateDer<'_>,
        _: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        Ok(rustls::client::danger::HandshakeSignatureValid::assertion())
    }

    fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> {
        rustls::crypto::ring::default_provider()
            .signature_verification_algorithms
            .supported_schemes()
    }
}
