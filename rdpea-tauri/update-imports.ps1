# Update all component files to use Tauri IPC bridge instead of window.rdpea

$files = Get-ChildItem -Path "src" -Include "*.tsx","*.ts" -Recurse

foreach ($file in $files) {
    $content = Get-Content $file.FullName -Raw
    $updated = $false
    
    # Skip if already has tauri import
    if ($content -match "from '\.\./lib/tauri'|from '../lib/tauri'") {
        Write-Host "Skipping $($file.Name) - already has tauri import"
        continue
    }
    
    # Check if file uses window.rdpea
    if ($content -match "window\.rdpea") {
        Write-Host "Updating $($file.Name)..."
        
        # Add tauri import at the top (after existing imports)
        if ($content -match "(?s)(import.*?from.*?;[\r\n]+)+") {
            $lastImport = $matches[0]
            $newImport = "import { tauri } from '../lib/tauri';`n"
            
            # Adjust path depth based on file location
            if ($file.Directory.Name -eq "hooks") {
                $newImport = "import { tauri } from '../lib/tauri';`n"
            } elseif ($file.Directory.Name -eq "components") {
                $newImport = "import { tauri } from '../lib/tauri';`n"
            }
            
            $content = $content -replace "(?s)(import.*?from.*?;[\r\n]+)+", "`$0$newImport"
        }
        
        # Replace window.rdpea with tauri
        $content = $content -replace "window\.rdpea\.", "tauri."
        
        $updated = $true
    }
    
    if ($updated) {
        Set-Content -Path $file.FullName -Value $content -NoNewline
        Write-Host "  ✓ Updated $($file.Name)"
    }
}

Write-Host "`nDone!"
