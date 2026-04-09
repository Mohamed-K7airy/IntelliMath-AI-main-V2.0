import dspy
from pydantic import BaseModel
from datetime import datetime
import os
from .generate_embeddings import generate_embeddings
from .vectordb import (
    EmbeddedMemory,
    RetrievedMemory,
    delete_records,
    fetch_all_user_records,
    insert_memories,
    search_memories,
)

dspy.configure_cache(
    enable_disk_cache=False,
    enable_memory_cache=False,
)

class MemoryWithIds(BaseModel):
    memory_id: int
    memory_text: str
    memory_categories: list[str]


class UpdateMemorySignature(dspy.Signature):
    """
    You will be given the conversation between user and assistant and some similar memories from the database. Your goal is to decide how to combine the new memories into the database with the existing memories.

    Actions meaning:
    - ADD: add new memories into the database as a new memory
    - UPDATE: update an existing memory with richer information.
    - DELETE: remove memory items from the database that aren't required anymore due to new information
    - NOOP: No need to take any action

    If no action is required you can finish.

    Think less and do actions.
    """

    messages: list[dict] = dspy.InputField()
    existing_memories: list[MemoryWithIds] = dspy.InputField()
    summary: str = dspy.OutputField(
        description="Summarize what you did. Very short (less than 10 words)"
    )


async def update_memories_agent(
    user_id: str, messages: list[dict], existing_memories: list[RetrievedMemory]
):

    def get_point_id_from_memory_id(memory_id):
        return existing_memories[memory_id].point_id

    async def add_memory(memory_text: str, categories: list[str]) -> str:
        """
        Add the new_memory into the database.
        """
        print(f"Adding memory for {user_id}: {memory_text}")

        embeddings = await generate_embeddings([memory_text])
        await insert_memories(
            memories=[
                EmbeddedMemory(
                    user_id=user_id,
                    memory_text=memory_text,
                    categories=categories,
                    date=datetime.now().strftime("%Y-%m-%d %H:%M"),
                    embedding=embeddings[0],
                )
            ]
        )
        return f"Memory: '{memory_text}' was added to DB"

    async def update(memory_id: int, updated_memory_text: str, categories: list[str]):
        """
        Updating memory_id to use updated_memory_text
        """
        point_id = get_point_id_from_memory_id(memory_id)
        await delete_records([point_id])

        embeddings = await generate_embeddings([updated_memory_text])

        await insert_memories(
            memories=[
                EmbeddedMemory(
                    user_id=user_id,
                    memory_text=updated_memory_text,
                    categories=categories,
                    date=datetime.now().strftime("%Y-%m-%d %H:%M"),
                    embedding=embeddings[0],
                )
            ]
        )
        return f"Memory {memory_id} has been updated"

    async def noop():
        return "No action done"

    async def delete(memory_ids: list[int]):
        print(f"Deleting memories for {user_id}")
        point_ids = [get_point_id_from_memory_id(mid) for mid in memory_ids]
        await delete_records(point_ids)
        return f"Memories deleted"

    memory_updater = dspy.ReAct(
        UpdateMemorySignature, tools=[add_memory, update, delete, noop], max_iters=3
    )
    memory_ids = [
        MemoryWithIds(
            memory_id=idx, memory_text=m.memory_text, memory_categories=m.categories
        )
        for idx, m in enumerate(existing_memories)
    ]

    groq_api_key = os.getenv("GROQ_API_KEY")
    with dspy.context(
        lm=dspy.LM(
            model="groq/llama-3.3-70b-versatile",
            max_tokens=1024,
            api_key=groq_api_key
        )
    ):
        out = await memory_updater.acall(
            messages=messages, existing_memories=memory_ids
        )
    return out.summary


async def update_memories(user_id: str, messages: list[dict]):
    try:
        latest_user_message = [x["content"] for x in messages if x["role"] == "user"][-1]
        embedding = (await generate_embeddings([latest_user_message]))[0]

        retrieved_memories = await search_memories(search_vector=embedding, user_id=user_id)

        response = await update_memories_agent(
            user_id=user_id, existing_memories=retrieved_memories, messages=messages
        )
        return response
    except Exception as e:
        print(f"Error updating memory: {e}")
        return "Error updating memory"
