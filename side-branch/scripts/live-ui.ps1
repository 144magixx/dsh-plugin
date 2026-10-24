# Windows-only manual acceptance helper: drives the existing DSH Desktop window
# through Win32 UI Automation. Not needed for tests; macOS has no equivalent here.
param(
  [ValidateSet('list','invoke','set','restore','minimize','screenshot')][string]$Action = 'list',
  [string]$Name,
  [string]$Text,
  [string]$OutputPath,
  [int]$WindowProcessId = 0
)
$ErrorActionPreference = 'Stop'
if (-not $IsWindows -and $PSVersionTable.PSEdition -eq 'Core') { throw 'live-ui.ps1 requires Windows UI Automation.' }
if ($WindowProcessId -eq 0) {
  $WindowProcessId = @(Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 })[0].Id
  if (-not $WindowProcessId) { throw 'No DSH Desktop window found; pass -WindowProcessId.' }
}
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class SideBranchUiNative {
 [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int command);
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
 [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
 public struct RECT { public int Left, Top, Right, Bottom; }
}
'@
$p = Get-Process -Id $WindowProcessId
if ($p.ProcessName -ne 'DeepSeek Harness' -or $p.MainWindowHandle -eq 0) { throw 'Expected existing DSH main window; refusing action.' }
$handle = [IntPtr]$p.MainWindowHandle
$root = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
if ($Action -eq 'restore') {
  [void][SideBranchUiNative]::ShowWindowAsync($handle, 9)
  [void][SideBranchUiNative]::SetForegroundWindow($handle)
  'Restored existing DSH window; no process restarted.'
  exit
}
if ($Action -eq 'minimize') { [void][SideBranchUiNative]::ShowWindowAsync($handle, 6); 'Minimized existing DSH window; runtime remains active.'; exit }
if ($Action -eq 'screenshot') {
  $artifactRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\artifacts')) + [System.IO.Path]::DirectorySeparatorChar
  if (-not $OutputPath -or -not [System.IO.Path]::GetFullPath($OutputPath).StartsWith($artifactRoot, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Screenshot path must stay in this plugin artifacts directory.' }
  [void][SideBranchUiNative]::SetProcessDPIAware()
  $rect = New-Object SideBranchUiNative+RECT
  [void][SideBranchUiNative]::GetWindowRect($handle, [ref]$rect)
  if ($rect.Left -lt -10000 -or $rect.Right -le $rect.Left) { throw 'Window is minimized; restore before screenshot.' }
  $bitmap = New-Object System.Drawing.Bitmap(($rect.Right-$rect.Left),($rect.Bottom-$rect.Top))
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try { $graphics.CopyFromScreen($rect.Left,$rect.Top,0,0,$bitmap.Size); $bitmap.Save($OutputPath,[System.Drawing.Imaging.ImageFormat]::Png) }
  finally { $graphics.Dispose(); $bitmap.Dispose() }
  $OutputPath
  exit
}
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
if ($Action -eq 'list') {
  $all | Where-Object { $_.Current.ControlType.ProgrammaticName -match 'Document|Button|Edit|TabItem|Hyperlink|Text|CheckBox|RadioButton|ComboBox' } | Select-Object -First 180 @{n='Type';e={$_.Current.ControlType.ProgrammaticName}},@{n='Name';e={$s=$_.Current.Name;if($s.Length -gt 160){$s.Substring(0,160)}else{$s}}},@{n='Bounds';e={$_.Current.BoundingRectangle.ToString()}} | Format-Table -Wrap -AutoSize
  exit
}
$matchesByName = @($all | Where-Object { $_.Current.Name -eq $Name -and $_.Current.ControlType.ProgrammaticName -match 'Button|Edit|Hyperlink|CheckBox|RadioButton|ComboBox|TabItem' })
if ($matchesByName.Count -ne 1) { throw "Expected one actionable control named '$Name'; found $($matchesByName.Count)." }
$control = $matchesByName[0]
if ($Action -eq 'invoke') {
  $invoke = $control.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
  $invoke.Invoke()
  "Invoked: $Name"
} elseif ($Action -eq 'set') {
  $value = $control.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
  $value.SetValue($Text)
  "Set value in: $Name"
}
