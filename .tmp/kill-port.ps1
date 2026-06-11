$port =8211
$conn = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
if ($conn) {
 foreach ($c in $conn) {
 $pid2 = $c.OwningProcess
 Write-Host "Killing PID $pid2 on port $port"
 Stop-Process -Id $pid2 -Force -ErrorAction SilentlyContinue
 }
} else {
 Write-Host "No connection on port $port"
}
