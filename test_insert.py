import asyncio
from backend.memory.vectordb import insert_memories, EmbeddedMemory

async def test():
    print("Testing Supabase insert...")
    try:
        mem = EmbeddedMemory(
            user_id="c9a662e5-9b5d-4ef1-a51f-fde0d3dc33fc", # A valid UUID structure for test
            memory_text="User is testing the system locally.",
            categories=["test"],
            date="2026-04-10 01:00",
            embedding=[0.1] * 384
        )
        await insert_memories([mem])
        print("✅ Insert successful!")
    except Exception as e:
        print(f"❌ Insert failed: {e}")

if __name__ == "__main__":
    asyncio.run(test())
