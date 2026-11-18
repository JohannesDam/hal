# HAL's one process per PC: a warm voice, the haze windows, and an inbox of messages.
# The mod writes JSON messages into the inbox folder; this process answers on stdout,
# one JSON object per line. The haze is click-through, never takes focus, never touches input.
#
# One-shot use (testing):  hal-host.ps1 -Say "Three files changed." [-Haze 0]
# When a host is already running, a one-shot hands its line to that host's inbox.
param(
  [string]$Inbox = "",
  [string]$Say = "",
  [int]$Haze = 1,
  [double]$Strength = 0.56,
  # Tools for the listening test: process every wav in a folder through the voice chain,
  # or render one line with the Windows voice into a processed wav. Neither speaks.
  [string]$ProcessDir = "",
  [string]$OutDir = "",
  [string]$RenderText = "",
  [string]$OutWav = "",
  # HAL's voice: a Piper voice (kestrin) or a Kokoro voice (am_michael), when set up by
  # tools/setup-voice.ps1. Speed 0 takes the engine's own default.
  [string]$Voice = "kestrin",
  [double]$Speed = 0.0,
  # Testing only: do not count key presses (keys never end a line; the mod never sets this).
  [switch]$IgnoreKeys
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

function Emit($obj) {
  [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress -Depth 6))
  [Console]::Out.Flush()
}
function NowMs { [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }

if (-not $Inbox) { $Inbox = Join-Path $env:LOCALAPPDATA 'hal\inbox' }
New-Item -ItemType Directory -Force -Path $Inbox | Out-Null

$isOneShot = [bool]$Say
$isTool = [bool]($ProcessDir -or $RenderText)
if ($isTool) {
} elseif ($isOneShot) {
  $existing = $null
  if ([System.Threading.Mutex]::TryOpenExisting('Local\HAL-host', [ref]$existing)) {
    $msg = @{ kind = 'say'; id = "oneshot-$(NowMs)"; text = $Say; haze = ($Haze -eq 1); strength = $Strength; at = (NowMs) }
    $name = Join-Path $Inbox ("{0:D15}-oneshot.json" -f (NowMs))
    [IO.File]::WriteAllText($name, ($msg | ConvertTo-Json -Compress), [Text.Encoding]::UTF8)
    exit 0
  }
} else {
  $created = $false
  $script:hostMutex = New-Object System.Threading.Mutex($true, 'Local\HAL-host', [ref]$created)
  if (-not $created) { Emit @{ t = 'busy' }; exit 0 }
}

# ---------- native helpers and the voice chain ----------
Add-Type -TypeDefinition @"
using System;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;
using System.Runtime.InteropServices;
using Microsoft.Win32;

public static class HalNative {
  [DllImport("shell32.dll")] static extern int SHQueryUserNotificationState(out int state);
  // A fullscreen app, a D3D game or presentation mode: then HAL keeps his initiative to himself.
  public static bool IsFullscreen() { int s; if (SHQueryUserNotificationState(out s) != 0) return false; return s == 2 || s == 3 || s == 4; }

  // Who holds a microphone right now, from the store behind Windows' mic indicator; HAL's own
  // Python processes are left out. Returns the app's short name, or "" when nobody else does.
  public static string MicUser(string[] own) {
    string bas = @"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone";
    string found = Scan(bas, true, own);
    return found != "" ? found : Scan(bas + @"\NonPackaged", false, own);
  }

  static string Scan(string path, bool isPackaged, string[] own) {
    try {
      using (RegistryKey key = Registry.CurrentUser.OpenSubKey(path)) {
        if (key == null) return "";
        foreach (string name in key.GetSubKeyNames()) {
          if (name == "NonPackaged") continue;
          using (RegistryKey app = key.OpenSubKey(name)) {
            if (app == null) continue;
            object start = app.GetValue("LastUsedTimeStart"), stop = app.GetValue("LastUsedTimeStop");
            if (start == null || stop == null || Convert.ToInt64(start) == 0 || Convert.ToInt64(stop) != 0) continue;
            if (Array.IndexOf(own, name.ToLowerInvariant()) >= 0) continue;
            if (isPackaged) return name.Split('_')[0];
            string[] parts = name.Split('#');
            return parts[parts.Length - 1];
          }
        }
      }
    } catch { }
    return "";
  }

  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll")] static extern int SetWindowLong(IntPtr h, int i, int v);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
  // WS_EX_TRANSPARENT | WS_EX_LAYERED | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE
  public static void ClickThrough(IntPtr h) { SetWindowLong(h, -20, GetWindowLong(h, -20) | 0x20 | 0x80000 | 0x80 | 0x8000000); }
  public static IntPtr ActiveMonitor() { return MonitorFromWindow(GetForegroundWindow(), 2); }
  public static IntPtr MonitorOf(IntPtr h) { return MonitorFromWindow(h, 2); }
  [StructLayout(LayoutKind.Sequential)] struct BasicInfo { public IntPtr exit; public IntPtr peb; public IntPtr affinity; public IntPtr priority; public IntPtr pid; public IntPtr parent; }
  [DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(IntPtr h, int c, ref BasicInfo b, int l, out int r);
  // The process that started this one: Claude Code, whose exit the farewell waits for.
  public static int ParentPid() {
    try { BasicInfo b = new BasicInfo(); int r; NtQueryInformationProcess(Process.GetCurrentProcess().Handle, 0, ref b, Marshal.SizeOf(b), out r); return b.parent.ToInt32(); }
    catch { return 0; }
  }
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
  // Whether a key went down since the last call (or is down now). Reads key state only:
  // no hook, nothing recorded. Mouse buttons and lone modifiers do not count.
  public static int LastKey;
  public static bool AnyKeyDown() {
    bool any = false;
    for (int k = 0x08; k <= 0xFE; k++) {
      if (k == 0x10 || k == 0x11 || k == 0x12 || (k >= 0xA0 && k <= 0xA5) || k == 0x5B || k == 0x5C) continue;
      if ((GetAsyncKeyState(k) & 0x8001) != 0) { any = true; LastKey = k; }
    }
    return any;
  }
}

public sealed class HalVoice {
  public byte[] Wav;
  public double Seconds;
  public double[] Samples;   // the processed voice, mono, with its preroll
  public int Rate;
  public double[] Fast;   // loudness per 10 ms, 0..1, attack 30 ms, release 180 ms
  public double[] Slow;   // the same low-passed at about 2 Hz: for large areas, flash-safe
  public const double Preroll = 0.3;

  public double FastAt(double t) { int i = (int)(t * 100); return (i >= 0 && i < Fast.Length) ? Fast[i] : 0; }
  public double SlowAt(double t) { int i = (int)(t * 100); return (i >= 0 && i < Slow.Length) ? Slow[i] : 0; }

  public static HalVoice Process(byte[] wav) {
    int pos = 12, ch = 1, rate = 16000, bits = 16, start = 0, len = 0;
    while (pos + 8 <= wav.Length) {
      string id = System.Text.Encoding.ASCII.GetString(wav, pos, 4);
      int n = BitConverter.ToInt32(wav, pos + 4);
      if (id == "fmt ") { ch = BitConverter.ToInt16(wav, pos + 10); rate = BitConverter.ToInt32(wav, pos + 12); bits = BitConverter.ToInt16(wav, pos + 22); }
      else if (id == "data") { start = pos + 8; len = Math.Min(n, wav.Length - start); break; }
      pos += 8 + n + (n % 2);
    }
    if (bits != 16 || len <= 0) throw new InvalidDataException("the voice gave no 16-bit PCM");
    int frames = len / (2 * ch);
    double[] x = new double[frames];
    for (int i = 0; i < frames; i++) {
      double s = 0;
      for (int c = 0; c < ch; c++) s += BitConverter.ToInt16(wav, start + (i * ch + c) * 2) / 32768.0;
      x[i] = s / ch;
    }
    int first = 0;
    while (first < frames && Math.Abs(x[first]) < 0.01) first++;
    first = Math.Max(0, first - rate / 50);
    double[] y = new double[frames - first];
    Array.Copy(x, first, y, 0, y.Length);

    y = HighPass(y, rate, 70, 0.707);
    y = Peak(y, rate, 150, 1.0, 3);
    y = Peak(y, rate, 400, 1.0, -2);
    y = Peak(y, rate, 3000, 1.0, 2);
    Compress(y, rate, 0.126, 3.0, 0.005, 0.08);
    DeEss(y, rate);
    Reflect(y, rate, 0.020, 0.126);
    Level(y);

    int pre = (int)(Preroll * rate);
    double[] z = new double[pre + y.Length];
    Random r = new Random(7);
    for (int i = 0; i < pre; i++) z[i] = (r.NextDouble() * 2 - 1) * 0.001;
    Array.Copy(y, 0, z, pre, y.Length);

    HalVoice v = new HalVoice();
    v.Seconds = z.Length / (double)rate;
    v.Samples = z;
    v.Rate = rate;
    v.Wav = ToWav(z, rate);
    Envelopes(z, rate, out v.Fast, out v.Slow);
    return v;
  }

  // The house tone under the full haze: generated, not recorded. A 55 Hz ground with
  // overtones at 110, 165 and 220 Hz (laptop speakers need those), soft noise, left and
  // right tuned slightly apart, about 20 dB under the voice. It swells over `lead` seconds
  // before the voice, holds `tail` seconds after it, and falls away in 200 ms. Stereo.
  public byte[] WithHouseTone(double lead, double tail) {
    int r = Rate, L = (int)(lead * r), T = (int)(tail * r), F = (int)(0.2 * r);
    int n = L + Samples.Length + T + F;
    short[] buf = new short[n * 2];
    double amp = 0.035, nl = 0, nr = 0;
    Random rnd = new Random(11);
    for (int i = 0; i < n; i++) {
      double t = (double)i / r, env;
      if (i < L) env = (double)i / Math.Max(1, L);
      else if (i < L + Samples.Length + T) env = 1;
      else env = 1 - (double)(i - L - Samples.Length - T) / F;
      nl = 0.995 * nl + 0.005 * (rnd.NextDouble() * 2 - 1);
      nr = 0.995 * nr + 0.005 * (rnd.NextDouble() * 2 - 1);
      double v = (i >= L && i - L < Samples.Length) ? Samples[i - L] : 0;
      buf[2 * i] = Clip(v + amp * env * (Tone(t, 55.0) + 6 * nl));
      buf[2 * i + 1] = Clip(v + amp * env * (Tone(t, 55.0 * 1.004) + 6 * nr));
    }
    MemoryStream ms = new MemoryStream();
    BinaryWriter w = new BinaryWriter(ms);
    int dataLen = buf.Length * 2;
    w.Write(Encoding.ASCII.GetBytes("RIFF")); w.Write(36 + dataLen);
    w.Write(Encoding.ASCII.GetBytes("WAVEfmt ")); w.Write(16); w.Write((short)1); w.Write((short)2);
    w.Write(r); w.Write(r * 4); w.Write((short)4); w.Write((short)16);
    w.Write(Encoding.ASCII.GetBytes("data")); w.Write(dataLen);
    for (int i = 0; i < buf.Length; i++) w.Write(buf[i]);
    w.Flush();
    return ms.ToArray();
  }

  static double Tone(double t, double f) {
    return 0.5 * Math.Sin(2 * Math.PI * f * t) + 0.3 * Math.Sin(4 * Math.PI * f * t)
         + 0.2 * Math.Sin(6 * Math.PI * f * t) + 0.15 * Math.Sin(8 * Math.PI * f * t);
  }

  static short Clip(double v) { return (short)Math.Max(-32767, Math.Min(32767, v * 32767)); }

  static double[] Biquad(double[] x, double b0, double b1, double b2, double a0, double a1, double a2) {
    double[] y = new double[x.Length];
    double x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
    for (int i = 0; i < x.Length; i++) {
      double o = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = x[i]; y2 = y1; y1 = o; y[i] = o;
    }
    return y;
  }

  static double[] HighPass(double[] x, int rate, double f, double q) {
    double w = 2 * Math.PI * f / rate, cs = Math.Cos(w), al = Math.Sin(w) / (2 * q);
    return Biquad(x, (1 + cs) / 2, -(1 + cs), (1 + cs) / 2, 1 + al, -2 * cs, 1 - al);
  }

  static double[] Peak(double[] x, int rate, double f, double q, double gainDb) {
    if (f >= rate * 0.45) return x;
    double a = Math.Pow(10, gainDb / 40), w = 2 * Math.PI * f / rate, cs = Math.Cos(w), al = Math.Sin(w) / (2 * q);
    return Biquad(x, 1 + al * a, -2 * cs, 1 - al * a, 1 + al / a, -2 * cs, 1 - al / a);
  }

  static void Compress(double[] y, int rate, double threshold, double ratio, double attack, double release) {
    double a = Math.Exp(-1.0 / (attack * rate)), r = Math.Exp(-1.0 / (release * rate)), env = 0;
    for (int i = 0; i < y.Length; i++) {
      double v = Math.Abs(y[i]);
      env = v > env ? a * env + (1 - a) * v : r * env + (1 - r) * v;
      if (env > threshold) y[i] *= Math.Pow(env / threshold, 1.0 / ratio - 1.0);
    }
  }

  static void DeEss(double[] y, int rate) {
    double[] hp = HighPass(y, rate, Math.Min(5500, rate * 0.4), 0.707);
    double a = Math.Exp(-1.0 / (0.001 * rate)), r = Math.Exp(-1.0 / (0.05 * rate)), env = 0, threshold = 0.04;
    for (int i = 0; i < y.Length; i++) {
      double v = Math.Abs(hp[i]);
      env = v > env ? a * env + (1 - a) * v : r * env + (1 - r) * v;
      if (env > threshold) y[i] -= hp[i] * (1 - threshold / env);
    }
  }

  static void Reflect(double[] y, int rate, double delay, double gain) {
    int d = (int)(delay * rate);
    for (int i = y.Length - 1; i >= d; i--) y[i] += gain * y[i - d];
  }

  static void Level(double[] y) {
    double sum = 0, peak = 1e-9; int n = 0;
    for (int i = 0; i < y.Length; i++) {
      double v = Math.Abs(y[i]);
      if (v > peak) peak = v;
      if (v > 0.005) { sum += y[i] * y[i]; n++; }
    }
    double rms = n > 0 ? Math.Sqrt(sum / n) : 0.1;
    double scale = 0.16 / Math.Max(rms, 1e-6);
    if (peak * scale > 0.89) scale = 0.89 / peak;
    for (int i = 0; i < y.Length; i++) y[i] *= scale;
  }

  static byte[] ToWav(double[] z, int rate) {
    MemoryStream ms = new MemoryStream();
    BinaryWriter w = new BinaryWriter(ms);
    int dataLen = z.Length * 2;
    w.Write(System.Text.Encoding.ASCII.GetBytes("RIFF")); w.Write(36 + dataLen);
    w.Write(System.Text.Encoding.ASCII.GetBytes("WAVEfmt ")); w.Write(16); w.Write((short)1); w.Write((short)1);
    w.Write(rate); w.Write(rate * 2); w.Write((short)2); w.Write((short)16);
    w.Write(System.Text.Encoding.ASCII.GetBytes("data")); w.Write(dataLen);
    for (int i = 0; i < z.Length; i++) w.Write((short)Math.Max(-32767, Math.Min(32767, z[i] * 32767)));
    w.Flush();
    return ms.ToArray();
  }

  static void Envelopes(double[] z, int rate, out double[] fast, out double[] slow) {
    int per = Math.Max(1, rate / 100), frames = z.Length / per + 1;
    double[] raw = new double[frames];
    double peak = 1e-9;
    for (int f = 0; f < frames; f++) {
      double sum = 0; int n = 0;
      for (int i = f * per; i < Math.Min(z.Length, (f + 1) * per); i++) { sum += z[i] * z[i]; n++; }
      raw[f] = n > 0 ? Math.Sqrt(sum / n) : 0;
      if (raw[f] > peak) peak = raw[f];
    }
    fast = new double[frames]; slow = new double[frames];
    double a = Math.Exp(-10.0 / 30.0), r = Math.Exp(-10.0 / 180.0), k = 1 - Math.Exp(-2 * Math.PI * 2 * 0.01);
    double e = 0, s = 0;
    for (int f = 0; f < frames; f++) {
      double v = Math.Min(1.0, raw[f] / peak);
      e = v > e ? a * e + (1 - a) * v : r * e + (1 - r) * v;
      s += k * (e - s);
      fast[f] = e; slow[f] = s;
    }
  }
}

// The neural voice, kept warm in a small Python process (hal-voice.py): requests on its stdin,
// answers collected on a background thread. Text goes out ASCII-escaped, so encodings never bite.
public sealed class HalNeural {
  readonly Process p;
  readonly ConcurrentDictionary<string, string> answers = new ConcurrentDictionary<string, string>();
  public volatile bool IsReady;
  public string LastLine = "";

  public HalNeural(string python, string script, string voice, string speed) {
    ProcessStartInfo psi = new ProcessStartInfo(python, "-E -s \"" + script + "\" " + voice + " " + speed);
    psi.UseShellExecute = false; psi.CreateNoWindow = true;
    psi.RedirectStandardInput = true; psi.RedirectStandardOutput = true; psi.RedirectStandardError = true;
    psi.StandardOutputEncoding = Encoding.UTF8;
    p = Process.Start(psi);
    p.StandardInput.AutoFlush = true;
    Thread o = new Thread(ReadOut); o.IsBackground = true; o.Start();
    Thread e = new Thread(ReadErr); e.IsBackground = true; e.Start();
  }

  public bool IsAlive { get { try { return !p.HasExited; } catch { return false; } } }

  void ReadOut() {
    try {
      string line;
      while ((line = p.StandardOutput.ReadLine()) != null) {
        LastLine = line;
        if (line.Contains("\"t\": \"ready\"")) { IsReady = true; continue; }
        int at = line.IndexOf("\"id\": \"");
        if (at < 0) continue;
        int start = at + 7, end = line.IndexOf('"', start);
        if (end > start) answers[line.Substring(start, end - start)] = line;
      }
    } catch { }
  }

  void ReadErr() { try { while (p.StandardError.ReadLine() != null) { } } catch { } }

  static string Escape(string s) {
    StringBuilder b = new StringBuilder();
    foreach (char c in s) {
      if (c == '"' || c == '\\') { b.Append('\\').Append(c); }
      else if (c < 32 || c > 126) { b.AppendFormat("\\u{0:x4}", (int)c); }
      else b.Append(c);
    }
    return b.ToString();
  }

  public void Request(string id, string text) {
    p.StandardInput.WriteLine("{\"id\": \"" + Escape(id) + "\", \"text\": \"" + Escape(text) + "\"}");
  }

  public string Take(string id) { string v; return answers.TryRemove(id, out v) ? v : null; }

  public void Stop() {
    try { p.StandardInput.Close(); if (!p.WaitForExit(1500)) p.Kill(); } catch { }
  }
}

// The ears (hal-ears.py): every stdout line is queued for the dispatcher to pass on.
// Nothing is written to disk: the heard words exist only in these lines.
public sealed class HalEars {
  readonly Process p;
  public readonly ConcurrentQueue<string> Lines = new ConcurrentQueue<string>();

  public HalEars(string python, string args) {
    ProcessStartInfo psi = new ProcessStartInfo(python, args);
    psi.UseShellExecute = false; psi.CreateNoWindow = true;
    psi.RedirectStandardInput = true; psi.RedirectStandardOutput = true; psi.RedirectStandardError = true;
    psi.StandardOutputEncoding = Encoding.UTF8;
    p = Process.Start(psi);
    p.StandardInput.AutoFlush = true;
    Thread o = new Thread(ReadOut); o.IsBackground = true; o.Start();
    Thread e = new Thread(ReadErr); e.IsBackground = true; e.Start();
  }

  public bool IsAlive { get { try { return !p.HasExited; } catch { return false; } } }

  void ReadOut() {
    try { string line; while ((line = p.StandardOutput.ReadLine()) != null) { if (line.Length > 0) Lines.Enqueue(line); } } catch { }
  }

  void ReadErr() { try { while (p.StandardError.ReadLine() != null) { } } catch { } }

  public void Send(string json) { try { p.StandardInput.WriteLine(json); } catch { } }

  public void Stop() {
    try { p.StandardInput.Close(); if (!p.WaitForExit(1500)) p.Kill(); } catch { }
  }
}
"@

# ---------- the voice: Windows OneCore through WinRT, kept warm ----------
$voiceName = $null
$synth = $null
$asTask = $null
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $null = [Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media.SpeechSynthesis, ContentType = WindowsRuntime]
  $generic = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  } | Select-Object -First 1
  $asTask = $generic.MakeGenericMethod([Windows.Media.SpeechSynthesis.SpeechSynthesisStream])
  $all = @([Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices)
  # A fixed order, never a Dutch voice: George, another British man, an American man.
  $pick = @(
    $all | Where-Object { $_.DisplayName -like '*George*' }
    $all | Where-Object { $_.Language -eq 'en-GB' -and "$($_.Gender)" -eq 'Male' }
    $all | Where-Object { $_.Language -eq 'en-US' -and "$($_.Gender)" -eq 'Male' }
  ) | Select-Object -First 1
  if ($pick) {
    $synth = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer
    $synth.Voice = $pick
    $voiceName = $pick.DisplayName
  }
} catch { $synth = $null }

# The neural voice, when it is set up on this machine: the chosen Piper voice; else Kokoro
# (the chosen Kokoro voice, or am_michael in place of a Piper voice that is missing).
$neural = $null
$neuralStartedMs = 0
$neuralMissing = @()
$neuralNote = ''
$neuralPython = Join-Path $env:LOCALAPPDATA 'hal\venv\Scripts\python.exe'
$neuralScript = Join-Path $PSScriptRoot 'hal-voice.py'
$models = Join-Path $env:LOCALAPPDATA 'hal\models'
$neuralVoice = $null
$isKokoroName = $Voice -match '^[a-z]{2}_[a-z]+$'
if (-not $isKokoroName -and (Test-Path -LiteralPath (Join-Path $models "piper\$Voice\$Voice.onnx"))) {
  $neuralVoice = $Voice; $voiceLabel = "$Voice (Piper)"
} elseif (Test-Path -LiteralPath (Join-Path $models 'kokoro\kokoro-multi-lang-v1_0\model.onnx')) {
  $neuralVoice = $(if ($isKokoroName) { $Voice } else { 'am_michael' }); $voiceLabel = "$neuralVoice (Kokoro)"
  if (-not $isKokoroName) { $neuralNote = " ($Voice is not set up)" }
} else { $neuralMissing += "the voice $Voice" }
if (-not (Test-Path -LiteralPath $neuralPython)) { $neuralMissing += 'the Python environment' }
if (-not $isTool -and $neuralMissing.Count -eq 0) {
  try {
    $neural = New-Object HalNeural ($neuralPython, $neuralScript, $neuralVoice, $Speed.ToString([Globalization.CultureInfo]::InvariantCulture))
    $neuralStartedMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $voiceName = $voiceLabel
  } catch { $neural = $null; $neuralMissing += "a start ($_)" }
}

function Start-Synthesis([string]$text) {
  $lang = $synth.Voice.Language
  $safe = [Security.SecurityElement]::Escape($text)
  # "..." before the true detail becomes real silence.
  $safe = $safe -replace '\s*(\.\.\.|…)\s*', " <break time='700ms'/> "
  $ssml = "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='$lang'><prosody rate='-12%' pitch='-8%'>$safe</prosody></speak>"
  $asTask.Invoke($null, @($synth.SynthesizeSsmlToStreamAsync($ssml)))
}

# A line goes to the neural voice when it is there; otherwise to the Windows voice.
function Start-Voice([string]$text, [string]$id) {
  if ($neural -and $neural.IsAlive) { $neural.Request($id, $text); return @{ kind = 'neural'; id = $id } }
  if ($synth) { return @{ kind = 'winrt'; task = (Start-Synthesis $text) } }
  $null
}

# @{ done; voice }: voice is $null when the voice failed (then only the haze and the subtitle).
function Get-VoiceResult($job) {
  if ($job.kind -eq 'winrt') {
    if (-not $job.task.IsCompleted) { return @{ done = $false } }
    if ($job.task.IsFaulted) { return @{ done = $true; voice = $null } }
    return @{ done = $true; voice = (Read-Synthesis $job.task) }
  }
  $line = $neural.Take($job.id)
  if (-not $line) {
    if (-not $neural.IsAlive) { Emit @{ t = 'error'; why = 'the neural voice stopped' }; return @{ done = $true; voice = $null } }
    return @{ done = $false }
  }
  $answer = $line | ConvertFrom-Json
  if ($answer.t -ne 'done') { Emit @{ t = 'error'; why = "voice: $($answer.why)" }; return @{ done = $true; voice = $null } }
  $bytes = [IO.File]::ReadAllBytes($answer.path)
  Remove-Item -LiteralPath $answer.path -Force -ErrorAction SilentlyContinue
  @{ done = $true; voice = [HalVoice]::Process($bytes) }
}

# A line that cannot sound within 5 s is dropped; while the neural voice is still loading, 20 s.
function Get-LateMs {
  if ($neural -and -not $neural.IsReady -and (NowMs) - $neuralStartedMs -lt 30000) { return 20000 }
  5000
}

function Read-Synthesis($task) {
  $net = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($task.Result)
  $ms = New-Object System.IO.MemoryStream
  $net.CopyTo($ms)
  [HalVoice]::Process($ms.ToArray())
}

if ($ProcessDir) {
  New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
  foreach ($f in Get-ChildItem -LiteralPath $ProcessDir -Filter '*.wav' -File) {
    $v = [HalVoice]::Process([IO.File]::ReadAllBytes($f.FullName))
    [IO.File]::WriteAllBytes((Join-Path $OutDir $f.Name), $v.Wav)
  }
  exit 0
}
if ($RenderText) {
  if (-not $synth) { Emit @{ t = 'error'; why = 'no voice' }; exit 1 }
  $task = Start-Synthesis $RenderText
  $task.Wait()
  [IO.File]::WriteAllBytes($OutWav, (Read-Synthesis $task).Wav)
  exit 0
}

# ---------- the haze: one window per monitor ----------
Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase, System.Windows.Forms

$eyeXaml = @"
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        WindowStyle="None" AllowsTransparency="True" Background="Transparent"
        Topmost="True" ShowInTaskbar="False" ShowActivated="False" Focusable="False"
        ResizeMode="NoResize" Opacity="0" Width="100" Height="100">
  <Grid IsHitTestVisible="False">
    <Rectangle x:Name="Haze"/>
    <Canvas x:Name="Stage">
      <Canvas x:Name="EyeGroup">
        <Canvas.RenderTransform><ScaleTransform x:Name="EyeScale" ScaleX="1" ScaleY="1"/></Canvas.RenderTransform>
        <Ellipse x:Name="Bloom" Width="1000" Height="1000" Canvas.Left="-500" Canvas.Top="-500" Opacity="0.3">
          <Ellipse.Fill>
            <RadialGradientBrush>
              <GradientStop Color="#D0FF2400" Offset="0"/>
              <GradientStop Color="#60B00000" Offset="0.32"/>
              <GradientStop Color="#00000000" Offset="1"/>
            </RadialGradientBrush>
          </Ellipse.Fill>
        </Ellipse>
        <Canvas x:Name="Ticks">
          <Canvas.RenderTransform><RotateTransform x:Name="Spin" Angle="0"/></Canvas.RenderTransform>
        </Canvas>
        <Ellipse Width="350" Height="350" Canvas.Left="-175" Canvas.Top="-175" Stroke="#FF000000" StrokeThickness="2">
          <Ellipse.Effect><DropShadowEffect Color="#FF000000" BlurRadius="40" ShadowDepth="0" Opacity="0.9"/></Ellipse.Effect>
          <Ellipse.Fill>
            <RadialGradientBrush GradientOrigin="0.35,0.3">
              <GradientStop Color="#FF3C3C42" Offset="0"/>
              <GradientStop Color="#FF1C1C20" Offset="0.8"/>
              <GradientStop Color="#FF0A0A0C" Offset="1"/>
            </RadialGradientBrush>
          </Ellipse.Fill>
        </Ellipse>
        <Ellipse Width="306" Height="306" Canvas.Left="-153" Canvas.Top="-153" Fill="#FF040404" Stroke="#FFB31212" StrokeThickness="1.5"/>
        <!-- The iris: its heat sits in a ring around the aperture; the brush is set in code. -->
        <Ellipse x:Name="Iris" Width="280" Height="280" Canvas.Left="-140" Canvas.Top="-140" Opacity="0.9"/>
        <!-- Seven diaphragm blades around a dark heptagonal aperture; built and moved in code. -->
        <Canvas x:Name="Diaphragm"/>
        <Path Stroke="#26FFFFFF" StrokeThickness="5" StrokeStartLineCap="Round" StrokeEndLineCap="Round" Data="M -105,-62 A 122,122 0 0 1 -30,-118"/>
      </Canvas>
      <Ellipse x:Name="Spark" Width="40" Height="40" Opacity="0">
        <Ellipse.Fill>
          <RadialGradientBrush>
            <GradientStop Color="#FFFFF1DC" Offset="0"/>
            <GradientStop Color="#FFFF5A1F" Offset="0.25"/>
            <GradientStop Color="#00E0301A" Offset="1"/>
          </RadialGradientBrush>
        </Ellipse.Fill>
      </Ellipse>
      <TextBlock x:Name="Line" TextAlignment="Center" TextWrapping="Wrap" FontFamily="Segoe UI Light" FontSize="24" Foreground="#FFEADBD6" Opacity="0">
        <TextBlock.Effect><DropShadowEffect Color="#FF7A0000" BlurRadius="18" ShadowDepth="0" Opacity="1"/></TextBlock.Effect>
      </TextBlock>
    </Canvas>
  </Grid>
</Window>
"@

$script:systemScale = 1.0
try { $g = [System.Drawing.Graphics]::FromHwnd([IntPtr]::Zero); $script:systemScale = $g.DpiX / 96.0; $g.Dispose() } catch { }

function New-HazeWindow($screen) {
  $win = [Windows.Markup.XamlReader]::Parse($eyeXaml)
  $p = @{ win = $win; screen = $screen; monitor = [IntPtr]::Zero }
  foreach ($n in 'Haze', 'EyeGroup', 'EyeScale', 'Bloom', 'Ticks', 'Spin', 'Iris', 'Diaphragm', 'Spark', 'Line') { $p[$n] = $win.FindName($n) }

  # Iris: dark at the aperture, a narrow hot ring just outside it, falling off to deep red.
  $p.irisBrush = New-Object System.Windows.Media.RadialGradientBrush
  foreach ($stop in @(@('#FF050101', 0), @('#FF050101', 0.2), @('#FFFFF1DC', 0.22), @('#FFFF5A1F', 0.28), @('#FFE0301A', 0.4), @('#FF7A0A06', 0.65), @('#FF160403', 1))) {
    [void]$p.irisBrush.GradientStops.Add((New-Object System.Windows.Media.GradientStop ([System.Windows.Media.ColorConverter]::ConvertFromString($stop[0])), $stop[1]))
  }
  $p.Iris.Fill = $p.irisBrush

  # Seven blades, the aperture they leave, and its glowing rim.
  $bladeFill = New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.Color]::FromArgb(0xB4, 0x14, 0x03, 0x03))
  $bladeEdge = New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.Color]::FromArgb(0x55, 0xFF, 0x4A, 0x1A))
  $p.blades = @()
  for ($k = 0; $k -lt 7; $k++) {
    $blade = New-Object System.Windows.Shapes.Polygon
    $blade.Fill = $bladeFill; $blade.Stroke = $bladeEdge; $blade.StrokeThickness = 1.2
    [void]$p.Diaphragm.Children.Add($blade); $p.blades += $blade
  }
  $p.aperture = New-Object System.Windows.Shapes.Polygon
  $p.aperture.Fill = New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.Color]::FromArgb(255, 4, 1, 1))
  [void]$p.Diaphragm.Children.Add($p.aperture)
  $p.rim = New-Object System.Windows.Shapes.Polygon
  $p.rim.Stroke = New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.Color]::FromArgb(255, 0xFF, 0x5A, 0x1F))
  $p.rim.StrokeThickness = 2.5
  $glow = New-Object System.Windows.Media.Effects.DropShadowEffect
  $glow.Color = [System.Windows.Media.Color]::FromArgb(255, 0xFF, 0x3A, 0x12); $glow.BlurRadius = 14; $glow.ShadowDepth = 0; $glow.Opacity = 1
  $p.rim.Effect = $glow
  [void]$p.Diaphragm.Children.Add($p.rim)
  Set-Diaphragm $p 0.55 0.0 0.0 0.0
  $p.hazeBrush = New-Object System.Windows.Media.RadialGradientBrush
  $p.hazeBrush.MappingMode = 'Absolute'
  foreach ($o in 0, 0.25, 1) { [void]$p.hazeBrush.GradientStops.Add((New-Object System.Windows.Media.GradientStop ([System.Windows.Media.Colors]::Transparent), $o)) }
  $p.Haze.Fill = $p.hazeBrush

  $red = New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.Color]::FromArgb(255, 210, 30, 20))
  for ($k = 0; $k -lt 72; $k++) {
    $isLong = ($k % 6 -eq 0)
    $h = 8; if ($isLong) { $h = 18 }
    $r = New-Object System.Windows.Shapes.Rectangle
    $r.Width = 2; $r.Height = $h; $r.Fill = $red
    $r.Opacity = 0.45; if ($isLong) { $r.Opacity = 0.95 }
    [System.Windows.Controls.Canvas]::SetLeft($r, -1)
    [System.Windows.Controls.Canvas]::SetTop($r, -200)
    $r.RenderTransform = New-Object System.Windows.Media.RotateTransform (($k * 5), 1, 200)
    [void]$p.Ticks.Children.Add($r)
  }

  # Park the window inside its monitor, then maximise: the monitor decides the size, not DPI arithmetic.
  $b = $screen.Bounds
  $win.Left = ($b.X + $b.Width / 2) / $script:systemScale - 50
  $win.Top = ($b.Y + $b.Height / 2) / $script:systemScale - 50
  # Handlers find their parts through Tag: a closure would hide this script's functions
  # when the script is called from another one (hal.ps1).
  $win.Tag = $p
  $win.Add_SourceInitialized({
      $hwnd = (New-Object System.Windows.Interop.WindowInteropHelper $this).Handle
      [HalNative]::ClickThrough($hwnd)
    })
  $win.Add_SizeChanged({ Set-Layout $this.Tag })
  $p
}

