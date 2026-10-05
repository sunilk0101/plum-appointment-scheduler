Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$outDir = Join-Path $root "samples"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$path = Join-Path $outDir "ocr-note.png"

$bmp = New-Object System.Drawing.Bitmap 1100, 220
$graphics = [System.Drawing.Graphics]::FromImage($bmp)
$graphics.Clear([System.Drawing.Color]::White)
$graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias
$font = New-Object System.Drawing.Font "Arial", 32
$brush = [System.Drawing.Brushes]::Black
$graphics.DrawString("book dentist nxt Friday @ 3 pm", $font, $brush, 40, 80)
$bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bmp.Dispose()
Write-Output "Wrote $path"
