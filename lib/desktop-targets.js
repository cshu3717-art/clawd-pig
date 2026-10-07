'use strict';
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);

// UI Automation 返回物理像素；统一转换成 Electron 窗口使用的 DIP。
// 读取在异步子进程中进行，桌面扫描不会冻结小猪的运动。
const SCRIPT = String.raw`
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class ClawdDesktop {
  [DllImport("user32.dll", CharSet=CharSet.Unicode)]
  public static extern IntPtr FindWindow(string cls, string title);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)]
  public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string title);
}
'@
$def = [ClawdDesktop]::FindWindowEx([ClawdDesktop]::FindWindow('Progman',$null),[IntPtr]::Zero,'SHELLDLL_DefView',$null)
if ($def -eq [IntPtr]::Zero) {
  $worker = [IntPtr]::Zero
  do {
    $worker = [ClawdDesktop]::FindWindowEx([IntPtr]::Zero,$worker,'WorkerW',$null)
    if ($worker -ne [IntPtr]::Zero) {
      $def = [ClawdDesktop]::FindWindowEx($worker,[IntPtr]::Zero,'SHELLDLL_DefView',$null)
    }
  } while ($worker -ne [IntPtr]::Zero -and $def -eq [IntPtr]::Zero)
}
if ($def -eq [IntPtr]::Zero) { '[]'; exit }
$list = [ClawdDesktop]::FindWindowEx($def,[IntPtr]::Zero,'SysListView32',$null)
if ($list -eq [IntPtr]::Zero) { '[]'; exit }
$root = [System.Windows.Automation.AutomationElement]::FromHandle($list)
$cond = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
  [System.Windows.Automation.ControlType]::ListItem)
$items = $root.FindAll([System.Windows.Automation.TreeScope]::Children,$cond)
$out = @()
foreach ($item in $items) {
  $r = $item.Current.BoundingRectangle
  if (-not $r.IsEmpty -and -not $item.Current.IsOffscreen) {
    $out += [pscustomobject]@{name=$item.Current.Name;x=$r.X;y=$r.Y;width=$r.Width;height=$r.Height}
  }
}
ConvertTo-Json -InputObject @($out) -Compress
`;

function key(name) { return String(name || '').replace(/\.(lnk|url)$/i, '').trim().toLocaleLowerCase('zh-CN'); }

function attachTargets(entries, rects, screen, testMode = false) {
  const byName = new Map();
  for (const rect of rects) {
    const name = key(rect.name);
    if (!name || ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) continue;
    const list = byName.get(name) || [];
    list.push(rect);
    byName.set(name, list);
  }
  const counts = new Map();
  for (const e of entries) counts.set(key(e.name), (counts.get(key(e.name)) || 0) + 1);
  const wa = screen.getPrimaryDisplay().workArea;
  const rows = Math.max(1, Math.floor((wa.height - 24) / 78));
  return entries.map((entry, index) => {
    const matches = byName.get(key(entry.name)) || [];
    if (matches.length === 1 && counts.get(key(entry.name)) === 1) {
      const r = matches[0];
      let point = { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
      try { point = screen.screenToDipPoint(point); } catch { point = null; }
      if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) {
        return { ...entry, target: { ...point, source: 'desktop' } };
      }
    }
    // 估算位置只允许动画预览；绝不用估算位置移动真实快捷方式。
    return { ...entry, target: {
      x: wa.x + 70 + Math.floor(index / rows) * 82,
      y: wa.y + 130 + index % rows * 78,
      source: testMode ? 'test' : 'estimated',
    } };
  });
}

async function locate(entries, screen) {
  let rects = [];
  const testMode = Boolean(process.env.CLAWD_TEST_DESKTOP);
  if (process.platform === 'win32' && !testMode && entries.length) {
    try {
      const { stdout } = await run('powershell.exe', [
        '-NoLogo', '-NoProfile', '-NonInteractive', '-Sta', '-EncodedCommand', Buffer.from(SCRIPT, 'utf16le').toString('base64'),
      ], { encoding: 'utf8', windowsHide: true, timeout: 6000, maxBuffer: 1024 * 1024 });
      const parsed = JSON.parse(stdout.replace(/^\uFEFF/, '').trim() || '[]');
      rects = Array.isArray(parsed) ? parsed : [parsed];
    } catch { /* 定位失败会明确显示“只能预览”，不假称走到了真实图标旁。 */ }
  }
  return attachTargets(entries, rects, screen, testMode);
}

module.exports = { locate, attachTargets };
