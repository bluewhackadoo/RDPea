cask "rdpea" do
  version "1.0.3"
  sha256 "REPLACE_WITH_ACTUAL_SHA256"

  url "https://github.com/bluewhackadoo/RDPea/releases/download/v#{version}/RDPea-#{version}-arm64.dmg"

  on_intel do
    url "https://github.com/bluewhackadoo/RDPea/releases/download/v#{version}/RDPea-#{version}-x64.dmg"
  end
  name "RDPea"
  desc "Lightweight RDP Remote Desktop Client"
  homepage "https://github.com/bluewhackadoo/RDPea"

  livecheck do
    url :url
    strategy :github_latest
  end

  auto_updates true

  app "RDPea.app"

  zap trash: [
    "~/Library/Application Support/rdpea",
    "~/Library/Preferences/com.rdpea.app.plist",
    "~/Library/Saved Application State/com.rdpea.app.savedState",
  ]
end