# The diaphragm: `open` 0.1 (nearly shut) .. 1 (wide); the aperture is a heptagon whose
# blades swirl out to the iris edge. gx/gy shift it with the gaze; `rot` turns it slowly.
function Set-Diaphragm($p, [double]$open, [double]$gx, [double]$gy, [double]$rot) {
  $ra = 18 + 52 * [Math]::Max(0.1, [Math]::Min(1.0, [double]$open))
  $R = 140; $swirl = 0.55; $step = 2 * [Math]::PI / 7
  $ox = $gx * 14; $oy = $gy * 14
  $inner = @(); $outer = @()
  for ($k = 0; $k -lt 7; $k++) {
    $a = $rot + $k * $step
    $inner += New-Object System.Windows.Point (($ox + $ra * [Math]::Cos($a)), ($oy + $ra * [Math]::Sin($a)))
    $outer += New-Object System.Windows.Point (($R * [Math]::Cos($a + $swirl)), ($R * [Math]::Sin($a + $swirl)))
  }
  for ($k = 0; $k -lt 7; $k++) {
    $n = ($k + 1) % 7
    $pts = New-Object System.Windows.Media.PointCollection
    $pts.Add($inner[$k]); $pts.Add($inner[$n]); $pts.Add($outer[$n]); $pts.Add($outer[$k])
    $p.blades[$k].Points = $pts
  }
  $hole = New-Object System.Windows.Media.PointCollection
  foreach ($pt in $inner) { $hole.Add($pt) }
  $p.aperture.Points = $hole
  $p.rim.Points = $hole
  # The hot ring follows the aperture's size.
  $a0 = $ra / $R
  $stops = $p.irisBrush.GradientStops
  $stops[1].Offset = [Math]::Max(0.01, $a0 - 0.02); $stops[2].Offset = $a0; $stops[3].Offset = $a0 + 0.07
  $stops[4].Offset = $a0 + 0.2; $stops[5].Offset = [Math]::Min(0.95, $a0 + 0.45)
  $c = New-Object System.Windows.Point ((0.5 + $ox / 280), (0.5 + $oy / 280))
  $p.irisBrush.Center = $c; $p.irisBrush.GradientOrigin = $c
}

