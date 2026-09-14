$ErrorActionPreference = 'Stop'
$gameDvr = $null
$key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\GameDVR'
if (Test-Path $key) {
  $item = Get-ItemProperty -Path $key -Name HistoricalCaptureEnabled -ErrorAction SilentlyContinue
  if ($null -ne $item) { $gameDvr = [int]$item.HistoricalCaptureEnabled }
}
[pscustomobject]@{ backgroundRecording = $gameDvr } | ConvertTo-Json -Compress
