"""Decode capture fragments and align each page lifetime on the session timeline."""
import io
import os
import shutil
import subprocess
import tempfile
import wave
from collections import defaultdict
from pathlib import Path


def ffmpeg_binary():
    configured = os.environ.get("FFMPEG_BINARY") or shutil.which("ffmpeg")
    if configured:
        return configured
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError as exc:
        raise RuntimeError("FFmpeg is required for recording playback") from exc


def render_recording(chunks):
    captures = defaultdict(list)
    for chunk in chunks:
        captures[str(chunk.capture_id)].append(chunk)
    # Decode captures independently; concatenating WebM files across reloads is invalid.
    decoded = []
    with tempfile.TemporaryDirectory(prefix="vivaai-recording-") as directory:
        for index, parts in enumerate(captures.values()):
            parts.sort(key=lambda part: part.sequence)
            if [part.sequence for part in parts] != list(range(len(parts))):
                raise ValueError("Recording fragments are still syncing. Please retry shortly.")
            source = Path(directory) / f"capture-{index}"
            source.write_bytes(b"".join(part.data for part in parts))
            output = Path(directory) / f"capture-{index}.wav"
            subprocess.run([ffmpeg_binary(), "-nostdin", "-v", "error", "-i", str(source), "-ac", "1", "-ar", "16000",
                "-acodec", "pcm_s16le", str(output)], check=True, capture_output=True, timeout=60)
            with wave.open(str(output), "rb") as recording:
                decoded.append((round(parts[0].start_secs * 16000), recording.readframes(recording.getnframes())))
    # Silence between captures preserves transcript/audio alignment without hiding outages.
    size = max(start * 2 + len(data) for start, data in decoded)
    if size > (7200 + 120) * 16000 * 2:
        raise ValueError("Recording exceeds the supported duration")
    timeline = bytearray(size)
    import array
    for start, data in decoded:
        # Captures normally do not overlap; saturating addition also handles brief overlap at reload.
        incoming = array.array('h', data)
        existing = array.array('h', timeline[start * 2:start * 2 + len(data)])
        mixed = array.array('h', (max(-32768, min(32767, a + b)) for a, b in zip(existing, incoming)))
        timeline[start * 2:start * 2 + len(data)] = mixed.tobytes()
    output = io.BytesIO()
    with wave.open(output, "wb") as recording:
        recording.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
        recording.writeframes(timeline)
    return output.getvalue()
