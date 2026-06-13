
$files = Get-ChildItem -Path "c:\Users\Subhankar Roy\Downloads\MeatDae" -Filter *.html -Recurse
foreach ($file in $files) {
    try {
        $content = Get-Content -Path $file.FullName -Raw -Encoding UTF8
        $newContent = $content -replace 'callto:123456789', 'tel:+917002568330' -replace 'callto:\+917002568330', 'tel:+917002568330'
        
        if ($content -ne $newContent) {
            Set-Content -Path $file.FullName -Value $newContent -Encoding UTF8 -NoNewline
            Write-Host "Updated $($file.Name)"
        }
    } catch {
        Write-Host "Error processing $($file.Name): $_"
    }
}