function Set-Layout($p) {
  $w = $p.win.ActualWidth; $h = $p.win.ActualHeight
  if ($w -lt 10 -or $h -lt 10) { return }
  # The eye is 30% of the short side, between 220 and 420 DIP; its design size is 350.
  $d = [Math]::Max(220.0, [Math]::Min(420.0, 0.3 * [Math]::Min([double]$w, [double]$h)))
  $p.baseScale = $d / 350
  $cx = $w / 2; $cy = $h / 2 - 0.04 * $h
  $p.cx = $cx; $p.cy = $cy
  [System.Windows.Controls.Canvas]::SetLeft($p.EyeGroup, $cx)
  [System.Windows.Controls.Canvas]::SetTop($p.EyeGroup, $cy)
  $p.EyeScale.ScaleX = $p.baseScale; $p.EyeScale.ScaleY = $p.baseScale
  [System.Windows.Controls.Canvas]::SetLeft($p.Spark, $cx - 20)
  [System.Windows.Controls.Canvas]::SetTop($p.Spark, $cy - 20)
  $p.hazeBrush.Center = New-Object System.Windows.Point ($cx, $cy)
  $p.hazeBrush.GradientOrigin = $p.hazeBrush.Center
  $p.hazeBrush.RadiusX = 0.71 * $w; $p.hazeBrush.RadiusY = 0.71 * $h
  $lw = [Math]::Min(1100.0, $w * 0.8)
  $p.Line.Width = $lw
  [System.Windows.Controls.Canvas]::SetLeft($p.Line, $cx - $lw / 2)
  [System.Windows.Controls.Canvas]::SetTop($p.Line, $cy + $d * 0.62 + 24)
}

