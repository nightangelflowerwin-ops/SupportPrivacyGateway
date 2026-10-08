param([switch]$ValidatorsOnly)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    throw 'Install uv from https://docs.astral.sh/uv/getting-started/installation/ first.'
}
uv sync --extra serve --extra presidio
if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
$env:PII_DETECTOR = if ($ValidatorsOnly) { 'validators' } else { 'presidio' }
$env:PII_SPACY_MODEL = 'en_core_web_sm'
$env:PYTHONUTF8 = '1'
Write-Host 'Open http://127.0.0.1:8765 in your browser. Ctrl+C stops the gateway.'
uv run --no-sync uvicorn --factory pii_gateway.lab:create_lab --host 127.0.0.1 --port 8765 --no-access-log
