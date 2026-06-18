from typing import Dict, List, Optional, Callable, TypedDict
from fastapi import WebSocket, WebSocketDisconnect
import asyncio
import json
import re
from enum import Enum
import numpy as np
import yaml
from loguru import logger

from .service_context import ServiceContext
from .live2d_model import Live2dModel
from .avatar_pack_manager import avatar_pack_exists
from .chat_group import (
    ChatGroupManager,
    handle_group_operation,
    handle_client_disconnect,
    broadcast_to_group,
)
from .message_handler import message_handler
from .utils.stream_audio import prepare_audio_payload
from .chat_history_manager import (
    create_new_history,
    get_history,
    delete_history,
    get_history_list,
)
from .config_manager import TTSConfig, read_yaml
from .config_manager.utils import scan_config_alts_directory, scan_bg_directory
from .conversations.conversation_handler import (
    handle_conversation_trigger,
    handle_group_interrupt,
    handle_individual_interrupt,
)
from .persona_safety import ensure_teaching_persona_safety
from .classroom.storage import attach_profile_metadata, save_profile_from_context


class MessageType(Enum):
    """Enum for WebSocket message types"""

    GROUP = ["add-client-to-group", "remove-client-from-group"]
    HISTORY = [
        "fetch-history-list",
        "fetch-and-set-history",
        "create-new-history",
        "delete-history",
    ]
    CONVERSATION = ["mic-audio-end", "text-input", "ai-speak-signal"]
    CONFIG = ["fetch-configs", "switch-config"]
    CONTROL = ["interrupt-signal", "audio-play-start"]
    DATA = ["mic-audio-data"]


class WSMessage(TypedDict, total=False):
    """Type definition for WebSocket messages"""

    type: str
    action: Optional[str]
    text: Optional[str]
    audio: Optional[List[float]]
    images: Optional[List[str]]
    history_uid: Optional[str]
    file: Optional[str]
    display_text: Optional[dict]
    character_name: Optional[str]
    human_name: Optional[str]
    persona_prompt: Optional[str]
    persona_description: Optional[str]
    request_id: Optional[str]
    live2d_model: Optional[str]
    tts_model: Optional[str]
    engine_config: Optional[dict]
    knowledge_enabled: Optional[bool]
    avatar_mode: Optional[str]
    avatar_pack_id: Optional[str]


