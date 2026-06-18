import base64
import os
import threading
import time
import uuid

import requests
from loguru import logger

from .tts_interface import TTSInterface


class TTSEngine(TTSInterface):
    FALLBACK_VOICE = "BV001_streaming"

    def __init__(
        self,
        appid: str,
        access_token: str,
        voice: str = "BV001_streaming",
        api_url: str = "https://openspeech.bytedance.com/api/v1/tts",
        cluster: str = "volcano_tts",
        secret_key: str = "",
        encoding: str = "mp3",
        sample_rate: int = 24000,
        speed_ratio: float = 1.0,
        volume_ratio: float = 1.0,
        pitch_ratio: float = 1.0,
        timeout_seconds: float = 20.0,
    ):
        self.appid = appid
        self.access_token = access_token
        self.voice = voice
        self.api_url = api_url
        self.cluster = cluster
        self.secret_key = secret_key  # Reserved for future signed-request modes.
        self.encoding = encoding
        self.sample_rate = sample_rate
        self.speed_ratio = speed_ratio
        self.volume_ratio = volume_ratio
        self.pitch_ratio = pitch_ratio
        self.timeout_seconds = timeout_seconds
        self._request_lock = threading.Lock()

        self.new_audio_dir = "cache"
        if not os.path.exists(self.new_audio_dir):
            os.makedirs(self.new_audio_dir)

    @property
    def file_extension(self) -> str:
        if self.encoding == "ogg_opus":
            return "ogg"
        return self.encoding

    def max_concurrent_generations(self) -> int:
        # The standalone Volcengine package used on the Raspberry Pi has a
        # low concurrency quota, so synthesize sentence segments sequentially.
        return 1

    def _build_request_payload(self, text: str, voice: str | None = None) -> dict:
        request_voice = voice or self.voice
        return {
            "app": {
                "appid": self.appid,
                "token": self.access_token,
                "cluster": self.cluster,
            },
            "user": {"uid": "open-llm-vtuber"},
            "audio": {
                "voice_type": request_voice,
                "encoding": self.encoding,
                "rate": self.sample_rate,
                "speed_ratio": self.speed_ratio,
                "volume_ratio": self.volume_ratio,
                "pitch_ratio": self.pitch_ratio,
            },
            "request": {
                "reqid": str(uuid.uuid4()),
                "text": text,
                "text_type": "plain",
                "operation": "query",
            },
        }

    def _extract_audio_bytes(self, response_json: dict) -> bytes:
        if isinstance(response_json.get("data"), str) and response_json.get("data"):
            return base64.b64decode(response_json["data"])

        output = response_json.get("output")
        if isinstance(output, dict):
            audio = output.get("audio")
            if isinstance(audio, dict) and isinstance(audio.get("data"), str):
                return base64.b64decode(audio["data"])

        raise ValueError(
            f"Volcengine TTS response does not contain decodable audio data: {response_json}"
        )

    def generate_audio(self, text: str, file_name_no_ext=None) -> str | None:
        with self._request_lock:
            return self._generate_audio_locked(text, file_name_no_ext)

    def _generate_audio_locked(self, text: str, file_name_no_ext=None) -> str | None:
        if not self.appid or not self.access_token:
            logger.error("Volcengine TTS requires both appid and access_token.")
            return None

        file_name = self.generate_cache_file_name(file_name_no_ext, self.file_extension)
        headers = {
            "Authorization": f"Bearer;{self.access_token}",
            "Content-Type": "application/json",
        }

        max_attempts = 3

        try:
            response = None
            response = requests.post(
                self.api_url,
                headers=headers,
                json=self._build_request_payload(text),
                timeout=self.timeout_seconds,
            )
            for attempt in range(max_attempts):
                if attempt > 0:
                    retry_delay = 0.8 * attempt
                    logger.warning(
                        "Volcengine TTS retrying after HTTP 429 in {:.1f}s "
                        "(attempt {}/{}).",
                        retry_delay,
                        attempt + 1,
                        max_attempts,
                    )
                    time.sleep(retry_delay)
                    response = requests.post(
                        self.api_url,
                        headers=headers,
                        json=self._build_request_payload(text),
                        timeout=self.timeout_seconds,
                    )

                should_retry_with_fallback = (
                    response.status_code == 403
                    and "requested resource not granted" in response.text
                    and self.voice != self.FALLBACK_VOICE
                )
                if should_retry_with_fallback:
                    logger.warning(
                        "Volcengine TTS voice '{}' not granted; retrying with fallback voice '{}'.",
                        self.voice,
                        self.FALLBACK_VOICE,
                    )
                    response = requests.post(
                        self.api_url,
                        headers=headers,
                        json=self._build_request_payload(text, voice=self.FALLBACK_VOICE),
                        timeout=self.timeout_seconds,
                    )

                if response.status_code != 429 or attempt == max_attempts - 1:
                    break

            if response is None:
                logger.error("Volcengine TTS request did not return a response.")
                return None

            if response.status_code >= 400:
                logger.error(
                    f"Volcengine TTS HTTP {response.status_code} (voice={self.voice}): {response.text[:500]}"
                )
                return None
            response_json = response.json()
            audio_bytes = self._extract_audio_bytes(response_json)
        except Exception as e:
            logger.error(f"Volcengine TTS generate_audio failed: {e}")
            return None

        try:
            with open(file_name, "wb") as f:
                f.write(audio_bytes)
            return file_name
        except Exception as e:
            logger.error(f"Volcengine TTS failed to write audio file: {e}")
            return None
