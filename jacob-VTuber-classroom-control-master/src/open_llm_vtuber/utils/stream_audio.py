import base64
import uuid
from typing import Any
from pydub import AudioSegment
from pydub.utils import make_chunks
from ..agent.output_types import Actions
from ..agent.output_types import DisplayText


def _get_volume_by_chunks(audio: AudioSegment, chunk_length_ms: int) -> list:
    """
    Calculate the normalized volume (RMS) for each chunk of the audio.

    Parameters:
        audio (AudioSegment): The audio segment to process.
        chunk_length_ms (int): The length of each audio chunk in milliseconds.

    Returns:
        list: Normalized volumes for each chunk.
    """
    chunks = make_chunks(audio, chunk_length_ms)
    volumes = [chunk.rms for chunk in chunks]
    max_volume = max(volumes)
    if max_volume == 0:
        raise ValueError("Audio is empty or all zero.")
    return [volume / max_volume for volume in volumes]


def prepare_audio_payload(
    audio_path: str | None,
    chunk_length_ms: int = 20,
    display_text: DisplayText = None,
    actions: Actions = None,
    forwarded: bool = False,
) -> dict[str, any]:
    """
    Prepares the audio payload for sending to a broadcast endpoint.
    If audio_path is None, returns a payload with audio=None for silent display.

    Parameters:
        audio_path (str | None): The path to the audio file to be processed, or None for silent display
        chunk_length_ms (int): The length of each audio chunk in milliseconds
        display_text (DisplayText, optional): Text to be displayed with the audio
        actions (Actions, optional): Actions associated with the audio

    Returns:
        dict: The audio payload to be sent
    """
    if isinstance(display_text, DisplayText):
        display_text = display_text.to_dict()

    if not audio_path:
        # Return payload for silent display
        return {
            "type": "audio",
            "audio": None,
            "volumes": [],
            "slice_length": chunk_length_ms,
            "display_text": display_text,
            "actions": actions.to_dict() if actions else None,
            "forwarded": forwarded,
        }

    try:
        audio = AudioSegment.from_file(audio_path)
        audio_bytes = audio.export(format="wav").read()
    except Exception as e:
        raise ValueError(
            f"Error loading or converting generated audio file to wav file '{audio_path}': {e}"
        )
    audio_base64 = base64.b64encode(audio_bytes).decode("utf-8")
    volumes = _get_volume_by_chunks(audio, chunk_length_ms)

    payload = {
        "type": "audio",
        "audio": audio_base64,
        "volumes": volumes,
        "slice_length": chunk_length_ms,
        "display_text": display_text,
        "actions": actions.to_dict() if actions else None,
        "forwarded": forwarded,
    }

    return payload


def prepare_audio_stream_events(
    audio_path: str | None,
    chunk_length_ms: int = 20,
    base64_chunk_size: int = 16 * 1024,
    display_text: DisplayText = None,
    actions: Actions = None,
    forwarded: bool = False,
) -> list[dict[str, Any]]:
    """
    Prepare websocket events for frontend-side streaming skeleton.

    This function sends:
      1) audio-stream-start
      2) one or more audio-stream-chunk
      3) audio-stream-end

    The frontend buffers chunks and re-assembles them before playback.
    """
    if base64_chunk_size <= 0:
        raise ValueError("base64_chunk_size must be greater than 0")

    if isinstance(display_text, DisplayText):
        display_text = display_text.to_dict()

    action_dict = actions.to_dict() if actions else None

    # Keep silent display behavior compatible when no audio is produced.
    if not audio_path:
        stream_id = str(uuid.uuid4())
        return [
            {
                "type": "audio-stream-start",
                "stream_id": stream_id,
                "display_text": display_text,
                "actions": action_dict,
                "forwarded": forwarded,
            },
            {
                "type": "audio-stream-end",
                "stream_id": stream_id,
                "volumes": [],
                "slice_length": chunk_length_ms,
            },
        ]

    try:
        audio = AudioSegment.from_file(audio_path)
        audio_bytes = audio.export(format="wav").read()
    except Exception as e:
        raise ValueError(
            f"Error loading or converting generated audio file to wav file '{audio_path}': {e}"
        )

    audio_base64 = base64.b64encode(audio_bytes).decode("utf-8")
    volumes = _get_volume_by_chunks(audio, chunk_length_ms)
    stream_id = str(uuid.uuid4())

    events: list[dict[str, Any]] = [
        {
            "type": "audio-stream-start",
            "stream_id": stream_id,
            "display_text": display_text,
            "actions": action_dict,
            "forwarded": forwarded,
        }
    ]

    for i in range(0, len(audio_base64), base64_chunk_size):
        events.append(
            {
                "type": "audio-stream-chunk",
                "stream_id": stream_id,
                "chunk": audio_base64[i : i + base64_chunk_size],
            }
        )

    events.append(
        {
            "type": "audio-stream-end",
            "stream_id": stream_id,
            "volumes": volumes,
            "slice_length": chunk_length_ms,
        }
    )

    return events


# Example usage:
# payload, duration = prepare_audio_payload("path/to/audio.mp3", display_text="Hello", expression_list=[0,1,2])
