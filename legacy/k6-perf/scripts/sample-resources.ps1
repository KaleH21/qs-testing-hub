# Prints one line per second: "<beCpu%> <beMemBytes>" for the BE process (CPU in % of ONE core).
# BE = the process owning TCP port $Port. Missing values print as -1.
# MySQL is not sampled here: as a Windows service its counters read 0 without admin rights;
# DB load comes from performance_schema instead (lib/probes.js).
# shortcut: uses English performance-counter names; on a localized Windows the counters
# are not found and the run simply has no CPU/RAM data. Upgrade: look names up via PDH index.
param([int]$Port = 3020)
$ErrorActionPreference = 'SilentlyContinue'
$inv = [Globalization.CultureInfo]::InvariantCulture
$be = $null
while ($true) {
  if (-not $be) {
    # Listen first; Established also works once k6 is connected (some sandboxes hide Listen rows).
    $c = Get-NetTCPConnection -LocalPort $Port | Where-Object { $_.OwningProcess -gt 4 } |
      Sort-Object { "$($_.State)" -ne 'Listen' } | Select-Object -First 1
    if ($c) { $be = [int]$c.OwningProcess }
  }
  $s = (Get-Counter -SampleInterval 1 -Counter @(
      '\Process(node*)\ID Process', '\Process(node*)\% Processor Time', '\Process(node*)\Working Set - Private')).CounterSamples
  # Every node.exe reports InstanceName "node"; only the counter path ("process(node#3)") tells them apart.
  $idPath = ($s | Where-Object { $_.Path -like '*\id process' -and $be -and [int]$_.CookedValue -eq $be } | Select-Object -First 1).Path
  $beCpu = -1; $beMem = -1
  if ($idPath) {
    $prefix = $idPath.Substring(0, $idPath.LastIndexOf('\'))
    $beCpu = ($s | Where-Object { $_.Path -eq "$prefix\% processor time" }).CookedValue
    $beMem = ($s | Where-Object { $_.Path -eq "$prefix\working set - private" }).CookedValue
  }
  [Console]::Out.WriteLine([string]::Format($inv, '{0:F1} {1:F0}', $beCpu, $beMem))
}
