pub mod types;
pub mod buffer;
pub mod transport;
pub mod protocol;
pub mod security;
pub mod ntlm;
pub mod bitmap;
pub mod audio;
pub mod clipboard;
pub mod input;
pub mod client;
pub mod mcs;
pub mod gcc;

pub use transport::{TpktFrame, RdpTransport};
pub use protocol::{X224ConnectionRequest, X224ConnectionConfirm, Protocol, negotiate_protocol};
pub use mcs::{McsConnectInitial, McsConnectResponse, McsLayer, encode_ber_length, decode_ber_length};
pub use gcc::{ClientCoreData, ClientSecurityData, ClientNetworkData, ChannelDef, ChannelOptions,
              RdpVersion, ServerDataBlock, ServerCoreData, EncryptionMethod};
pub use security::{SecurityLayer, RsaPublicKey, SessionKeys, rsa_encrypt, generate_random_bytes};

#[cfg(test)]
pub mod tests;
