import os
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)


def view_memories():
    try:
        result = (
            supabase.table("memories")
            .select("id, user_id, memory_text, categories, date")
            .execute()
        )

        rows = result.data or []

        if not rows:
            print("No memories found in the database.")
            return

        print(f"Found {len(rows)} memories:\n")
        print("-" * 80)

        for row in rows:
            print(f"ID: {row['id']}")
            print(f"User: {row['user_id']}")
            print(f"Date: {row.get('date', 'Unknown')}")
            cats = row.get("categories", []) or []
            print(f"Categories: {', '.join(cats) if isinstance(cats, list) else cats}")
            print(f"Content: {row['memory_text']}")
            print("-" * 80)

    except Exception as e:
        print(f"Error reading memories: {e}")


if __name__ == "__main__":
    view_memories()