# Note: PowerShell picks [Math]::Min/Max's integer overload when the first argument is an
# integer literal, and then rounds the second. Every literal here is written as a double.
function Set-Strength($p, [double]$strength) {
  $p.alpha = 255.0 * [Math]::Min(1.0, [Math]::Max(0.0, $strength))
}

function ToByte([double]$value) {
  if ([double]::IsNaN($value)) { return [byte]0 }
  [byte][Math]::Round([Math]::Max(0.0, [Math]::Min(255.0, $value)))
}

# The haze: `edge` darkens the rim of the screen, `center` the middle; both 0..1.
function Set-Haze($p, [double]$edge, [double]$center) {
  $a = [double]$p.alpha
  if ([double]::IsNaN($edge) -or [double]::IsNaN($center)) { Emit @{ t = 'error'; why = "haze NaN edge=$edge center=$center at $((Get-PSCallStack | Select-Object -Skip 1 -First 3 | ForEach-Object { $_.Location }) -join ' < ')" } }
  $stops = $p.hazeBrush.GradientStops
  $stops[0].Color = [System.Windows.Media.Color]::FromArgb((ToByte ($a * 0.55 * $center)), 0x3A, 0, 0)
  $stops[1].Color = [System.Windows.Media.Color]::FromArgb((ToByte ($a * 0.50 * $center)), 0x1A, 0, 0)
  $stops[2].Color = [System.Windows.Media.Color]::FromArgb((ToByte ($a * 0.80 * $edge)), 0, 0, 0)
}

