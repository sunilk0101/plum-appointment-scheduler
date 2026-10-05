$ErrorActionPreference = "Stop"
$base = "http://localhost:3000"

function Show-Step($title, $response) {
  Write-Host ""
  Write-Host "==== $title ===="
  $response | ConvertTo-Json -Depth 8
}

$sample = @{
  text = "Book dentist next Friday at 3pm"
  reference_date = "2025-09-19"
} | ConvertTo-Json

Show-Step "health" (Invoke-RestMethod "$base/health")
Show-Step "1 extract" (Invoke-RestMethod -Method Post -Uri "$base/api/v1/extract" -ContentType "application/json" -Body $sample)
Show-Step "2 entities" (Invoke-RestMethod -Method Post -Uri "$base/api/v1/entities" -ContentType "application/json" -Body $sample)

$normalize = @{
  reference_date = "2025-09-19"
  entities = @{
    date_phrase = "next Friday"
    time_phrase = "3pm"
    department = "dentist"
  }
} | ConvertTo-Json -Depth 5
Show-Step "3 normalize" (Invoke-RestMethod -Method Post -Uri "$base/api/v1/normalize" -ContentType "application/json" -Body $normalize)
Show-Step "4 appointment" (Invoke-RestMethod -Method Post -Uri "$base/api/v1/appointments" -ContentType "application/json" -Body $sample)

$noisy = @{
  text = "book dentist nxt Friday @ 3 pm"
  reference_date = "2025-09-19"
} | ConvertTo-Json
Show-Step "noisy OCR text" (Invoke-RestMethod -Method Post -Uri "$base/api/v1/pipeline" -ContentType "application/json" -Body $noisy)

$ambiguous = @{
  text = "Book dentist Friday or Monday at 3pm"
  reference_date = "2025-09-19"
} | ConvertTo-Json
Show-Step "guardrail" (Invoke-RestMethod -Method Post -Uri "$base/api/v1/appointments" -ContentType "application/json" -Body $ambiguous)

$image = Join-Path $PSScriptRoot "..\samples\ocr-note.png"
if (Test-Path $image) {
  Write-Host ""
  Write-Host "==== image ===="
  curl.exe -s -X POST "$base/api/v1/pipeline" -F "reference_date=2025-09-19" -F "image=@$image"
  Write-Host ""
}
