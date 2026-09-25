$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$fixtureDirectory = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\test-results'))
[System.IO.Directory]::CreateDirectory($fixtureDirectory) | Out-Null
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$phrases = ConvertFrom-Json ([System.IO.File]::ReadAllText((Join-Path $PSScriptRoot 'voice-fixtures.json'), [System.Text.Encoding]::UTF8))
try {
  $voice = $synth.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -eq 'pt-BR' } | Select-Object -First 1
  if (-not $voice) { throw 'Instale uma voz de teste em português para gerar as frases sintéticas.' }
  $synth.SelectVoice($voice.VoiceInfo.Name)
  $format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(24000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
  $synth.SetOutputToWaveFile((Join-Path $fixtureDirectory 'live-phrase-1.wav'), $format)
  $synth.Speak($phrases[0])
  $synth.SetOutputToWaveFile((Join-Path $fixtureDirectory 'live-phrase-2.wav'), $format)
  $synth.Speak($phrases[1])
} finally { $synth.Dispose() }