function Get-Windows {
  $screens = [System.Windows.Forms.Screen]::AllScreens
  $key = ($screens | ForEach-Object { "$($_.Bounds)" }) -join ';'
  if ($script:S.screensKey -ne $key) {
    foreach ($old in $script:S.windows) { try { $old.win.Close() } catch { } }
    $script:S.windows = @($screens | ForEach-Object { New-HazeWindow $_ })
    $script:S.screensKey = $key
  }
  $script:S.windows
}

# ---------- the loop ----------
# One line runs through four phases:
#   enter  the haze creeps in from the edges, a point of light, the iris opens toward you;
#          the voice never starts before 2.0 s, plus the pause the mod asked for
#   speak  the voice; the aperture holds, only its rim follows the voice
#   stare  2 s of staring after the last word (3 s for the wordless eye)
#   exit   1.8 s: the iris closes, the centre clears first, the edges last, a red point fades
# Keys never cut a line short: the guest's typing goes on underneath the click-through haze and is only counted.
$script:S = @{
  queue = New-Object System.Collections.ArrayList
  item = $null; phase = 'idle'; windows = @(); screensKey = ''
  clock = [Diagnostics.Stopwatch]::StartNew(); t0 = 0.0
  task = $null; voice = $null; player = $null; voiceReadyT = $null
  isHaze = $false; isEyeOnly = $false; pause = 0.0
  speakAt = $null; speakStart = 0.0; stareStart = 0.0; stareLength = 2.0
  exitStart = 0.0; exitLength = 1.8; exitEvent = 'done'; exitWhy = ''
  interruptedAt = $null; lastLevelAt = 0.0; vis = $null
  gaze = @{ x = 0.0; y = 0.0; nx = 0.0; ny = 0.0; dartUntil = 0.0; nextDart = 0.0; dx = 0.0; dy = 0.0 }
  started = (NowMs); lastLatencyMs = $null; lastSynthMs = $null; lastCpuPct = $null
  cpuAt = $null; synthStartMs = 0
  # A conversation: the haze and the eye stay between his lines ('hold') until the mod ends it.
  presence = $false; presenceStrength = 0.5
}
$rnd = New-Object System.Random
$clamp = { param($v) [Math]::Max(0.0, [Math]::Min(1.0, [double]$v)) }

function Start-Next {
  if ($script:S.queue.Count -eq 0) { return }
  $S = $script:S
  $item = $S.queue[0]; $S.queue.RemoveAt(0)
  if ((NowMs) - [int64]$item.at -gt (Get-LateMs)) { Emit @{ t = 'dropped'; id = $item.id; why = 'late' }; Start-Next; return }
  $wasHolding = $S.phase -eq 'hold'
  $S.item = $item
  $S.isEyeOnly = [bool]$item.eyeOnly
  # A line that starts from the hold stays in the haze, also his last one after "stop".
  $S.isHaze = [bool]$item.haze -or $S.isEyeOnly -or $S.presence -or $wasHolding
  $S.pause = 0.0; if ($item.pauseMs) { $S.pause = [double]$item.pauseMs / 1000 }
  $S.t0 = $S.clock.Elapsed.TotalSeconds
  # In a conversation the eye is already there: no new entrance, he only looks a moment longer.
  if ($wasHolding) { $S.t0 -= 1.4 }
  $S.voice = $null; $S.voiceReadyT = $null; $S.speakAt = $null; $S.interruptedAt = $null
  $S.exitEvent = 'done'; $S.exitWhy = ''
  $S.synthStartMs = NowMs
  $S.job = $null; $S.wav = $null; $S.lead = 0.0; $S.isPlayed = $false
  # The subtitle shows one phrase at a time, timed by its share of the letters.
  $S.phrases = @(([string]$item.text -split '(?<=[,.;:?…])\s+') | Where-Object { $_.Trim() })
  if ($S.phrases.Count -eq 0) { $S.phrases = @('') }
  $S.phraseAt = @(); $total = [Math]::Max(1.0, [double]([string]$item.text).Length); $sum = 0.0
  foreach ($ph in $S.phrases) { $S.phraseAt += $sum / $total; $sum += $ph.Length + 1 }
  $S.phrase = 0
  if (-not $S.isEyeOnly -and $item.text) { $S.job = Start-Voice ([string]$item.text) ([string]$item.id) }
  $null = [HalNative]::AnyKeyDown()   # forget keys pressed before this line
  $S.cpuAt = @{ cpu = (Get-Process -Id $PID).TotalProcessorTime.TotalMilliseconds; at = $S.clock.Elapsed.TotalMilliseconds }
  if ($S.isHaze -and $wasHolding) {
    foreach ($p in $S.windows) { if ($p.Line.Visibility -eq 'Visible') { $p.Line.Text = [string]$S.phrases[0]; $p.Line.Opacity = 0 } }
  } elseif ($S.isHaze) {
    $active = [HalNative]::ActiveMonitor()
    $windows = @(Get-Windows)
    $strength = [double]$item.strength; if ($S.presence) { $strength = $S.presenceStrength }
    foreach ($p in $windows) {
      Set-Strength $p $strength
      Set-Haze $p 0 0
      $p.Line.Text = [string]$S.phrases[0]
      $p.Line.Opacity = 0; $p.Spark.Opacity = 0; $p.EyeGroup.Opacity = 0
      $p.win.Opacity = 1
      if (-not $p.win.IsVisible) { $p.win.Show(); $p.win.WindowState = 'Maximized' }
      if ($p.monitor -eq [IntPtr]::Zero) { $p.monitor = [HalNative]::MonitorOf((New-Object System.Windows.Interop.WindowInteropHelper $p.win).Handle) }
      $isActive = ($p.monitor -eq $active) -or ($windows.Count -eq 1)
      $vis = 'Collapsed'; if ($isActive) { $vis = 'Visible' }
      $p.EyeGroup.Visibility = $vis; $p.Line.Visibility = $vis; $p.Spark.Visibility = $vis
    }
  }
  Emit @{ t = 'enter'; id = $item.id; haze = $S.isHaze }
  Send-Ears '{"gate": true}'   # HAL does not hear himself
  $S.phase = 'enter'
  $script:anim.Start()
}

function Start-Exit([double]$t, [double]$length, [string]$event, [string]$why) {
  $S = $script:S
  $S.phase = 'exit'; $S.exitStart = $t; $S.exitLength = $length
  $S.exitEvent = $event; $S.exitWhy = $why
  if ($S.player -and $event -eq 'dropped') { try { $S.player.Stop() } catch { } }
}

# A line is done inside a conversation: the eye stays and holds the guest; his ears open again.
function Enter-Hold([string]$why) {
  $S = $script:S
  $msg = @{ t = 'done'; id = $S.item.id }
  if ($why) { $msg.why = $why }
  Emit $msg
  Send-Ears '{"gate": false}'
  foreach ($p in $S.windows) { $p.Line.Text = ''; $p.Line.Opacity = 0 }
  $S.item = $null; $S.player = $null; $S.isEyeOnly = $false; $S.isHaze = $true
  $S.phase = 'hold'; $S.holdStart = $S.clock.Elapsed.TotalSeconds - $S.t0
  if ($S.queue.Count -gt 0) { Start-Next }
}

function Stop-Line {
  $S = $script:S
  foreach ($p in $S.windows) { if ($p.win.IsVisible) { $p.win.Hide() } }
  if ($S.cpuAt) {
    $cpu = (Get-Process -Id $PID).TotalProcessorTime.TotalMilliseconds - $S.cpuAt.cpu
    $ms = $S.clock.Elapsed.TotalMilliseconds - $S.cpuAt.at
    if ($ms -gt 0) { $S.lastCpuPct = [Math]::Round(100 * $cpu / $ms, 1) }
  }
  $msg = @{ t = $S.exitEvent; id = $S.item.id }
  if ($S.exitWhy) { $msg.why = $S.exitWhy }
  Emit $msg
  Send-Ears '{"gate": false}'
  $S.phase = 'idle'; $S.item = $null; $S.player = $null
  $script:anim.Stop()
  if ($isOneShot -and $S.queue.Count -eq 0) { [System.Windows.Threading.Dispatcher]::CurrentDispatcher.InvokeShutdown(); return }
  Start-Next
}

