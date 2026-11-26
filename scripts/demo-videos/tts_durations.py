"""How long each caption takes to speak, measured with the voice-over tool's own engine.

Run inside the `vo` project (../video-pipeline beside this repo, or $VO_PROJECT; see docs/DEMO_VIDEOS_PLAN.md):

    uv run --project <vo> python scripts/demo-videos/tts_durations.py < request.json

stdin:  {"voice": "af_heart", "speed": 1.0, "texts": ["...", ...]}
stdout: [{"text": "...", "duration": 2.41}, ...]

A line is measured exactly as `vo synth` places it: Kokoro at its natural rate,
then leading and trailing silence trimmed (vo.timeline.trim_silence_bounds), so
the demo Director can keep the next caption from starting before this line ends.
Everything runs locally; no text leaves the machine.
"""

from __future__ import annotations

import json
import sys

from vo.timeline import trim_silence_bounds
from vo.tts.registry import get_engine


def main() -> None:
    request = json.load(sys.stdin)
    voice = str(request.get("voice") or "af_heart")
    speed = float(request.get("speed") or 1.0)
    texts = [str(t) for t in request.get("texts", []) if str(t).strip()]

    engine = get_engine("kokoro", progress=False)
    out = []
    for text in texts:
        result = engine.synth(text, voice=voice, speed=speed)
        start, end = trim_silence_bounds(result.audio, result.sample_rate)
        out.append({"text": text, "duration": round((end - start) / float(result.sample_rate), 3)})
    json.dump(out, sys.stdout)


if __name__ == "__main__":
    main()