class WebSocketHandler:
    """Handles WebSocket connections and message routing"""

    def __init__(self, default_context_cache: ServiceContext):
        """Initialize the WebSocket handler with default context"""
        self.client_connections: Dict[str, WebSocket] = {}
        self.client_contexts: Dict[str, ServiceContext] = {}
        self.chat_group_manager = ChatGroupManager()
        self.current_conversation_tasks: Dict[str, Optional[asyncio.Task]] = {}
        self.default_context_cache = default_context_cache
        self.received_data_buffers: Dict[str, np.ndarray] = {}

        # Message handlers mapping
        self._message_handlers = self._init_message_handlers()

    def _init_message_handlers(self) -> Dict[str, Callable]:
        """Initialize message type to handler mapping"""
        return {
            "add-client-to-group": self._handle_group_operation,
            "remove-client-from-group": self._handle_group_operation,
            "request-group-info": self._handle_group_info,
            "fetch-history-list": self._handle_history_list_request,
            "fetch-and-set-history": self._handle_fetch_history,
            "create-new-history": self._handle_create_history,
            "delete-history": self._handle_delete_history,
            "interrupt-signal": self._handle_interrupt,
            "mic-audio-data": self._handle_audio_data,
            "mic-audio-end": self._handle_conversation_trigger,
            "raw-audio-data": self._handle_raw_audio_data,
            "text-input": self._handle_conversation_trigger,
            "ai-speak-signal": self._handle_conversation_trigger,
            "fetch-configs": self._handle_fetch_configs,
            "switch-config": self._handle_config_switch,
            "update-persona": self._handle_update_persona,
            "generate-persona-prompt": self._handle_generate_persona_prompt,
            "update-live2d-model": self._handle_update_live2d_model,
            "update-avatar-pack": self._handle_update_avatar_pack,
            "request-tts-config": self._handle_request_tts_config,
            "update-tts-config": self._handle_update_tts_config,
            "request-knowledge-settings": self._handle_request_knowledge_settings,
            "update-knowledge-settings": self._handle_update_knowledge_settings,
            "fetch-backgrounds": self._handle_fetch_backgrounds,
            "audio-play-start": self._handle_audio_play_start,
            "request-init-config": self._handle_init_config_request,
            "heartbeat": self._handle_heartbeat,
        }

    async def handle_new_connection(
        self, websocket: WebSocket, client_uid: str
    ) -> None:
        """
        Handle new WebSocket connection setup

        Args:
            websocket: The WebSocket connection
            client_uid: Unique identifier for the client

        Raises:
            Exception: If initialization fails
        """
        try:
            session_service_context = await self._init_service_context(
                websocket.send_text, client_uid
            )

            await self._store_client_data(
                websocket, client_uid, session_service_context
            )

            await self._send_initial_messages(
                websocket, client_uid, session_service_context
            )

            logger.info(f"Connection established for client {client_uid}")

        except Exception as e:
            logger.error(
                f"Failed to initialize connection for client {client_uid}: {e}"
            )
            await self._cleanup_failed_connection(client_uid)
            raise

    async def _store_client_data(
        self,
        websocket: WebSocket,
        client_uid: str,
        session_service_context: ServiceContext,
    ):
        """Store client data and initialize group status"""
        self.client_connections[client_uid] = websocket
        self.client_contexts[client_uid] = session_service_context
        self.received_data_buffers[client_uid] = np.array([])

        self.chat_group_manager.client_group_map[client_uid] = ""
        await self.send_group_update(websocket, client_uid)

    async def _send_initial_messages(
        self,
        websocket: WebSocket,
        client_uid: str,
        session_service_context: ServiceContext,
    ):
        """Send initial connection messages to the client"""
        await websocket.send_text(
            json.dumps({"type": "full-text", "text": "Connection established"})
        )

        await websocket.send_text(
            json.dumps(
                {
                    "type": "set-model-and-conf",
                    "model_info": session_service_context.live2d_model.model_info,
                    "conf_name": session_service_context.character_config.conf_name,
                    "conf_uid": session_service_context.character_config.conf_uid,
                    "character_name": session_service_context.character_config.character_name,
                    "human_name": session_service_context.character_config.human_name,
                    "persona_prompt": session_service_context.character_config.persona_prompt,
                    "avatar_mode": session_service_context.character_config.avatar_mode,
                    "avatar_pack_id": session_service_context.character_config.avatar_pack_id,
                    "client_uid": client_uid,
                }
            )
        )

        # Send initial group status
        await self.send_group_update(websocket, client_uid)

        # Start microphone
        await websocket.send_text(json.dumps({"type": "control", "text": "start-mic"}))

    async def _init_service_context(
        self, send_text: Callable, client_uid: str
    ) -> ServiceContext:
        """Initialize service context for a new session by cloning the default context"""
        session_service_context = ServiceContext()
        await session_service_context.load_cache(
            config=self.default_context_cache.config.model_copy(deep=True),
            system_config=self.default_context_cache.system_config.model_copy(
                deep=True
            ),
            character_config=self.default_context_cache.character_config.model_copy(
                deep=True
            ),
            live2d_model=self.default_context_cache.live2d_model,
            asr_engine=self.default_context_cache.asr_engine,
            tts_engine=self.default_context_cache.tts_engine,
            vad_engine=self.default_context_cache.vad_engine,
            agent_engine=self.default_context_cache.agent_engine,
            translate_engine=self.default_context_cache.translate_engine,
            mcp_server_registery=self.default_context_cache.mcp_server_registery,
            tool_adapter=self.default_context_cache.tool_adapter,
            send_text=send_text,
            client_uid=client_uid,
        )
        session_service_context.knowledge_enabled = bool(
            self.default_context_cache.knowledge_enabled
        )
        session_service_context.classroom_username = (
            self.default_context_cache.classroom_username
        )
        session_service_context.classroom_class_name = (
            self.default_context_cache.classroom_class_name
        )
        session_service_context.classroom_dirty = (
            self.default_context_cache.classroom_dirty
        )
        session_service_context.classroom_submitted = (
            self.default_context_cache.classroom_submitted
        )
        session_service_context.classroom_last_saved_at = (
            self.default_context_cache.classroom_last_saved_at
        )
        session_service_context.classroom_locked = (
            self.default_context_cache.classroom_locked
        )
        return session_service_context

    async def handle_websocket_communication(
        self, websocket: WebSocket, client_uid: str
    ) -> None:
        """
        Handle ongoing WebSocket communication

        Args:
            websocket: The WebSocket connection
            client_uid: Unique identifier for the client
        """
        try:
            while True:
                try:
                    data = await websocket.receive_json()
                    message_handler.handle_message(client_uid, data)
                    await self._route_message(websocket, client_uid, data)
                except WebSocketDisconnect:
                    raise
                except json.JSONDecodeError:
                    logger.error("Invalid JSON received")
                    continue
                except Exception as e:
                    logger.error(f"Error processing message: {e}")
                    await websocket.send_text(
                        json.dumps({"type": "error", "message": str(e)})
                    )
                    continue

        except WebSocketDisconnect:
            logger.info(f"Client {client_uid} disconnected")
            raise
        except Exception as e:
            logger.error(f"Fatal error in WebSocket communication: {e}")
            raise

    async def _route_message(
        self, websocket: WebSocket, client_uid: str, data: WSMessage
    ) -> None:
        """
        Route incoming message to appropriate handler

        Args:
            websocket: The WebSocket connection
            client_uid: Client identifier
            data: Message data
        """
        msg_type = data.get("type")
        if not msg_type:
            logger.warning("Message received without type")
            return

        handler = self._message_handlers.get(msg_type)
        if handler:
            await handler(websocket, client_uid, data)
        else:
            if msg_type != "frontend-playback-complete":
                logger.warning(f"Unknown message type: {msg_type}")

    async def _handle_group_operation(
        self, websocket: WebSocket, client_uid: str, data: dict
    ) -> None:
        """Handle group-related operations"""
        operation = data.get("type")
        target_uid = data.get(
            "invitee_uid" if operation == "add-client-to-group" else "target_uid"
        )

        await handle_group_operation(
            operation=operation,
            client_uid=client_uid,
            target_uid=target_uid,
            chat_group_manager=self.chat_group_manager,
            client_connections=self.client_connections,
            send_group_update=self.send_group_update,
        )

    async def handle_disconnect(self, client_uid: str) -> None:
        """Handle client disconnection"""
        group = self.chat_group_manager.get_client_group(client_uid)
        if group:
            await handle_group_interrupt(
                group_id=group.group_id,
                heard_response="",
                current_conversation_tasks=self.current_conversation_tasks,
                chat_group_manager=self.chat_group_manager,
                client_contexts=self.client_contexts,
                broadcast_to_group=self.broadcast_to_group,
            )

        await handle_client_disconnect(
            client_uid=client_uid,
            chat_group_manager=self.chat_group_manager,
            client_connections=self.client_connections,
            send_group_update=self.send_group_update,
        )

        # Clean up other client data
        self.client_connections.pop(client_uid, None)
        self.client_contexts.pop(client_uid, None)
        self.received_data_buffers.pop(client_uid, None)
        if client_uid in self.current_conversation_tasks:
            task = self.current_conversation_tasks[client_uid]
            if task and not task.done():
                task.cancel()
            self.current_conversation_tasks.pop(client_uid, None)

        # Call context close to clean up resources (e.g., MCPClient)
        context = self.client_contexts.get(client_uid)
        if context:
            await context.close()

        logger.info(f"Client {client_uid} disconnected")
        message_handler.cleanup_client(client_uid)

    async def _cleanup_failed_connection(self, client_uid: str) -> None:
        """Clean up failed connection data"""
        self.client_connections.pop(client_uid, None)
        self.client_contexts.pop(client_uid, None)
        self.received_data_buffers.pop(client_uid, None)
        self.chat_group_manager.client_group_map.pop(client_uid, None)

        if client_uid in self.current_conversation_tasks:
            task = self.current_conversation_tasks[client_uid]
            if task and not task.done():
                task.cancel()
            self.current_conversation_tasks.pop(client_uid, None)

        message_handler.cleanup_client(client_uid)

    async def broadcast_to_group(
        self, group_members: list[str], message: dict, exclude_uid: str = None
    ) -> None:
        """Broadcasts a message to group members"""
        await broadcast_to_group(
            group_members=group_members,
            message=message,
            client_connections=self.client_connections,
            exclude_uid=exclude_uid,
        )

    async def send_group_update(self, websocket: WebSocket, client_uid: str):
        """Sends group information to a client"""
        group = self.chat_group_manager.get_client_group(client_uid)
        if group:
            current_members = self.chat_group_manager.get_group_members(client_uid)
            await websocket.send_text(
                json.dumps(
                    {
                        "type": "group-update",
                        "members": current_members,
                        "is_owner": group.owner_uid == client_uid,
                    }
                )
            )
        else:
            await websocket.send_text(
                json.dumps(
                    {
                        "type": "group-update",
                        "members": [],
                        "is_owner": False,
                    }
                )
            )

    async def _handle_interrupt(
        self, websocket: WebSocket, client_uid: str, data: WSMessage
    ) -> None:
        """Handle conversation interruption"""
        heard_response = data.get("text", "")
        context = self.client_contexts[client_uid]
        group = self.chat_group_manager.get_client_group(client_uid)

        if group and len(group.members) > 1:
            await handle_group_interrupt(
                group_id=group.group_id,
                heard_response=heard_response,
                current_conversation_tasks=self.current_conversation_tasks,
                chat_group_manager=self.chat_group_manager,
                client_contexts=self.client_contexts,
                broadcast_to_group=self.broadcast_to_group,
            )
        else:
            await handle_individual_interrupt(
                client_uid=client_uid,
                current_conversation_tasks=self.current_conversation_tasks,
                context=context,
                heard_response=heard_response,
            )

    async def _handle_history_list_request(
        self, websocket: WebSocket, client_uid: str, data: WSMessage
    ) -> None:
        """Handle request for chat history list"""
        context = self.client_contexts[client_uid]
        histories = get_history_list(context.character_config.conf_uid)
        await websocket.send_text(
            json.dumps({"type": "history-list", "histories": histories})
        )

    async def _handle_fetch_history(
        self, websocket: WebSocket, client_uid: str, data: dict
    ):
        """Handle fetching and setting specific chat history"""
        history_uid = data.get("history_uid")
        if not history_uid:
            return

        context = self.client_contexts[client_uid]
        # Update history_uid in service context
        context.history_uid = history_uid
        context.agent_engine.set_memory_from_history(
            conf_uid=context.character_config.conf_uid,
            history_uid=history_uid,
        )

        messages = [
            msg
            for msg in get_history(
                context.character_config.conf_uid,
                history_uid,
            )
            if msg["role"] != "system"
        ]
        await websocket.send_text(
            json.dumps({"type": "history-data", "messages": messages})
        )

    async def _handle_create_history(
        self, websocket: WebSocket, client_uid: str, data: WSMessage
    ) -> None:
        """Handle creation of new chat history"""
        context = self.client_contexts[client_uid]
        history_uid = create_new_history(context.character_config.conf_uid)
        if history_uid:
            context.history_uid = history_uid
            context.agent_engine.set_memory_from_history(
                conf_uid=context.character_config.conf_uid,
                history_uid=history_uid,
            )
            await websocket.send_text(
                json.dumps(
                    {
                        "type": "new-history-created",
                        "history_uid": history_uid,
                    }
                )
            )

    async def _handle_delete_history(
        self, websocket: WebSocket, client_uid: str, data: dict
    ):
        """Handle deletion of chat history"""
        history_uid = data.get("history_uid")
        if not history_uid:
            return

        context = self.client_contexts[client_uid]
        success = delete_history(
            context.character_config.conf_uid,
            history_uid,
        )
        await websocket.send_text(
            json.dumps(
                {
                    "type": "history-deleted",
                    "success": success,
                    "history_uid": history_uid,
                }
            )
        )
        if history_uid == context.history_uid:
            context.history_uid = None

    async def _handle_audio_data(
        self, websocket: WebSocket, client_uid: str, data: WSMessage
    ) -> None:
        """Handle incoming audio data"""
        audio_data = data.get("audio", [])
        if audio_data:
            self.received_data_buffers[client_uid] = np.append(
                self.received_data_buffers[client_uid],
                np.array(audio_data, dtype=np.float32),
            )

    async def _handle_raw_audio_data(
        self, websocket: WebSocket, client_uid: str, data: WSMessage
    ) -> None:
        """Handle incoming raw audio data for VAD processing"""
        context = self.client_contexts[client_uid]
        chunk = data.get("audio", [])
        if chunk:
            for audio_bytes in context.vad_engine.detect_speech(chunk):
                if audio_bytes == b"<|PAUSE|>":
                    await websocket.send_text(
                        json.dumps({"type": "control", "text": "interrupt"})
                    )
                elif audio_bytes == b"<|RESUME|>":
                    pass
                elif len(audio_bytes) > 1024:
                    # Detected audio activity (voice)
                    self.received_data_buffers[client_uid] = np.append(
                        self.received_data_buffers[client_uid],
                        np.frombuffer(audio_bytes, dtype=np.int16).astype(np.float32),
                    )
                    await websocket.send_text(
                        json.dumps({"type": "control", "text": "mic-audio-end"})
                    )

    async def _handle_conversation_trigger(
        self, websocket: WebSocket, client_uid: str, data: WSMessage
    ) -> None:
        """Handle triggers that start a conversation"""
        await handle_conversation_trigger(
            msg_type=data.get("type", ""),
            data=data,
            client_uid=client_uid,
            context=self.client_contexts[client_uid],
            websocket=websocket,
            client_contexts=self.client_contexts,
            client_connections=self.client_connections,
            chat_group_manager=self.chat_group_manager,
            received_data_buffers=self.received_data_buffers,
            current_conversation_tasks=self.current_conversation_tasks,
            broadcast_to_group=self.broadcast_to_group,
        )

    async def _handle_fetch_configs(
        self, websocket: WebSocket, client_uid: str, data: WSMessage
    ) -> None:
        """Handle fetching available configurations"""
        context = self.client_contexts[client_uid]
        config_files = scan_config_alts_directory(context.system_config.config_alts_dir)
        await websocket.send_text(
            json.dumps({"type": "config-files", "configs": config_files})
        )

    async def _handle_config_switch(
        self, websocket: WebSocket, client_uid: str, data: dict
    ):
        """Handle switching to a different configuration"""
        config_file_name = data.get("file")
        if config_file_name:
            context = self.client_contexts[client_uid]
            await context.handle_config_switch(websocket, config_file_name)

    async def _handle_update_persona(
        self, websocket: WebSocket, client_uid: str, data: WSMessage
    ) -> None:
        """Handle runtime persona update for current session."""
        context = self.client_contexts[client_uid]

        persona_prompt = (data.get("persona_prompt") or "").strip()
        if not persona_prompt:
            await websocket.send_text(
                json.dumps(
                    {
                        "type": "error",
                        "message": "persona_prompt cannot be empty",
                    }
                )
            )
            return
        persona_prompt = ensure_teaching_persona_safety(persona_prompt)

        character_name = (
            (data.get("character_name") or context.character_config.character_name or "")
            .strip()
            or context.character_config.conf_name
        )
        human_name = (
            (data.get("human_name") or context.character_config.human_name or "").strip()
            or "Human"
        )

        # Keep previous persona for change detection inside init_agent.
        # If we update context.character_config.persona_prompt before calling init_agent,
        # init_agent may think nothing changed and skip rebuilding the agent prompt.
        context.character_config.character_name = character_name
        context.character_config.human_name = human_name

        await context.init_agent(
            context.character_config.agent_config,
            persona_prompt,
        )
        context.character_config.persona_prompt = persona_prompt
        await self._persist_persona_config(
            character_name,
            human_name,
            persona_prompt,
            context=context,
        )

        await websocket.send_text(
            json.dumps(
                {
                    "type": "set-model-and-conf",
                    "model_info": context.live2d_model.model_info,
                    "conf_name": context.character_config.conf_name,
                    "conf_uid": context.character_config.conf_uid,
                    "character_name": context.character_config.character_name,
                    "human_name": context.character_config.human_name,
                    "persona_prompt": context.character_config.persona_prompt,
                    "avatar_mode": context.character_config.avatar_mode,
                    "avatar_pack_id": context.character_config.avatar_pack_id,
                    "client_uid": client_uid,
                }
            )
        )

        await websocket.send_text(
            json.dumps(
                {
                    "type": "persona-updated",
                    "message": "Persona updated",
                }
            )
        )

    async def _persist_persona_config(
        self,
        character_name: str,
        human_name: str,
        persona_prompt: str,
        context: ServiceContext | None = None,
    ) -> None:
        """Persist persona settings for new sessions and restart."""
        if context and context.classroom_username:
            profile = save_profile_from_context(context, dirty=True)
            if (
                context is not self.default_context_cache
                and profile.username == self.default_context_cache.classroom_username
            ):
                await self.default_context_cache.apply_character_config(
                    context.character_config
                )
                attach_profile_metadata(self.default_context_cache, profile)
            return

        # Keep default context in sync so newly connected clients inherit latest persona.
        default_character_config = self.default_context_cache.character_config
        default_character_config.character_name = character_name
        default_character_config.human_name = human_name

        # Keep previous prompt for init_agent change detection.
        previous_prompt = default_character_config.persona_prompt
        default_character_config.persona_prompt = previous_prompt
        await self.default_context_cache.init_agent(
            default_character_config.agent_config,
            persona_prompt,
        )
        default_character_config.persona_prompt = persona_prompt

        if (
            self.default_context_cache.config
            and self.default_context_cache.config.character_config
        ):
            self.default_context_cache.config.character_config.character_name = (
                character_name
            )
            self.default_context_cache.config.character_config.human_name = human_name
            self.default_context_cache.config.character_config.persona_prompt = (
                persona_prompt
            )

        # Persist to conf.yaml so restart keeps the persona.
        conf_data = read_yaml("conf.yaml") or {}
        character_config = conf_data.setdefault("character_config", {})
        character_config["character_name"] = character_name
        character_config["human_name"] = human_name
        character_config["persona_prompt"] = persona_prompt

        with open("conf.yaml", "w", encoding="utf-8") as file:
            yaml.safe_dump(conf_data, file, allow_unicode=True, sort_keys=False)

    async def _persist_avatar_config(
        self,
        avatar_mode: str,
        live2d_model_name: str,
        avatar_pack_id: str,
        context: ServiceContext | None = None,
    ) -> None:
        """Persist avatar rendering settings for new sessions and restart."""
        if context and context.classroom_username:
            profile = save_profile_from_context(context, dirty=True)
            if (
                context is not self.default_context_cache
                and profile.username == self.default_context_cache.classroom_username
            ):
                await self.default_context_cache.apply_character_config(
                    context.character_config
                )
                attach_profile_metadata(self.default_context_cache, profile)
            return

        default_character_config = self.default_context_cache.character_config
        if default_character_config:
            default_character_config.avatar_mode = avatar_mode
            default_character_config.avatar_pack_id = avatar_pack_id
            default_character_config.live2d_model_name = live2d_model_name
            if avatar_mode == "live2d":
                self.default_context_cache.init_live2d(live2d_model_name)

        if (
            self.default_context_cache.config
            and self.default_context_cache.config.character_config
        ):
            self.default_context_cache.config.character_config.avatar_mode = avatar_mode
            self.default_context_cache.config.character_config.avatar_pack_id = (
                avatar_pack_id
            )
            self.default_context_cache.config.character_config.live2d_model_name = (
                live2d_model_name
            )

        conf_data = read_yaml("conf.yaml") or {}
        character_config = conf_data.setdefault("character_config", {})
        character_config["avatar_mode"] = avatar_mode
        character_config["avatar_pack_id"] = avatar_pack_id
        character_config["live2d_model_name"] = live2d_model_name

        with open("conf.yaml", "w", encoding="utf-8") as file:
            yaml.safe_dump(conf_data, file, allow_unicode=True, sort_keys=False)

    def _build_fallback_persona_prompt(
        self,
        character_name: str,
        persona_description: str,
    ) -> str:
        """Build a safe fallback persona prompt when LLM generation fails."""
        lines = [
            f"你是{character_name}，正在与用户进行互动。",
            f"核心设定：{persona_description}",
            "请始终保持该人设的一致性，回答简洁自然，不要偏离设定。",
            "在不确定时先澄清用户意图，再继续对话。",
        ]
        return "\n".join(lines)

    async def _generate_persona_prompt_with_llm(
        self,
        context: ServiceContext,
        character_name: str,
        persona_description: str,
    ) -> str:
        """Generate persona prompt text by reusing current session LLM."""
        agent_engine = context.agent_engine
        llm = getattr(agent_engine, "_llm", None)
        if not llm or not hasattr(llm, "chat_completion"):
            raise ValueError("Current agent does not expose a reusable LLM backend.")

        system_prompt = (
            "你是一个“角色设定提示词生成器”。"
            "你的任务是根据用户提供的角色描述，生成可直接用于对话系统的人设提示词。"
            "输出必须是纯文本，不要使用 Markdown 标题、列表符号、代码块或解释说明。"
            "请使用中文，内容清晰、结构完整、可执行。"
        )

        user_prompt = (
            f"角色名称：{character_name}\n"
            f"角色描述：{persona_description}\n\n"
            "请直接输出最终人设提示词，至少包含：\n"
            "1) 角色身份与核心设定\n"
            "2) 性格与说话风格\n"
            "3) 互动规则与边界\n"
            "4) 语言风格约束（简洁、自然）\n"
        )

        messages = [{"role": "user", "content": [{"type": "text", "text": user_prompt}]}]

        chunks: List[str] = []
        token_stream = llm.chat_completion(messages, system_prompt)
        async for event in token_stream:
            text_chunk = ""
            if isinstance(event, dict):
                if event.get("type") == "text_delta":
                    text_chunk = event.get("text", "")
            elif isinstance(event, str):
                text_chunk = event

            if text_chunk and text_chunk != "__API_NOT_SUPPORT_TOOLS__":
                chunks.append(text_chunk)

        generated_prompt = "".join(chunks).strip()
        generated_prompt = re.sub(r"^```[a-zA-Z0-9_-]*\s*", "", generated_prompt)
        generated_prompt = re.sub(r"\s*```$", "", generated_prompt).strip()

        if not generated_prompt:
            raise ValueError("Persona generation returned empty content.")

        if generated_prompt.lower().startswith("error calling the chat endpoint"):
            raise ValueError(generated_prompt)

        return generated_prompt

    async def _handle_generate_persona_prompt(
        self, websocket: WebSocket, client_uid: str, data: WSMessage
    ) -> None:
        """Generate persona prompt from free-form description."""
        context = self.client_contexts[client_uid]
        request_id = (data.get("request_id") or "").strip()
        character_name = (
            (data.get("character_name") or context.character_config.character_name or "")
            .strip()
            or context.character_config.conf_name
        )
        persona_description = (data.get("persona_description") or "").strip()

        if not persona_description:
            await websocket.send_text(
                json.dumps(
                    {
                        "type": "persona-generated",
                        "request_id": request_id,
                        "error": "persona_description cannot be empty",
                    }
                )
            )
            return

        try:
            generated_prompt = await self._generate_persona_prompt_with_llm(
                context=context,
                character_name=character_name,
                persona_description=persona_description,
            )
        except Exception as e:
            logger.error(f"Failed to generate persona prompt: {e}")
            generated_prompt = self._build_fallback_persona_prompt(
                character_name=character_name,
                persona_description=persona_description,
            )
        generated_prompt = ensure_teaching_persona_safety(generated_prompt)

        await websocket.send_text(
            json.dumps(
                {
                    "type": "persona-generated",
                    "request_id": request_id,
                    "character_name": character_name,
                    "persona_prompt": generated_prompt,
                }
            )
        )

    async def _handle_update_live2d_model(
        self, websocket: WebSocket, client_uid: str, data: WSMessage
    ) -> None:
        """Handle runtime live2d model update for current session."""
        context = self.client_contexts[client_uid]
        model_name = (data.get("live2d_model") or "").strip()
        if not model_name:
            await websocket.send_text(
                json.dumps(
                    {
                        "type": "error",
                        "message": "live2d_model is required",
                    }
                )
            )
            return

        try:
            updated_model = Live2dModel(model_name)
            context.live2d_model = updated_model
            context.character_config.live2d_model_name = model_name
            context.character_config.avatar_mode = "live2d"
        except Exception as e:
            logger.error(f"Failed to update live2d model: {e}")
            await websocket.send_text(
                json.dumps(
                    {
                        "type": "error",
                        "message": f"Failed to update live2d model: {e}",
                    }
                )
            )
            return

        await self._persist_avatar_config(
            avatar_mode=context.character_config.avatar_mode,
            live2d_model_name=context.character_config.live2d_model_name,
            avatar_pack_id=context.character_config.avatar_pack_id,
            context=context,
        )

        await websocket.send_text(
            json.dumps(
                {
                    "type": "set-model-and-conf",
                    "model_info": context.live2d_model.model_info,
                    "conf_name": context.character_config.conf_name,
                    "conf_uid": context.character_config.conf_uid,
                    "character_name": context.character_config.character_name,
                    "human_name": context.character_config.human_name,
                    "persona_prompt": context.character_config.persona_prompt,
                    "avatar_mode": context.character_config.avatar_mode,
                    "avatar_pack_id": context.character_config.avatar_pack_id,
                    "client_uid": client_uid,
                }
            )
        )

        await websocket.send_text(
            json.dumps(
                {
                    "type": "live2d-model-updated",
                    "live2d_model": model_name,
                    "message": "Live2D model updated",
                }
            )
        )

    async def _handle_update_avatar_pack(
        self, websocket: WebSocket, client_uid: str, data: WSMessage
    ) -> None:
        """Handle runtime avatar pack activation for current session."""
        context = self.client_contexts[client_uid]
        pack_id = (data.get("avatar_pack_id") or "").strip()
        if not pack_id:
            await websocket.send_text(
                json.dumps(
                    {
                        "type": "error",
                        "message": "avatar_pack_id is required",
                    }
                )
            )
            return

        if not avatar_pack_exists(pack_id):
            await websocket.send_text(
                json.dumps(
                    {
                        "type": "error",
                        "message": f"Avatar pack not found: {pack_id}",
                    }
                )
            )
            return

        context.character_config.avatar_mode = "avatarpack"
        context.character_config.avatar_pack_id = pack_id

        await self._persist_avatar_config(
            avatar_mode=context.character_config.avatar_mode,
            live2d_model_name=context.character_config.live2d_model_name,
            avatar_pack_id=context.character_config.avatar_pack_id,
            context=context,
        )

        await websocket.send_text(
            json.dumps(
                {
                    "type": "set-model-and-conf",
                    "model_info": context.live2d_model.model_info,
                    "conf_name": context.character_config.conf_name,
                    "conf_uid": context.character_config.conf_uid,
                    "character_name": context.character_config.character_name,
                    "human_name": context.character_config.human_name,
                    "persona_prompt": context.character_config.persona_prompt,
                    "avatar_mode": context.character_config.avatar_mode,
                    "avatar_pack_id": context.character_config.avatar_pack_id,
                    "client_uid": client_uid,
                }
            )
        )

        await websocket.send_text(
            json.dumps(
                {
                    "type": "avatar-pack-updated",
                    "avatar_mode": "avatarpack",
                    "avatar_pack_id": pack_id,
                    "message": "Avatar pack updated",
                }
            )
        )

    async def _handle_fetch_backgrounds(
        self, websocket: WebSocket, client_uid: str, data: WSMessage
    ) -> None:
        """Handle fetching available background images"""
        bg_files = scan_bg_directory()
        await websocket.send_text(
            json.dumps({"type": "background-files", "files": bg_files})
        )

    async def _send_tts_config(self, websocket: WebSocket, context: ServiceContext) -> None:
        """Send current TTS configuration to frontend."""
        await websocket.send_text(
            json.dumps(
                {
                    "type": "tts-config",
                    "tts_model": context.character_config.tts_config.tts_model,
                    "tts_config": context.character_config.tts_config.model_dump(),
                }
            )
        )

    def _persist_tts_config(self, validated_tts_config: TTSConfig) -> None:
        """Persist TTS config for runtime defaults and restart."""
        # Keep default context in sync so newly connected clients see latest config.
        self.default_context_cache.init_tts(validated_tts_config)
        self.default_context_cache.character_config.tts_config = validated_tts_config
        if (
            self.default_context_cache.config
            and self.default_context_cache.config.character_config
        ):
            self.default_context_cache.config.character_config.tts_config = (
                validated_tts_config
            )

        # Persist to conf.yaml so restart keeps the selection/credentials.
        conf_data = read_yaml("conf.yaml") or {}
        character_config = conf_data.setdefault("character_config", {})
        existing_tts_config = character_config.get("tts_config")
        if not isinstance(existing_tts_config, dict):
            existing_tts_config = {}

        merged_tts_config = {
            **existing_tts_config,
            **validated_tts_config.model_dump(by_alias=True, exclude_none=True),
        }
        character_config["tts_config"] = merged_tts_config

        with open("conf.yaml", "w", encoding="utf-8") as file:
            yaml.safe_dump(conf_data, file, allow_unicode=True, sort_keys=False)

    async def _handle_request_tts_config(
        self, websocket: WebSocket, client_uid: str, data: WSMessage
    ) -> None:
        """Handle frontend request for current TTS configuration."""
        context = self.client_contexts.get(client_uid)
        if not context:
            context = self.default_context_cache
        await self._send_tts_config(websocket, context)

    async def _handle_update_tts_config(
        self, websocket: WebSocket, client_uid: str, data: WSMessage
    ) -> None:
        """Handle runtime TTS engine/config update for current session."""
        context = self.client_contexts[client_uid]
        current_tts_config_dict = context.character_config.tts_config.model_dump()

        target_tts_model = (
            (data.get("tts_model") or current_tts_config_dict.get("tts_model") or "")
            .strip()
        )
        if not target_tts_model:
            await websocket.send_text(
                json.dumps(
                    {
                        "type": "error",
                        "message": "tts_model is required",
                    }
                )
            )
            return

        if target_tts_model not in current_tts_config_dict:
            await websocket.send_text(
                json.dumps(
                    {
                        "type": "error",
                        "message": f"Unknown tts_model: {target_tts_model}",
                    }
                )
            )
            return

        incoming_engine_config = data.get("engine_config")
        if incoming_engine_config is None:
            incoming_engine_config = {}
        if not isinstance(incoming_engine_config, dict):
            await websocket.send_text(
                json.dumps(
                    {
                        "type": "error",
                        "message": "engine_config must be a JSON object",
                    }
                )
            )
            return

        next_tts_config_dict = {**current_tts_config_dict, "tts_model": target_tts_model}
        current_engine_config = next_tts_config_dict.get(target_tts_model)
        if not isinstance(current_engine_config, dict):
            current_engine_config = {}
        next_tts_config_dict[target_tts_model] = {
            **current_engine_config,
            **incoming_engine_config,
        }

        try:
            validated_tts_config = TTSConfig.model_validate(next_tts_config_dict)
            context.init_tts(validated_tts_config)
            self._persist_tts_config(validated_tts_config)
        except Exception as e:
            logger.error(f"Failed to update TTS config: {e}")
            await websocket.send_text(
                json.dumps(
                    {
                        "type": "error",
                        "message": f"Failed to update TTS config: {e}",
                    }
                )
            )
            return

        await self._send_tts_config(websocket, context)
        await websocket.send_text(
            json.dumps(
                {
                    "type": "tts-updated",
                    "tts_model": context.character_config.tts_config.tts_model,
                    "message": "TTS configuration updated",
                }
            )
        )

    async def _send_knowledge_settings(
        self, websocket: WebSocket, context: ServiceContext
    ) -> None:
        """Send current session knowledge retrieval settings to frontend."""
        await websocket.send_text(
            json.dumps(
                {
                    "type": "knowledge-settings",
                    "knowledge_enabled": bool(context.knowledge_enabled),
                }
            )
        )

    async def _handle_request_knowledge_settings(
        self, websocket: WebSocket, client_uid: str, data: WSMessage
    ) -> None:
        """Handle frontend request for current knowledge retrieval settings."""
        context = self.client_contexts.get(client_uid)
        if not context:
            context = self.default_context_cache
        await self._send_knowledge_settings(websocket, context)

    async def _handle_update_knowledge_settings(
        self, websocket: WebSocket, client_uid: str, data: WSMessage
    ) -> None:
        """Handle runtime update for current-session knowledge retrieval toggle."""
        context = self.client_contexts.get(client_uid)
        if not context:
            await websocket.send_text(
                json.dumps(
                    {
                        "type": "error",
                        "message": "Client context not found",
                    }
                )
            )
            return

        raw_enabled = data.get("knowledge_enabled")
        if isinstance(raw_enabled, bool):
            next_enabled = raw_enabled
        elif isinstance(raw_enabled, str):
            lowered = raw_enabled.strip().lower()
            if lowered in {"true", "1", "yes", "on"}:
                next_enabled = True
            elif lowered in {"false", "0", "no", "off"}:
                next_enabled = False
            else:
                await websocket.send_text(
                    json.dumps(
                        {
                            "type": "error",
                            "message": "knowledge_enabled must be a boolean",
                        }
                    )
                )
                return
        else:
            await websocket.send_text(
                json.dumps(
                    {
                        "type": "error",
                        "message": "knowledge_enabled must be provided",
                    }
                )
            )
            return

        context.knowledge_enabled = next_enabled
        self.default_context_cache.knowledge_enabled = next_enabled
        await self._send_knowledge_settings(websocket, context)

    async def _handle_audio_play_start(
        self, websocket: WebSocket, client_uid: str, data: WSMessage
    ) -> None:
        """
        Handle audio playback start notification
        """
        group_members = self.chat_group_manager.get_group_members(client_uid)
        if len(group_members) > 1:
            display_text = data.get("display_text")
            if display_text:
                silent_payload = prepare_audio_payload(
                    audio_path=None,
                    display_text=display_text,
                    actions=None,
                    forwarded=True,
                )
                await self.broadcast_to_group(
                    group_members, silent_payload, exclude_uid=client_uid
                )

    async def _handle_group_info(
        self, websocket: WebSocket, client_uid: str, data: WSMessage
    ) -> None:
        """Handle group info request"""
        await self.send_group_update(websocket, client_uid)

    async def _handle_init_config_request(
        self, websocket: WebSocket, client_uid: str, data: WSMessage
    ) -> None:
        """Handle request for initialization configuration"""
        context = self.client_contexts.get(client_uid)
        if not context:
            context = self.default_context_cache

        await websocket.send_text(
            json.dumps(
                {
                    "type": "set-model-and-conf",
                    "model_info": context.live2d_model.model_info,
                    "conf_name": context.character_config.conf_name,
                    "conf_uid": context.character_config.conf_uid,
                    "character_name": context.character_config.character_name,
                    "human_name": context.character_config.human_name,
                    "persona_prompt": context.character_config.persona_prompt,
                    "avatar_mode": context.character_config.avatar_mode,
                    "avatar_pack_id": context.character_config.avatar_pack_id,
                    "client_uid": client_uid,
                }
            )
        )

    async def _handle_heartbeat(
        self, websocket: WebSocket, client_uid: str, data: WSMessage
    ) -> None:
        """Handle heartbeat messages from clients"""
        try:
            await websocket.send_json({"type": "heartbeat-ack"})
        except Exception as e:
            logger.error(f"Error sending heartbeat acknowledgment: {e}")