# What the haze and the eye look like at time t of the current line.
function Get-Visual([double]$t, [double]$fast) {
  $S = $script:S
  $v = @{ edge = 1.0; center = 1.0; eye = 1.0; scale = 1.0; open = 0.55; spark = 0.0; line = 0.0; mode = 'speaking' }
  switch ($S.phase) {
    'enter' {
      $v.edge = & $clamp ($t / 0.5)
      $v.center = & $clamp (($t - 0.3) / 0.7)
      if ($t -ge 0.5) { if ($t -lt 0.65) { $v.spark = ($t - 0.5) / 0.15 } else { $v.spark = & $clamp (1 - ($t - 0.65) / 0.75) } }
      $k = & $clamp (($t - 0.6) / 0.8)
      $v.eye = $k; $v.scale = 0.92 + 0.08 * $k
      $v.open = 0.1 + 0.25 * $k
      $v.mode = 'atYou'
    }
    'speak' {
      $v.open = 0.4   # held: only the rim follows the voice
      $v.line = 0.85 * (& $clamp (($t - $S.speakStart) / 0.8))
    }
    'stare' {
      $v.open = 0.35; $v.mode = 'atYou'
      if (-not $S.isEyeOnly) { $v.line = 0.85 }
    }
    'hold' {
      # Waiting for the guest: it looks straight at them, the aperture narrows slowly the
      # longer they say nothing (at most a third narrower after a minute), no subtitle.
      $since = $t - [double]$S.holdStart
      $v.open = 0.35 - 0.12 * (& $clamp ($since / 60.0)); $v.mode = 'atYou'; $v.line = 0.0
    }
    'exit' {
      # PowerShell names ignore case: never call a local $s next to the state $S.
      $since = $t - $S.exitStart
      if ($S.exitLength -lt 1) {
        # The quick way out: everything fades from where it was.
        $last = $S.vis; if (-not $last) { $last = $v }
        $k = 1 - (& $clamp ($since / $S.exitLength))
        $v = @{ edge = $last.edge * $k; center = $last.center * $k; eye = $last.eye * $k; scale = $last.scale; open = $last.open; spark = 0.0; line = $last.line * $k; mode = $last.mode }
        return $v
      }
      $v.open = 0.35 - 0.25 * (& $clamp ($since / 0.6))
      $v.center = 1 - (& $clamp ($since / 1.0))
      $v.edge = 1 - (& $clamp (($since - 0.6) / 1.2))
      $v.eye = 1 - (& $clamp (($since - 0.3) / 0.6))
      if ($since -ge 0.6) { if ($since -lt 0.8) { $v.spark = ($since - 0.6) / 0.2 } else { $v.spark = & $clamp (1 - ($since - 0.8) / 1.0) } }
      $v.line = 0.85 * (1 - (& $clamp ($since / 0.5)))
      if ($S.isEyeOnly) { $v.line = 0 }
      $v.mode = 'atYou'
    }
  }
  $v
}

function Update-Eye([double]$t, [double]$fast, [double]$slow, $v) {
  $gz = $script:S.gaze
  # Where he looks: straight at you, or past you (6% of the iris radius to the upper left)
  # with brief darts away while he speaks. Chance decides the darts, never the looking at you.
  $tx = 0.0; $ty = 0.0
  if ($v.mode -ne 'atYou') {
    $tx = -0.42; $ty = -0.42
    if ($t -ge $gz.nextDart) {
      $ang = $rnd.NextDouble() * 2 * [Math]::PI; $reach = 0.5 + 0.4 * $rnd.NextDouble()
      $gz.dx = [Math]::Cos($ang) * $reach; $gz.dy = [Math]::Sin($ang) * $reach * 0.6
      $gz.dartUntil = $t + 0.3 + 0.2 * $rnd.NextDouble()
      $gz.nextDart = $t + 3.0 + 3.0 * $rnd.NextDouble()
    }
    if ($t -lt $gz.dartUntil) { $tx = $gz.dx; $ty = $gz.dy }
  }
  # Saccades are fast (two frames), then the gaze holds; a small smoothed tremor stays.
  $gz.x += ($tx - $gz.x) * 0.7; $gz.y += ($ty - $gz.y) * 0.7
  $gz.nx = 0.8 * $gz.nx + 0.04 * ($rnd.NextDouble() - 0.5); $gz.ny = 0.8 * $gz.ny + 0.04 * ($rnd.NextDouble() - 0.5)
  $gx = $gz.x + $gz.nx; $gy = $gz.y + $gz.ny
  # The breath is asymmetric: 40% in, 60% out, over 5.5 s.
  $phase = ($t % 5.5) / 5.5
  if ($phase -lt 0.4) { $breath = [Math]::Sin([Math]::PI / 2 * $phase / 0.4) } else { $breath = [Math]::Cos([Math]::PI / 2 * ($phase - 0.4) / 0.6) }
  # Flash-safe: large areas move at most +-0.12 around their base, from the slow envelope only.
  $wave = 0.4 * ($breath - 0.5) * 2 + 0.6 * ($slow * 2 - 1)
  $focus = 0.0; if ($v.mode -eq 'atYou') { $focus = 0.15 }
  foreach ($p in $script:S.windows) {
    if ($p.EyeGroup.Visibility -ne 'Visible') { continue }
    Set-Haze $p $v.edge $v.center
    $p.EyeGroup.Opacity = $v.eye
    $scale = $p.baseScale * $v.scale
    $p.EyeScale.ScaleX = $scale; $p.EyeScale.ScaleY = $scale
    $p.Spark.Opacity = $v.spark
    $p.Line.Opacity = $v.line
    $p.Bloom.Opacity = 0.32 + 0.12 * $wave
    $p.Iris.Opacity = 0.86 + 0.1 * $wave
    Set-Diaphragm $p $v.open $gx $gy ($t * 0.05)
    # Only the narrow rim follows the voice quickly; it is brighter while it looks at you.
    $p.rim.Opacity = [Math]::Min(1.0, 0.5 + $focus + 0.45 * $fast)
    $p.Spin.Angle = $t * 3
  }
  foreach ($p in $script:S.windows) {
    if ($p.EyeGroup.Visibility -eq 'Visible') { continue }
    Set-Haze $p $v.edge $v.center
  }
}

$script:anim = New-Object System.Windows.Threading.DispatcherTimer
# 30 frames a second: half the CPU of 60, and still smooth for a slow eye.
$script:anim.Interval = [TimeSpan]::FromMilliseconds(33)
$script:anim.Add_Tick({
    try {
      $S = $script:S
      if ($S.phase -eq 'idle') { $script:anim.Stop(); return }
      $item = $S.item
      $t = $S.clock.Elapsed.TotalSeconds - $S.t0
      $isKeyed = [HalNative]::AnyKeyDown() -and -not $IgnoreKeys
      $fast = 0.0; $slow = 0.0

      switch ($S.phase) {
        'enter' {
          if ($S.job -and $null -eq $S.voiceReadyT) {
            $result = Get-VoiceResult $S.job
            if ($result.done) {
              $S.voice = $result.voice
              $S.voiceReadyT = $t
              $S.lastSynthMs = (NowMs) - $S.synthStartMs
              if ($S.voice -and $S.isHaze) { $S.wav = $S.voice.WithHouseTone(0.8, 0.5); $S.lead = 0.8 }
              elseif ($S.voice) { $S.wav = $S.voice.Wav; $S.lead = 0.0 }
            }
          }
          $isReady = $S.isEyeOnly -or (-not $S.job) -or ($null -ne $S.voiceReadyT)
          if ($isReady -and $null -eq $S.speakAt) {
            # The iris is open at 1.4 s; he looks for 0.6 s more before the first word.
            $minT = 0.0; if ($S.isHaze) { $minT = 2.0 }
            $readyT = $t; if ($null -ne $S.voiceReadyT) { $readyT = $S.voiceReadyT }
            $S.speakAt = [Math]::Max($minT, $readyT) + $S.pause
          }
          # Keys never send him away: the guest types on, the eye stays. Only counted.
          if ($isKeyed -and $null -eq $S.interruptedAt) { $S.interruptedAt = $t }
          if ($null -eq $S.speakAt -and (NowMs) - [int64]$item.at -gt (Get-LateMs)) { Start-Exit $t 0.3 'dropped' 'late'; break }
          # The house tone swells in ahead of the first word: playback starts `lead` early.
          if ($S.wav -and -not $S.isPlayed -and $null -ne $S.speakAt -and $t -ge $S.speakAt - $S.lead) {
            $S.player = New-Object System.Media.SoundPlayer (New-Object System.IO.MemoryStream (, $S.wav))
            $S.player.Play()
            $S.isPlayed = $true
          }
          if ($null -ne $S.speakAt -and $t -ge $S.speakAt) {
            if ($S.isEyeOnly) { $S.phase = 'stare'; $S.stareStart = $t; $S.stareLength = 3.0; break }
            if ($S.voice) { $S.lastLatencyMs = (NowMs) + [int](1000 * [HalVoice]::Preroll) - [int64]$item.at }
            $S.speakStart = $t; $S.lastLevelAt = 0.0
            Emit @{ t = 'speaking'; id = $item.id; latencyMs = $S.lastLatencyMs }
            $S.phase = 'speak'
          }
        }
        'speak' {
          $u = $t - $S.speakStart
          $seconds = [Math]::Max(3.5, ([string]$item.text).Length / 14.0)
          if ($S.voice) { $seconds = $S.voice.Seconds; $fast = $S.voice.FastAt($u); $slow = $S.voice.SlowAt($u) }
          if ($isKeyed -and $null -eq $S.interruptedAt) { $S.interruptedAt = $t }
          if ($u - $S.lastLevelAt -ge 0.04) { $S.lastLevelAt = $u; Emit @{ t = 'level'; v = [Math]::Round($fast, 2) } }
          $k = $S.phrases.Count - 1
          while ($k -gt 0 -and $u / [Math]::Max(0.1, $seconds) -lt $S.phraseAt[$k]) { $k-- }
          if ($k -ne $S.phrase) {
            $S.phrase = $k
            foreach ($p in $S.windows) { if ($p.Line.Visibility -eq 'Visible') { $p.Line.Text = [string]$S.phrases[$k] } }
          }
          if ($u -ge $seconds) {
            Emit @{ t = 'level'; v = 0 }
            $S.phase = 'stare'; $S.stareStart = $t; $S.stareLength = 2.0
          }
        }
        'stare' {
          if ($t - $S.stareStart -ge $S.stareLength) {
            $why = ''; if ($null -ne $S.interruptedAt) { $why = 'interrupted' }
            if ($S.presence) { Enter-Hold $why; break }
            Start-Exit $t 1.8 'done' $why
          }
        }
        'hold' {
          # The conversation ended: the slow way out, as after any line.
          if (-not $S.presence) { Start-Exit $t 1.8 'released' ''; break }
        }
        'exit' {
          if (-not $S.isHaze -or $t - $S.exitStart -ge $S.exitLength) { Stop-Line; return }
        }
      }

      if ($S.isHaze) {
        $v = Get-Visual $t $fast
        if ($S.phase -ne 'exit') { $S.vis = $v }
        Update-Eye $t $fast $slow $v
      }
    } catch {
      Emit @{ t = 'error'; why = "$_"; at = "$($_.InvocationInfo.ScriptLineNumber): $($_.InvocationInfo.Line.Trim())" }
      try { $S.exitEvent = 'dropped'; $S.exitWhy = 'error'; Stop-Line } catch { }
    }
  })

