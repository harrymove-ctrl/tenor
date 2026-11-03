#!/usr/bin/env bash
# Synthesizes the demo's sound effects with ffmpeg (no samples, no licenses).
# Output: video/sfx/{riser,stamp,tear,whoosh,click}.wav at 48 kHz.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p sfx
ff() { ffmpeg -loglevel error -y "$@"; }

# Intro riser: rising chirp under swelling pink noise, 3.0 s.
ff -filter_complex "aevalsrc='0.22*sin(2*PI*(70*t+(520-70)/(2*3.0)*t*t))':d=3.0:s=48000[a];anoisesrc=color=pink:d=3.0:r=48000:a=0.35,highpass=f=300,lowpass=f=6000[n];[a][n]amix=inputs=2:normalize=0,afade=t=in:d=2.6:curve=exp,afade=t=out:st=2.85:d=0.15,volume=1.4" sfx/riser.wav

# Stamp thud: low sine thump plus a short paper slap, 0.7 s.
ff -filter_complex "aevalsrc='0.95*sin(2*PI*58*t)*exp(-10*t)+0.35*sin(2*PI*116*t)*exp(-16*t)':d=0.7:s=48000[t];anoisesrc=color=white:d=0.09:r=48000:a=0.6,bandpass=f=1800:width_type=h:w=2200,afade=t=out:d=0.09[s];[t][s]amix=inputs=2:normalize=0,alimiter=limit=0.95" sfx/stamp.wav

# Paper tear: band-passed noise with a ragged envelope, 0.9 s.
ff -filter_complex "anoisesrc=color=white:d=0.9:r=48000:a=0.7,bandpass=f=2600:width_type=h:w=2400,tremolo=f=38:d=0.6,afade=t=in:d=0.04,afade=t=out:st=0.35:d=0.55,volume=0.9" sfx/tear.wav

# Camera whoosh: soft pink noise swell, 0.7 s.
ff -filter_complex "anoisesrc=color=pink:d=0.7:r=48000:a=0.5,bandpass=f=900:width_type=h:w=900,afade=t=in:d=0.3:curve=qsin,afade=t=out:st=0.3:d=0.4,volume=0.8" sfx/whoosh.wav

# UI click: tiny damped tick, 70 ms.
ff -filter_complex "aevalsrc='0.55*sin(2*PI*2400*t)*exp(-140*t)+0.25*sin(2*PI*1200*t)*exp(-90*t)':d=0.07:s=48000" sfx/click.wav

# Peak-normalize each effect to -1 dBFS so the mix controls relative level.
for f in sfx/*.wav; do
  peak=$(ffmpeg -i "$f" -af volumedetect -f null - 2>&1 | sed -n 's/.*max_volume: \(-*[0-9.]*\) dB/\1/p')
  ff -i "$f" -af "volume=$(python3 -c "print(-1-float('$peak'))")dB" "$f.tmp.wav" && mv "$f.tmp.wav" "$f"
done

for f in sfx/*.wav; do
  printf '%s %ss %s\n' "$f" "$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f")" \
    "$(ffmpeg -i "$f" -af volumedetect -f null - 2>&1 | grep -o 'max_volume: [-0-9.]* dB')"
done
