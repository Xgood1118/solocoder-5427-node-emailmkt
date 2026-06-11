Get-NetTCPConnection -LocalPort8211 | Select-Object OwningProcess, LocalAddress, LocalPort
Get-Process -Id16636 -ErrorAction SilentlyContinue | Format-List Id, ProcessName, StartTime
Get-Process -Id384535 -ErrorAction SilentlyContinue | Format-List Id, ProcessName, StartTime
Get-Process -Id384535 -ErrorAction SilentlyContinue | Stop-Process -Force
Get-Process -Id16636 -ErrorAction SilentlyContinue | Stop-Process -Force