# ---------- the edge glow: four narrow windows along each screen's edges, only during a turn ----------
# A 60 DIP gradient in #5A0603 that breathes up to 9% opacity at 5 fps (half the CPU of 10). The layer
# stands still; only the windows' opacity changes. Never during fullscreen or while HAL speaks.
$script:glow = @{ on = $false; windows = @(); key = ''; started = 0.0; clock = [Diagnostics.Stopwatch]::StartNew() }

function New-GlowWindow([double]$x, [double]$y, [double]$w, [double]$h, [string]$side) {
  $win = New-Object System.Windows.Window
  $win.WindowStyle = 'None'; $win.AllowsTransparency = $true; $win.Background = [System.Windows.Media.Brushes]::Transparent
  $win.Topmost = $true; $win.ShowInTaskbar = $false; $win.ShowActivated = $false; $win.Focusable = $false
  $win.ResizeMode = 'NoResize'; $win.IsHitTestVisible = $false
  $win.Left = $x; $win.Top = $y; $win.Width = $w; $win.Height = $h; $win.Opacity = 0
  $brush = New-Object System.Windows.Media.LinearGradientBrush
  switch ($side) {
    'top' { $brush.StartPoint = '0,0'; $brush.EndPoint = '0,1' }
    'bottom' { $brush.StartPoint = '0,1'; $brush.EndPoint = '0,0' }
    'left' { $brush.StartPoint = '0,0'; $brush.EndPoint = '1,0' }
    'right' { $brush.StartPoint = '1,0'; $brush.EndPoint = '0,0' }
  }
  [void]$brush.GradientStops.Add((New-Object System.Windows.Media.GradientStop ([System.Windows.Media.Color]::FromArgb(255, 0x5A, 0x06, 0x03)), 0))
  [void]$brush.GradientStops.Add((New-Object System.Windows.Media.GradientStop ([System.Windows.Media.Color]::FromArgb(0, 0x5A, 0x06, 0x03)), 1))
  $rect = New-Object System.Windows.Shapes.Rectangle
  $rect.Fill = $brush; $rect.IsHitTestVisible = $false
  $win.Content = $rect
  $win.Add_SourceInitialized({ [HalNative]::ClickThrough((New-Object System.Windows.Interop.WindowInteropHelper $this).Handle) })
  $win
}

function Get-GlowWindows {
  $screens = [System.Windows.Forms.Screen]::AllScreens
  $key = ($screens | ForEach-Object { "$($_.Bounds)" }) -join ';'
  if ($script:glow.key -ne $key) {
    foreach ($old in $script:glow.windows) { try { $old.Close() } catch { } }
    $list = @()
    foreach ($screen in $screens) {
      $b = $screen.Bounds; $k = $script:systemScale
      $x = $b.X / $k; $y = $b.Y / $k; $w = $b.Width / $k; $h = $b.Height / $k; $d = 60.0
      $list += New-GlowWindow $x $y $w $d 'top'
      $list += New-GlowWindow $x ($y + $h - $d) $w $d 'bottom'
      $list += New-GlowWindow $x ($y + $d) $d ($h - 2 * $d) 'left'
      $list += New-GlowWindow ($x + $w - $d) ($y + $d) $d ($h - 2 * $d) 'right'
    }
    $script:glow.windows = $list
    $script:glow.key = $key
  }
  $script:glow.windows
}

function Set-Glow([bool]$on) {
  $script:glow.on = $on
  if ($on) {
    $script:glow.started = $script:glow.clock.Elapsed.TotalSeconds
    $script:glowCpuAt = @{ cpu = (Get-Process -Id $PID).TotalProcessorTime.TotalMilliseconds; at = $script:glow.clock.Elapsed.TotalMilliseconds }
    foreach ($w in (Get-GlowWindows)) { if (-not $w.IsVisible) { $w.Show() } }
    $script:glowTimer.Start()
  } else {
    $script:glowTimer.Stop()
    if ($script:glowCpuAt) {
      $ms = $script:glow.clock.Elapsed.TotalMilliseconds - $script:glowCpuAt.at
      if ($ms -gt 2000) { $script:S.lastGlowCpuPct = [Math]::Round(100 * ((Get-Process -Id $PID).TotalProcessorTime.TotalMilliseconds - $script:glowCpuAt.cpu) / $ms, 1) }
      $script:glowCpuAt = $null
    }
    foreach ($w in $script:glow.windows) { $w.Opacity = 0; if ($w.IsVisible) { $w.Hide() } }
  }
}

$script:glowTimer = New-Object System.Windows.Threading.DispatcherTimer
$script:glowTimer.Interval = [TimeSpan]::FromMilliseconds(200)
$script:glowTimer.Add_Tick({
    try {
      $t = $script:glow.clock.Elapsed.TotalSeconds - $script:glow.started
      # Away while HAL is on screen or a fullscreen app runs; it fades in over 2 s and breathes.
      $isQuiet = ($script:S.phase -ne 'idle') -or $script:desk.fullscreen
      $phase = ($t % 5.5) / 5.5
      if ($phase -lt 0.4) { $breath = [Math]::Sin([Math]::PI / 2 * $phase / 0.4) } else { $breath = [Math]::Cos([Math]::PI / 2 * ($phase - 0.4) / 0.6) }
      $level = 0.0
      if (-not $isQuiet) { $level = [Math]::Min(1.0, $t / 2.0) * (0.045 + 0.045 * $breath) }
      foreach ($w in $script:glow.windows) { $w.Opacity = $level }
    } catch { Emit @{ t = 'error'; why = "glow: $_" } }
  })

# ---------- a line rendered ahead, for the farewell: processed, written to a wav, not played ----------
$script:renders = New-Object System.Collections.ArrayList

function Read-Renders {
  foreach ($r in @($script:renders)) {
    $result = Get-VoiceResult $r.job
    if (-not $result.done) {
      if ((NowMs) - $r.at -gt 30000) { [void]$script:renders.Remove($r); Emit @{ t = 'rendered'; id = $r.id; ok = $false; why = 'late' } }
      continue
    }
    [void]$script:renders.Remove($r)
    if (-not $result.voice) { Emit @{ t = 'rendered'; id = $r.id; ok = $false; why = 'no voice' }; continue }
    try {
      [IO.File]::WriteAllBytes($r.path, $result.voice.Wav)
      Emit @{ t = 'rendered'; id = $r.id; ok = $true; path = $r.path; seconds = [Math]::Round($result.voice.Seconds, 1) }
      if ($r.farewell) { Start-FarewellWaiter $r.path }
    } catch { Emit @{ t = 'rendered'; id = $r.id; ok = $false; why = "$_" } }
  }
}

