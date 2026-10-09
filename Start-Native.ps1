param([switch]$Rebuild)
$ErrorActionPreference = 'Stop'
$taskRoot = $PSScriptRoot
$taskExe = Join-Path $taskRoot 'native/target/release/support-privacy-native.exe'
$taskAssets = Join-Path $taskRoot 'browser/dist'
if ($Rebuild -or !(Test-Path -LiteralPath $taskExe) -or !(Test-Path -LiteralPath (Join-Path $taskAssets 'models/Xenova/bert-base-NER/onnx/model_quantized.onnx'))) {
    Push-Location (Join-Path $taskRoot 'browser')
    try {
        & npm.cmd ci --ignore-scripts; if ($LASTEXITCODE) { throw 'Browser dependency setup failed' }
        & npm.cmd run assets; if ($LASTEXITCODE) { throw 'Local asset preparation failed' }
        & npm.cmd run build; if ($LASTEXITCODE) { throw 'Browser build failed' }
    } finally { Pop-Location }
    Push-Location (Join-Path $taskRoot 'native')
    try { & cargo build --release --locked; if ($LASTEXITCODE) { throw 'Rust build failed' } } finally { Pop-Location }
}
Write-Host 'Open http://127.0.0.1:8766 in Brave. Close this launcher to stop the server.'
& $taskExe serve --port 8766 --assets $taskAssets