# The farewell (decision 4): a small process outside Claude Code's process tree (started
# through WMI, so Claude Code's exit does not take it along) waits for Claude Code to end,
# then plays the pre-rendered last word and stops hard after 6 s. One per Claude Code.
$script:claudePid = [HalNative]::ParentPid()
function Start-FarewellWaiter([string]$wav) {
  if ($script:farewellWaiter -or $script:claudePid -le 0) { return }
  $waiter = Join-Path $PSScriptRoot 'hal-farewell.ps1'
  $exe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $line = "`"$exe`" -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$waiter`" -Wav `"$wav`" -WatchPid $($script:claudePid)"
  try {
    $made = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $line }
    if ($made.ReturnValue -eq 0) { $script:farewellWaiter = $made.ProcessId } else { Emit @{ t = 'error'; why = "farewell: WMI returned $($made.ReturnValue)" } }
  } catch { Emit @{ t = 'error'; why = "farewell: $_" } }
}

# ---------- the desk: a fullscreen app, another app on the microphone ----------
$script:desk = @{ fullscreen = $false; micBusy = ''; checkedAt = 0 }
$script:ownPythons = @()
foreach ($exe in @($neuralPython, (Join-Path $env:LOCALAPPDATA 'hal\venv\Scripts\pythonw.exe'))) { $script:ownPythons += $exe }
try {
  $cfg = Get-Content -LiteralPath (Join-Path $env:LOCALAPPDATA 'hal\venv\pyvenv.cfg') -ErrorAction Stop | Where-Object { $_ -match '^\s*home\s*=' }
  if ($cfg) { $script:ownPythons += (Join-Path (($cfg -split '=', 2)[1].Trim()) 'python.exe') }
} catch { }
$script:ownPythons = @($script:ownPythons | ForEach-Object { ($_ -replace '\\', '#').ToLowerInvariant() })

function Read-Desk {
  # HAL's own haze is a maximised topmost window: Windows would call that fullscreen.
  if ($script:S.phase -ne 'idle') { return }
  if ((NowMs) - $script:desk.checkedAt -lt 2000) { return }
  $script:desk.checkedAt = NowMs
  $full = [HalNative]::IsFullscreen()
  $mic = [HalNative]::MicUser([string[]]$script:ownPythons)
  if ($full -ne $script:desk.fullscreen -or $mic -ne $script:desk.micBusy) {
    $script:desk.fullscreen = $full; $script:desk.micBusy = $mic
    Emit @{ t = 'desk'; fullscreen = $full; micBusy = [bool]$mic }
  }
}

# ---------- the ears: hal-ears.py, while the mod asks HAL to listen ----------
# Their lines go to stdout as they are; the host only gates them while HAL speaks.
$script:ears = $null
$script:earsWanted = $false
$script:earsMic = ''
$script:earsState = 'off'
$script:earsStarts = @()

function Get-EarsMissing {
  $missing = @()
  if (-not (Test-Path -LiteralPath $neuralPython)) { $missing += 'the Python environment' }
  if (-not (Test-Path -LiteralPath (Join-Path $env:LOCALAPPDATA 'hal\venv\Lib\site-packages\soundcard'))) { $missing += 'soundcard' }
  if (-not (Test-Path -LiteralPath (Join-Path $models 'vad\silero_vad.onnx'))) { $missing += 'the VAD model' }
  if (-not (Test-Path -LiteralPath (Join-Path $models 'whisper-small\small-decoder.int8.onnx'))) { $missing += 'the Whisper model' }
  $missing
}

function Start-Ears {
  if ($script:ears -and $script:ears.IsAlive) { return }
  $missing = @(Get-EarsMissing)
  if ($missing.Count -gt 0) {
    $script:earsState = 'not set up: ' + ($missing -join ', ')
    Emit @{ t = 'ears'; state = 'not set up'; why = ($missing -join ', ') }
    return
  }
  # A crashing ear restarts, but at most three times in ten minutes.
  $now = NowMs
  $script:earsStarts = @($script:earsStarts | Where-Object { $now - $_ -lt 600000 })
  if ($script:earsStarts.Count -ge 3) { $script:earsState = 'stopped after three failures'; return }
  $script:earsStarts += $now
  $earsScript = Join-Path $PSScriptRoot 'hal-ears.py'
  $arguments = "-E -s `"$earsScript`""
  if ($script:earsMic) { $arguments += " --mic `"$($script:earsMic -replace '"', '')`"" }
  try {
    $script:ears = New-Object HalEars ($neuralPython, $arguments)
    $script:earsState = 'starting'
  } catch { $script:ears = $null; Emit @{ t = 'error'; why = "ears: $_" } }
}

function Stop-Ears {
  if ($script:ears) { $script:ears.Stop(); $script:ears = $null }
  $script:earsState = 'off'
  Emit @{ t = 'ears'; state = 'off' }
}

function Send-Ears([string]$json) { if ($script:ears) { $script:ears.Send($json) } }

function Read-Ears {
  if (-not $script:ears) {
    if ($script:earsWanted) { Start-Ears }
    return
  }
  $line = $null
  while ($script:ears.Lines.TryDequeue([ref]$line)) {
    if ($line -match '"t": "ears"') {
      try { $state = $line | ConvertFrom-Json; $script:earsState = "$($state.state) (mic: $($state.mic); computer: $($state.loop))"; if ($state.learned) { $script:earsState += '; knows your voice' } else { $script:earsState += '; does not know your voice yet (/hal learn)' } } catch { }
    }
    [Console]::Out.WriteLine($line)
  }
  [Console]::Out.Flush()
  if (-not $script:ears.IsAlive) {
    $script:ears = $null
    Emit @{ t = 'error'; why = 'the ears stopped' }
    if ($script:earsWanted) { Start-Ears }
  }
}

function Get-Report {
  $mons = @([System.Windows.Forms.Screen]::AllScreens | ForEach-Object {
      @{ x = $_.Bounds.X; y = $_.Bounds.Y; width = $_.Bounds.Width; height = $_.Bounds.Height; isPrimary = $_.Primary }
    })
  @{
    pid = $PID; uptimeS = [int](((NowMs) - $script:S.started) / 1000)
    voice = $voiceName; monitors = $mons; scale = $script:systemScale
    neural = $(if ($neural) { if (-not $neural.IsAlive) { 'stopped' } elseif ($neural.IsReady) { "ready$neuralNote" } else { "warming up$neuralNote" } } else { 'not set up: ' + ($neuralMissing -join ', ') })
    lastSynthMs = $script:S.lastSynthMs; lastLatencyMs = $script:S.lastLatencyMs; lastHazeCpuPct = $script:S.lastCpuPct
    queued = $script:S.queue.Count; phase = $script:S.phase
    ears = $script:earsState
    lastGlowCpuPct = $script:S.lastGlowCpuPct
    fullscreen = $script:desk.fullscreen; micBusy = [bool]$script:desk.micBusy
  }
}

function Read-Inbox {
  $files = @(Get-ChildItem -LiteralPath $Inbox -Filter '*.json' -File -ErrorAction SilentlyContinue | Sort-Object Name)
  foreach ($f in $files) {
    $msg = $null
    try { $msg = Get-Content -LiteralPath $f.FullName -Raw -Encoding UTF8 | ConvertFrom-Json } catch { }
    # A message still being written does not parse yet: leave it for the next poll, for up to 2 s.
    if (-not $msg -and ((Get-Date) - $f.LastWriteTime).TotalSeconds -lt 2) { continue }
    Remove-Item -LiteralPath $f.FullName -Force -ErrorAction SilentlyContinue
    if (-not $msg) { continue }
    switch ([string]$msg.kind) {
      'say' { [void]$script:S.queue.Add($msg) }
      'check' { Emit @{ t = 'check'; id = $msg.id; report = (Get-Report) } }
      'ears' {
        $mic = [string]$msg.mic
        if ($script:ears -and $mic -ne $script:earsMic) { $script:ears.Stop(); $script:ears = $null }
        $script:earsMic = $mic
        $script:earsWanted = [bool]$msg.on
        if ($script:earsWanted) { $script:earsStarts = @(); Start-Ears; if ($msg.override) { Send-Ears '{"override": true}' } } else { Stop-Ears }
      }
      'learn' { Send-Ears (@{ learn = [string]$msg.step } | ConvertTo-Json -Compress) }
      'presence' {
        # A conversation: on, the eye comes (with his first words, if any) and stays; off, it goes
        # after the line he is saying. A strength alone darkens the haze that is there.
        if ($msg.strength) {
          $script:S.presenceStrength = [double]$msg.strength
          if ($script:S.phase -ne 'idle') { foreach ($p in $script:S.windows) { Set-Strength $p $script:S.presenceStrength } }
        }
        if ($msg.on -eq $true -and -not $script:S.presence) {
          $script:S.presence = $true
          if ($script:S.phase -eq 'idle') {
            $first = [pscustomobject]@{ kind = 'say'; id = [string]$msg.id; text = [string]$msg.text; eyeOnly = -not [bool]$msg.text; haze = $true; strength = $script:S.presenceStrength; pauseMs = 300; at = (NowMs) }
            [void]$script:S.queue.Insert(0, $first)
          }
        } elseif ($msg.on -eq $false) {
          $script:S.presence = $false
        }
      }
      'glow' { Set-Glow ([bool]$msg.on) }
      'render' {
        $path = [string]$msg.path
        if ($msg.farewell) { $path = Join-Path $env:LOCALAPPDATA "hal\farewell-$($script:claudePid).wav" }
        $job = Start-Voice ([string]$msg.text) ([string]$msg.id)
        if ($job) { [void]$script:renders.Add(@{ id = [string]$msg.id; path = $path; job = $job; at = (NowMs); farewell = [bool]$msg.farewell }) }
        else { Emit @{ t = 'rendered'; id = $msg.id; ok = $false; why = 'no voice' } }
      }
      'farewell-cancel' { Remove-Item -LiteralPath (Join-Path $env:LOCALAPPDATA "hal\farewell-$($script:claudePid).wav") -Force -ErrorAction SilentlyContinue }
      'quit' { [System.Windows.Threading.Dispatcher]::CurrentDispatcher.InvokeShutdown() }
    }
  }
}

$poll = New-Object System.Windows.Threading.DispatcherTimer
$poll.Interval = [TimeSpan]::FromMilliseconds(150)
$poll.Add_Tick({
    try {
      Read-Inbox
      Read-Ears
      Read-Desk
      if ($script:renders.Count -gt 0) { Read-Renders }
      if (($script:S.phase -eq 'idle' -or $script:S.phase -eq 'hold') -and $script:S.queue.Count -gt 0) { Start-Next }
    } catch { Emit @{ t = 'error'; why = "$_" } }
  })

if ($isOneShot) {
  [void]$script:S.queue.Add([pscustomobject]@{ kind = 'say'; id = 'oneshot'; text = $Say; haze = ($Haze -eq 1); strength = $Strength; at = (NowMs) })
  $null = [System.Windows.Threading.Dispatcher]::CurrentDispatcher.BeginInvoke([Action] { Start-Next })
} else {
  $poll.Start()
  Emit @{ t = 'ready'; pid = $PID; voice = $voiceName }
}
[System.Windows.Threading.Dispatcher]::Run()
if ($neural) { $neural.Stop() }
if ($script:ears) { $script:ears.Stop() }
foreach ($w in $script:glow.windows) { try { $w.Close() } catch { } }
if ($script:hostMutex) { try { $script:hostMutex.ReleaseMutex() } catch { } }
